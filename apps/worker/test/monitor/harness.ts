// The monitor test harness (step 5 spec section 12.1): a fetch router to the fake chain and the fake Telegram, a
// counting D1 proxy with a statement journal and scripted failures, deps with a test clock, and seed/read helpers.
// D1 is the real local D1 of workerd (migrations applied before every test, test/apply-migrations.ts).
import type { Address } from '@solana/kit';
import { decodeStakeAccount, STAKE_PROGRAM_ADDRESS } from '@stakeward/core';
import { env } from 'cloudflare:workers';
import { encodeBase64 } from '../../src/base64.ts';
import { runMonitorPass, type MonitorDeps, type PassReport } from '../../src/monitor/pass.ts';
import { insertWatchedStatements, SQL, watchRowOf, type WatchRow } from '../../src/monitor/store.ts';
import { PRIMARY_URL } from '../fakes.ts';
import { FakeChain } from './fake-chain.ts';
import { FakeTelegram } from './fake-telegram.ts';

export const ADMIN_CHAT = '700000001';

export type NetworkCall = { host: string; path: string };

/**
 * Routes the worker's fetch by host: the RPC hosts to the chain (the fallback host to `fallback` when given: a node
 * of its own), api.telegram.org to Telegram.
 */
export function network(chain: FakeChain, telegram: FakeTelegram, fallback?: FakeChain) {
  const calls: NetworkCall[] = [];
  const unexpected: string[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ host: url.hostname, path: url.pathname });
    switch (url.hostname) {
      case 'primary.rpc.test':
        return chain.handle('primary', body, init?.signal);
      case 'fallback.rpc.test':
        return (fallback ?? chain).handle('fallback', body, init?.signal);
      case 'api.telegram.org':
        return telegram.handle(url, body, init?.signal);
      default:
        unexpected.push(url.hostname);
        throw new Error(`unexpected fetch to ${url.hostname}`);
    }
  };
  return { fetch: fetchFn, calls, unexpected };
}

export type DbEntry = {
  /** The SQL constant's name (store.ts), or the start of the SQL text. */
  name: string;
  via: 'batch' | 'first' | 'all' | 'run' | 'raw';
  /** Index of the D1 call (batch or single statement) the statement went in. */
  call: number;
  args: unknown[];
};

export type CountingDb = D1Database & {
  readonly stats: { statements: number; calls: number };
  readonly journal: DbEntry[];
  /** Throws (as D1 would) before running a call holding a statement this matches. */
  failWhen: ((entry: DbEntry) => boolean) | null;
};

const SQL_NAMES = new Map<string, string>(Object.entries(SQL).map(([name, sql]) => [sql, name]));

/** The keys a PUT_META statement writes (its first argument is the JSON object of entries). */
export function metaKeysOf(entry: DbEntry): string[] {
  return entry.name === 'PUT_META' ? Object.keys(JSON.parse(String(entry.args[0])) as object) : [];
}

