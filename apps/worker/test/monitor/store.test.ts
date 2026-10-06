// Every SQL statement of src/monitor/store.ts on the local D1 of workerd (migrations applied before each test).
import { getAddressDecoder } from '@solana/kit';
import { I64_MAX, REMINDER_DAYS, reminderDue, U64_MAX } from '@stakeward/core';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { RowUpdate, StoredEvent } from '../../src/monitor/classify.ts';
import {
  chunkEventsStatement,
  chunkUpdateStatement,
  insertWatchedStatements,
  leaseAcquireStatement,
  linkCounterKey,
  linkStateStatement,
  linkWalletStatements,
  putMetaStatement,
  reminderDaysStatement,
  SQL,
  type AccountRow,
  type LinkLimits,
  type WatchRow,
} from '../../src/monitor/store.ts';
import { key, LOCK_UNTIL } from '../transactions.ts';

const db = env.DB;
const MAIN = key(1);
const SECOND = key(2);
const OTHER = key(3);
const NOW_MS = Date.UTC(2026, 9, 5, 12);
const NOW_S = NOW_MS / 1000;

function watchRow(n: number, overrides: Partial<WatchRow> = {}): WatchRow {
  return {
    stakeAccount: key(n),
    withdrawer: MAIN,
    staker: MAIN,
    custodian: SECOND,
    lockUntil: LOCK_UNTIL.toString(),
    lamports: '10000000000',
    state: 'delegated',
    voter: key(42),
    activationEpoch: '800',
    deactivationEpoch: U64_MAX.toString(),
    slot: 1000,
    checkedAt: NOW_MS - 120_000,
    lastReminderDays: null,
    fingerprint: 'fingerprint-1',
    ...overrides,
  };
}

async function seed(...rows: WatchRow[]) {
  await db.batch(insertWatchedStatements(db, rows, 1));
}

async function closeRow(stakeAccount: string) {
  await db.prepare("UPDATE accounts SET state = 'closed' WHERE stake_account = ?1").bind(stakeAccount).run();
}

async function page(limit = 1000) {
  return (await db.prepare(SQL.PAGE).bind(limit).all<AccountRow>()).results;
}

