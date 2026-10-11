import { getAddressDecoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { rawStakeAccount, stakeAccountOf } from '../test/raw-stake.ts';
import { STAKE_PROGRAM_ADDRESS, SYSTEM_PROGRAM_ADDRESS, U64_MAX, ZERO_ADDRESS } from './constants.ts';
import type { Lockup, RawAccount } from './decode.ts';
import { watchResponseFromJson, watchResponseToJson, type WatchResponse } from './json.ts';
import { customLockBounds, customLockEnd } from './lockup.ts';
import { MAX_WATCH_ACCOUNTS, WATCH_MAX_LOCK_SECONDS, watchVerdict } from './watch.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const A = key(1); // main key (stakeAccountOf's withdrawer)
const K = key(2); // second key
const NOW = 1_800_000_000n;
const CLOCK = { unixTimestamp: NOW, epoch: 1_000n };

const lockedRaw = (lockup: Partial<Lockup>): RawAccount =>
  rawStakeAccount(stakeAccountOf({ lockup: { unixTimestamp: NOW + 86_400n, epoch: 0n, custodian: K, ...lockup } }));

describe('watchVerdict', () => {
  it('accepts the furthest custom lock end the site offers (D131)', () => {
    // Just before midnight, so the furthest date is nearly CUSTOM_LOCK_MAX_YEARS and a day ahead.
    for (const now of [NOW, BigInt(Date.UTC(2028, 1, 29, 23, 59) / 1000)]) {
      const furthest = customLockEnd(customLockBounds(now).max, now);
      if (!furthest.ok) throw new Error('the furthest bound is a valid custom end');
      const raw = lockedRaw({ unixTimestamp: furthest.lockUntil });
      expect(watchVerdict(raw, { unixTimestamp: now, epoch: 1_000n }).ok).toBe(true);
    }
  });

  it('accepts a stake account locked by a second key, and returns it decoded', () => {
    const account = stakeAccountOf({ lockup: { unixTimestamp: NOW + 180n * 86_400n, epoch: 0n, custodian: K } });
    expect(watchVerdict(rawStakeAccount(account), CLOCK)).toEqual({ ok: true, account });
  });

  it('accepts a delegated account and a lock ending exactly 10 years after the cluster clock', () => {
    const delegated = stakeAccountOf({
      kind: 'delegated',
      lockup: { unixTimestamp: NOW + WATCH_MAX_LOCK_SECONDS, epoch: 0n, custodian: K },
      delegation: { voter: key(5), stake: 4_000_000_000n, activationEpoch: 900n, deactivationEpoch: U64_MAX },
    });
    expect(watchVerdict(rawStakeAccount(delegated), CLOCK)).toEqual({ ok: true, account: delegated });
  });

  it.each([
    ['a missing account', null, 'not-found'],
    ['a wallet (System-owned)', { ...lockedRaw({}), data: new Uint8Array(), owner: SYSTEM_PROGRAM_ADDRESS }, 'not-stake-account'],
    ['a 199-byte stake account', { ...lockedRaw({}), data: lockedRaw({}).data.slice(0, 199) }, 'not-stake-account'],
    ['an uninitialized stake account', { ...lockedRaw({}), data: new Uint8Array(200) }, 'not-stake-account'],
    ['a stake-sized account of another program', { ...lockedRaw({}), owner: SYSTEM_PROGRAM_ADDRESS }, 'not-stake-account'],
    ['no lock', lockedRaw({ unixTimestamp: 0n, custodian: ZERO_ADDRESS }), 'not-locked'],
    ['a lock ending exactly at the cluster clock', lockedRaw({ unixTimestamp: NOW }), 'not-locked'],
    ['a lock that ended', lockedRaw({ unixTimestamp: NOW - 1n }), 'not-locked'],
    ['an epoch-only lock (the epoch is ignored)', lockedRaw({ unixTimestamp: 0n, epoch: 2_000n }), 'not-locked'],
    ['a lock held by the main key itself', lockedRaw({ custodian: A }), 'unsupported-lock'],
    ['a lock with the zero key as custodian', lockedRaw({ custodian: ZERO_ADDRESS }), 'unsupported-lock'],
    ['a lock ending over 10 years ahead', lockedRaw({ unixTimestamp: NOW + WATCH_MAX_LOCK_SECONDS + 1n }), 'unsupported-lock'],
  ] as const)('%s -> %s', (_name, raw, reason) => {
    expect(watchVerdict(raw, CLOCK)).toEqual({ ok: false, reason });
  });

  it('judges the lock by the clock it is given (the cluster clock), not by the time of day', () => {
    const raw = lockedRaw({ unixTimestamp: NOW + 60n });
    expect(watchVerdict(raw, CLOCK).ok).toBe(true);
    expect(watchVerdict(raw, { unixTimestamp: NOW + 60n, epoch: 1_000n })).toEqual({ ok: false, reason: 'not-locked' });
  });

  it('applies the rules in order: a missing account before anything, the lock end before its custodian', () => {
    const ended = lockedRaw({ unixTimestamp: NOW - 1n, custodian: A });
    expect(watchVerdict(ended, CLOCK)).toEqual({ ok: false, reason: 'not-locked' });
    expect(watchVerdict({ ...lockedRaw({}), owner: STAKE_PROGRAM_ADDRESS, data: new Uint8Array(1) }, CLOCK)).toEqual({
      ok: false,
      reason: 'not-stake-account',
    });
  });

  it('caps a request at 20 accounts', () => {
    expect(MAX_WATCH_ACCOUNTS).toBe(20);
  });
});

