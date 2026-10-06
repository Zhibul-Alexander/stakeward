/**
 * GET /api/stats of the worker (CLAUDE.md section 8, DECISIONS.md D82): the watched stake accounts whose lock is in
 * force now, the lamports in them and the Telegram alerts sent so far.
 *
 * Body: `{ accountsLocked: number, lamportsLocked: string, alertsSent: number, now: string }`. `lamportsLocked` is a
 * decimal string, because a sum of u64 balances does not fit a JSON number. The worker answers 429 over its lookup
 * rate limit and 500 when its database fails.
 */

export type Stats = {
  accountsLocked: number;
  lamportsLocked: bigint;
  alertsSent: number;
};

const STATS_URL = '/api/stats';
/** Same per-request limit as the RPC transport (CLAUDE.md section 12). */
const TIMEOUT_MS = 8_000;
const LAMPORTS = /^(0|[1-9][0-9]{0,19})$/;
const U64_MAX = 18_446_744_073_709_551_615n;

export type StatsOptions = { fetch?: typeof fetch; timeoutMs?: number; url?: string };

/**
 * Reads /api/stats. Rejects on a network failure, another HTTP status than 200 or a malformed body, and after
 * `timeoutMs` with a `TimeoutError`, even when the fetch never settles.
 */
export async function fetchStats(options: StatsOptions = {}): Promise<Stats> {
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const timeout = new Error(`No answer within ${String(timeoutMs / 1000)} s`);
      timeout.name = 'TimeoutError';
      controller.abort(timeout);
      reject(timeout);
    }, timeoutMs);
  });
  const read = async (): Promise<Stats> => {
    const response = await fetchImpl(options.url ?? STATS_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status !== 200) throw new Error(`GET /api/stats answered HTTP ${String(response.status)}`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw malformed();
    }
    return parseStats(body);
  };
  try {
    return await Promise.race([read(), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** The body as the page shows it. Keys other than the three counts are ignored. */
export function parseStats(body: unknown): Stats {
  if (!isPlainObject(body)) throw malformed();
  const { accountsLocked, lamportsLocked, alertsSent } = body;
  if (!isCount(accountsLocked) || !isCount(alertsSent)) throw malformed();
  if (typeof lamportsLocked !== 'string' || !LAMPORTS.test(lamportsLocked)) throw malformed();
  const lamports = BigInt(lamportsLocked);
  if (lamports > U64_MAX) throw malformed();
  return { accountsLocked, lamportsLocked: lamports, alertsSent };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function malformed(): Error {
  return new Error('Malformed /api/stats response');
}
