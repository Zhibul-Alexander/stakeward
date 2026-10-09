import { isSolanaError, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE } from '@solana/kit';
import { translateError } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
// The worker's upstream budget, to keep the browser's timeout above it (test-only import across the two apps).
import { DEFAULT_UPSTREAM_OPTIONS } from '../../../worker/src/upstream.ts';
import {
  isRetryable,
  MAX_RETRIES,
  parseJsonWithBigInts,
  REQUEST_TIMEOUT_MS,
  Transport,
  WORKER_READ_BUDGET_MS,
} from './transport.ts';

const noSleep = () => Promise.resolve();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('parseJsonWithBigInts', () => {
  it('reads every integer as a bigint, exactly, and leaves other values alone', () => {
    const text =
      '{"lamports":18446744073709551615,"neg":-42,"zero":0,"float":0.25,"exp":1e3,"s":"12 \\"34\\" 5","list":[1,2.5,[3]],"t":true,"n":null}';
    expect(parseJsonWithBigInts(text)).toEqual({
      lamports: 18_446_744_073_709_551_615n,
      neg: -42n,
      zero: 0n,
      float: 0.25,
      exp: 1000,
      s: '12 "34" 5',
      list: [1n, 2.5, [3n]],
      t: true,
      n: null,
    });
  });

  it('does not touch digits inside strings, escaped quotes and backslashes included', () => {
    expect(parseJsonWithBigInts('["a\\\\", 7, "\\\\\\"9\\"", "x:1"]')).toEqual(['a\\', 7n, '\\"9"', 'x:1']);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseJsonWithBigInts('{"a":')).toThrow();
  });
});

