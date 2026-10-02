import { translateError } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { isTransient, MAX_RETRIES, parseJsonWithBigInts, REQUEST_TIMEOUT_MS, Transport } from './transport.ts';

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

  it('retries transient failures up to twice, then gives up with the last error', async () => {
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
    expect(translateError(error).code).toBe('network');
  });

  it('a retry that succeeds hides the failure; 429 and 503 are transient', async () => {
    const answers = [
      () => new Response('slow down', { status: 429, statusText: 'Too Many Requests' }),
      () => new Response('', { status: 503 }),
      () => jsonResponse({ jsonrpc: '2.0', id: 3, result: 'ok' }),
    ];
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

  it('does not retry what a retry cannot fix: a refused method, other HTTP statuses, a program error', async () => {
    let calls = 0;
    const transport = new Transport({
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32601, message: 'Method not allowed' } }, 400),
        );
      },
      sleep: noSleep,
    });
    const refused: unknown = await transport.rpc('/api/rpc', 'getProgramAccounts', [], { retries: 2 }).catch((e: unknown) => e);
    expect(calls).toBe(1);
    expect(translateError(refused).code).toBe('unknown');
    expect(isTransient(refused)).toBe(false);

    const forbidden = new Transport({ fetch: () => Promise.resolve(new Response('nope', { status: 403 })), sleep: noSleep });
    const error: unknown = await forbidden.getJson('/api/stake-accounts', { retries: 2 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ context: { statusCode: 403 } });
    expect(translateError(error).code).toBe('unknown');
  });

  it('times out after 8 s by default (TimeoutError, translateError: network) and aborts the request', async () => {
    expect(REQUEST_TIMEOUT_MS).toBe(8_000);
    let aborted = false;
    const transport = new Transport({
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
      sleep: noSleep,
    });
    const error: unknown = await transport.rpc('/api/rpc', 'getBalance', [], { retries: 0 }).catch((e: unknown) => e);
    expect(aborted).toBe(true);
    expect(error).toMatchObject({ name: 'TimeoutError' });
    expect(translateError(error).code).toBe('network');
  });

  it('a body that is not JSON-RPC is an error, not data', async () => {
    const transport = new Transport({ fetch: () => Promise.resolve(new Response('<html>')), sleep: noSleep });
    await expect(transport.rpc('/api/rpc', 'getBalance', [], { retries: 0 })).rejects.toThrow();
    const empty = new Transport({ fetch: () => Promise.resolve(jsonResponse({ jsonrpc: '2.0', id: 1 })), sleep: noSleep });
    await expect(empty.rpc('/api/rpc', 'getBalance', [], { retries: 0 })).rejects.toThrow(/no result/);
  });
});
