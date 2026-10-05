import { afterEach, describe, expect, it, vi } from 'vitest';
import { attemptPost, callUpstream } from '../src/upstream.ts';
import { errorOf, FALLBACK_URL, fakeUpstream, PRIMARY_URL, rpcResponse, testApp } from './fakes.ts';
import { b64, signedProtect } from './transactions.ts';

const EPOCH_INFO = { jsonrpc: '2.0', id: 1, method: 'getEpochInfo', params: [] };

function failing(status: number) {
  return new Response('upstream says no', { status });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('upstream RPC: reads retry and fall back', () => {
  it('retries the primary twice when there is no fallback (3 attempts), then answers 502', async () => {
    const upstream = fakeUpstream(() => failing(503));
    const res = await testApp(upstream).rpc(EPOCH_INFO);
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toEqual({ code: -32603, message: 'Upstream RPC unavailable' });
    expect(upstream.calls.map((c) => c.endpoint)).toEqual(['primary', 'primary', 'primary']);
  });

  it('succeeds on a retry after a network error', async () => {
    const upstream = fakeUpstream((c, i) => (i === 0 ? 'network-error' : rpcResponse(c.json.id, { epoch: 1047 })));
    const res = await testApp(upstream).rpc(EPOCH_INFO);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: '2.0', id: 1, result: { epoch: 1047 } });
    expect(upstream.calls).toHaveLength(2);
  });

  it('asks the fallback when the primary fails, and stops at the first answer', async () => {
    const upstream = fakeUpstream((c) => (c.endpoint === 'primary' ? failing(429) : rpcResponse(c.json.id, { epoch: 1 })));
    const res = await testApp(upstream, { fallback: true }).rpc(EPOCH_INFO);
    expect(res.status).toBe(200);
    expect(upstream.calls.map((c) => c.endpoint)).toEqual(['primary', 'fallback']);
    // The fallback gets the same validated request.
    expect(upstream.calls[1]?.raw).toBe(upstream.calls[0]?.raw);
  });

  it('alternates primary, fallback, primary and then gives up', async () => {
    const upstream = fakeUpstream(() => failing(500));
    const res = await testApp(upstream, { fallback: true }).rpc(EPOCH_INFO);
    expect(res.status).toBe(502);
    expect(upstream.calls.map((c) => c.endpoint)).toEqual(['primary', 'fallback', 'primary']);
  });

  it('treats any non-2xx status as a failure (e.g. a revoked key: 401) and uses the fallback', async () => {
    const upstream = fakeUpstream((c) => (c.endpoint === 'primary' ? failing(401) : rpcResponse(c.json.id, 1)));
    const res = await testApp(upstream, { fallback: true }).rpc(EPOCH_INFO);
    expect(res.status).toBe(200);
  });

  it('simulateTransaction is a read: it is retried and may use the fallback', async () => {
    const { bytes } = await signedProtect();
    const upstream = fakeUpstream((c) => (c.endpoint === 'primary' ? failing(503) : rpcResponse(c.json.id, { value: {} })));
    const res = await testApp(upstream, { fallback: true }).rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: [b64(bytes), { encoding: 'base64' }],
    });
    expect(res.status).toBe(200);
    expect(upstream.calls.map((c) => c.endpoint)).toEqual(['primary', 'fallback']);
  });
});

