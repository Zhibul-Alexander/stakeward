import {
  getSolanaErrorFromJsonRpcError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SolanaError,
} from '@solana/kit';
import { translateError } from '@stakeward/core';

/**
 * The site's only network path: same-origin requests to the worker (CLAUDE.md section 3, RPC). A fetch-based
 * JSON-RPC client instead of kit's createSolanaRpc: about 6 KB gzip smaller in the bundle (measured 02.10.2026 with
 * the inspector already bundled), and it only needs the nine methods the proxy allows.
 *
 * Reliability (CLAUDE.md section 12): every attempt times out after 8 s; reads are retried up to twice on transient
 * failures (network, timeout, HTTP 408/429/5xx, node behind). Failures are thrown in the shapes `translateError`
 * classifies: kit SolanaErrors for JSON-RPC and HTTP errors, a TimeoutError, or fetch's own TypeError.
 */

export const REQUEST_TIMEOUT_MS = 8_000;
/** Retries after the first attempt, for reads and for resending the same signed bytes. */
export const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [500, 1_500] as const;

export type TransportOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Waits between retries; tests pass a fake. */
  sleep?: (ms: number) => Promise<void>;
};

export type RequestOptions = {
  /** Retries after the first attempt on a transient failure (0 = one attempt). */
  retries: number;
};

/** A thrown fetch() failure: the request never got an HTTP answer. */
const fetchFailures = new WeakSet<object>();

export class Transport {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private nextId = 1;

  constructor(options: TransportOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** POSTs one JSON-RPC call to `url` and returns its `result` (integers as bigint). */
  rpc(url: string, method: string, params: readonly unknown[], options: RequestOptions): Promise<unknown> {
    return this.withRetries(options.retries, async () => {
      const id = this.nextId++;
      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      const response = await this.request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      const message = parseJsonWithBigInts(response.text);
      if (!isRecord(message)) throw malformed(`${method}: the response is not a JSON-RPC message`);
      if ('error' in message && message['error'] !== undefined && message['error'] !== null) {
        throw getSolanaErrorFromJsonRpcError(message['error']);
      }
      if (!('result' in message)) throw malformed(`${method}: the response has no result`);
      return message['result'];
    });
  }

  /** GETs `url` and returns its JSON body (integers as bigint). */
  getJson(url: string, options: RequestOptions): Promise<unknown> {
    return this.withRetries(options.retries, async () => {
      const response = await this.request(url, { method: 'GET', headers: { accept: 'application/json' } });
      return parseJsonWithBigInts(response.text);
    });
  }

  /** One HTTP exchange with a timeout over the whole exchange (headers and body). Non-2xx statuses throw. */
  private async request(url: string, init: RequestInit): Promise<{ text: string }> {
    const controller = new AbortController();
    const timeout = timeoutError(this.timeoutMs);
    const timer = setTimeout(() => {
      controller.abort(timeout);
    }, this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) throw timeout;
        if (typeof error === 'object' && error !== null) fetchFailures.add(error);
        throw error;
      }
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        if (controller.signal.aborted) throw timeout;
        throw error;
      }
      if (!response.ok) throw httpError(response, text);
      return { text };
    } finally {
      clearTimeout(timer);
    }
  }

  private async withRetries<T>(retries: number, attempt: () => Promise<T>): Promise<T> {
    for (let failures = 0; ; failures += 1) {
      try {
        return await attempt();
      } catch (error) {
        if (failures >= retries || !isTransient(error)) throw error;
        await this.sleep(RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)] ?? 1_000);
      }
    }
  }
}

/**
 * A failure worth retrying: no HTTP answer, our timeout, or what `translateError` calls a network failure
 * (HTTP 408/429/5xx, JSON-RPC -32005 node behind and -32603 internal error).
 */
export function isTransient(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && fetchFailures.has(error)) return true;
  return translateError(error).code === 'network';
}

/**
 * An HTTP error status. 408, 429 and 5xx become kit's transport error (translateError: network). Anything else
 * carrying a JSON-RPC error body (the proxy refusing a method or its parameters) throws that error; the rest throws
 * the transport error with the status.
 */
function httpError(response: Response, text: string): Error {
  const status = response.status;
  if (status !== 408 && status !== 429 && status < 500) {
    try {
      const body = parseJsonWithBigInts(text);
      if (isRecord(body) && isRecord(body['error']) && 'code' in body['error']) {
        return getSolanaErrorFromJsonRpcError(body['error']);
      }
    } catch {
      // Not JSON: report the status below.
    }
  }
  return new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
    headers: response.headers,
    message: (response.statusText || text).slice(0, 200),
    statusCode: status,
  });
}

function timeoutError(ms: number): Error {
  const error = new Error(`No answer within ${String(ms / 1000)} s`);
  error.name = 'TimeoutError';
  return error;
}

function malformed(message: string): Error {
  return new Error(`Malformed response: ${message}`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * JSON.parse that reads every integer as a bigint, so u64 values (lamports above 2^53, rentEpoch u64::MAX) keep their
 * precision. Non-integers stay numbers. Integers are wrapped as {"$n":"<digits>"} outside strings and unwrapped by the
 * reviver (kit's RPC client does the same).
 */
export function parseJsonWithBigInts(json: string): unknown {
  return JSON.parse(wrapIntegers(json), (_key, value: unknown) =>
    isRecord(value) && Object.keys(value).length === 1 && typeof value['$n'] === 'string' ? BigInt(value['$n']) : value,
  );
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

function wrapIntegers(json: string): string {
  let out = '';
  let index = 0;
  while (index < json.length) {
    const char = json.charAt(index);
    if (char === '"') {
      // Copy the whole string literal, escapes included.
      let end = index + 1;
      while (end < json.length && json.charAt(end) !== '"') end += json.charAt(end) === '\\' ? 2 : 1;
      out += json.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (char === '-' || (char >= '0' && char <= '9')) {
      NUMBER.lastIndex = index;
      const match = NUMBER.exec(json);
      if (match !== null) {
        const token = match[0];
        out += /[.eE]/.test(token) ? token : `{"$n":"${token}"}`;
        index += token.length;
        continue;
      }
    }
    out += char;
    index += 1;
  }
  return out;
}
