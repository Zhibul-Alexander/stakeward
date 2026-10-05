// Test doubles for the worker: a scripted upstream RPC (injected as the app's fetch) and request helpers.
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { createApp } from '../src/app.ts';
import { encodeBase64 } from '../src/base64.ts';

export const PRIMARY_URL = 'https://primary.rpc.test/?api-key=test-primary-key';
export const FALLBACK_URL = 'https://fallback.rpc.test/?api-key=test-fallback-key';
export const ORIGIN = 'https://stakeward.test';

export type UpstreamCall = {
  endpoint: 'primary' | 'fallback' | 'other';
  /** The exact text the worker sent. */
  raw: string;
  json: { jsonrpc: string; id: unknown; method: string; params: unknown[] };
};

/** What the scripted upstream does with one call: answer, hang until aborted, or fail at the network level. */
export type Outcome = Response | 'hang' | 'network-error';

export function fakeUpstream(script: (call: UpstreamCall, index: number) => Outcome | Promise<Outcome>) {
  const calls: UpstreamCall[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const raw = typeof init?.body === 'string' ? init.body : '';
    const call: UpstreamCall = {
      endpoint: url === PRIMARY_URL ? 'primary' : url === FALLBACK_URL ? 'fallback' : 'other',
      raw,
      json: JSON.parse(raw) as UpstreamCall['json'],
    };
    calls.push(call);
    const outcome = await script(call, calls.length - 1);
    if (outcome === 'network-error') throw new TypeError('Network connection lost');
    if (outcome === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    }
    return outcome;
  };
  return { fetch: fetchFn, calls };
}

/** One account of a getMultipleAccounts answer; null = the account does not exist. */
export type AccountJson = { data: Uint8Array; lamports: bigint; owner: string } | null;

/**
 * A getMultipleAccounts answer as raw JSON text, the way an RPC node writes it: lamports and rentEpoch are bare JSON
 * numbers, exact above 2^53.
 */
export function multipleAccountsText(id: unknown, slot: number, items: readonly AccountJson[]): string {
  const value = items.map((item) =>
    item === null
      ? null
      : {
          data: [encodeBase64(item.data), 'base64'],
          executable: false,
          lamports: item.lamports.toString(),
          owner: item.owner,
          rentEpoch: '18446744073709551615',
          space: item.data.length,
        },
  );
  return JSON.stringify({ jsonrpc: '2.0', id, result: { context: { apiVersion: '3.0.6', slot }, value } }).replace(
    /"(lamports|rentEpoch)":"([0-9]+)"/g,
    '"$1":$2',
  );
}

export function multipleAccountsAnswer(id: unknown, slot: number, items: readonly AccountJson[]): Response {
  return new Response(multipleAccountsText(id, slot, items), { headers: { 'Content-Type': 'application/json' } });
}

export function rpcResponse(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'Content-Type': 'application/json' } });
}

/** A distinct client IP per call site, so per-IP rate limits never couple tests (limits are shared across files). */
export function freshIp(): string {
  const [a = 0, b = 0, c = 0] = crypto.getRandomValues(new Uint8Array(3));
  return `10.${String(a)}.${String(b)}.${String(c)}`;
}

export type TestApp = ReturnType<typeof testApp>;

/**
 * The API with a scripted upstream, short timeouts and no retry pause. Requests run through Hono's app.request with
 * the real bindings (rate limiters, D1) of the test environment and a fresh client IP per app.
 */
export function testApp(
  upstream: { fetch: typeof fetch },
  options: { fallback?: boolean; timeoutMs?: number; ip?: string; rpcUrl?: string } = {},
) {
  const app = createApp({ upstream: { fetch: upstream.fetch, timeoutMs: options.timeoutMs ?? 200, retryDelayMs: 0 } });
  const bindings: Env = { ...env, RPC_URL: options.rpcUrl ?? PRIMARY_URL };
  if (options.fallback === true) bindings.RPC_FALLBACK_URL = FALLBACK_URL;
  const ip = options.ip ?? freshIp();
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('CF-Connecting-IP')) headers.set('CF-Connecting-IP', ip);
    return app.request(`${ORIGIN}${path}`, { ...init, headers }, bindings, createExecutionContext());
  };
  /** POST with a JSON body (object or raw text); Content-Type application/json unless `init` sets one. */
  const post = (path: string, body: unknown, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return request(path, {
      method: 'POST',
      ...init,
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  };
  return {
    request,
    ip,
    /** POST /api/rpc with a JSON body (object or raw text). */
    rpc: (body: unknown, init: RequestInit = {}) => post('/api/rpc', body, init),
    /** POST /api/watch with a JSON body (object or raw text). */
    watch: (body: unknown, init: RequestInit = {}) => post('/api/watch', body, init),
  };
}

export type JsonRpcErrorBody = {
  jsonrpc: '2.0';
  id: unknown;
  error: { code: number; message: string; data?: { check: string; code: string; message: string; signers?: string[] } };
};

export async function errorOf(response: Response): Promise<JsonRpcErrorBody['error']> {
  const body = await response.json<JsonRpcErrorBody>();
  return body.error;
}

export const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
} as const;

export function securityHeadersOf(response: Response): Record<string, string | null> {
  return Object.fromEntries(Object.keys(SECURITY_HEADERS).map((name) => [name, response.headers.get(name)]));
}