describe('upstream RPC: the endpoint that answered, and pinned reads', () => {
  const options = (upstream: { fetch: typeof fetch }) => ({ timeoutMs: 200, retryDelayMs: 0, fetch: upstream.fetch });
  const both = { primary: PRIMARY_URL, fallback: FALLBACK_URL };

  it('a read says which endpoint answered', async () => {
    const primary = fakeUpstream((c) => rpcResponse(c.json.id, 1));
    expect(await callUpstream(both, '{}', 'read', options(primary))).toMatchObject({ ok: true, endpoint: 'primary' });
    const fallback = fakeUpstream((c) => (c.endpoint === 'primary' ? failing(503) : rpcResponse(c.json.id, 1)));
    expect(await callUpstream(both, '{}', 'read', options(fallback))).toMatchObject({ ok: true, endpoint: 'fallback' });
  });

  it('a read pinned to an endpoint makes all three attempts there and never asks the other', async () => {
    const down = fakeUpstream(() => failing(503));
    expect(await callUpstream(both, '{}', 'read', options(down), 'fallback')).toEqual({ ok: false, reason: 'unavailable' });
    expect(down.calls.map((c) => c.endpoint)).toEqual(['fallback', 'fallback', 'fallback']);

    const primaryOnly = fakeUpstream((c, i) => (i < 2 ? failing(503) : rpcResponse(c.json.id, 1)));
    expect(await callUpstream(both, '{}', 'read', options(primaryOnly), 'primary')).toMatchObject({ ok: true, endpoint: 'primary' });
    expect(primaryOnly.calls.map((c) => c.endpoint)).toEqual(['primary', 'primary', 'primary']);

    // Without a fallback set, a fallback pin is the primary.
    const single = fakeUpstream((c) => rpcResponse(c.json.id, 1));
    const result = await callUpstream({ primary: PRIMARY_URL }, '{}', 'read', options(single), 'fallback');
    expect(result).toMatchObject({ ok: true, endpoint: 'primary' });
    expect(single.calls.map((c) => c.endpoint)).toEqual(['primary']);
  });
});

describe('upstream RPC: a cap on the answer', () => {
  it('a read with maxBodyBytes stops reading past it: too-large, no retry, the stream cancelled', async () => {
    // 1 MB in 4 KB chunks.
    let pulls = 0;
    let cancelled = false;
    const huge = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull: (controller) => {
            pulls += 1;
            controller.enqueue(new Uint8Array(4_096).fill(0x20));
            if (pulls === 256) controller.close();
          },
          cancel: () => {
            cancelled = true;
          },
        }),
      );
    const upstream = fakeUpstream(huge);
    const options = { timeoutMs: 1_000, retryDelayMs: 0, fetch: upstream.fetch, maxBodyBytes: 10_000 };
    const result = await callUpstream({ primary: PRIMARY_URL, fallback: FALLBACK_URL }, '{}', 'read', options);
    // Not the result itself: a diff of a megabyte of body text would hang the reporter.
    expect(result.ok ? `read ${String(result.body.length)} characters` : result.reason).toBe('too-large');
    expect(upstream.calls).toHaveLength(1);
    expect(pulls).toBeLessThanOrEqual(5);
    expect(cancelled).toBe(true);
  });

  it('an answer within maxBodyBytes is read as usual; a Content-Length over it is refused unread', async () => {
    const options = (upstream: { fetch: typeof fetch }) => ({ timeoutMs: 1_000, retryDelayMs: 0, fetch: upstream.fetch, maxBodyBytes: 100 });
    const small = fakeUpstream((c) => rpcResponse(c.json.id, 1));
    expect(await callUpstream({ primary: PRIMARY_URL }, '{}', 'read', options(small))).toMatchObject({ ok: true });
    const declared = fakeUpstream(() => new Response('x'.repeat(101), { headers: { 'Content-Length': '101' } }));
    const refused = await callUpstream({ primary: PRIMARY_URL }, '{}', 'read', options(declared));
    expect(refused.ok ? `read ${String(refused.body.length)} characters` : refused.reason).toBe('too-large');
  });
});

describe('upstream RPC: sendTransaction', () => {
  it('makes one attempt on the primary only, even with a fallback configured', async () => {
    const { bytes } = await signedProtect();
    const upstream = fakeUpstream(() => failing(503));
    const res = await testApp(upstream, { fallback: true }).rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [b64(bytes), { encoding: 'base64' }],
    });
    expect(res.status).toBe(502);
    expect(upstream.calls.map((c) => c.endpoint)).toEqual(['primary']);
  });
});

