import type { Address } from '@solana/kit';
import { lockupEnd, ZERO_ADDRESS, type StakeAccount } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { choiceLockUntil, choiceValue, defaultChoice, extendOptions, extendStage, type ExtendChoice } from './options.ts';

const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8' as Address;
const SECOND = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi' as Address;
const STAKE = 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW' as Address;
/** 2026-10-01T00:00:00Z. */
const NOW = 1_790_812_800n;
const CLOCK = { unixTimestamp: NOW, epoch: 850n };
const DAY = 86_400n;

function stake(lockup: StakeAccount['lockup']): StakeAccount {
  return {
    address: STAKE,
    lamports: 2_001_666_240n,
    kind: 'initialized',
    rentExemptReserve: 1_666_240n,
    staker: MAIN,
    withdrawer: MAIN,
    lockup,
    delegation: null,
  };
}

const values = (choices: readonly ExtendChoice[]) => choices.map(choiceValue);

describe('extendStage', () => {
  it('ready only for a lock in force by its date that a second key holds', () => {
    expect(extendStage(stake({ unixTimestamp: NOW + DAY, epoch: 0n, custodian: SECOND }), CLOCK)).toBe('ready');
  });

  it('an epoch that holds the lock is left alone, whoever holds it and whatever its date', () => {
    expect(extendStage(stake({ unixTimestamp: 0n, epoch: 851n, custodian: SECOND }), CLOCK)).toBe('epoch-locked');
    expect(extendStage(stake({ unixTimestamp: NOW + DAY, epoch: 851n, custodian: SECOND }), CLOCK)).toBe('epoch-locked');
    expect(extendStage(stake({ unixTimestamp: 0n, epoch: 851n, custodian: ZERO_ADDRESS }), CLOCK)).toBe('epoch-locked');
  });

  it('no lock, an ended lock, or one held by the main key itself or by no key is not a lock to extend', () => {
    expect(extendStage(stake({ unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS }), CLOCK)).toBe('not-locked');
    expect(extendStage(stake({ unixTimestamp: NOW, epoch: 850n, custodian: SECOND }), CLOCK)).toBe('not-locked');
    expect(extendStage(stake({ unixTimestamp: NOW + DAY, epoch: 0n, custodian: MAIN }), CLOCK)).toBe('not-locked');
    expect(extendStage(stake({ unixTimestamp: NOW + DAY, epoch: 0n, custodian: ZERO_ADDRESS }), CLOCK)).toBe('not-locked');
  });
});

describe('extendOptions', () => {
  it('offers only the periods that end later than the lock, in the wizard order, then remove', () => {
    // Every period of devnet ends after a lock that ends in 5 minutes.
    expect(values(extendOptions(NOW + 300n, CLOCK, 'devnet'))).toEqual([
      '1-month',
      '3-months',
      '6-months',
      '12-months',
      '10-minutes',
      '1-hour',
      'remove',
    ]);
    // A lock ending in 100 days keeps 6 and 12 months; mainnet never offers the short test periods.
    expect(values(extendOptions(NOW + 100n * DAY, CLOCK, 'mainnet'))).toEqual(['6-months', '12-months', 'remove']);
    // A period that ends exactly with the lock is not later.
    const sixMonths = lockupEnd(NOW, '6-months', 'mainnet');
    expect(values(extendOptions(sixMonths, CLOCK, 'mainnet'))).toEqual(['12-months', 'remove']);
    // Beyond every period: only remove.
    expect(values(extendOptions(NOW + 400n * DAY, CLOCK, 'mainnet'))).toEqual(['remove']);
  });

  it('dates every period from the cluster clock, like the protect wizard', () => {
    const choices = extendOptions(NOW + 100n * DAY, CLOCK, 'mainnet');
    expect(choices[0]).toEqual({ kind: 'period', period: '6-months', until: lockupEnd(NOW, '6-months', 'mainnet') });
    expect(choiceLockUntil(choices[1] as ExtendChoice)).toBe(lockupEnd(NOW, '12-months', 'mainnet'));
    expect(choiceLockUntil({ kind: 'remove' })).toBe(0n);
  });
});

describe('defaultChoice', () => {
  it('6 months when offered, else the first period, else remove; ?remove always picks remove', () => {
    const all = extendOptions(NOW + 300n, CLOCK, 'devnet');
    expect(defaultChoice(all, false)).toMatchObject({ kind: 'period', period: '6-months' });
    expect(defaultChoice(all, true)).toEqual({ kind: 'remove' });

    const twelveOnly = extendOptions(lockupEnd(NOW, '6-months', 'mainnet'), CLOCK, 'mainnet');
    expect(defaultChoice(twelveOnly, false)).toMatchObject({ kind: 'period', period: '12-months' });

    const removeOnly = extendOptions(NOW + 400n * DAY, CLOCK, 'mainnet');
    expect(defaultChoice(removeOnly, false)).toEqual({ kind: 'remove' });
    expect(defaultChoice(removeOnly, true)).toEqual({ kind: 'remove' });
  });
});
