import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowRequest } from '../src/rate-limit.ts';
import { MAX_RPC_BODY_BYTES } from '../src/rpc.ts';
import {
  fakeUpstream,
  freshIp,
  ORIGIN,
  PRIMARY_URL,
  rpcResponse,
  SECURITY_HEADERS,
  securityHeadersOf,
  testApp,
} from './fakes.ts';
import { key } from './transactions.ts';

/** Limits configured in wrangler.jsonc (env dev). */
const RPC_LIMIT = 30;
const LOOKUP_LIMIT = 20;
const WATCH_LIMIT = 10;

const EPOCH_INFO = { jsonrpc: '2.0', id: 1, method: 'getEpochInfo', params: [] };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rate limits per client IP', () => {
  it(`POST /api/rpc: ${String(RPC_LIMIT)} requests per 10 s, then HTTP 429 with Retry-After`, async () => {
    const upstream = fakeUpstream((c) => rpcResponse(c.json.id, { epoch: 1 }));
    const client = testApp(upstream);
    for (let i = 0; i < RPC_LIMIT; i++) expect((await client.rpc(EPOCH_INFO)).status).toBe(200);
    const limited = await client.rpc(EPOCH_INFO);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('10');
    expect(await limited.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'Too many requests' } });
    expect(securityHeadersOf(limited)).toEqual(SECURITY_HEADERS);
    expect(upstream.calls).toHaveLength(RPC_LIMIT);

    // Another client is not affected.
    expect((await testApp(upstream).rpc(EPOCH_INFO)).status).toBe(200);
  });

  it(`GET /api/stake-accounts: ${String(LOOKUP_LIMIT)} requests per 60 s, then HTTP 429`, async () => {
    const upstream = fakeUpstream(() => {
      throw new Error('invalid queries never reach upstream');
    });
    const client = testApp(upstream);
    // Invalid queries count too: the limit runs before anything else.
    for (let i = 0; i < LOOKUP_LIMIT; i++) expect((await client.request('/api/stake-accounts')).status).toBe(400);
    const limited = await client.request(`/api/stake-accounts?withdrawer=${key(1)}`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    expect(await limited.json()).toMatchObject({ error: 'rate-limited' });
  });

  it(`POST /api/watch: ${String(WATCH_LIMIT)} requests per 60 s, then HTTP 429, on its own counter`, async () => {
    const upstream = fakeUpstream((c) => rpcResponse(c.json.id, { epoch: 1 }));
    const ip = freshIp();
    // Invalid bodies count too: the limit runs before anything else, and they never reach upstream.
    for (let i = 0; i < WATCH_LIMIT; i++) expect((await testApp(upstream, { ip }).watch({})).status).toBe(400);
    const limited = await testApp(upstream, { ip }).watch({ accounts: [key(1)] });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    expect(await limited.json()).toEqual({ error: 'rate-limited', message: 'Too many requests, try again in a minute' });
    expect(securityHeadersOf(limited)).toEqual(SECURITY_HEADERS);
    expect(upstream.calls).toHaveLength(0);

    // The lookup and proxy limits of the same client are untouched, and another client is not affected.
    expect((await testApp(upstream, { ip }).request('/api/stake-accounts')).status).toBe(400);
    expect((await testApp(upstream, { ip }).rpc(EPOCH_INFO)).status).toBe(200);
    expect((await testApp(upstream).watch({})).status).toBe(400);
  });

  it('the two limits are separate counters', async () => {
    const upstream = fakeUpstream((c) => rpcResponse(c.json.id, { epoch: 1 }));
    const ip = freshIp();
    for (let i = 0; i < LOOKUP_LIMIT; i++) await testApp(upstream, { ip }).request('/api/stake-accounts');
    expect((await testApp(upstream, { ip }).request('/api/stake-accounts')).status).toBe(429);
    expect((await testApp(upstream, { ip }).rpc(EPOCH_INFO)).status).toBe(200);
  });
});

describe('allowRequest: a limit on any key (the webhook limits per chat, not per IP)', () => {
  it('TELEGRAM_RATE_LIMIT: 20 per key in 60 s, keys counted apart', async () => {
    const chat = `chat:${freshIp()}`;
    for (let i = 0; i < 20; i++) expect(await allowRequest(env, 'TELEGRAM_RATE_LIMIT', chat)).toBe(true);
    expect(await allowRequest(env, 'TELEGRAM_RATE_LIMIT', chat)).toBe(false);
    expect(await allowRequest(env, 'TELEGRAM_RATE_LIMIT', `chat:${freshIp()}`)).toBe(true);
    // Another binding is another counter.
    expect(await allowRequest(env, 'LOOKUP_RATE_LIMIT', chat)).toBe(true);
  });

  it('WATCH_RATE_LIMIT: 10 per key in 60 s', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) expect(await allowRequest(env, 'WATCH_RATE_LIMIT', ip)).toBe(true);
    expect(await allowRequest(env, 'WATCH_RATE_LIMIT', ip)).toBe(false);
  });

  it('fails open when the limiter throws, and logs the binding but never the key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = { ...env, TELEGRAM_RATE_LIMIT: { limit: () => Promise.reject(new TypeError('limiter down')) } };
    expect(await allowRequest(broken, 'TELEGRAM_RATE_LIMIT', 'chat:-100777')).toBe(true);
    const logged = warn.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('TELEGRAM_RATE_LIMIT');
    expect(logged).not.toContain('-100777');
  });
});