/** D1 behind a Proxy that counts statements (first/all/run/raw = 1, batch(n) = n) and calls, and journals them. */
export function countingDb(db: D1Database): CountingDb {
  const stats = { statements: 0, calls: 0 };
  const journal: DbEntry[] = [];
  const statements = new WeakMap<object, { real: D1PreparedStatement; name: string; args: unknown[] }>();
  const state: { failWhen: CountingDb['failWhen'] } = { failWhen: null };

  const record = (entries: Omit<DbEntry, 'call'>[]) => {
    const call = stats.calls;
    const full = entries.map((entry) => ({ ...entry, call }));
    if (state.failWhen !== null && full.some(state.failWhen)) throw new Error('D1_ERROR: injected by the test');
    stats.calls += 1;
    stats.statements += full.length;
    journal.push(...full);
  };

  const wrap = (real: D1PreparedStatement, name: string, args: unknown[]): D1PreparedStatement => {
    const proxy = new Proxy(real, {
      get(target, prop) {
        if (prop === 'bind') return (...bound: unknown[]) => wrap(target.bind(...bound), name, bound);
        if (prop === 'first' || prop === 'all' || prop === 'run' || prop === 'raw') {
          return (...rest: unknown[]) => {
            record([{ name, via: prop, args }]);
            return (target[prop] as (...a: unknown[]) => unknown).apply(target, rest);
          };
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    statements.set(proxy, { real, name, args });
    return proxy;
  };

  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'stats') return stats;
      if (prop === 'journal') return journal;
      if (prop === 'failWhen') return state.failWhen;
      if (prop === 'prepare') {
        return (sql: string) => wrap(target.prepare(sql), SQL_NAMES.get(sql) ?? sql.slice(0, 40), []);
      }
      if (prop === 'batch') {
        return (stmts: D1PreparedStatement[]) => {
          const known = stmts.map((stmt) => {
            const entry = statements.get(stmt);
            if (entry === undefined) throw new Error('countingDb: a statement prepared elsewhere');
            return entry;
          });
          record(known.map(({ name, args }) => ({ name, via: 'batch' as const, args })));
          return target.batch(known.map((entry) => entry.real));
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
    set(_target, prop, value) {
      if (prop !== 'failWhen') return false;
      state.failWhen = value as CountingDb['failWhen'];
      return true;
    },
  }) as CountingDb;
}

export type TestClock = { ms: number };

/** The test environment with `overrides` (e.g. MONITOR_PLAN), RPC_URL on the fake primary. */
export function testEnv(overrides: Record<string, string | undefined> = {}): Env {
  const all: Record<string, unknown> = { ...env, RPC_URL: PRIMARY_URL, ...overrides };
  return Object.fromEntries(Object.entries(all).filter(([, value]) => value !== undefined)) as unknown as Env;
}

/**
 * Deps for runMonitorPass: the test clock, the routed fetch, the counting D1, short timeouts without retry pauses,
 * pass ids pass-1, pass-2, ... and the log in an array.
 */
export function makeDeps(options: {
  clock: TestClock;
  chain: FakeChain;
  telegram: FakeTelegram;
  env?: Record<string, string | undefined>;
  db?: CountingDb;
  fallback?: FakeChain;
}) {
  const net = network(options.chain, options.telegram, options.fallback);
  const db = options.db ?? countingDb(env.DB);
  const logs: Record<string, unknown>[] = [];
  let passes = 0;
  const deps: MonitorDeps = {
    env: testEnv(options.env),
    db,
    fetch: net.fetch,
    now: () => options.clock.ms,
    newPassId: () => {
      passes += 1;
      return `pass-${String(passes)}`;
    },
    upstream: { timeoutMs: 50, retryDelayMs: 0 },
    telegramTimeoutMs: 50,
    log: (line) => logs.push(line),
    adminMemory: new Map(),
  };
  return { deps, net, db, logs };
}

/** Slots run at 400 ms from a fixed origin: the slot follows the time, a later time is a later slot. */
const SLOT_ORIGIN_MS = Date.UTC(2026, 0, 1);
const SLOT_ORIGIN = 300_000_000;

export type Harness = ReturnType<typeof createHarness>;

/**
 * A fake chain, a fake Telegram, the counting D1 and deps over them, plus seed and read helpers. With `fallback`, the
 * fallback RPC host is that chain (set RPC_FALLBACK_URL in `env`); its slot and clock are the test's to set.
 */
export function createHarness(options: { env?: Record<string, string | undefined>; fallback?: FakeChain } = {}) {
  const clock: TestClock = { ms: Date.UTC(2026, 9, 5, 12) };
  const chain = new FakeChain();
  const telegram = new FakeTelegram();
  const made = makeDeps({
    clock,
    chain,
    telegram,
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.fallback === undefined ? {} : { fallback: options.fallback }),
  });
  const { deps, net, db, logs } = made;

  const setTime = (ms: number) => {
    clock.ms = ms;
    chain.clock.unixTimestamp = BigInt(Math.floor(ms / 1000));
    chain.slot = SLOT_ORIGIN + Math.floor((ms - SLOT_ORIGIN_MS) / 400);
  };
  setTime(clock.ms);

  /** Rows /api/watch would write for `addresses`, read from the chain now (at its slot and cluster clock). */
  const watchRows = (addresses: readonly Address[], opts: { fingerprint?: boolean } = {}): WatchRow[] =>
    addresses.map((address) => {
      const raw = chain.accounts.get(address);
      if (raw === undefined) throw new Error(`seedWatched: ${address} is not on the fake chain`);
      const decoded = decodeStakeAccount({ address, data: raw.data, lamports: raw.lamports, owner: raw.owner ?? STAKE_PROGRAM_ADDRESS });
      if (!decoded.ok) throw new Error(`seedWatched: ${address} does not decode`);
      const dataBase64 = opts.fingerprint === false ? null : encodeBase64(raw.data);
      const clockMs = Number(chain.clock.unixTimestamp) * 1000;
      return watchRowOf(decoded.account, BigInt(chain.slot), clockMs, dataBase64, chain.clock.unixTimestamp);
    });

  return {
    clock,
    chain,
    telegram,
    net,
    db,
    logs,
    deps,
    /** Sets the worker clock and the cluster clock to `iso` (UTC); the chain slot follows the time. */
    at(iso: string): void {
      setTime(Date.parse(iso));
    },
    advance(ms: number): void {
      setTime(clock.ms + ms);
    },
    pass(): Promise<PassReport> {
      return runMonitorPass(deps);
    },
    /** Watches `addresses` as POST /api/watch would, from their chain state now. Not counted. */
    async seedWatched(addresses: readonly Address[], opts: { fingerprint?: boolean } = {}): Promise<void> {
      await env.DB.batch(insertWatchedStatements(env.DB, watchRows(addresses, opts), clock.ms));
    },
    async linkChat(wallet: Address, chatId: string, lastEventId = 0): Promise<void> {
      await env.DB.prepare('INSERT INTO alert_links (wallet, chat_id, created_at, last_event_id) VALUES (?1, ?2, ?3, ?4)')
        .bind(wallet, chatId, clock.ms, lastEventId)
        .run();
    },
    async setMeta(entries: Record<string, string>): Promise<void> {
      await env.DB.batch(
        Object.entries(entries).map(([key, value]) =>
          env.DB.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)').bind(key, value),
        ),
      );
    },
    async readMeta(): Promise<Record<string, string>> {
      const { results } = await env.DB.prepare('SELECT key, value FROM meta').all<{ key: string; value: string }>();
      return Object.fromEntries(results.map((row) => [row.key, row.value]));
    },
    async readEvents(): Promise<StoredEventRow[]> {
      const { results } = await env.DB.prepare(
        'SELECT id, stake_account, type, details_json, slot, detected_at, notified_at FROM events ORDER BY id',
      ).all<Omit<StoredEventRow, 'details'> & { details_json: string }>();
      return results.map(({ details_json, ...row }) => ({ ...row, details: JSON.parse(details_json) as unknown }));
    },
    async readLinks(): Promise<{ wallet: string; chat_id: string; last_event_id: number }[]> {
      const { results } = await env.DB.prepare(
        'SELECT wallet, chat_id, last_event_id FROM alert_links ORDER BY chat_id, wallet',
      ).all<{ wallet: string; chat_id: string; last_event_id: number }>();
      return results;
    },
    async readAccounts(): Promise<AccountsRow[]> {
      const { results } = await env.DB.prepare(
        `SELECT stake_account, withdrawer, staker, custodian, CAST(lock_until AS TEXT) AS lock_until, lamports, state,
                voter, activation_epoch, deactivation_epoch, slot, checked_at, last_reminder_days, fingerprint
         FROM accounts ORDER BY stake_account`,
      ).all<AccountsRow>();
      return results;
    },
    /** Admin messages Telegram received for ADMIN_CHAT_ID (any reply). */
    adminMessages(): string[] {
      return telegram.requests.filter((r) => r.chatId === ADMIN_CHAT).map((r) => r.text);
    },
  };
}

export type StoredEventRow = {
  id: number;
  stake_account: string;
  type: string;
  details: unknown;
  slot: number;
  detected_at: number;
  notified_at: number | null;
};

export type AccountsRow = {
  stake_account: string;
  withdrawer: string;
  staker: string;
  custodian: string;
  lock_until: string;
  lamports: string;
  state: string;
  voter: string | null;
  activation_epoch: string | null;
  deactivation_epoch: string | null;
  slot: number;
  checked_at: number;
  last_reminder_days: number | null;
  fingerprint: string | null;
};
