// The public read API (step 5 spec section 9): /api/accounts, /api/stats, and the Telegram deep link
// /api/telegram/link (section 8.4). /api/health has its own file.
import type { Address } from '@solana/kit';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { insertWatchedStatements, type WatchRow } from '../src/monitor/store.ts';
import { fakeUpstream, freshIp, SECURITY_HEADERS, securityHeadersOf, testApp } from './fakes.ts';
import { countingDb } from './monitor/harness.ts';
import { key } from './transactions.ts';

const NOW = Date.UTC(2026, 9, 5, 12);
const NOW_S = BigInt(NOW / 1000);
const DAY = 86_400n;
const WALLET = key(1);
const OTHER = key(2);
const ZERO = '11111111111111111111111111111111';

const noUpstream = () =>
  fakeUpstream(() => {
    throw new Error('the public API never calls the RPC');
  });

function api(options: { ip?: string; env?: Partial<Env> } = {}) {
  return testApp(noUpstream(), { now: () => NOW, ...options });
}

/** A stored row as POST /api/watch writes it. */
function row(
  stakeAccount: Address,
  columns: { withdrawer: Address; custodian: Address; lockUntil: bigint; lamports?: string; checkedAt?: number },
): WatchRow {
  return {
    stakeAccount,
    withdrawer: columns.withdrawer,
    staker: columns.withdrawer,
    custodian: columns.custodian,
    lockUntil: columns.lockUntil.toString(),
    lamports: columns.lamports ?? '10000000000',
    state: 'delegated',
    voter: key(90),
    activationEpoch: '800',
    deactivationEpoch: '18446744073709551615',
    slot: 400_000_000,
    checkedAt: columns.checkedAt ?? NOW - 3_600_000,
    lastReminderDays: null,
    fingerprint: null,
  };
}

async function seed(rows: readonly WatchRow[]): Promise<void> {
  await env.DB.batch(insertWatchedStatements(env.DB, rows, NOW - 86_400_000));
}

async function close(stakeAccount: Address): Promise<void> {
  await env.DB.prepare("UPDATE accounts SET state = 'closed' WHERE stake_account = ?1").bind(stakeAccount).run();
}

async function addEvent(stakeAccount: Address, type: string, details: unknown, slot: number, detectedAt: number) {
  await env.DB.prepare(
    'INSERT INTO events (stake_account, type, details_json, slot, detected_at, notified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
  )
    .bind(stakeAccount, type, JSON.stringify(details), slot, detectedAt, detectedAt + 1000)
    .run();
}

afterEach(() => {
  vi.restoreAllMocks();
});

type AccountsBody = {
  wallet: string;
  now: string;
  lastMonitorRunAt: string | null;
  accounts: Record<string, unknown>[];
  events: Record<string, unknown>[];
};

