import { getAddressDecoder, type Address } from '@solana/kit';
import type { StakeAccount } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { changeKeyStage, newKeyProblems } from '@/pages/change-key/plan';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const A = key(1);
const K = key(2);
const K2 = key(3);
const STAKER = key(5);
const clock = { unixTimestamp: 1_700_000_000n, epoch: 500n };
const lockedBy = (custodian: Address, unixTimestamp = clock.unixTimestamp + 1_000n): StakeAccount => ({
  address: key(9),
  lamports: 5_000_000_000n,
  kind: 'initialized',
  rentExemptReserve: 1_666_240n,
  staker: STAKER,
  withdrawer: A,
  lockup: { unixTimestamp, epoch: 0n, custodian },
  delegation: null,
});

describe('changeKeyStage (F7)', () => {
  it('is ready only while a second key holds a lock in force', () => {
    expect(changeKeyStage(lockedBy(K), clock)).toBe('ready');
    expect(changeKeyStage(lockedBy(K, clock.unixTimestamp - 1n), clock)).toBe('not-locked');
    expect(changeKeyStage(lockedBy(A), clock)).toBe('not-locked');
  });
});

describe('newKeyProblems', () => {
  it('refuses every key of the account and the account itself', () => {
    const account = lockedBy(K);
    expect(newKeyProblems(K2, account)).toEqual([]);
    expect(newKeyProblems(K, account)).toEqual(['is-second']);
    expect(newKeyProblems(A, account)).toEqual(['is-main']);
    expect(newKeyProblems(STAKER, account)).toEqual(['is-staker']);
    expect(newKeyProblems(account.address, account)).toEqual(['is-stake-account']);
  });
});