describe('POST /api/watch JSON', () => {
  const S1 = key(11);
  const S2 = key(12);
  const S3 = key(13);
  const response: WatchResponse = {
    slot: 2n ** 60n,
    results: [
      { account: S1, status: 'watched', reason: null },
      { account: S2, status: 'already-watched', reason: null },
      { account: S3, status: 'rejected', reason: 'not-locked' },
    ],
  };
  const json = {
    slot: '1152921504606846976',
    results: [
      { account: S1, status: 'watched' },
      { account: S2, status: 'already-watched' },
      { account: S3, status: 'rejected', reason: 'not-locked' },
    ],
  };

  it('writes u64 slots as decimal strings and a reason only on rejected accounts', () => {
    expect(watchResponseToJson(response)).toEqual(json);
  });

  it('round-trips through JSON text', () => {
    const text = JSON.stringify(watchResponseToJson(response));
    expect(watchResponseFromJson(JSON.parse(text), [S1, S2, S3])).toEqual(response);
  });

  it('round-trips every reject reason', () => {
    for (const reason of ['not-found', 'not-stake-account', 'not-locked', 'unsupported-lock'] as const) {
      const one: WatchResponse = { slot: 1n, results: [{ account: S1, status: 'rejected', reason }] };
      expect(watchResponseFromJson(watchResponseToJson(one), [S1])).toEqual(one);
    }
  });

  it('refuses to write a rejected result without a reason', () => {
    expect(() => watchResponseToJson({ slot: 1n, results: [{ account: S1, status: 'rejected', reason: null }] })).toThrow(
      /rejected without a reason/,
    );
  });

  const results = json.results;
  const [watched, already, rejected] = results;
  it.each([
    ['not an object', [], /body is not an object/],
    ['an extra key at the root', { ...json, cached: true }, /body has an unexpected field "cached"/],
    ['a missing slot', { results }, /body misses the field "slot"/],
    ['a numeric slot', { ...json, slot: 5 }, /slot is not a u64 decimal string/],
    ['a slot above u64', { ...json, slot: '18446744073709551616' }, /slot is larger than u64/],
    ['results that are not an array', { ...json, results: {} }, /results is not an array/],
    ['one result too few', { ...json, results: [watched, already] }, /results has 2 items for 3 accounts/],
    ['one result too many', { ...json, results: [...results, watched] }, /results has 4 items for 3 accounts/],
    [
      'results in another order',
      { ...json, results: [already, watched, rejected] },
      /results\[0\]\.account is not the account asked at this position/,
    ],
    [
      'an extra key on a result',
      { ...json, results: [{ ...watched, note: 'x' }, already, rejected] },
      /results\[0\] has an unexpected field "note"/,
    ],
    [
      'a reason on a watched result',
      { ...json, results: [{ ...watched, reason: 'not-locked' }, already, rejected] },
      /results\[0\] has an unexpected field "reason"/,
    ],
    [
      'a reason on an already-watched result',
      { ...json, results: [watched, { ...already, reason: 'not-found' }, rejected] },
      /results\[1\] has an unexpected field "reason"/,
    ],
    [
      'a rejected result without a reason',
      { ...json, results: [watched, already, { account: S3, status: 'rejected' }] },
      /results\[2\] misses the field "reason"/,
    ],
    [
      'an unknown status',
      { ...json, results: [{ account: S1, status: 'queued' }, already, rejected] },
      /results\[0\]\.status is not a known status/,
    ],
    [
      'an unknown reason',
      { ...json, results: [watched, already, { account: S3, status: 'rejected', reason: 'later' }] },
      /results\[2\]\.reason is not a known reason/,
    ],
    [
      'an account that is not an address',
      { ...json, results: [{ account: 'nope', status: 'watched' }, already, rejected] },
      /results\[0\]\.account is not a base58 address/,
    ],
    ['a result that is not an object', { ...json, results: ['watched', already, rejected] }, /results\[0\] is not an object/],
  ])('rejects %s', (_name, body, message) => {
    const parse = () => watchResponseFromJson(body, [S1, S2, S3]);
    expect(parse).toThrow(message);
    expect(parse).toThrow(expect.objectContaining({ name: 'InvalidWatchResponseError' }));
  });
});