async function meta(): Promise<Record<string, string>> {
  const { results } = await db.prepare(SQL.LOAD_META).all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

async function setMeta(entries: Record<string, string>) {
  await db.batch(
    Object.entries(entries).map(([k, v]) => db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)').bind(k, v)),
  );
}

type EventRow = { id: number; stake_account: string; type: string; details_json: string; slot: number; notified_at: number | null };

async function events() {
  return (await db.prepare('SELECT id, stake_account, type, details_json, slot, notified_at FROM events ORDER BY id').all<EventRow>())
    .results;
}

async function insertEvent(stakeAccount: string, type: string, slot: number, notifiedAt: number | null = null) {
  await db
    .prepare('INSERT INTO events (stake_account, type, details_json, slot, detected_at, notified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(stakeAccount, type, '{}', slot, NOW_MS, notifiedAt)
    .run();
}

async function link(wallet: string, chat: string, createdAt = 1, lastEventId = 0) {
  await db
    .prepare('INSERT INTO alert_links (wallet, chat_id, created_at, last_event_id) VALUES (?1, ?2, ?3, ?4)')
    .bind(wallet, chat, createdAt, lastEventId)
    .run();
}

async function links() {
  type Link = { wallet: string; chat_id: string; last_event_id: number };
  return (await db.prepare('SELECT wallet, chat_id, last_event_id FROM alert_links ORDER BY chat_id, wallet').all<Link>())
    .results;
}

const sorted = (values: string[]) => [...values].sort();

describe('SQL forms the store relies on, as local D1 runs them', () => {
  it('->> reads JSON text, numbers and null; json_each walks arrays and objects', async () => {
    const row = await db
      .prepare(`SELECT ?1 ->> '$.a' AS a, ?1 ->> '$.n' AS n, ?1 ->> '$.z' AS z, typeof(?1 ->> '$.n') AS t`)
      .bind('{"a":"text","n":1807574400123,"z":null}')
      .first();
    expect(row).toEqual({ a: 'text', n: 1807574400123, z: null, t: 'integer' });
    const { results } = await db.prepare('SELECT key, value FROM json_each(?1) ORDER BY key').bind('{"b":"2","a":"1"}').all();
    expect(results).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
  });

  it('UPDATE ... FROM json_each', async () => {
    await setMeta({ x: '1', y: '2' });
    await db
      .prepare(`UPDATE meta SET value = u.value ->> '$.v' FROM json_each(?1) AS u WHERE meta.key = u.value ->> '$.k'`)
      .bind('[{"k":"x","v":"10"}]')
      .run();
    expect(await meta()).toEqual({ x: '10', y: '2' });
  });

  it('upsert with a DO UPDATE ... WHERE and RETURNING: a row only when it inserted or updated', async () => {
    const upsert = db.prepare(
      `INSERT INTO meta (key, value) VALUES ('k', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value
       WHERE meta.value = ?2 RETURNING value`,
    );
    expect((await upsert.bind('a', 'never').all()).results).toEqual([{ value: 'a' }]);
    expect((await upsert.bind('b', 'not-a').all()).results).toEqual([]);
    expect((await upsert.bind('c', 'a').all()).results).toEqual([{ value: 'c' }]);
    expect(await meta()).toEqual({ k: 'c' });
  });

  it('INSERT ... SELECT with EXISTS on the same table, then ON CONFLICT', async () => {
    await setMeta({ gate: 'open', k: 'old' });
    const insert = db.prepare(
      `INSERT INTO meta (key, value) SELECT m.key, m.value FROM json_each(?1) AS m
       WHERE EXISTS (SELECT 1 FROM meta WHERE key = 'gate' AND value = ?2)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    );
    await insert.bind('{"k":"new","n":"1"}', 'closed').run();
    expect(await meta()).toEqual({ gate: 'open', k: 'old' });
    await insert.bind('{"k":"new","n":"1"}', 'open').run();
    expect(await meta()).toEqual({ gate: 'open', k: 'new', n: '1' });
  });
});

describe('lease and meta', () => {
  it('LEASE_ACQUIRE: free -> taken; held -> refused; same pass -> idempotent; expired -> taken over', async () => {
    const acquire = async (pass: string, until: number, nowMs: number) =>
      (await leaseAcquireStatement(db, { pass, until }, nowMs).all<{ value: string }>()).results;

    expect(await acquire('A', NOW_MS + 110_000, NOW_MS)).toEqual([{ value: JSON.stringify({ pass: 'A', until: NOW_MS + 110_000 }) }]);
    expect(await acquire('B', NOW_MS + 200_000, NOW_MS + 90_000)).toEqual([]);
    expect(JSON.parse((await meta()).pass_lease ?? '')).toEqual({ pass: 'A', until: NOW_MS + 110_000 });
    expect(await acquire('A', NOW_MS + 110_000, NOW_MS + 1)).toHaveLength(1);
    // At exactly `until` the lease has expired.
    expect(await acquire('B', NOW_MS + 220_000, NOW_MS + 110_000)).toHaveLength(1);
    expect(JSON.parse((await meta()).pass_lease ?? '')).toEqual({ pass: 'B', until: NOW_MS + 220_000 });
  });

  it('a released lease (until 0) is free for the next pass', async () => {
    await leaseAcquireStatement(db, { pass: 'A', until: NOW_MS + 110_000 }, NOW_MS).run();
    await putMetaStatement(db, { pass_lease: JSON.stringify({ pass: 'A', until: 0 }) }, 'A').run();
    expect((await leaseAcquireStatement(db, { pass: 'B', until: NOW_MS + 110_000 }, NOW_MS + 5).all()).results).toHaveLength(1);
  });

  it('PUT_META writes every entry as text only for the pass holding the lease', async () => {
    await leaseAcquireStatement(db, { pass: 'A', until: NOW_MS + 110_000 }, NOW_MS).run();
    await setMeta({ cursor: 'old' });
    const fenced = await putMetaStatement(db, { cursor: 'by-B', last_pass_at: '1' }, 'B').run();
    expect(fenced.meta.changes).toBe(0);
    expect(await meta()).toMatchObject({ cursor: 'old' });
    await putMetaStatement(db, { cursor: '', last_pass_at: String(NOW_MS), rescan_queue: '[]' }, 'A').run();
    const after = await meta();
    expect(after).toMatchObject({ cursor: '', last_pass_at: String(NOW_MS), rescan_queue: '[]' });
    const types = await db.prepare("SELECT DISTINCT typeof(value) AS t FROM meta").all<{ t: string }>();
    expect(types.results).toEqual([{ t: 'text' }]);
  });

  it('PUT_META without any lease writes nothing', async () => {
    await putMetaStatement(db, { cursor: 'x' }, 'A').run();
    expect(await meta()).toEqual({});
  });

  it('LAST_PASS_AT and ALERTS_SENT read their meta value', async () => {
    expect(await db.prepare(SQL.LAST_PASS_AT).first()).toBeNull();
    await setMeta({ last_pass_at: '1700000000000', alerts_sent: '7' });
    expect(await db.prepare(SQL.LAST_PASS_AT).first()).toEqual({ value: '1700000000000' });
    expect(await db.prepare(SQL.ALERTS_SENT).first()).toEqual({ value: '7' });
  });
});

describe('monitor chunk statements', () => {
  it('PAGE: live rows after the cursor, by address, with lock_until exact as text', async () => {
    const rows = [10, 11, 12, 13].map((n) => watchRow(n, { lockUntil: I64_MAX.toString() }));
    await seed(...rows);
    await closeRow(key(11));
    const live = sorted([key(10), key(12), key(13)]);

    const all = await page();
    expect(all.map((r) => r.stake_account)).toEqual(live);
    expect(all[0]).toEqual({
      stake_account: live[0],
      withdrawer: MAIN,
      staker: MAIN,
      custodian: SECOND,
      lock_until: '9223372036854775807',
      lamports: '10000000000',
      state: 'delegated',
      voter: key(42),
      activation_epoch: '800',
      deactivation_epoch: '18446744073709551615',
      slot: 1000,
      checked_at: NOW_MS - 120_000,
      last_reminder_days: null,
      fingerprint: 'fingerprint-1',
    });

    expect((await page(2)).map((r) => r.stake_account)).toEqual(live.slice(0, 2));
    await setMeta({ cursor: live[0] ?? '' });
    expect((await page()).map((r) => r.stake_account)).toEqual(live.slice(1));
    await setMeta({ cursor: live[2] ?? '' });
    expect(await page()).toEqual([]);
  });

  const deactivated = (prev: { slot: number; checkedAt: number }): RowUpdate => ({
    ...watchRow(10),
    deactivationEpoch: '900',
    lockUntil: I64_MAX.toString(),
    voter: null,
    activationEpoch: null,
    state: 'initialized',
    slot: 1100,
    checkedAt: NOW_MS,
    fingerprint: null,
    prevSlot: prev.slot,
    prevCheckedAt: prev.checkedAt,
  });
  const event = (prev: { slot: number; checkedAt: number }, type: StoredEvent['type'] = 'DEACTIVATED'): StoredEvent => ({
    stakeAccount: key(10),
    type,
    detailsJson: '{"deactivationEpoch":"900"}',
    slot: 1100,
    prevSlot: prev.slot,
    prevCheckedAt: prev.checkedAt,
  });

  it('CHUNK_EVENTS then CHUNK_UPDATE in one batch: applied once, on the version they were computed from', async () => {
    await seed(watchRow(10));
    const version = { slot: 1000, checkedAt: NOW_MS - 120_000 };
    const batch = () =>
      db.batch([chunkEventsStatement(db, [event(version)], NOW_MS), chunkUpdateStatement(db, [deactivated(version)])]);

    const [inserted, updated] = await batch();
    expect(inserted?.meta.changes).toBe(1);
    expect(updated?.meta.changes).toBe(1);
    expect(await events()).toEqual([
      { id: 1, stake_account: key(10), type: 'DEACTIVATED', details_json: '{"deactivationEpoch":"900"}', slot: 1100, notified_at: null },
    ]);
    const [row] = await page();
    expect(row).toMatchObject({
      lock_until: '9223372036854775807',
      state: 'initialized',
      voter: null,
      activation_epoch: null,
      deactivation_epoch: '900',
      slot: 1100,
      checked_at: NOW_MS,
      fingerprint: null,
    });

    // The same batch again (a retried commit, or a second pass with the old read): the version moved on.
    const [again, againUpdate] = await batch();
    expect(again?.meta.changes).toBe(0);
    expect(againUpdate?.meta.changes).toBe(0);
    expect(await events()).toHaveLength(1);
    expect(await page()).toEqual([row]);
  });

  it('CHUNK_EVENTS inserts nothing from a row version that moved on (a pass that lost the race)', async () => {
    await seed(watchRow(10), watchRow(11));
    const current = { slot: 1000, checkedAt: NOW_MS - 120_000 };
    const result = await chunkEventsStatement(
      db,
      [
        { ...event({ ...current, slot: 999 }), slot: 1200 },
        { ...event({ ...current, checkedAt: NOW_MS }), slot: 1201 },
        { ...event(current), stakeAccount: key(12), slot: 1202 },
        { ...event(current), stakeAccount: key(11), slot: 1203 },
      ],
      NOW_MS,
    ).run();
    expect(result.meta.changes).toBe(1);
    expect((await events()).map((e) => [e.stake_account, e.slot])).toEqual([[key(11), 1203]]);
  });

  it('CHUNK_EVENTS ignores a duplicate (account, type, slot) instead of failing the batch', async () => {
    await seed(watchRow(10));
    const version = { slot: 1000, checkedAt: NOW_MS - 120_000 };
    await insertEvent(key(10), 'DEACTIVATED', 1100);
    const [inserted] = await db.batch([chunkEventsStatement(db, [event(version), event(version, 'STAKER_CHANGED')], NOW_MS)]);
    expect(inserted?.meta.changes).toBe(1);
    expect((await events()).map((e) => e.type)).toEqual(['DEACTIVATED', 'STAKER_CHANGED']);
  });

  it('CHUNK_UPDATE leaves rows of another version alone', async () => {
    await seed(watchRow(10), watchRow(11));
    const updates = [
      { ...deactivated({ slot: 1000, checkedAt: NOW_MS - 120_000 }) },
      { ...deactivated({ slot: 999, checkedAt: NOW_MS - 120_000 }), stakeAccount: key(11) },
    ];
    const result = await chunkUpdateStatement(db, updates).run();
    expect(result.meta.changes).toBe(1);
    const rows = Object.fromEntries((await page()).map((r) => [r.stake_account, r.slot]));
    expect(rows).toEqual({ [key(10)]: 1100, [key(11)]: 1000 });
  });

  it('CHUNK_UPDATE keeps the last reminder threshold while the lock end stays, clears it for a new end', async () => {
    await seed(watchRow(10, { lastReminderDays: 30 }), watchRow(11, { stakeAccount: key(11), lastReminderDays: 30 }));
    const version = { prevSlot: 1000, prevCheckedAt: NOW_MS - 120_000, slot: 1100, checkedAt: NOW_MS, fingerprint: null };
    const result = await chunkUpdateStatement(db, [
      { ...watchRow(10), lamports: '10000000001', ...version },
      { ...watchRow(11, { stakeAccount: key(11) }), lockUntil: (LOCK_UNTIL + 86_400n).toString(), ...version },
    ]).run();
    expect(result.meta.changes).toBe(2);
    const days = Object.fromEntries((await page()).map((r) => [r.stake_account, r.last_reminder_days]));
    expect(days).toEqual({ [key(10)]: 30, [key(11)]: null });
  });

  it('KNOWN_LIVE: the listed accounts that have a live row', async () => {
    await seed(watchRow(10), watchRow(11));
    await closeRow(key(11));
    const { results } = await db.prepare(SQL.KNOWN_LIVE).bind(JSON.stringify([key(10), key(11), key(12)])).all();
    expect(results).toEqual([{ stake_account: key(10) }]);
  });

  it('INSERT_WATCHED takes 100 rows per statement', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => {
      const bytes = new Uint8Array(32).fill(7);
      bytes.set([i & 0xff, i >> 8]);
      return watchRow(0, { stakeAccount: getAddressDecoder().decode(bytes) });
    });
    const statements = insertWatchedStatements(db, rows, NOW_MS);
    expect(statements).toHaveLength(3);
    expect(insertWatchedStatements(db, [], NOW_MS)).toEqual([]);
    const results = await db.batch(statements);
    expect(results.map((r) => r.meta.changes)).toEqual([100, 100, 50]);
    const count = await db.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS c FROM accounts').first();
    expect(count).toEqual({ n: 250, c: NOW_MS });
  });
});

describe('daily statements', () => {
  it('DAILY_PAIRS: distinct (main key, second key) pairs of locks not ended, closed rows included, a page after the cursor', async () => {
    await seed(
      watchRow(10),
      watchRow(11),
      watchRow(12, { custodian: OTHER }),
      watchRow(13, { withdrawer: OTHER, lockUntil: String(NOW_S) }),
      watchRow(14, { withdrawer: OTHER, custodian: MAIN }),
    );
    await closeRow(key(14));
    const pairs = async (after: [string, string], limit: number) =>
      (await db.prepare(SQL.DAILY_PAIRS).bind(NOW_S, after[0], after[1], limit).all<{ withdrawer: string; custodian: string }>())
        .results;
    const expected = [
      { withdrawer: MAIN, custodian: SECOND },
      { withdrawer: MAIN, custodian: OTHER },
      { withdrawer: OTHER, custodian: MAIN },
    ].sort((a, b) =>
      a.withdrawer !== b.withdrawer ? (a.withdrawer < b.withdrawer ? -1 : 1) : a.custodian < b.custodian ? -1 : 1,
    );
    expect(await pairs(['', ''], 100)).toEqual(expected);
    // Keyset by (main key, second key): each page goes on after the last pair of the one before.
    const [one, two, three] = expected;
    expect(await pairs(['', ''], 2)).toEqual([one, two]);
    expect(await pairs([two?.withdrawer ?? '', two?.custodian ?? ''], 2)).toEqual([three]);
    expect(await pairs([one?.withdrawer ?? '', one?.custodian ?? ''], 1)).toEqual([two]);
    expect(await pairs([three?.withdrawer ?? '', three?.custodian ?? ''], 2)).toEqual([]);
  });

  it('DAILY_REMINDER_ROWS: live locks ending within 30 days whose reminder is due, by address after the cursor', async () => {
    const day = 86_400;
    await seed(
      // Its 14-day reminder was sent: not due, so it takes no place in the page.
      watchRow(10, { lockUntil: String(NOW_S + 10 * day), lastReminderDays: 14 }),
      watchRow(11, { lockUntil: String(NOW_S + 30 * day) }),
      watchRow(12, { lockUntil: String(NOW_S + 30 * day + 1) }),
      watchRow(13, { lockUntil: String(NOW_S) }),
      watchRow(14, { lockUntil: String(NOW_S + 1) }),
      watchRow(15, { lockUntil: String(NOW_S + 2 * day) }),
      // Only the 30-day reminder was sent: the 14-day one is due.
      watchRow(16, { lockUntil: String(NOW_S + 10 * day), lastReminderDays: 30 }),
    );
    await closeRow(key(15));
    const select = async (after: string, limit: number) =>
      (await db.prepare(SQL.DAILY_REMINDER_ROWS).bind(NOW_S, after, limit).all()).results;
    const version = { slot: 1000, checked_at: NOW_MS - 120_000 };
    const expected = [
      { stake_account: key(14), lock_until: String(NOW_S + 1), last_reminder_days: null, ...version },
      { stake_account: key(11), lock_until: String(NOW_S + 30 * day), last_reminder_days: null, ...version },
      { stake_account: key(16), lock_until: String(NOW_S + 10 * day), last_reminder_days: 30, ...version },
    ].sort((a, b) => (a.stake_account < b.stake_account ? -1 : 1));
    expect(await select('', 1000)).toEqual(expected);
    // Keyset paging: strictly after the cursor, at most `limit` rows.
    expect(await select(expected[0]?.stake_account ?? '', 1)).toEqual([expected[1]]);
    expect(await select(expected[1]?.stake_account ?? '', 1000)).toEqual([expected[2]]);
    expect(await select(expected[2]?.stake_account ?? '', 1000)).toEqual([]);
  });

  it('DAILY_REMINDER_ROWS selects a row exactly when core reminderDue has a reminder for it', async () => {
    const day = 86_400;
    const offsets = [-1, 0, 1, ...REMINDER_DAYS.flatMap((d) => [d * day - 1, d * day, d * day + 1])];
    const lasts = [null, ...REMINDER_DAYS];
    const rows: WatchRow[] = [];
    const due: string[] = [];
    offsets.forEach((offset, i) => {
      lasts.forEach((last, j) => {
        const bytes = new Uint8Array(32).fill(0x33);
        bytes[0] = i;
        bytes[1] = j;
        const stakeAccount = getAddressDecoder().decode(bytes);
        rows.push(watchRow(0, { stakeAccount, lockUntil: String(NOW_S + offset), lastReminderDays: last }));
        if (reminderDue(BigInt(NOW_S + offset), BigInt(NOW_S), last) !== null) due.push(stakeAccount);
      });
    });
    await seed(...rows);
    const { results } = await db.prepare(SQL.DAILY_REMINDER_ROWS).bind(NOW_S, '', 1000).all<{ stake_account: string }>();
    expect(results.map((r) => r.stake_account)).toEqual(due.sort());
    expect(due.length).toBeGreaterThan(30);
    expect(due.length).toBeLessThan(rows.length);
  });

  it('REMINDER_DAYS records the threshold on the row version it was decided on', async () => {
    await seed(watchRow(10), watchRow(11));
    const result = await reminderDaysStatement(db, [
      { stakeAccount: key(10), days: 7, prevSlot: 1000, prevCheckedAt: NOW_MS - 120_000 },
      { stakeAccount: key(11), days: 7, prevSlot: 1000, prevCheckedAt: NOW_MS },
    ]).run();
    expect(result.meta.changes).toBe(1);
    const days = Object.fromEntries((await page()).map((r) => [r.stake_account, r.last_reminder_days]));
    expect(days).toEqual({ [key(10)]: 7, [key(11)]: null });
  });
});

describe('delivery statements', () => {
  it('PENDING: undelivered events in id order with the row keys and lock_until as text', async () => {
    await seed(watchRow(10, { lockUntil: I64_MAX.toString() }), watchRow(11, { withdrawer: OTHER }));
    await insertEvent(key(10), 'DEACTIVATED', 1);
    await insertEvent(key(11), 'STAKER_CHANGED', 2, NOW_MS);
    await insertEvent(key(11), 'BALANCE_DECREASED', 3);
    await insertEvent(key(10), 'REMINDER_7', 4);
    const { results } = await db.prepare(SQL.PENDING).bind(2).all();
    expect(results).toEqual([
      {
        id: 1,
        stake_account: key(10),
        type: 'DEACTIVATED',
        details_json: '{}',
        detected_at: NOW_MS,
        withdrawer: MAIN,
        custodian: SECOND,
        lock_until: '9223372036854775807',
      },
      {
        id: 3,
        stake_account: key(11),
        type: 'BALANCE_DECREASED',
        details_json: '{}',
        detected_at: NOW_MS,
        withdrawer: OTHER,
        custodian: SECOND,
        lock_until: LOCK_UNTIL.toString(),
      },
    ]);
  });

  it('PENDING reads the undelivered events only, however many were delivered before (D1 rows read)', async () => {
    await seed(watchRow(10));
    // Events are never deleted: 3000 delivered ones, then 2 waiting.
    await db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 3000)
         INSERT INTO events (stake_account, type, details_json, slot, detected_at, notified_at)
         SELECT ?1, 'DEACTIVATED', '{}', i, ?2, ?2 FROM n`,
      )
      .bind(key(10), NOW_MS)
      .run();
    await insertEvent(key(10), 'STAKER_CHANGED', 1);
    await insertEvent(key(10), 'BALANCE_DECREASED', 2);
    const result = await db.prepare(SQL.PENDING).bind(100).all();
    expect(result.results.map((r) => r.type)).toEqual(['STAKER_CHANGED', 'BALANCE_DECREASED']);
    expect(result.meta.rows_read).toBeLessThanOrEqual(10);

    await db.prepare('UPDATE events SET notified_at = ?1 WHERE notified_at IS NULL').bind(NOW_MS).run();
    const quiet = await db.prepare(SQL.PENDING).bind(100).all();
    expect(quiet.results).toEqual([]);
    expect(quiet.meta.rows_read).toBeLessThanOrEqual(2);
  });

  it('LINKS_FOR, LINK_PROGRESS (never backwards, every link of the chat), UNLINK_CHATS', async () => {
    await link(MAIN, '-100500', 1, 0);
    await link(SECOND, '-100500', 2, 5);
    await link(MAIN, '42', 3, 0);
    await link(OTHER, '43', 4, 0);
    const { results } = await db.prepare(SQL.LINKS_FOR).bind(JSON.stringify([MAIN, SECOND])).all();
    expect(sorted(results.map((r) => `${String(r.wallet)}/${String(r.chat_id)}`))).toEqual(
      sorted([`${MAIN}/-100500`, `${SECOND}/-100500`, `${MAIN}/42`]),
    );

    await db.prepare(SQL.LINK_PROGRESS).bind(JSON.stringify([{ chat: '-100500', id: 3 }, { chat: '42', id: 9 }])).run();
    const progress = Object.fromEntries((await links()).map((l) => [`${l.wallet}/${l.chat_id}`, l.last_event_id]));
    expect(progress).toEqual({ [`${MAIN}/-100500`]: 3, [`${SECOND}/-100500`]: 5, [`${MAIN}/42`]: 9, [`${OTHER}/43`]: 0 });

    await db.prepare(SQL.UNLINK_CHATS).bind(JSON.stringify(['-100500', '44'])).run();
    expect((await links()).map((l) => l.chat_id)).toEqual(['42', '43']);
  });

  it('MARK_NOTIFIED sets notified_at once, for the listed ids only', async () => {
    await insertEvent(key(10), 'DEACTIVATED', 1);
    await insertEvent(key(10), 'STAKER_CHANGED', 2, 5);
    await insertEvent(key(10), 'BALANCE_DECREASED', 3);
    await db.prepare(SQL.MARK_NOTIFIED).bind(JSON.stringify([1, 2]), NOW_MS).run();
    expect((await events()).map((e) => e.notified_at)).toEqual([NOW_MS, 5, null]);
  });
});

describe('webhook statements', () => {
  const TODAY = '2026-10-05';
  const SECRET = 'test-webhook-secret';
  const LIMITS: LinkLimits = { linksPerChat: 20, writesPerDay: 1000, writesPerChatPerDay: 50 };
  /** The key meta.link_writes counts `chat` under on `day`. */
  const keyOf = (chat: string, day = TODAY) => linkCounterKey(SECRET, chat, day);
  /** The /start batch: [LINK_COUNT, LINK_WALLET, LINK_STATE], each call with a fresh token. */
  const linkWallet = async (wallet: string, chat: string, opts: { nowMs?: number; today?: string; limits?: LinkLimits } = {}) =>
    db.batch(
      linkWalletStatements(db, {
        wallet,
        chatId: chat,
        today: opts.today ?? TODAY,
        counterKey: await keyOf(chat, opts.today ?? TODAY),
        nowMs: opts.nowMs ?? NOW_MS,
        token: crypto.randomUUID(),
        limits: opts.limits ?? LIMITS,
      }),
    );
  const linkWritesText = async () =>
    (await db.prepare("SELECT value FROM meta WHERE key = 'link_writes'").first<{ value: string }>())?.value ?? 'null';
  const linkWrites = async () => JSON.parse(await linkWritesText()) as unknown;
  const state = async (wallet: string, chat: string, today = TODAY) =>
    (await linkStateStatement(db, wallet, chat, today, await keyOf(chat, today)).all()).results;

  it('linkCounterKey: 32 hex characters of an HMAC of the day and the chat id, keyed by the webhook secret', async () => {
    const key42 = await keyOf('42');
    expect(key42).toMatch(/^[0-9a-f]{32}$/);
    expect(await keyOf('42')).toBe(key42);
    const others = [
      await keyOf('43'),
      await keyOf('42', '2026-10-06'),
      await linkCounterKey('another-secret', '42', TODAY),
      await keyOf('-1001234567890'),
    ];
    expect(new Set([key42, ...others]).size).toBe(5);
  });

  it('meta.link_writes holds no chat id: a chat that sent /stop leaves no trace of its id in meta', async () => {
    await linkWallet(MAIN, '1234567890');
    await linkWallet(SECOND, '-1001234567890');
    await db.prepare(SQL.STOP).bind('1234567890').run();
    await db.prepare(SQL.UNLINK_CHATS).bind(JSON.stringify(['-1001234567890'])).run();
    expect(await links()).toEqual([]);
    const { results } = await db.prepare('SELECT key, value FROM meta').all<{ key: string; value: string }>();
    expect(results.map((row) => row.key)).toEqual(['link_writes']);
    for (const chat of ['1234567890', '1001234567890']) expect(JSON.stringify(results)).not.toContain(chat);
    // The count itself stays: churn does not reopen the chat's budget.
    expect(await linkWrites()).toMatchObject({ n: 2, chats: { [await keyOf('1234567890')]: 1 } });
  });

  it('LINK_WALLET starts at the newest event id and is idempotent; LINK_STATE counts live accounts of the wallet', async () => {
    await seed(watchRow(10), watchRow(11, { withdrawer: OTHER }), watchRow(12));
    await closeRow(key(12));
    await insertEvent(key(10), 'DEACTIVATED', 1);
    await insertEvent(key(10), 'STAKER_CHANGED', 2);

    const [counted, inserted, after] = await linkWallet(SECOND, '42');
    expect(counted?.meta.changes).toBe(1);
    expect(inserted?.meta.changes).toBe(1);
    expect(after?.results).toEqual([{ linked: 1, watched: 2, links: 1, day_writes: 1, chat_writes: 1 }]);
    const [countedAgain, again, afterAgain] = await linkWallet(SECOND, '42', { nowMs: NOW_MS + 1 });
    expect(countedAgain?.meta.changes).toBe(0);
    expect(again?.meta.changes).toBe(0);
    expect(afterAgain?.results).toEqual([{ linked: 1, watched: 2, links: 1, day_writes: 1, chat_writes: 1 }]);
    expect(await links()).toEqual([{ wallet: SECOND, chat_id: '42', last_event_id: 2 }]);

    const [, , nothingWatched] = await linkWallet(key(99), '42');
    expect(nothingWatched?.results).toEqual([{ linked: 1, watched: 0, links: 2, day_writes: 2, chat_writes: 2 }]);
  });

  it('LINK_WALLET: with no events the link starts at 0; a chat follows at most 20 wallets', async () => {
    for (let n = 100; n < 120; n++) await linkWallet(key(n), '42');
    expect(await links()).toHaveLength(20);
    expect((await links()).every((l) => l.last_event_id === 0)).toBe(true);
    const [counted, refused, after] = await linkWallet(key(120), '42');
    expect(counted?.meta.changes).toBe(0);
    expect(refused?.meta.changes).toBe(0);
    expect(after?.results).toEqual([{ linked: 0, watched: 0, links: 20, day_writes: 20, chat_writes: 20 }]);
    // An existing link stays linked at the limit; another chat is not affected.
    expect((await linkWallet(key(100), '42'))[2]?.results).toMatchObject([{ linked: 1, links: 20 }]);
    expect((await linkWallet(key(120), '43'))[2]?.results).toMatchObject([{ linked: 1, links: 1, chat_writes: 1 }]);
  });

  it('LINK_COUNT counts only the links LINK_WALLET adds, per day and per chat (meta.link_writes)', async () => {
    await linkWallet(MAIN, '42');
    await linkWallet(MAIN, '42');
    await linkWallet(SECOND, '42');
    await linkWallet(MAIN, '-1001234567890');
    const [k42, kGroup] = [await keyOf('42'), await keyOf('-1001234567890')];
    expect(await linkWrites()).toMatchObject({ day: TODAY, n: 3, chats: { [k42]: 2, [kGroup]: 1 } });
    // A /stop deletes links, not the count: the same wallet linked again counts again.
    await db.prepare(SQL.STOP).bind('42').run();
    await linkWallet(MAIN, '42');
    expect(await linkWrites()).toMatchObject({ day: TODAY, n: 4, chats: { [k42]: 3, [kGroup]: 1 } });
    expect(await state(OTHER, '42')).toEqual([{ linked: 0, watched: 0, links: 1, day_writes: 4, chat_writes: 3 }]);
    // A new day starts from 0, and its count holds only the chats that linked that day.
    await linkWallet(OTHER, '43', { today: '2026-10-06' });
    expect(await linkWrites()).toMatchObject({ day: '2026-10-06', n: 1, chats: { [await keyOf('43', '2026-10-06')]: 1 } });
    expect(await state(OTHER, '42', '2026-10-06')).toMatchObject([{ day_writes: 1, chat_writes: 0 }]);
  });

  it('LINK_COUNT refuses past the day\'s budget or the chat\'s, and LINK_WALLET then adds nothing', async () => {
    const tight: LinkLimits = { linksPerChat: 20, writesPerDay: 3, writesPerChatPerDay: 2 };
    await linkWallet(key(100), '42', { limits: tight });
    await linkWallet(key(101), '42', { limits: tight });
    const [chatFull, notAdded, after] = await linkWallet(key(102), '42', { limits: tight });
    expect(chatFull?.meta.changes).toBe(0);
    expect(notAdded?.meta.changes).toBe(0);
    expect(after?.results).toMatchObject([{ linked: 0, links: 2, day_writes: 2, chat_writes: 2 }]);
    // Another chat still links until the day's budget is used up.
    await linkWallet(key(100), '43', { limits: tight });
    const [dayFull, , afterDay] = await linkWallet(key(101), '43', { limits: tight });
    expect(dayFull?.meta.changes).toBe(0);
    expect(afterDay?.results).toMatchObject([{ linked: 0, day_writes: 3, chat_writes: 1 }]);
    expect(await links()).toHaveLength(3);
    expect(await linkWrites()).toMatchObject({ n: 3, chats: { [await keyOf('42')]: 2, [await keyOf('43')]: 1 } });
  });

  it('LINK_WALLET adds nothing without the token of the LINK_COUNT before it', async () => {
    const [counted] = await linkWallet(MAIN, '42');
    expect(counted?.meta.changes).toBe(1);
    const statements = linkWalletStatements(db, {
      wallet: SECOND,
      chatId: '42',
      today: TODAY,
      counterKey: await keyOf('42'),
      nowMs: NOW_MS,
      token: 'not-the-last-token',
      limits: LIMITS,
    });
    const [inserted, after] = await db.batch(statements.slice(1));
    expect(inserted?.meta.changes).toBe(0);
    expect(after?.results).toMatchObject([{ linked: 0 }]);
    expect(await links()).toEqual([{ wallet: MAIN, chat_id: '42', last_event_id: 0 }]);
  });

  it('STATUS lists the wallets of the chat in link order with their live account counts; STOP forgets the chat', async () => {
    await seed(watchRow(10), watchRow(11, { withdrawer: OTHER, custodian: OTHER }));
    await link(OTHER, '42', 2);
    await link(MAIN, '42', 1);
    await link(MAIN, '43', 1);
    const { results } = await db.prepare(SQL.STATUS).bind('42').all();
    expect(results).toEqual([
      { wallet: MAIN, watched: 1 },
      { wallet: OTHER, watched: 1 },
    ]);
    await db.prepare(SQL.STOP).bind('42').run();
    expect(await links()).toEqual([{ wallet: MAIN, chat_id: '43', last_event_id: 0 }]);
  });
});

describe('public API statements', () => {
  it('ACCOUNTS_FOR_WALLET: rows where the wallet is the main or the second key, closed included', async () => {
    await seed(watchRow(10), watchRow(11, { withdrawer: OTHER }), watchRow(12, { withdrawer: OTHER, custodian: OTHER }));
    await closeRow(key(10));
    const { results } = await db.prepare(SQL.ACCOUNTS_FOR_WALLET).bind(SECOND).all();
    expect(results.map((r) => r.stake_account)).toEqual(sorted([key(10), key(11)]));
    expect(results.find((r) => r.stake_account === key(10))).toEqual({
      stake_account: key(10),
      withdrawer: MAIN,
      custodian: SECOND,
      lock_until: LOCK_UNTIL.toString(),
      lamports: '10000000000',
      state: 'closed',
      checked_at: NOW_MS - 120_000,
    });
  });

  it("EVENTS_FOR_WALLET: the wallet's events, newest first, without reminders", async () => {
    await seed(watchRow(10), watchRow(11, { withdrawer: OTHER, custodian: OTHER }));
    await insertEvent(key(10), 'DEACTIVATED', 1);
    await insertEvent(key(11), 'DEACTIVATED', 2);
    await insertEvent(key(10), 'REMINDER_7', 3);
    await insertEvent(key(10), 'STAKER_CHANGED', 4);
    const { results } = await db.prepare(SQL.EVENTS_FOR_WALLET).bind(MAIN).all();
    expect(results.map((r) => r.type)).toEqual(['STAKER_CHANGED', 'DEACTIVATED']);
    expect(results[0]).toEqual({ stake_account: key(10), type: 'STAKER_CHANGED', details_json: '{}', slot: 4, detected_at: NOW_MS });
  });

  it('STATS_COUNT and STATS_CACHE: live locks not ended; the lamport sum is exact above 2^53; a count stands ?3 ms, from up to ?4 ms ahead', async () => {
    const TTL = 600_000;
    const SKEW = 60_000;
    const count = async (ms: number) => {
      const [, cache] = await db.batch([
        db.prepare(SQL.STATS_COUNT).bind(ms, Math.floor(ms / 1000), TTL, SKEW),
        db.prepare(SQL.STATS_CACHE),
      ]);
      return cache?.results;
    };
    await seed(
      watchRow(10, { lamports: '9007199254740993' }),
      watchRow(11, { lamports: '1' }),
      watchRow(12, { lamports: '5', lockUntil: String(NOW_S) }),
      watchRow(13, { lamports: '7' }),
    );
    await closeRow(key(13));
    expect(await count(NOW_MS)).toEqual([{ at: NOW_MS, accounts: 2, lamports: '9007199254740994' }]);
    // The stored value is the JSON object the comment of SQL.STATS_COUNT names, `at` an integer.
    expect(await db.prepare("SELECT value FROM meta WHERE key = 'stats_cache'").first()).toEqual({
      value: `{"at":${String(NOW_MS)},"accounts":2,"lamports":"9007199254740994"}`,
    });
    await db.prepare('DELETE FROM accounts').run();
    expect(await count(NOW_MS + TTL - 1)).toEqual([{ at: NOW_MS, accounts: 2, lamports: '9007199254740994' }]);
    expect(await count(NOW_MS + TTL)).toEqual([{ at: NOW_MS + TTL, accounts: 0, lamports: '0' }]);
    // A count up to ?4 ms from the future stands (clocks differ); further ahead it does not.
    await seed(watchRow(14, { lamports: '3' }));
    expect(await count(NOW_MS + TTL - SKEW)).toEqual([{ at: NOW_MS + TTL, accounts: 0, lamports: '0' }]);
    expect(await count(NOW_MS + TTL - SKEW - 1)).toEqual([{ at: NOW_MS + TTL - SKEW - 1, accounts: 1, lamports: '3' }]);
  });
});
