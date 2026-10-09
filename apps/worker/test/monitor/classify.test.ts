import { STAKE_PROGRAM_ADDRESS, stakeDataFingerprint, SYSTEM_PROGRAM_ADDRESS } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { classifyChunk } from '../../src/monitor/classify.ts';
import type { ChunkRead, RawItem } from '../../src/monitor/read.ts';
import { watchRowOf, type AccountRow } from '../../src/monitor/store.ts';
import type { StakeAccountSpec } from '../transactions.ts';
import { key, LOCK_UNTIL } from '../transactions.ts';
import { accountRowOf, testStake, type TestStake } from './rows.ts';

const MAIN = key(1);
const SECOND = key(2);
const THIEF = key(3);
const STAKE = key(10);
const ROW_SLOT = 5000;
/** The row was written 100 days before the lock end. */
const ROW_S = LOCK_UNTIL - 100n * 86_400n;
const ROW_MS = Number(ROW_S) * 1000;

const SPEC: StakeAccountSpec = { state: 'delegated', staker: MAIN, withdrawer: MAIN, custodian: SECOND, unixTimestamp: LOCK_UNTIL };
const stake = (overrides: Partial<StakeAccountSpec> = {}, lamports?: bigint, address = STAKE) =>
  testStake(address, { ...SPEC, ...overrides }, lamports);

function rowOf(s: TestStake, options: { fingerprint?: boolean; checkedAtMs?: number } = {}): AccountRow {
  const data = options.fingerprint === false ? null : s.dataBase64;
  return accountRowOf(watchRowOf(s.account, BigInt(ROW_SLOT), options.checkedAtMs ?? ROW_MS, data, ROW_S));
}

const item = (s: TestStake): RawItem => ({ owner: STAKE_PROGRAM_ADDRESS, dataBase64: s.dataBase64, lamports: s.lamports });

/** A read two minutes after the row was written, unless `clockS` says otherwise. */
function readOf(items: (RawItem | null)[], options: { slot?: number; clockS?: bigint } = {}): ChunkRead {
  const clockS = options.clockS ?? ROW_S + 120n;
  return {
    slot: options.slot ?? ROW_SLOT + 300,
    clock: { slot: 1n, epochStartTimestamp: clockS - 3_600n, epoch: 950n, unixTimestamp: clockS },
    clockMs: Number(clockS) * 1000,
    items,
  };
}

describe('classifyChunk: fast path', () => {
  it('an unchanged account: nothing decoded, nothing written', () => {
    const s = stake();
    const out = classifyChunk([rowOf(s)], readOf([item(s)]), 20);
    expect(out).toEqual({
      processed: 1,
      updates: [],
      events: [],
      rescan: [],
      counts: { stale: 0, fastPath: 1, lamportsOnly: 0, decoded: 0, closed: 0 },
    });
  });

  it('epoch rewards (more lamports, delegated stake and credits moved): the new balance only, same fingerprint', () => {
    const before = stake({ stake: 5_000_000_000n, credits: 100n }, 10_000_000_000n);
    const after = stake({ stake: 5_000_123_456n, credits: 4_000n }, 10_000_123_456n);
    const row = rowOf(before);
    const out = classifyChunk([row], readOf([item(after)]), 20);
    expect(out.counts).toMatchObject({ fastPath: 0, lamportsOnly: 1, decoded: 0 });
    expect(out.events).toEqual([]);
    expect(out.updates).toEqual([
      {
        stakeAccount: STAKE,
        withdrawer: MAIN,
        staker: MAIN,
        custodian: SECOND,
        lockUntil: row.lock_until,
        lamports: '10000123456',
        state: 'delegated',
        voter: row.voter,
        activationEpoch: row.activation_epoch,
        deactivationEpoch: row.deactivation_epoch,
        slot: ROW_SLOT + 300,
        checkedAt: ROW_MS + 120_000,
        fingerprint: row.fingerprint,
        prevSlot: ROW_SLOT,
        prevCheckedAt: ROW_MS,
      },
    ]);
  });

  it('a row without a fingerprint (watched without one) takes the full path once: written, no events', () => {
    const s = stake();
    const out = classifyChunk([rowOf(s, { fingerprint: false })], readOf([item(s)]), 20);
    expect(out.counts).toMatchObject({ fastPath: 0, decoded: 1 });
    expect(out.events).toEqual([]);
    expect(out.updates).toHaveLength(1);
    expect(out.updates[0]).toMatchObject({ fingerprint: stakeDataFingerprint(s.dataBase64), slot: ROW_SLOT + 300 });
  });
});

