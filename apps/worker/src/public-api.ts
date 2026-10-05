import type { Address } from '@solana/kit';
import { EXPIRING_THRESHOLD_SECONDS, ZERO_ADDRESS } from '@stakeward/core';
import type { Context, MiddlewareHandler } from 'hono';
import * as z from 'zod';
import { isAddressText } from './address.ts';
import { lastPassAtOf, SQL } from './monitor/store.ts';
import type { AppEnv } from './app.ts';

/**
 * Public read-only API (CLAUDE.md section 8; step 5 spec section 9): /api/health, /api/accounts and /api/stats, all
 * from D1 alone. Times come from the worker clock `now` (AppOptions), so the site measures ages with it rather than
 * with the visitor's device clock. A D1 failure is thrown to app.onError -> 500: the site shows "unavailable", never a
 * stale "ok".
 */

/** /api/health turns 503 when the last successful monitor pass is older than this (CLAUDE.md section 8). */
export const MONITOR_STALE_AFTER_MS = 10 * 60_000;

/** `Cache-Control: no-store` on every response of the route, errors included. */
export function noStore(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    c.res.headers.set('Cache-Control', 'no-store');
  };
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * GET /api/health: `{ ok, lastMonitorRunAt, now }` (DECISIONS.md D38), exactly these keys. 200 while the marker of the
 * last successful monitor pass is at most 10 minutes old, else 503, including when no pass has succeeded yet.
 */
export function healthHandler(now: () => number) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const lastPassAt = lastPassAtOf(await c.env.DB.prepare(SQL.LAST_PASS_AT).first<{ value: unknown }>());
    const nowMs = now();
    const ok = lastPassAt !== null && nowMs - lastPassAt <= MONITOR_STALE_AFTER_MS;
    const body = { ok, lastMonitorRunAt: lastPassAt === null ? null : isoOf(lastPassAt), now: isoOf(nowMs) };
    return c.json(body, ok ? 200 : 503);
  };
}

const walletQuery = z.strictObject({
  wallet: z
    .string()
    .refine(isAddressText, 'Expected a base58 address')
    .refine((a) => a !== ZERO_ADDRESS, 'The all-zero address is not a wallet'),
});

type AccountDbRow = {
  stake_account: Address;
  withdrawer: Address;
  custodian: Address;
  lock_until: string;
  lamports: string;
  state: 'initialized' | 'delegated' | 'closed';
  checked_at: number;
};

type EventDbRow = { stake_account: Address; type: string; details_json: string; slot: number; detected_at: number };

export type AccountsJson = {
  wallet: Address;
  now: string;
  lastMonitorRunAt: string | null;
  accounts: {
    address: Address;
    /** `main`: the wallet is the account's main key; `second`: its second key. */
    roles: ('main' | 'second')[];
    lockUntil: string;
    /** `ending-soon`: in force for less than 30 more days. */
    lock: 'in-force' | 'ending-soon' | 'ended';
    /** Whole days until the lock ends, rounded up, while it is in force. */
    daysLeft: number | null;
    lamports: string;
    state: 'initialized' | 'delegated' | 'closed';
    /** When the monitor last stored a change (the row's checked_at). */
    lastChangeAt: string;
  }[];
  events: { stakeAccount: Address; type: string; details: unknown; slot: string; detectedAt: string }[];
};

/**
 * GET /api/accounts?wallet=<address>: the watched accounts whose main key or second key is the wallet, with their lock
 * and recent events (reminders left out). Deliberately not in the answer: Protected or not (the chain cannot tell whose
 * key holds a lock, D14, D35), and whether alerts are delivered or linked (anyone could learn whether a wallet gets
 * alerts).
 */
