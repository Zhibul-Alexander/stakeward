import { isAddress, isSignature } from '@solana/kit';
import { MAX_TRANSACTION_BYTES } from '@stakeward/core';
import * as z from 'zod';

/**
 * What POST /api/rpc lets through (CLAUDE.md section 8): one JSON-RPC 2.0 request object, a method from the list
 * and, for each method, only the parameter shapes the site uses. Config objects are strict: an unknown key is an
 * error, not something to drop. Values are checked as tightly as the RPC defines them.
 */

/** Base64 length of the largest wire transaction core accepts (1232 bytes, the packet size). */
const MAX_TRANSACTION_BASE64 = 4 * Math.ceil(MAX_TRANSACTION_BYTES / 3);
/** Largest Solana account (10 MiB): bounds dataSlice and getMinimumBalanceForRentExemption. */
const MAX_ACCOUNT_BYTES = 10 * 1024 * 1024;
/** RPC limits: getMultipleAccounts takes 100 keys, getSignatureStatuses 256 signatures. */
export const MAX_MULTIPLE_ACCOUNTS = 100;
export const MAX_SIGNATURE_STATUSES = 256;

const address = z.string().refine(isAddress, 'Expected a base58 address');
const signature = z.string().refine(isSignature, 'Expected a base58 transaction signature');
const commitment = z.enum(['processed', 'confirmed', 'finalized']);
const slot = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const transaction = z
  .string()
  .min(1)
  .max(MAX_TRANSACTION_BASE64)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Expected a base64 transaction');

const contextConfig = z.strictObject({ commitment: commitment.optional(), minContextSlot: slot.optional() });

const accountBytes = z.number().int().min(0).max(MAX_ACCOUNT_BYTES);

const accountConfig = z.strictObject({
  encoding: z.literal('base64'),
  commitment: commitment.optional(),
  dataSlice: z.strictObject({ offset: accountBytes, length: accountBytes }).optional(),
  minContextSlot: slot.optional(),
});

const simulateConfig = z
  .strictObject({
    encoding: z.literal('base64'),
    commitment: commitment.optional(),
    sigVerify: z.boolean().optional(),
    replaceRecentBlockhash: z.boolean().optional(),
    minContextSlot: slot.optional(),
  })
  .refine((config) => config.sigVerify !== true || config.replaceRecentBlockhash !== true, {
    message: 'sigVerify and replaceRecentBlockhash cannot both be true',
  });

const sendConfig = z.strictObject({
  encoding: z.literal('base64'),
  skipPreflight: z.boolean().optional(),
  preflightCommitment: commitment.optional(),
  maxRetries: z.number().int().min(0).max(100).optional(),
  minContextSlot: slot.optional(),
});

/** Positional params of every allowed method. A trailing optional config may be left out. */
export const METHOD_PARAMS = {
  getLatestBlockhash: z.tuple([contextConfig.optional()]),
  getAccountInfo: z.tuple([address, accountConfig]),
  getMultipleAccounts: z.tuple([z.array(address).min(1).max(MAX_MULTIPLE_ACCOUNTS), accountConfig]),
  getBalance: z.tuple([address, contextConfig.optional()]),
  getEpochInfo: z.tuple([contextConfig.optional()]),
  getMinimumBalanceForRentExemption: z.tuple([
    accountBytes,
    z.strictObject({ commitment: commitment.optional() }).optional(),
  ]),
  getSignatureStatuses: z.tuple([
    z.array(signature).min(1).max(MAX_SIGNATURE_STATUSES),
    z.strictObject({ searchTransactionHistory: z.literal(false).optional() }).optional(),
  ]),
  simulateTransaction: z.tuple([transaction, simulateConfig]),
  sendTransaction: z.tuple([transaction, sendConfig]),
} as const;

export type AllowedMethod = keyof typeof METHOD_PARAMS;

export function isAllowedMethod(method: string): method is AllowedMethod {
  return Object.hasOwn(METHOD_PARAMS, method);
}

/** JSON-RPC 2.0 request object. `id` is required: notifications get no answer, and every call here needs one. */
export const jsonRpcRequest = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string().max(64), z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)]),
  method: z.string().max(64),
  params: z.unknown().optional(),
});

export type JsonRpcId = z.infer<typeof jsonRpcRequest>['id'];

/** First problem of a failed parse, as `<root><path>: message`, short enough for an error response. */
export function describeIssue(error: z.ZodError, root: string): string {
  const issue = error.issues[0];
  if (issue === undefined) return `${root}: invalid value`;
  const path = issue.path.map((part) => (typeof part === 'number' ? `[${String(part)}]` : `.${String(part)}`)).join('');
  return `${root}${path}: ${issue.message}`;
}
