// The rule for every write of a first sighting (POST /api/watch and monitor rescans; step 5 spec section 11):
// insertWatchedStatements inserts a new row, revives a closed row only from a fresher read, and never changes a live
// row. Otherwise anyone could POST the account of a victim right after the theft, refresh its snapshot, and the
// monitor would never report the Deactivate.
import { I64_MAX, reminderDue, snapshotOf, stakeDataFingerprint, U64_MAX } from '@stakeward/core';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { insertWatchedStatements, snapshotOfRow, SQL, watchRowOf, type AccountRow } from '../src/monitor/store.ts';
import { testStake } from './monitor/rows.ts';
import { key, LOCK_UNTIL } from './transactions.ts';

const db = env.DB;
const MAIN = key(1);
const SECOND = key(2);
const THIEF = key(3);
const STAKE = key(10);
const NOW_S = LOCK_UNTIL - 100n * 86_400n;
const NOW_MS = Number(NOW_S) * 1000;

const locked = testStake(STAKE, {
  state: 'delegated',
  staker: MAIN,
  withdrawer: MAIN,
  custodian: SECOND,
  unixTimestamp: LOCK_UNTIL,
});
const deactivated = testStake(STAKE, {
  state: 'delegated',
  staker: THIEF,
  withdrawer: MAIN,
  custodian: SECOND,
  unixTimestamp: LOCK_UNTIL,
  deactivationEpoch: 900n,
});

type Row = AccountRow & { created_at: number };

async function rows(): Promise<Row[]> {
  const { results } = await db
    .prepare(`SELECT stake_account, withdrawer, staker, custodian, CAST(lock_until AS TEXT) AS lock_until, lamports, state,
                     voter, activation_epoch, deactivation_epoch, slot, checked_at, last_reminder_days, fingerprint, created_at
              FROM accounts ORDER BY stake_account`)
    .all<Row>();
  return results;
}

/** One row per statement, as POST /api/watch writes them: meta.changes says watched (1) or already watched (0). */
async function watch(stake: typeof locked, slot: bigint, checkedAtMs: number, createdAtMs: number) {
  const row = watchRowOf(stake.account, slot, checkedAtMs, stake.dataBase64, BigInt(Math.floor(checkedAtMs / 1000)));
  const results = await db.batch(insertWatchedStatements(db, [row], createdAtMs));
  return results.map((r) => r.meta.changes);
}

describe('insertWatchedStatements: the /api/watch contract', () => {
  it('inserts a new account with every column from the read', async () => {
    expect(await watch(locked, 5000n, NOW_MS, NOW_MS + 7)).toEqual([1]);
    const [row] = await rows();
    expect(row).toEqual({
      stake_account: STAKE,
      withdrawer: MAIN,
      staker: MAIN,
      custodian: SECOND,
      lock_until: LOCK_UNTIL.toString(),
      lamports: '10000000000',
      state: 'delegated',
      voter: key(42),
      activation_epoch: '800',
      deactivation_epoch: U64_MAX.toString(),
      slot: 5000,
      checked_at: NOW_MS,
      last_reminder_days: null,
      fingerprint: stakeDataFingerprint(locked.dataBase64),
      created_at: NOW_MS + 7,
    } satisfies Row);
    // The stored row reads back as exactly the snapshot of the read.
    expect(snapshotOfRow(row as AccountRow)).toEqual(snapshotOf(locked.account, 5000n, NOW_MS));
  });

  it('never changes a live row, even from a fresher read of a changed account', async () => {
    await watch(locked, 5000n, NOW_MS, NOW_MS);
    const before = await rows();
    expect(await watch(deactivated, 6000n, NOW_MS + 60_000, NOW_MS + 60_000)).toEqual([0]);
    expect(await rows()).toEqual(before);
  });

  it('revives a closed row only from a read with a higher slot', async () => {
    await watch(locked, 5000n, NOW_MS, NOW_MS);
    await db.prepare("UPDATE accounts SET state = 'closed', fingerprint = NULL, slot = 5500 WHERE stake_account = ?1").bind(STAKE).run();
    const closed = await rows();

    expect(await watch(deactivated, 5500n, NOW_MS + 60_000, NOW_MS + 60_000)).toEqual([0]);
    expect(await watch(deactivated, 5400n, NOW_MS + 60_000, NOW_MS + 60_000)).toEqual([0]);
    expect(await rows()).toEqual(closed);

    expect(await watch(deactivated, 5501n, NOW_MS + 60_000, NOW_MS + 90_000)).toEqual([1]);
    const [revived] = await rows();
    expect(revived).toMatchObject({
      staker: THIEF,
      state: 'delegated',
      deactivation_epoch: '900',
      slot: 5501,
      checked_at: NOW_MS + 60_000,
      fingerprint: stakeDataFingerprint(deactivated.dataBase64),
      // created_at keeps the first sighting.
      created_at: NOW_MS,
    });
  });

  it('stores lock_until = i64::MAX exactly and reads it back exactly', async () => {
    const forever = testStake(STAKE, { staker: MAIN, withdrawer: MAIN, custodian: SECOND, unixTimestamp: I64_MAX });
    await watch(forever, 5000n, NOW_MS, NOW_MS);
    const [row] = await rows();
    expect(row?.lock_until).toBe('9223372036854775807');
    expect(snapshotOfRow(row as AccountRow).lockUntil).toBe(I64_MAX);
    const exact = await db.prepare('SELECT lock_until = ?1 AS same FROM accounts').bind('9223372036854775807').first();
    expect(exact).toEqual({ same: 1 });
    const page = await db.prepare(SQL.PAGE).bind(10).all<AccountRow>();
    expect(page.results[0]?.lock_until).toBe('9223372036854775807');
  });

  it('watchRowOf marks the reminder threshold already reached as sent', () => {
    const tenDaysBefore = LOCK_UNTIL - 10n * 86_400n;
    const row = watchRowOf(locked.account, 1n, 0, null, tenDaysBefore);
    expect(row.lastReminderDays).toBe(14);
    expect(reminderDue(LOCK_UNTIL, LOCK_UNTIL - 6n * 86_400n, row.lastReminderDays)).toBe(7);
    expect(row.fingerprint).toBeNull();
    expect(watchRowOf(locked.account, 1n, 0, null, NOW_S).lastReminderDays).toBeNull();
  });
});
