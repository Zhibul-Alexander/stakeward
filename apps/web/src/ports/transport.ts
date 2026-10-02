import {
  getSolanaErrorFromJsonRpcError,
  isSolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SolanaError,
} from '@solana/kit';

/**
 * The site's only network path: same-origin requests to the worker (CLAUDE.md section 3, RPC). A fetch-based
 * JSON-RPC client instead of kit's createSolanaRpc: about 6 KB gzip smaller in the bundle (measured 02.10.2026 with
 * the inspector already bundled), and it only needs the nine methods the proxy allows.
 *
 * Reliability (CLAUDE.md section 12). The worker already retries the upstream RPC: a read gets three attempts of 8 s
 * with pauses of 250 and 500 ms, a send one attempt (apps/worker/src/upstream.ts). So the browser never retries what
 * the worker answered: its 502 and 504 (the RPC failed after the worker's own retries), 429 (rate limit, wait a
 * minute) and every JSON-RPC error are final; retrying them would multiply upstream calls and the wait. The browser
 * retries, up to twice, only when the worker's answer never arrived: fetch failed (TypeError), the body broke off,
 * or no answer within REQUEST_TIMEOUT_MS, which is longer than the worker's longest answer. Plus HTTP 503, which
 * Cloudflare answers when a Worker could not run at all (resource limits, e.g. the CPU of a cold start) and the
 * worker answers when its RPC is not configured; neither reached the upstream RPC.
 * Failures are thrown in the shapes `translateError` classifies: kit SolanaErrors for JSON-RPC and HTTP errors, a
 * TimeoutError, or fetch's own TypeError.
 */

/** The worker's longest answer: three upstream attempts of 8 s and the pauses between them (upstream.ts). */
export const WORKER_READ_BUDGET_MS = 3 * 8_000 + 250 + 500;
/** Per request; longer than WORKER_READ_BUDGET_MS, so the browser does not give up while the worker still works. */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Retries after the first attempt, only for answers that never arrived (see above). */
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

/** Failures where the worker's answer never arrived: fetch threw, the body broke off, or our timeout fired. */
const unanswered = new WeakSet<object>();

function noAnswer<T>(error: T): T {
  if (typeof error === 'object' && error !== null) unanswered.add(error);
  return error;
}

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
        throw jsonRpcError(message['error']);
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
        throw noAnswer(controller.signal.aborted ? timeout : error);
      }
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        throw noAnswer(controller.signal.aborted ? timeout : error);
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
        if (failures >= retries || !isRetryable(error)) throw error;
        await this.sleep(RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)] ?? 1_000);
      }
    }
  }
}

/**
 * A failure worth retrying (see the module comment): the worker's answer never arrived, or HTTP 503 (the Worker could
 * not run). Never what the worker answered after trying the RPC itself (502, 504, JSON-RPC errors) or a rate limit.
 */
export function isRetryable(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && unanswered.has(error)) return true;
  return isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) && error.context.statusCode === 503;
}

/**
 * An HTTP error status. 408, 429 and 5xx become kit's transport error (translateError: rate-limited for 429, network
 * for the others). Anything else carrying a JSON-RPC error body (the proxy refusing a method or its parameters)
 * throws that error; the rest throws the transport error with the status.
 */
function httpError(response: Response, text: string): Error {
  const status = response.status;
  if (status !== 408 && status !== 429 && status < 500) {
    try {
      const body = parseJsonWithBigInts(text);
      if (isRecord(body) && isRecord(body['error']) && 'code' in body['error']) {
        return jsonRpcError(body['error']);
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

/**
 * kit's error for a JSON-RPC error object. kit keeps the server's own message only for some codes (as
 * `__serverMessage`) and drops it for the others, and its production build numbers every error message. So the message
 * is added under kit's own name when kit dropped it: translateError shows it under "Details" (UX rule 8).
 */
export function jsonRpcError(raw: unknown): SolanaError {
  const error = getSolanaErrorFromJsonRpcError(raw);
  const message = isRecord(raw) ? raw['message'] : undefined;
  if (typeof message !== 'string' || message === '' || '__serverMessage' in error.context) return error;
  const { __code: code, ...context } = error.context;
  const cause: unknown = error.cause;
  // The context kit built for this code, plus the message (and the cause, which kit keeps outside the context).
  const rebuilt = { ...context, __serverMessage: message, ...(cause === undefined ? {} : { cause }) };
  return new SolanaError(code, rebuilt);
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
