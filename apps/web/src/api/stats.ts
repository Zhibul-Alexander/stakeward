import { translateError, U64_MAX } from '@stakeward/core';

/**
 * GET /api/stats of the worker (CLAUDE.md section 8, DECISIONS D62, D84): the public numbers of the /stats page. The
 * accounts and the SOL are counted from D1 at most every 10 minutes; the alerts are read on every request. Body,
 * exactly these keys:
 * - `accountsLocked`: watched stake accounts whose lock is in force now (by the worker's clock), a JSON number;
 * - `lamportsLocked`: the lamports in them, a decimal string (exact above 2^53, where a JSON number is not);
 * - `alertsSent`: Telegram alerts delivered so far, reminders not counted, a JSON number;
 * - `now`: the worker's clock when it counted the accounts and the SOL, ISO 8601 UTC (`Date#toISOString`).
 * Any other status is an error, its body is not read: 429 is the per-IP rate limit, 500 a D1 failure.
 */
export type Stats = {
  accountsLocked: number;
  lamportsLocked: bigint;
  alertsSent: number;
  /** The worker's clock when it counted: "a lock in force now" means at this time. */
  countedAt: Date;
};

/** GET /api/stats answered with a status other than 200. */
export class StatsHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`GET /api/stats answered HTTP ${String(status)}`);
    this.name = 'StatsHttpError';
    this.status = status;
  }
}

const STATS_URL = '/api/stats';
/** Same per-request limit as the RPC transport (CLAUDE.md section 12). */
const TIMEOUT_MS = 8_000;

export type StatsOptions = { fetch?: typeof fetch; timeoutMs?: number; url?: string };

/**
 * Reads /api/stats once. Rejects on a network failure, a timeout (an Error named TimeoutError), another HTTP status
 * (StatsHttpError) or a body that is not exactly the shape above (an Error named InvalidStatsResponseError).
 */
export async function fetchStats(options: StatsOptions = {}): Promise<Stats> {
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const timer = setTimeout(() => {
    const timeout = new Error(`No answer within ${String(timeoutMs / 1000)} s`);
    timeout.name = 'TimeoutError';
    controller.abort(timeout);
  }, timeoutMs);
  try {
    const response = await fetchImpl(options.url ?? STATS_URL, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status !== 200) throw new StatsHttpError(response.status);
    return parseStats(await response.json());
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const FIELDS = ['accountsLocked', 'lamportsLocked', 'alertsSent', 'now'];
const DECIMAL = /^(0|[1-9][0-9]*)$/;
/** `Date#toISOString`, milliseconds optional: what the worker writes, and nothing a Date would merely guess at. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Parses a GET /api/stats body strictly: a plain object with exactly the four fields, counts as non-negative safe
 * integers, lamports as a canonical decimal string within u64 (no real sum comes near it: all SOL is about 6e17
 * lamports), `now` as an ISO 8601 UTC time. Throws an Error named InvalidStatsResponseError that says which field is
 * wrong; never returns partial numbers.
 */
export function parseStats(body: unknown): Stats {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) malformed('body', 'is not an object');
  const keys = Object.keys(body);
  const unexpected = keys.find((key) => !FIELDS.includes(key));
  if (unexpected !== undefined) malformed('body', `has an unexpected field "${unexpected}"`);
  const missing = FIELDS.find((key) => !keys.includes(key));
  if (missing !== undefined) malformed('body', `misses the field "${missing}"`);
  const record = body as Record<string, unknown>;
  return {
    accountsLocked: count(record.accountsLocked, 'accountsLocked'),
    lamportsLocked: lamports(record.lamportsLocked),
    alertsSent: count(record.alertsSent, 'alertsSent'),
    countedAt: time(record.now),
  };
}

function count(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    malformed(field, 'is not a non-negative whole number');
  }
  // JSON may say -0, which would print as "-0".
  return value === 0 ? 0 : value;
}

function lamports(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 20 || !DECIMAL.test(value)) {
    malformed('lamportsLocked', 'is not a decimal string of lamports');
  }
  const amount = BigInt(value);
  if (amount > U64_MAX) malformed('lamportsLocked', 'is larger than u64');
  return amount;
}

function time(value: unknown): Date {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) malformed('now', 'is not an ISO 8601 UTC time');
  const date = new Date(value);
  // A Date rolls an impossible time over (30 February reads as 2 March): it must read back as written.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)) {
    malformed('now', 'is not a real time');
  }
  return date;
}

function malformed(field: string, problem: string): never {
  const error = new Error(`Malformed /api/stats response: ${field} ${problem}`);
  error.name = 'InvalidStatsResponseError';
  throw error;
}

/**
 * What a failed read means for the reader (UX rule 8: what happened and what to do next):
 * - `rate-limited`: HTTP 429, wait a minute;
 * - `network`: no answer (offline, a dropped connection, the 8 s timeout), check the connection;
 * - `server`: the worker answered, but not with the numbers (another status, a malformed body), try again later.
 */
export type StatsFailureKind = 'rate-limited' | 'network' | 'server';

export function statsFailureKind(error: unknown): StatsFailureKind {
  if (error instanceof StatsHttpError) return error.status === 429 ? 'rate-limited' : 'server';
  return translateError(error).code === 'network' ? 'network' : 'server';
}