describe('upstream RPC: timeouts', () => {
  it('a hanging upstream ends in 504 after every read attempt timed out', async () => {
    const upstream = fakeUpstream(() => 'hang');
    const started = Date.now();
    const res = await testApp(upstream, { timeoutMs: 50 }).rpc(EPOCH_INFO);
    expect(res.status).toBe(504);
    expect(await errorOf(res)).toEqual({ code: -32603, message: 'Upstream RPC timed out' });
    expect(upstream.calls).toHaveLength(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  it('a slow primary times out and the fallback answers', async () => {
    const upstream = fakeUpstream((c) => (c.endpoint === 'primary' ? 'hang' : rpcResponse(c.json.id, { epoch: 2 })));
    const res = await testApp(upstream, { fallback: true, timeoutMs: 50 }).rpc(EPOCH_INFO);
    expect(res.status).toBe(200);
    expect(upstream.calls.map((c) => c.endpoint)).toEqual(['primary', 'fallback']);
  });

  it('the timeout also covers a body that never finishes', async () => {
    const stalled = () =>
      new Response(
        new ReadableStream({
          start: (controller) => {
            controller.enqueue(new TextEncoder().encode('{"jsonrpc"'));
          },
        }),
      );
    const result = await callUpstream({ primary: PRIMARY_URL }, '{}', 'send', {
      timeoutMs: 50,
      retryDelayMs: 0,
      fetch: fakeUpstream(stalled).fetch,
    });
    expect(result).toEqual({ ok: false, reason: 'timeout' });
  });

  it('the default per-attempt timeout is 8 seconds', async () => {
    const { DEFAULT_UPSTREAM_OPTIONS } = await import('../src/upstream.ts');
    expect(DEFAULT_UPSTREAM_OPTIONS.timeoutMs).toBe(8_000);
  });
});

describe('upstream RPC: secrets stay out of logs and responses', () => {
  it('logs which endpoint failed and why, never its URL or key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const upstream = fakeUpstream((c) =>
      c.endpoint === 'primary' ? 'network-error' : c.endpoint === 'fallback' ? 'hang' : failing(500),
    );
    const res = await testApp(upstream, { fallback: true, timeoutMs: 30 }).rpc(EPOCH_INFO);
    const text = await res.text();
    const logged = [...warn.mock.calls, ...error.mock.calls].map((args) => args.map(String).join(' ')).join('\n');
    expect(warn).toHaveBeenCalledTimes(3);
    expect(logged).toContain('"endpoint":"fallback"');
    expect(logged).toContain('"reason":"timeout"');
    for (const secret of [PRIMARY_URL, FALLBACK_URL, 'api-key', 'test-primary-key', 'test-fallback-key', 'rpc.test']) {
      expect(logged).not.toContain(secret);
      expect(text).not.toContain(secret);
    }
  });
});

describe('attemptPost: one attempt, its status', () => {
  it('a 2xx status comes back with the body; any other status with the body unread', async () => {
    const ok = fakeUpstream(() => new Response('{"ok":true}', { status: 200 }));
    expect(await attemptPost(PRIMARY_URL, '{"a":1}', { timeoutMs: 200, fetch: ok.fetch })).toEqual({ status: 200, body: '{"ok":true}' });
    expect(ok.calls[0]?.raw).toBe('{"a":1}');
    for (const status of [400, 403, 429, 500]) {
      const failing = fakeUpstream(() => new Response('{"description":"secret detail"}', { status }));
      expect(await attemptPost(PRIMARY_URL, '{}', { timeoutMs: 200, fetch: failing.fetch })).toEqual({ status, body: null });
    }
  });

  it('a timeout and a network error have no status', async () => {
    expect(await attemptPost(PRIMARY_URL, '{}', { timeoutMs: 30, fetch: fakeUpstream(() => 'hang').fetch })).toBe('timeout');
    expect(await attemptPost(PRIMARY_URL, '{}', { timeoutMs: 200, fetch: fakeUpstream(() => 'network-error').fetch })).toBe('network');
  });

  it('logs nothing (the URL may carry an API key or a bot token)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await attemptPost(PRIMARY_URL, '{}', { timeoutMs: 200, fetch: fakeUpstream(() => failing(500)).fetch });
    await attemptPost(PRIMARY_URL, '{}', { timeoutMs: 200, fetch: fakeUpstream(() => 'network-error').fetch });
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
