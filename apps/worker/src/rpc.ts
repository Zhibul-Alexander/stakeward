import { inspectTransaction, verifyAllSignatures } from '@stakeward/core';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { decodeBase64, encodeBase64 } from './base64.ts';
import { describeIssue, isAllowedMethod, jsonRpcRequest, METHOD_PARAMS, type JsonRpcId } from './rpc-params.ts';
import { callUpstream, type UpstreamOptions } from './upstream.ts';
import type { AppEnv } from './app.ts';

/**
 * POST /api/rpc: the browser's only way to the chain (CLAUDE.md sections 3 and 8). One JSON-RPC request object per
 * call, an allow-listed method, strict params. simulateTransaction and sendTransaction pass only if the inspector
 * accepts the bytes; sendTransaction also needs every signature present and valid. What goes upstream is rebuilt
 * from the validated request (and the inspected bytes), never the client's text. Upstream answers come back as they
 * are, with HTTP 200; our own rejections are JSON-RPC errors with HTTP 200 too, so kit surfaces their codes.
 *
 * Refused transactions use codes kit knows, never a custom one: outside production builds kit 8.4 throws a TypeError
 * while formatting an unknown JSON-RPC code, and a TypeError reads as a network error. Signature problems are -32003
 * (what a node answers for bad signatures; kit keeps `data` as the error context), any other inspector refusal is
 * -32602 with the inspector code in the message. `data` carries the details for clients that read the body.
 */

export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** Rate limited (HTTP 429). Same code Solana nodes use for "try again later". */
  rateLimited: -32005,
  /** A signature is missing or does not verify (kit: SERVER_ERROR_TRANSACTION_SIGNATURE_VERIFICATION_FAILURE). */
  signatureVerificationFailure: -32003,
} as const;

/** Largest body of a legitimate request: getSignatureStatuses with 256 signatures is about 23.5 KB. */
export const MAX_RPC_BODY_BYTES = 32 * 1024;

export type TransactionRejection =
  | { check: 'inspector'; code: string; message: string }
  | { check: 'signatures'; code: string; signers: readonly string[]; message: string };

export function jsonRpcError(
  c: Context,
  status: ContentfulStatusCode,
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: TransactionRejection,
): Response {
  const error = data === undefined ? { code, message } : { code, message, data };
  return c.json({ jsonrpc: '2.0', id, error }, status);
}

export function rpcHandler(upstreamOptions: UpstreamOptions) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const contentType = c.req.header('Content-Type') ?? '';
    if (!/^application\/json\s*(;|$)/i.test(contentType)) {
      return jsonRpcError(c, 415, null, JSON_RPC_ERRORS.invalidRequest, 'Content-Type must be application/json');
    }

    let body: unknown;
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      return jsonRpcError(c, 200, null, JSON_RPC_ERRORS.parseError, 'Parse error');
    }
    if (Array.isArray(body)) {
      return jsonRpcError(c, 200, null, JSON_RPC_ERRORS.invalidRequest, 'Batch requests are not supported');
    }
    const envelope = jsonRpcRequest.safeParse(body);
    if (!envelope.success) {
      return jsonRpcError(c, 200, idOf(body), JSON_RPC_ERRORS.invalidRequest, describeIssue(envelope.error, 'request'));
    }
    const { id, method } = envelope.data;
    if (!isAllowedMethod(method)) {
      return jsonRpcError(c, 200, id, JSON_RPC_ERRORS.methodNotFound, `Method not allowed: ${method}`);
    }
    const parsed = METHOD_PARAMS[method].safeParse(envelope.data.params ?? []);
    if (!parsed.success) {
      return jsonRpcError(c, 200, id, JSON_RPC_ERRORS.invalidParams, describeIssue(parsed.error, 'params'));
    }
    const params: unknown[] = [...parsed.data];

    if (method === 'simulateTransaction' || method === 'sendTransaction') {
      const encoded = params[0] as string;
      const bytes = decodeBase64(encoded);
      if (bytes === null) {
        return jsonRpcError(c, 200, id, JSON_RPC_ERRORS.invalidParams, 'params[0]: Expected canonical base64');
      }
      const inspected = await inspectTransaction(bytes);
      if (!inspected.ok) {
        const { code, message } = inspected.error;
        const rpcCode =
          code === 'invalid-signature' ? JSON_RPC_ERRORS.signatureVerificationFailure : JSON_RPC_ERRORS.invalidParams;
        return jsonRpcError(c, 200, id, rpcCode, `Transaction rejected by inspector: ${code}`, {
          check: 'inspector',
          code,
          message,
        });
      }
      if (method === 'sendTransaction') {
        const signatures = await verifyAllSignatures(bytes);
        if (!signatures.ok) {
          const { code, signers, message } = signatures.error;
          const rejection = { check: 'signatures', code, signers, message } as const;
          const text = `Transaction rejected: ${code}`;
          return jsonRpcError(c, 200, id, JSON_RPC_ERRORS.signatureVerificationFailure, text, rejection);
        }
      }
      params[0] = encodeBase64(bytes);
    }

    const rpcUrl = c.env.RPC_URL;
    if (rpcUrl === '') {
      return jsonRpcError(c, 503, id, JSON_RPC_ERRORS.internalError, 'RPC is not configured');
    }
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const result = await callUpstream(
      { primary: rpcUrl, fallback: c.env.RPC_FALLBACK_URL },
      payload,
      method === 'sendTransaction' ? 'send' : 'read',
      upstreamOptions,
    );
    if (!result.ok) {
      return result.reason === 'timeout'
        ? jsonRpcError(c, 504, id, JSON_RPC_ERRORS.internalError, 'Upstream RPC timed out')
        : jsonRpcError(c, 502, id, JSON_RPC_ERRORS.internalError, 'Upstream RPC unavailable');
    }
    return c.body(result.body, 200, { 'Content-Type': 'application/json; charset=utf-8' });
  };
}

/** The request's id when it is a valid one, for error responses to otherwise invalid requests. */
function idOf(body: unknown): JsonRpcId | null {
  if (typeof body !== 'object' || body === null || !('id' in body)) return null;
  const parsed = jsonRpcRequest.shape.id.safeParse(body.id);
  return parsed.success ? parsed.data : null;
}