describe('Transport', () => {
  it('posts a JSON-RPC 2.0 call and returns its result', async () => {
    const requests: unknown[] = [];
    const transport = new Transport({
      fetch: (_url, init) => {
        requests.push(JSON.parse(init?.body as string));
        return Promise.resolve(jsonResponse({ jsonrpc: '2.0', id: 1, result: { value: 5 } }));
      },
    });
    expect(await transport.rpc('/api/rpc', 'getBalance', ['x'], { retries: 0 })).toEqual({ value: 5n });
    expect(requests).toEqual([{ jsonrpc: '2.0', id: 1, method: 'getBalance', params: ['x'] }]);
  });

  it('throws JSON-RPC errors as kit SolanaErrors (translateError reads them)', async () => {
    const transport = new Transport({
      fetch: () => Promise.resolve(jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'Node is behind' } })),
      sleep: noSleep,
    });
    const error: unknown = await transport.rpc('/api/rpc', 'getEpochInfo', [], { retries: 0 }).catch((e: unknown) => e);
    expect(translateError(error).code).toBe('network');
  });

  it("keeps the server's message and kit's context and cause for Details", async () => {
    const preflight = {
      code: -32002,
      message: 'Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1',
      data: { err: { InstructionError: [2, { Custom: 1 }] }, logs: ['Program log: ERROR: Custom program error: 0x1'] },
    };
    const transport = new Transport({ fetch: () => Promise.resolve(jsonResponse({ jsonrpc: '2.0', id: 1, error: preflight })) });
    const error: unknown = await transport.rpc('/api/rpc', 'sendTransaction', [], { retries: 0 }).catch((e: unknown) => e);
    expect(isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)).toBe(true);
    if (!isSolanaError(error)) throw new Error('not a SolanaError');
    expect(error.context).toMatchObject({ __serverMessage: preflight.message, logs: preflight.data.logs });
    expect(isSolanaError(error.cause)).toBe(true);
    const { detail } = translateError(error);
    expect(detail).toContain(preflight.message);
    expect(detail).toContain('Program log: ERROR: Custom program error: 0x1');
    expect(detail).toMatch(/Caused by SolanaError/);
  });

  it('retries when no answer arrived (fetch failed) up to twice, then gives up with the last error', async () => {
    let calls = 0;
    const transport = new Transport({
      fetch: () => {
        calls += 1;
        return Promise.reject(new TypeError('Failed to fetch'));
      },
      sleep: noSleep,
    });
    const error: unknown = await transport.rpc('/api/rpc', 'getBalance', [], { retries: MAX_RETRIES }).catch((e: unknown) => e);
    expect(calls).toBe(1 + MAX_RETRIES);
    expect(isRetryable(error)).toBe(true);
    expect(translateError(error).code).toBe('network');
  });

  it('a retry that succeeds hides the failure: a broken-off body and HTTP 503 (the Worker could not run) are retried', async () => {
    const brokenBody = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('network error'));
          },
        }),
      );
    const answers = [brokenBody, () => new Response('', { status: 503 }), () => jsonResponse({ jsonrpc: '2.0', id: 3, result: 'ok' })];
    const delays: number[] = [];
    const transport = new Transport({
      fetch: () => Promise.resolve((answers.shift() ?? answers[0])?.() ?? new Response('', { status: 500 })),
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });
    expect(await transport.rpc('/api/rpc', 'getEpochInfo', [], { retries: 2 })).toBe('ok');
    expect(delays).toEqual([500, 1_500]);
  });

  it('does not retry what the worker answered: 502/504 after its own upstream retries, 429, other statuses, JSON-RPC errors', async () => {
    const answers: [string, () => Response, string][] = [
      ['502 upstream unavailable', () => jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Upstream RPC unavailable' } }, 502), 'network'],
      ['504 upstream timed out', () => jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Upstream RPC timed out' } }, 504), 'network'],
      ['500', () => new Response('', { status: 500 }), 'network'],
      ['408', () => new Response('', { status: 408 }), 'network'],
      ['429 rate limit', () => jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'Too many requests' } }, 429), 'rate-limited'],
      ['400 refused method', () => jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32601, message: 'Method not allowed' } }, 400), 'unknown'],
      ['403', () => new Response('nope', { status: 403 }), 'unknown'],
      ['node behind (-32005)', () => jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'Node is behind' } }), 'network'],
      ['internal error (-32603)', () => jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } }), 'network'],
      [
        'inspector refusal',
        () => jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Transaction rejected by inspector: bad-layout', data: { check: 'inspector', code: 'bad-layout' } } }),
        'rejected-by-inspector',
      ],
    ];
    for (const [name, answer, code] of answers) {
      let calls = 0;
      const transport = new Transport({
        fetch: () => {
          calls += 1;
          return Promise.resolve(answer());
        },
        sleep: noSleep,
      });
      const error: unknown = await transport.rpc('/api/rpc', 'getBalance', [], { retries: MAX_RETRIES }).catch((e: unknown) => e);
      expect(calls, name).toBe(1);
      expect(isRetryable(error), name).toBe(false);
      expect(translateError(error).code, name).toBe(code);
    }

    const forbidden = new Transport({ fetch: () => Promise.resolve(new Response('nope', { status: 403 })), sleep: noSleep });
    const error: unknown = await forbidden.getJson('/api/stake-accounts', { retries: 2 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ context: { statusCode: 403 } });
    expect(translateError(error).code).toBe('unknown');
  });

  it("times out after 30 s by default, longer than the worker's longest answer", () => {
    const { timeoutMs, retryDelayMs } = DEFAULT_UPSTREAM_OPTIONS;
    // A read: three upstream attempts, pauses of 1 x and 2 x retryDelayMs (apps/worker/src/upstream.ts).
    expect(WORKER_READ_BUDGET_MS).toBe(3 * timeoutMs + retryDelayMs + 2 * retryDelayMs);
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(WORKER_READ_BUDGET_MS + 2_000);
  });

  it('a timeout is a TimeoutError (translateError: network), aborts the request and is retried', async () => {
    let calls = 0;
    let aborted = 0;
    const transport = new Transport({
      timeoutMs: 20,
      fetch: (_url, init) => {
        calls += 1;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted += 1;
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      },
      sleep: noSleep,
    });
    const error: unknown = await transport.rpc('/api/rpc', 'getBalance', [], { retries: 1 }).catch((e: unknown) => e);
    expect(calls).toBe(2);
    expect(aborted).toBe(2);
    expect(error).toMatchObject({ name: 'TimeoutError' });
    expect(isRetryable(error)).toBe(true);
    expect(translateError(error).code).toBe('network');
  });

  it('a body that is not JSON-RPC is an error, not data', async () => {
    const transport = new Transport({ fetch: () => Promise.resolve(new Response('<html>')), sleep: noSleep });
    await expect(transport.rpc('/api/rpc', 'getBalance', [], { retries: 0 })).rejects.toThrow();
    const empty = new Transport({ fetch: () => Promise.resolve(jsonResponse({ jsonrpc: '2.0', id: 1 })), sleep: noSleep });
    await expect(empty.rpc('/api/rpc', 'getBalance', [], { retries: 0 })).rejects.toThrow(/no result/);
  });
});