describe('body size limit on POST /api/rpc', () => {
  it(`accepts ${String(MAX_RPC_BODY_BYTES)} bytes and rejects one more with HTTP 413`, async () => {
    const upstream = fakeUpstream(() => {
      throw new Error('oversized bodies never reach upstream');
    });
    const client = testApp(upstream);
    const atLimit = JSON.stringify(EPOCH_INFO).padEnd(MAX_RPC_BODY_BYTES, ' ');
    // Exactly at the limit the body is read (and parsed: trailing spaces are valid JSON whitespace)...
    const ok = await testApp(fakeUpstream((c) => rpcResponse(c.json.id, 1))).rpc(atLimit);
    expect(ok.status).toBe(200);
    // ...one byte more is refused before parsing.
    const res = await client.rpc(`${atLimit} `);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request body too large' } });
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
  });

  it('also refuses a streamed body without Content-Length once it passes the limit', async () => {
    const chunk = new TextEncoder().encode(' '.repeat(8 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 10) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const res = await testApp(fakeUpstream(() => new Response())).request('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // @ts-expect-error -- `duplex` is required by fetch for stream bodies but missing from RequestInit here.
      duplex: 'half',
    });
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(10);
  });
});

describe('security headers on every /api response', () => {
  it('success, JSON-RPC errors, transport errors, 404 and lookups all carry the section 11 headers', async () => {
    // A fresh monitor marker: /api/health answers 200 (503 without one).
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('last_pass_at', ?1)").bind(String(Date.now())).run();
    const ok = fakeUpstream((c) => rpcResponse(c.json.id, { epoch: 1 }));
    const down = fakeUpstream(() => new Response('', { status: 503 }));
    const hang = fakeUpstream(() => 'hang');
    const responses = [
      await testApp(ok).rpc(EPOCH_INFO),
      await testApp(ok).rpc({ ...EPOCH_INFO, method: 'getProgramAccounts' }),
      await testApp(ok).rpc('not json'),
      await testApp(ok).rpc(EPOCH_INFO, { headers: { 'Content-Type': 'text/plain' } }),
      await testApp(down).rpc(EPOCH_INFO),
      await testApp(hang, { timeoutMs: 20 }).rpc(EPOCH_INFO),
      await testApp(ok).request('/api/stake-accounts?withdrawer=bad'),
      await testApp(down).request(`/api/stake-accounts?withdrawer=${key(200)}`),
      await testApp(ok).request('/api/nope'),
      await testApp(ok).request('/api/health'),
    ];
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 415, 502, 504, 400, 502, 404, 200]);
    for (const res of responses) expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
  });

  it('the step 5 routes: health, accounts, stats, the Telegram link and the webhook', async () => {
    const ok = fakeUpstream(() => {
      throw new Error('these routes never call the RPC');
    });
    const webhook = (secret: string | null, body: string) =>
      testApp(ok).request('/api/telegram/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret === null ? {} : { 'X-Telegram-Bot-Api-Secret-Token': secret }),
        },
        body,
      });
    const update = JSON.stringify({ update_id: 1, message: { chat: { id: 4242, type: 'private' }, text: '/help' } });
    const responses = [
      await testApp(ok).request('/api/health'),
      await testApp(ok).request(`/api/accounts?wallet=${key(1)}`),
      await testApp(ok).request('/api/accounts?wallet=bad'),
      await testApp(ok).request('/api/stats'),
      await testApp(ok).request(`/api/telegram/link?wallet=${key(1)}`),
      await testApp(ok).request('/api/telegram/link'),
      await testApp(ok, { env: { TELEGRAM_BOT_USERNAME: '' } }).request(`/api/telegram/link?wallet=${key(1)}`),
      await webhook(env.TELEGRAM_WEBHOOK_SECRET, update),
      await webhook(env.TELEGRAM_WEBHOOK_SECRET, 'garbage'),
      await webhook('wrong', update),
      await webhook(null, update),
      await testApp(ok, { env: { TELEGRAM_WEBHOOK_SECRET: '' } }).request('/api/telegram/webhook', { method: 'POST', body: update }),
    ];
    expect(responses.map((r) => r.status)).toEqual([503, 200, 400, 200, 302, 400, 503, 200, 200, 401, 401, 503]);
    for (const res of responses) expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
  });
});

describe('the deployed entry point (exports.default)', () => {
  it('proxies through the global fetch with the RPC_URL secret and the security headers', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((_input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(rpcResponse((JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { id: unknown }).id, { epoch: 1047 })),
      );
    const res = await exports.default.fetch(`${ORIGIN}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': freshIp() },
      body: JSON.stringify(EPOCH_INFO),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: '2.0', id: 1, result: { epoch: 1047 } });
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(PRIMARY_URL);
  });
});
