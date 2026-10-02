/**
 * GET /api/health of the worker (CLAUDE.md section 8): when the monitor last finished a pass. The worker answers
 * HTTP 200, or 503 once that pass is older than 10 minutes; both carry the same JSON body, so both are read.
 *
 * Body: `{ ok: boolean, lastMonitorRunAt: string | null, now?: string }`, times as ISO 8601 UTC
 * (`Date#toISOString`); `lastMonitorRunAt` is null before the first pass, `now` is the worker's clock.
 */

export type Health = {
  /** When the monitor last finished a pass; null when it has not run yet. */
  lastMonitorRunAt: Date | null;
  /**
   * The worker's own verdict when it answered: false for HTTP 503 or `ok: false` (by its clock the last pass is older
   * than 10 minutes). Absent when the answer did not say.
   */
  ok?: boolean;
  /** The worker's clock when it answered (`now`): the age then does not depend on this device's clock. */
  serverTime?: Date;
};

export const MONITOR_STALE_AFTER_MS = 10 * 60_000;

const HEALTH_URL = '/api/health';
/** Same per-request limit as the RPC transport (CLAUDE.md section 12). */
const TIMEOUT_MS = 8_000;

export type HealthOptions = { fetch?: typeof fetch; timeoutMs?: number; url?: string };

/** Reads /api/health. Rejects on a network failure, a timeout, another HTTP status or a malformed body. */
export async function fetchHealth(options: HealthOptions = {}): Promise<Health> {
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const timer = setTimeout(() => {
    const timeout = new Error(`No answer within ${String(timeoutMs / 1000)} s`);
    timeout.name = 'TimeoutError';
    controller.abort(timeout);
  }, timeoutMs);
  try {
    const response = await fetchImpl(options.url ?? HEALTH_URL, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status !== 200 && response.status !== 503) {
      throw new Error(`GET /api/health answered HTTP ${String(response.status)}`);
    }
    const health = parseHealth(await response.json());
    return response.status === 503 ? { ...health, ok: false } : health;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function parseHealth(body: unknown): Health {
  if (typeof body !== 'object' || body === null || !('lastMonitorRunAt' in body)) throw malformed();
  const record = body as Record<string, unknown>;
  const value = record.lastMonitorRunAt;
  const lastMonitorRunAt = value === null ? null : parseTime(value);
  const health: Health = { lastMonitorRunAt };
  if (typeof record.ok === 'boolean') health.ok = record.ok;
  else if (record.ok !== undefined) throw malformed();
  if (record.now !== undefined) health.serverTime = parseTime(record.now);
  return health;
}

function parseTime(value: unknown): Date {
  if (typeof value !== 'string') throw malformed();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw malformed();
  return date;
}

function malformed(): Error {
  return new Error('Malformed /api/health response');
}

/** How the monitor stands at `now`, for the "Last checked N min ago" line. */
export type MonitorFreshness =
  | { kind: 'not-yet' }
  | { kind: 'checked'; ageMs: number; stale: boolean };

/**
 * The age of the last pass at `now` (local ms) for an answer that arrived at `receivedAt` (local ms; `now` when
 * omitted): the age when the worker answered, by its clock when it sent one (by this device's clock otherwise), plus
 * the time since the answer.
 *
 * Stale (red): the worker said so; or, when it said the monitor is fine, the answer is now too old to vouch for that
 * (the page asks again every minute, so only when it got no answer for 10 minutes); or, when it gave no verdict, the
 * age is over 10 minutes. A device clock that runs ahead or behind never turns a verdict around.
 */
export function monitorFreshness(health: Health, now: number, receivedAt: number = now): MonitorFreshness {
  if (health.lastMonitorRunAt === null) return { kind: 'not-yet' };
  const sinceAnswer = Math.max(0, now - receivedAt);
  // A clock a little behind the worker's must not show a negative age.
  const atAnswer = Math.max(0, (health.serverTime?.getTime() ?? receivedAt) - health.lastMonitorRunAt.getTime());
  const ageMs = atAnswer + sinceAnswer;
  const stale =
    health.ok === undefined
      ? ageMs > MONITOR_STALE_AFTER_MS
      : !health.ok || (health.serverTime === undefined ? sinceAnswer : ageMs) > MONITOR_STALE_AFTER_MS;
  return { kind: 'checked', ageMs, stale };
}
