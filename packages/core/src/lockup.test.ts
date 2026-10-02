import { getAddressDecoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { ZERO_ADDRESS } from './constants.ts';
import {
  DEFAULT_LOCK_PERIOD,
  isLockupInForce,
  lockPeriodsFor,
  lockupEnd,
  lockupEndForPeriod,
  validateSecondKey,
} from './lockup.ts';

const utc = (iso: string): bigint => BigInt(Date.parse(iso) / 1000);
const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));

describe('isLockupInForce', () => {
  const clock = { unixTimestamp: 1_800_000_000n, epoch: 1_000n };

  it('is in force while the timestamp is later than the clock', () => {
    expect(isLockupInForce({ unixTimestamp: clock.unixTimestamp + 1n, epoch: 0n }, clock)).toBe(true);
  });

  it('is over at exactly the lockup timestamp', () => {
    expect(isLockupInForce({ unixTimestamp: clock.unixTimestamp, epoch: 0n }, clock)).toBe(false);
    expect(isLockupInForce({ unixTimestamp: clock.unixTimestamp - 1n, epoch: 0n }, clock)).toBe(false);
  });

  it('is in force while the epoch is later than the current epoch, whatever the timestamp', () => {
    expect(isLockupInForce({ unixTimestamp: 0n, epoch: clock.epoch + 1n }, clock)).toBe(true);
    expect(isLockupInForce({ unixTimestamp: 0n, epoch: clock.epoch }, clock)).toBe(false);
  });

  it('is not in force for an empty lockup', () => {
    expect(isLockupInForce({ unixTimestamp: 0n, epoch: 0n }, clock)).toBe(false);
  });
});

describe('lockupEndForPeriod: 00:00 UTC after the end of the period', () => {
  it.each([
    // [now, months, T]
    ['2026-10-02T12:34:56Z', 6, '2027-04-03T00:00:00Z'],
    ['2026-10-11T08:00:00Z', 6, '2027-04-12T00:00:00Z'],
    ['2026-12-15T10:00:00Z', 1, '2027-01-16T00:00:00Z'], // year rollover
    ['2026-10-02T12:00:00Z', 12, '2027-10-03T00:00:00Z'],
    ['2026-10-02T12:00:00Z', 3, '2027-01-03T00:00:00Z'],
    // Month ends: a missing day becomes the last day of the target month.
    ['2027-01-31T10:00:00Z', 1, '2027-03-01T00:00:00Z'], // Feb 28 2027 -> next midnight
    ['2028-01-31T10:00:00Z', 1, '2028-03-01T00:00:00Z'], // Feb 29 2028 (leap) -> next midnight
    ['2028-01-30T10:00:00Z', 1, '2028-03-01T00:00:00Z'], // Feb 29 2028
    ['2028-01-29T10:00:00Z', 1, '2028-03-01T00:00:00Z'], // Feb 29 2028 exists
    ['2028-01-28T10:00:00Z', 1, '2028-02-29T00:00:00Z'],
    ['2026-08-31T10:00:00Z', 6, '2027-03-01T00:00:00Z'], // Feb 28 2027
    ['2027-03-31T10:00:00Z', 3, '2027-07-01T00:00:00Z'], // Jun 30
    ['2028-02-29T10:00:00Z', 12, '2029-03-01T00:00:00Z'], // Feb 28 2029
    // Midnight is moved to the next midnight ("strictly after"); one second before midnight too.
    ['2026-10-01T00:00:00Z', 1, '2026-11-02T00:00:00Z'],
    ['2026-10-01T23:59:59Z', 1, '2026-11-02T00:00:00Z'],
  ] as const)('%s + %i months -> %s', (now, months, expected) => {
    expect(lockupEndForPeriod(utc(now), months)).toBe(utc(expected));
    expect(lockupEndForPeriod(new Date(now), months)).toBe(utc(expected));
  });

  it('always lands on a UTC midnight after the nominal period', () => {
    for (let day = 0; day < 800; day += 7) {
      const now = utc('2026-01-01T13:00:00Z') + BigInt(day) * 86_400n;
      for (const months of [1, 3, 6, 12] as const) {
        const end = lockupEndForPeriod(now, months);
        expect(end % 86_400n).toBe(0n);
        expect(end).toBeGreaterThan(now + BigInt(months) * 28n * 86_400n);
        expect(end).toBeLessThanOrEqual(now + BigInt(months) * 31n * 86_400n + 86_400n);
      }
    }
  });

  it('rejects an invalid date', () => {
    expect(() => lockupEndForPeriod(new Date('not a date'), 1)).toThrow('Invalid date');
  });
});

describe('lock periods by cluster', () => {
  it('offers only month periods on mainnet and adds the short ones on devnet', () => {
    expect(lockPeriodsFor('mainnet')).toEqual(['1-month', '3-months', '6-months', '12-months']);
    expect(lockPeriodsFor('devnet')).toEqual(['1-month', '3-months', '6-months', '12-months', '10-minutes', '1-hour']);
    expect(lockPeriodsFor('mainnet')).toContain(DEFAULT_LOCK_PERIOD);
    expect(DEFAULT_LOCK_PERIOD).toBe('6-months');
  });

  it('computes month periods the same on every cluster', () => {
    const now = utc('2026-10-02T12:00:00Z');
    expect(lockupEnd(now, '6-months', 'mainnet')).toBe(lockupEndForPeriod(now, 6));
    expect(lockupEnd(now, '1-month', 'devnet')).toBe(lockupEndForPeriod(now, 1));
  });

  it('adds 10 minutes or 1 hour on devnet and refuses them on mainnet', () => {
    const now = utc('2026-10-02T12:00:30Z');
    expect(lockupEnd(now, '10-minutes', 'devnet')).toBe(now + 600n);
    expect(lockupEnd(new Date('2026-10-02T12:00:30.900Z'), '1-hour', 'devnet')).toBe(now + 3_600n);
    expect(() => lockupEnd(now, '10-minutes', 'mainnet')).toThrow('only available on devnet');
    expect(() => lockupEnd(now, '1-hour', 'mainnet')).toThrow('only available on devnet');
  });
});

describe('validateSecondKey', () => {
  const mainKey = key(1);
  const staker = key(2);
  const stakeAccount = key(3);

  it('accepts a different key', () => {
    expect(validateSecondKey({ second: key(9), mainKey, staker, stakeAccount })).toEqual([]);
  });

  it.each([
    [ZERO_ADDRESS, ['zero-key']],
    [mainKey, ['main-key']],
    [staker, ['staker']],
    [stakeAccount, ['stake-account']],
  ] as const)('rejects %s', (second, violations) => {
    expect(validateSecondKey({ second, mainKey, staker, stakeAccount })).toEqual(violations);
  });

  it('reports every rule a key breaks', () => {
    expect(validateSecondKey({ second: mainKey, mainKey, staker: mainKey, stakeAccount })).toEqual(['main-key', 'staker']);
  });
});