describe('GET /api/accounts', () => {
  it('lists the accounts where the wallet is the main or the second key, with roles, lock and days left', async () => {
    const [mainOnly, secondOnly, both, endingSoon, ended, boundary, forever, closed, foreign] = [
      key(10), key(11), key(12), key(13), key(14), key(15), key(16), key(17), key(18),
    ];
    await seed([
      row(mainOnly, { withdrawer: WALLET, custodian: OTHER, lockUntil: NOW_S + 40n * DAY }),
      row(secondOnly, { withdrawer: OTHER, custodian: WALLET, lockUntil: NOW_S + 40n * DAY - 1n }),
      row(both, { withdrawer: WALLET, custodian: WALLET, lockUntil: NOW_S + 100n * DAY }),
      row(endingSoon, { withdrawer: WALLET, custodian: OTHER, lockUntil: NOW_S + 12n * DAY + 1n }),
      row(ended, { withdrawer: WALLET, custodian: OTHER, lockUntil: NOW_S }),
      // Exactly 30 days left is not "ending soon" (core EXPIRING_THRESHOLD_SECONDS: less than 30 days).
      row(boundary, { withdrawer: WALLET, custodian: OTHER, lockUntil: NOW_S + 30n * DAY }),
      row(forever, { withdrawer: WALLET, custodian: OTHER, lockUntil: 9_223_372_036_854_775_807n, lamports: '18446744073709551615' }),
      row(closed, { withdrawer: WALLET, custodian: OTHER, lockUntil: NOW_S + 40n * DAY }),
      row(foreign, { withdrawer: OTHER, custodian: key(3), lockUntil: NOW_S + 40n * DAY }),
    ]);
    await close(closed);
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('last_pass_at', ?1)").bind(String(NOW - 90_000)).run();

    const res = await api().request(`/api/accounts?wallet=${WALLET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
    const body = await res.json<AccountsBody>();
    expect(Object.keys(body).sort()).toEqual(['accounts', 'events', 'lastMonitorRunAt', 'now', 'wallet']);
    expect(body).toMatchObject({ wallet: WALLET, now: '2026-10-05T12:00:00.000Z', lastMonitorRunAt: '2026-10-05T11:58:30.000Z' });

    const byAddress = new Map(body.accounts.map((a) => [a.address, a]));
    expect([...byAddress.keys()].sort()).toEqual(
      [mainOnly, secondOnly, both, endingSoon, ended, boundary, forever, closed].sort(),
    );
    expect(body.accounts.map((a) => a.address)).toEqual([...byAddress.keys()].sort());
    for (const account of body.accounts) {
      expect(Object.keys(account).sort()).toEqual(
        ['address', 'daysLeft', 'lamports', 'lastChangeAt', 'lock', 'lockUntil', 'roles', 'state'],
      );
    }
    expect(byAddress.get(mainOnly)).toEqual({
      address: mainOnly,
      roles: ['main'],
      lockUntil: (NOW_S + 40n * DAY).toString(),
      lock: 'in-force',
      daysLeft: 40,
      lamports: '10000000000',
      state: 'delegated',
      lastChangeAt: '2026-10-05T11:00:00.000Z',
    });
    expect(byAddress.get(secondOnly)).toMatchObject({ roles: ['second'], lock: 'in-force', daysLeft: 40 });
    expect(byAddress.get(both)).toMatchObject({ roles: ['main', 'second'], lock: 'in-force', daysLeft: 100 });
    expect(byAddress.get(endingSoon)).toMatchObject({ lock: 'ending-soon', daysLeft: 13 });
    expect(byAddress.get(ended)).toMatchObject({ lock: 'ended', daysLeft: null });
    expect(byAddress.get(boundary)).toMatchObject({ lock: 'in-force', daysLeft: 30 });
    // i64::MAX and u64::MAX come back exact, as strings; the days left are exact too.
    expect(byAddress.get(forever)).toMatchObject({
      lockUntil: '9223372036854775807',
      lamports: '18446744073709551615',
      lock: 'in-force',
      daysLeft: Number((9_223_372_036_854_775_807n - NOW_S + DAY - 1n) / DAY),
    });
    expect(byAddress.get(closed)).toMatchObject({ state: 'closed', roles: ['main'] });
  });

  it('lists the newest 50 events of those accounts, without reminders and without delivery state', async () => {
    const [mine, theirs] = [key(20), key(21)];
    await seed([
      row(mine, { withdrawer: WALLET, custodian: OTHER, lockUntil: NOW_S + 40n * DAY }),
      row(theirs, { withdrawer: OTHER, custodian: key(3), lockUntil: NOW_S + 40n * DAY }),
    ]);
    await addEvent(mine, 'DEACTIVATED', { deactivationEpoch: '951' }, 400_000_001, NOW - 300_000);
    await addEvent(mine, 'REMINDER_7', { days: 7, lockUntil: '1807574400' }, 400_000_001, NOW - 200_000);
    await addEvent(theirs, 'DEACTIVATED', { deactivationEpoch: '951' }, 400_000_002, NOW - 150_000);
    await addEvent(mine, 'STAKER_CHANGED', { from: WALLET, to: key(4) }, 400_000_003, NOW - 100_000);
    for (let i = 0; i < 55; i++) await addEvent(mine, 'BALANCE_DECREASED', { i }, 400_000_100 + i, NOW - 50_000 + i);

    const body = await (await api().request(`/api/accounts?wallet=${WALLET}`)).json<AccountsBody>();
    expect(body.events).toHaveLength(50);
    expect(body.events[0]).toEqual({
      stakeAccount: mine,
      type: 'BALANCE_DECREASED',
      details: { i: 54 },
      slot: '400000154',
      detectedAt: new Date(NOW - 50_000 + 54).toISOString(),
    });
    expect(body.events.every((e) => e.stakeAccount === mine && e.type === 'BALANCE_DECREASED')).toBe(true);

    await env.DB.prepare("DELETE FROM events WHERE type = 'BALANCE_DECREASED'").run();
    const fewer = await (await api().request(`/api/accounts?wallet=${WALLET}`)).json<AccountsBody>();
    expect(fewer.events).toEqual([
      { stakeAccount: mine, type: 'STAKER_CHANGED', details: { from: WALLET, to: key(4) }, slot: '400000003', detectedAt: new Date(NOW - 100_000).toISOString() },
      { stakeAccount: mine, type: 'DEACTIVATED', details: { deactivationEpoch: '951' }, slot: '400000001', detectedAt: new Date(NOW - 300_000).toISOString() },
    ]);
    const text = JSON.stringify(fewer);
    expect(text).not.toMatch(/REMINDER|notified/i);
  });

  it('an unknown wallet gets empty lists and lastMonitorRunAt null before the first pass', async () => {
    const res = await api().request(`/api/accounts?wallet=${key(5)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      wallet: key(5),
      now: '2026-10-05T12:00:00.000Z',
      lastMonitorRunAt: null,
      accounts: [],
      events: [],
    });
  });

  it.each([
    ['no query', ''],
    ['not an address', '?wallet=nope'],
    ['the all-zero address', `?wallet=${ZERO}`],
    ['another parameter', `?withdrawer=${WALLET}`],
    ['an extra parameter', `?wallet=${WALLET}&x=1`],
    ['the wallet twice', `?wallet=${WALLET}&wallet=${WALLET}`],
  ])('400 invalid-query for %s, without D1', async (_name, query) => {
    const db = countingDb(env.DB);
    const res = await api({ env: { DB: db } }).request(`/api/accounts${query}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-query', message: 'Pass exactly one wallet=<address>' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
    expect(db.stats.statements).toBe(0);
  });

  it('500 when D1 fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await env.DB.exec('DROP TABLE events');
    const res = await api().request(`/api/accounts?wallet=${WALLET}`);
    expect(res.status).toBe(500);
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
  });
});

describe('GET /api/stats', () => {
  it('counts watched accounts under a lock now and sums their lamports exactly, as a string', async () => {
    await seed([
      // 2^53 + 1 and 1: a JavaScript number sum would give 9007199254740992.
      row(key(30), { withdrawer: WALLET, custodian: OTHER, lockUntil: NOW_S + 1n, lamports: '9007199254740993' }),
      row(key(31), { withdrawer: OTHER, custodian: key(3), lockUntil: NOW_S + 400n * DAY, lamports: '1' }),
      // Not counted: a lock that ended (at now), and a closed account.
      row(key(32), { withdrawer: WALLET, custodian: OTHER, lockUntil: NOW_S, lamports: '5000' }),
      row(key(33), { withdrawer: WALLET, custodian: OTHER, lockUntil: NOW_S + 40n * DAY, lamports: '7000' }),
    ]);
    await close(key(33));
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('alerts_sent', '7')").run();

    const res = await api().request('/api/stats');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
    expect(await res.json()).toEqual({
      accountsLocked: 2,
      lamportsLocked: '9007199254740994',
      alertsSent: 7,
      now: '2026-10-05T12:00:00.000Z',
    });
  });

  it('zeros on an empty database', async () => {
    expect(await (await api().request('/api/stats')).json()).toEqual({
      accountsLocked: 0,
      lamportsLocked: '0',
      alertsSent: 0,
      now: '2026-10-05T12:00:00.000Z',
    });
  });

  it('500 when D1 fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await env.DB.exec('DROP TABLE accounts');
    const res = await api().request('/api/stats');
    expect(res.status).toBe(500);
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
  });
});

describe('LOOKUP_RATE_LIMIT on /api/accounts and /api/stats', () => {
  it('20 requests per 60 s per client IP, shared with /api/stake-accounts, then 429 with Retry-After', async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) expect((await api({ ip }).request(`/api/accounts?wallet=${WALLET}`)).status).toBe(200);
    for (let i = 0; i < 9; i++) expect((await api({ ip }).request('/api/stats')).status).toBe(200);
    expect((await api({ ip }).request('/api/stake-accounts')).status).toBe(400);
    for (const path of [`/api/accounts?wallet=${WALLET}`, '/api/stats', '/api/accounts']) {
      const limited = await api({ ip }).request(path);
      expect(limited.status, path).toBe(429);
      expect(limited.headers.get('Retry-After')).toBe('60');
      expect(limited.headers.get('Cache-Control')).toBe('no-store');
      expect(await limited.json()).toEqual({ error: 'rate-limited', message: 'Too many requests, try again in a minute' });
      expect(securityHeadersOf(limited)).toEqual(SECURITY_HEADERS);
    }
    // Health has no limit; another client is not affected.
    expect((await api({ ip }).request('/api/health')).status).toBe(503);
    expect((await api().request('/api/stats')).status).toBe(200);
  });
});

describe('GET /api/telegram/link', () => {
  it("302 to the bot's deep link for the wallet, not cached, without D1 or the network", async () => {
    const db = countingDb(env.DB);
    const res = await api({ env: { DB: db } }).request(`/api/telegram/link?wallet=${WALLET}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`https://t.me/stakeward_test_bot?start=${WALLET}`);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
    expect(db.stats.statements).toBe(0);
  });

  it('a base58 address always fits the start parameter (64 of [A-Za-z0-9_-])', () => {
    expect(WALLET).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect('z'.repeat(44)).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it.each([
    ['no query', ''],
    ['not an address', '?wallet=nope'],
    ['the all-zero address', `?wallet=${ZERO}`],
    ['another parameter', `?address=${WALLET}`],
    ['an extra parameter', `?wallet=${WALLET}&start=x`],
    ['the wallet twice', `?wallet=${WALLET}&wallet=${OTHER}`],
  ])('400 invalid-query for %s', async (_name, query) => {
    const res = await api().request(`/api/telegram/link${query}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-query', message: 'Pass exactly one wallet=<address>' });
    expect(res.headers.get('Location')).toBeNull();
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
  });

  it.each([
    ['empty', ''],
    ['with @', '@stakeward_test_bot'],
    ['too short', 'bot'],
    ['a URL', 'https://t.me/x'],
  ])('503 while TELEGRAM_BOT_USERNAME is not a bot username (%s)', async (_name, username) => {
    const res = await api({ env: { TELEGRAM_BOT_USERNAME: username } }).request(`/api/telegram/link?wallet=${WALLET}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'telegram-not-configured', message: 'Telegram alerts are not set up yet' });
    expect(res.headers.get('Location')).toBeNull();
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
  });
});
