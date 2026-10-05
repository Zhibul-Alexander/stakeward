import type { Address } from '@solana/kit';
import {
  MAX_WATCH_ACCOUNTS,
  translateError,
  watchResponseFromJson,
  type WatchRejectReason,
  type WatchResult,
} from '@stakeward/core';

/**
 * POST /api/watch of the worker (CLAUDE.md section 8): take stake accounts under monitoring. The worker reads each one
 * from the chain and accepts only a stake account with a lock in force (core `watchVerdict`); it never trusts the site.
 * Request `{ accounts: [address, ...] }` (1 to MAX_WATCH_ACCOUNTS, no duplicates); answer 200 with one result per
 * account in request order (core `watchResponseFromJson` reads it strictly), or an error status with
 * `{ error: <code>, message }`.
 */
export type ApiPort = {
  /** One result per distinct account asked, in the order asked. Rejects on a network failure, a timeout, another HTTP status or a malformed body. */
  watch(accounts: readonly Address[]): Promise<readonly WatchResult[]>;
};

/** POST /api/watch answered with a status other than 200; `code` is the worker's `error` field (`http-<status>` without one). */
export class WatchHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`POST /api/watch answered HTTP ${String(status)} (${code})`);
    this.name = 'WatchHttpError';
    this.status = status;
    this.code = code;
  }
}

const WATCH_URL = '/api/watch';
/** Same per-request limit as the RPC transport (CLAUDE.md section 12). */
const TIMEOUT_MS = 8_000;

export type WatchOptions = { fetch?: typeof fetch; timeoutMs?: number; url?: string };

/**
 * Asks the worker to watch `accounts`: each distinct account once, in chunks of MAX_WATCH_ACCOUNTS sent one after
 * another (8 s limit per request). Returns the results of every chunk in order; nothing for an empty list.
 */
export async function postWatch(accounts: readonly Address[], options: WatchOptions = {}): Promise<WatchResult[]> {
  const unique = [...new Set(accounts)];
  const results: WatchResult[] = [];
  for (let start = 0; start < unique.length; start += MAX_WATCH_ACCOUNTS) {
    results.push(...(await postChunk(unique.slice(start, start + MAX_WATCH_ACCOUNTS), options)));
  }
  return results;
}

async function postChunk(chunk: readonly Address[], options: WatchOptions): Promise<WatchResult[]> {
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const timer = setTimeout(() => {
    const timeout = new Error(`No answer within ${String(timeoutMs / 1000)} s`);
    timeout.name = 'TimeoutError';
    controller.abort(timeout);
  }, timeoutMs);
  try {
    const response = await fetchImpl(options.url ?? WATCH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ accounts: chunk }),
      signal: controller.signal,
    });
    if (response.status !== 200) throw new WatchHttpError(response.status, await errorCode(response));
    return watchResponseFromJson(await response.json(), chunk).results;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** The worker's `error` field, or `http-<status>` when the body does not carry one. */
async function errorCode(response: Response): Promise<string> {
  const fallback = `http-${String(response.status)}`;
  try {
    const body: unknown = await response.json();
    const code = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).error : undefined;
    return typeof code === 'string' && code !== '' ? code : fallback;
  } catch {
    return fallback;
  }
}

/** The site's ApiPort over the worker on this origin. */
export function createApiPort(options: { fetch?: typeof fetch } = {}): ApiPort {
  return { watch: (accounts) => postWatch(accounts, options) };
}

/** Where turning on monitoring stands (the Done screen's monitoring card). */
export type WatchState =
  | { kind: 'idle' }
  | { kind: 'working' }
  /** Every account is watched. */
  | { kind: 'on' }
  /** Some accounts are watched; these are not. */
  | { kind: 'partial'; rejected: readonly { account: Address; reason: WatchRejectReason }[] }
  /** No account is watched; `detail` is the technical reason for "Details". */
  | { kind: 'failed'; detail: string };

export type WatchRetryOptions = { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> };

/**
 * Turns on monitoring for `accounts`, retrying what may succeed a moment later: accounts answered `not-locked` (the
 * worker's RPC node may not show a lock that just landed yet) and whole calls that failed with a network error, a
 * timeout, a malformed body or HTTP 5xx. A 4xx answer (400, 413, 415, 429) is not retried. At most `attempts` calls
 * (default 3), `delayMs` apart (default 2 s).
 *
 * Outcome: `on` when every account is watched; `partial` when some are and others were rejected; `failed` when none
 * is (every call failed, or every account was rejected).
 */
export async function watchWithRetry(api: ApiPort, accounts: readonly Address[], options: WatchRetryOptions = {}): Promise<WatchState> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 2_000;
  const sleep = options.sleep ?? defaultSleep;
  const unique = [...new Set(accounts)];
  if (unique.length === 0) return { kind: 'idle' };

  const watched = new Set<Address>();
  const rejected = new Map<Address, WatchRejectReason>();
  let pending = unique;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts && pending.length > 0; attempt += 1) {
    if (attempt > 1) await sleep(delayMs);
    let results: readonly WatchResult[];
    try {
      results = await api.watch(pending);
    } catch (error) {
      lastError = error;
      if (error instanceof WatchHttpError && error.status < 500) break;
      continue;
    }
    lastError = null;
    for (const result of results) {
      if (result.status !== 'rejected') {
        watched.add(result.account);
        rejected.delete(result.account);
      } else if (result.reason !== null) {
        rejected.set(result.account, result.reason);
      }
    }
    pending = pending.filter((account) => rejected.get(account) === 'not-locked');
  }

  if (watched.size === unique.length) return { kind: 'on' };
  const notWatched = unique
    .filter((account) => !watched.has(account))
    .flatMap((account) => {
      const reason = rejected.get(account);
      return reason === undefined ? [] : [{ account, reason }];
    });
  if (watched.size === 0) {
    const detail =
      lastError !== null
        ? translateError(lastError).detail
        : notWatched.map(({ account, reason }) => `${account}: ${reason}`).join('\n');
    return { kind: 'failed', detail };
  }
  return { kind: 'partial', rejected: notWatched };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
