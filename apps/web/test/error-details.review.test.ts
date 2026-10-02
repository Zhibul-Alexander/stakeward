// @vitest-environment node
import { getSolanaErrorFromJsonRpcError } from '@solana/kit';
import { translateError } from '@stakeward/core';
import { afterEach, describe, expect, it } from 'vitest';
import { Transport } from '@/ports/transport';

/**
 * UX rule 8: the raw error text sits under "Details". The shipped site is a production build, where kit replaces every
 * SolanaError message with "Solana error #<code>; Decode this error by running `npx @solana/errors decode ...`".
 * `translateError(...).detail` is built from `error.message`, so in production the worker's own words (the inspector
 * refusal code, the upstream node's message) never reach "Details". Vitest runs kit in development mode, which hides
 * this; the test switches kit to its production messages the way the built site runs it.
 */
const previous = process.env['NODE_ENV'];

afterEach(() => {
  process.env['NODE_ENV'] = previous;
});

describe('error Details in the production build', () => {
  it('keeps the worker inspector refusal under Details', () => {
    process.env['NODE_ENV'] = 'production';
    const error = getSolanaErrorFromJsonRpcError({
      code: -32602,
      message: 'Transaction rejected by inspector: bad-lighthouse-tail',
      data: { check: 'inspect', code: 'bad-lighthouse-tail', message: 'Lighthouse instruction is not at the end' },
    });
    const { detail } = translateError(error);
    // Fails today: detail is "SolanaError: Solana error #-32602; Decode this error by running `npx @solana/errors ..."
    expect(detail).toContain('bad-lighthouse-tail');
  });

  it("keeps the upstream node's message under Details", async () => {
    process.env['NODE_ENV'] = 'production';
    // kit keeps no context for -32005 without data, so the message must be kept where the site turns the JSON-RPC
    // error into kit's (the transport; fix round of step 3: the original test built the error with kit directly,
    // where the message is gone before translateError sees it).
    const transport = new Transport({
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'Node is behind by 1200 slots' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    });
    const error: unknown = await transport.rpc('/api/rpc', 'getEpochInfo', [], { retries: 0 }).then(
      () => null,
      (reason: unknown) => reason,
    );
    const friendly = translateError(error);
    expect(friendly.code).toBe('network');
    expect(friendly.detail).toContain('Node is behind by 1200 slots');
  });
});