export function accountsHandler(now: () => number) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const entries = [...new URL(c.req.url).searchParams.entries()];
    const parsed = walletQuery.safeParse(Object.fromEntries(entries));
    if (!parsed.success || entries.length !== 1) {
      return c.json({ error: 'invalid-query', message: 'Pass exactly one wallet=<address>' }, 400);
    }
    const { wallet } = parsed.data;
    const db = c.env.DB;
    const [accounts, events, marker] = await db.batch([
      db.prepare(SQL.ACCOUNTS_FOR_WALLET).bind(wallet),
      db.prepare(SQL.EVENTS_FOR_WALLET).bind(wallet),
      db.prepare(SQL.LAST_PASS_AT),
    ]);
    const nowMs = now();
    const lastPassAt = lastPassAtOf(marker?.results[0] as { value: unknown } | undefined);
    const body: AccountsJson = {
      wallet,
      now: isoOf(nowMs),
      lastMonitorRunAt: lastPassAt === null ? null : isoOf(lastPassAt),
      accounts: ((accounts?.results ?? []) as AccountDbRow[]).map((row) => accountJson(row, wallet, nowMs)),
      events: ((events?.results ?? []) as EventDbRow[]).map((row) => ({
        stakeAccount: row.stake_account,
        type: row.type,
        details: parseDetails(row.details_json),
        slot: String(row.slot),
        detectedAt: isoOf(row.detected_at),
      })),
    };
    return c.json(body);
  };
}

function accountJson(row: AccountDbRow, wallet: Address, nowMs: number): AccountsJson['accounts'][number] {
  const roles: ('main' | 'second')[] = [];
  if (row.withdrawer === wallet) roles.push('main');
  if (row.custodian === wallet) roles.push('second');
  const lockUntil = BigInt(row.lock_until);
  const left = lockUntil - BigInt(Math.floor(nowMs / 1000));
  const lock = left <= 0n ? 'ended' : left < EXPIRING_THRESHOLD_SECONDS ? 'ending-soon' : 'in-force';
  return {
    address: row.stake_account,
    roles,
    lockUntil: row.lock_until,
    lock,
    // At most i64::MAX / 86400 (about 1e14), exact as a number.
    daysLeft: left <= 0n ? null : Number((left + 86_399n) / 86_400n),
    lamports: row.lamports,
    state: row.state,
    lastChangeAt: isoOf(row.checked_at),
  };
}

function parseDetails(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * How long /api/stats answers with its stored count before it counts again. Counting reads every watched row, and D1's
 * free plan allows 5 million rows read a day for everything, monitoring included: counted on every request (20 a
 * minute per IP), 1,000 watched rows would let one client read 28.8 million a day and stop the alerts. Stored, it is
 * at most 144 counts a day, whoever asks.
 */
export const STATS_TTL_MS = 10 * 60_000;

type StatsCount = { at: number; accounts: number; lamports: string };

/**
 * GET /api/stats: watched accounts whose lock is in force, the lamports in them (a decimal string: SQLite sums integers
 * exactly and all SOL is below 2^63 lamports) and the alerts delivered so far (meta.alerts_sent, read on every
 * request). The two counts come from meta.stats_cache while it is younger than STATS_TTL_MS; `now` is when they were
 * counted, so the site says "counted at" truthfully.
 */
export function statsHandler(now: () => number) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const db = c.env.DB;
    const nowMs = now();
    const [cache, sent] = await db.batch([db.prepare(SQL.STATS_CACHE), db.prepare(SQL.ALERTS_SENT)]);
    const sentValue = (sent?.results[0] as { value: unknown } | undefined)?.value;
    const alertsSent = typeof sentValue === 'string' && /^[0-9]{1,15}$/.test(sentValue) ? Number(sentValue) : 0;

    let count = statsCountOf((cache?.results[0] as { value: unknown } | undefined)?.value);
    // A count from the future (the clock went back, or a bad row) is counted again too.
    if (count === null || count.at > nowMs || nowMs - count.at >= STATS_TTL_MS) {
      const row = await db.prepare(SQL.STATS).bind(Math.floor(nowMs / 1000)).first<{ accounts: unknown; lamports: unknown }>();
      count = {
        at: nowMs,
        accounts: Number(row?.accounts ?? 0),
        lamports: typeof row?.lamports === 'string' ? row.lamports : '0',
      };
      await db.prepare(SQL.STATS_CACHE_PUT).bind(JSON.stringify(count)).run();
    }
    return c.json({ accountsLocked: count.accounts, lamportsLocked: count.lamports, alertsSent, now: isoOf(count.at) });
  };
}

/** The stored count of a meta.stats_cache value; null when it is missing or not exactly what statsHandler writes. */
function statsCountOf(value: unknown): StatsCount | null {
  if (typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { at, accounts, lamports } = parsed as Record<string, unknown>;
  if (typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0) return null;
  if (typeof accounts !== 'number' || !Number.isSafeInteger(accounts) || accounts < 0) return null;
  if (typeof lamports !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(lamports)) return null;
  return { at, accounts, lamports };
}