describe('classifyChunk: full path', () => {
  it('a deactivation: decoded, DEACTIVATED on the row version, the new snapshot written, the pair rescanned', () => {
    const before = stake();
    const after = stake({ deactivationEpoch: 951n });
    const out = classifyChunk([rowOf(before)], readOf([item(after)]), 20);
    expect(out.counts).toMatchObject({ decoded: 1, closed: 0 });
    expect(out.events).toEqual([
      {
        stakeAccount: STAKE,
        type: 'DEACTIVATED',
        detailsJson: JSON.stringify({ deactivationEpoch: '951' }),
        slot: ROW_SLOT + 300,
        prevSlot: ROW_SLOT,
        prevCheckedAt: ROW_MS,
      },
    ]);
    const { lastReminderDays: _, ...columns } = watchRowOf(after.account, BigInt(ROW_SLOT + 300), ROW_MS + 120_000, after.dataBase64, 0n);
    expect(out.updates).toEqual([{ ...columns, prevSlot: ROW_SLOT, prevCheckedAt: ROW_MS }]);
    expect(out.rescan).toEqual([[MAIN, SECOND]]);
  });

  it('a thief takes the staker: STAKER_CHANGED and a rescan of the stored pair', () => {
    const out = classifyChunk([rowOf(stake())], readOf([item(stake({ staker: THIEF }))]), 20);
    expect(out.events.map((e) => e.type)).toEqual(['STAKER_CHANGED']);
    expect(JSON.parse(out.events[0]?.detailsJson ?? '')).toEqual({ from: MAIN, to: THIEF });
    expect(out.rescan).toEqual([[MAIN, SECOND]]);
  });

  it('a lower balance with the same fingerprint is decoded: BALANCE_DECREASED', () => {
    const out = classifyChunk([rowOf(stake({}, 10_000_000_000n))], readOf([item(stake({}, 9_000_000_000n))]), 20);
    expect(out.counts).toMatchObject({ fastPath: 0, decoded: 1 });
    expect(out.events.map((e) => e.type)).toEqual(['BALANCE_DECREASED']);
    expect(out.updates[0]?.lamports).toBe('9000000000');
  });

  it('the lock end passing with unchanged data goes to the full path: EXPIRED once', () => {
    const s = stake();
    const row = rowOf(s, { checkedAtMs: Number(LOCK_UNTIL - 60n) * 1000 });
    const out = classifyChunk([row], readOf([item(s)], { clockS: LOCK_UNTIL + 60n }), 20);
    expect(out.events.map((e) => e.type)).toEqual(['EXPIRED']);
    expect(out.updates[0]).toMatchObject({ checkedAt: Number(LOCK_UNTIL + 60n) * 1000, prevCheckedAt: row.checked_at });
    expect(out.rescan).toEqual([]);
  });

  it('a missing account: ACCOUNT_CLOSED, the row closed with its last known keys, nothing decoded', () => {
    const row = rowOf(stake());
    const out = classifyChunk([row], readOf([null]), 0);
    expect(out.counts).toMatchObject({ decoded: 0, closed: 1 });
    expect(out.events.map((e) => e.type)).toEqual(['ACCOUNT_CLOSED']);
    expect(out.updates).toEqual([
      {
        stakeAccount: STAKE,
        withdrawer: MAIN,
        staker: MAIN,
        custodian: SECOND,
        lockUntil: row.lock_until,
        lamports: row.lamports,
        state: 'closed',
        voter: row.voter,
        activationEpoch: row.activation_epoch,
        deactivationEpoch: row.deactivation_epoch,
        slot: ROW_SLOT + 300,
        checkedAt: ROW_MS + 120_000,
        fingerprint: null,
        prevSlot: ROW_SLOT,
        prevCheckedAt: ROW_MS,
      },
    ]);
    expect(out.rescan).toEqual([[MAIN, SECOND]]);
  });

  it('an account now owned by another program is closed', () => {
    const s = stake();
    const reused: RawItem = { owner: SYSTEM_PROGRAM_ADDRESS, dataBase64: '', lamports: 1_000_000n };
    const out = classifyChunk([rowOf(s)], readOf([reused]), 20);
    expect(out.events.map((e) => e.type)).toEqual(['ACCOUNT_CLOSED']);
    expect(out.updates[0]?.state).toBe('closed');
  });

  it('checked_at never goes backwards when the read clock is behind the row', () => {
    const row = rowOf(stake());
    const out = classifyChunk([row], readOf([item(stake({ staker: THIEF }))], { clockS: ROW_S - 30n }), 20);
    expect(out.updates[0]?.checkedAt).toBe(ROW_MS);
  });

  it('throws when the read does not match the rows (a caller bug)', () => {
    expect(() => classifyChunk([rowOf(stake())], readOf([]), 20)).toThrow(/1 rows, 0 accounts/);
  });
});

describe('classifyChunk: lagging node and decode cap', () => {
  it('a read older than the row (a lagging fallback node) is skipped: no event, no write', () => {
    const row = rowOf(stake());
    const out = classifyChunk([row], readOf([null], { slot: ROW_SLOT - 1 }), 20);
    expect(out).toEqual({
      processed: 1,
      updates: [],
      events: [],
      rescan: [],
      counts: { stale: 1, fastPath: 0, lamportsOnly: 0, decoded: 0, closed: 0 },
    });
    // The same slot is not older.
    expect(classifyChunk([row], readOf([null], { slot: ROW_SLOT }), 20).counts.closed).toBe(1);
  });

  it('stops before the first account it may no longer decode; the cursor stays before it', () => {
    const accounts = [11, 12, 13, 14, 15].map((n) => stake({}, undefined, key(n)));
    const rows = accounts.map((s) => rowOf(s));
    const changed = (n: number) => item(stake({ staker: THIEF }, undefined, key(n)));
    const items = [item(accounts[0] as TestStake), changed(12), null, changed(14), changed(15)];

    const out = classifyChunk(rows, readOf(items), 1);
    // Row 0 fast path, row 1 decoded (the cap), row 2 missing (no decode needed), row 3 needs a decode: stop.
    expect(out.processed).toBe(3);
    expect(out.counts).toMatchObject({ fastPath: 1, decoded: 1, closed: 1 });
    expect(out.updates.map((u) => u.stakeAccount)).toEqual([key(12), key(13)]);
    // The pass sets the cursor to the last processed row: the next pass starts at the deferred one.
    expect(rows[out.processed - 1]?.stake_account).toBe(key(13));
    expect(rows[out.processed]?.stake_account).toBe(key(14));

    const none = classifyChunk(rows.slice(3), readOf(items.slice(3)), 0);
    expect(none).toMatchObject({ processed: 0, updates: [], events: [] });
  });
});
