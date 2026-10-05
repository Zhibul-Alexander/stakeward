import type { Address } from '@solana/kit';
import { U64_MAX, ZERO_ADDRESS, type Delegation, type StakeAccount } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { withdrawStage } from './stage.ts';

const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8' as Address;
const SECOND = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi' as Address;
const SERVICE = '2Xtq6iZ2mXjxTNsv5FrYCzayG5qYRJwZ6837A1X3TjF6' as Address;
const STAKE = 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW' as Address;
const VOTE = '7xKTg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgA9fQ' as Address;
const CLOCK = { unixTimestamp: 1_790_812_800n, epoch: 850n };
const NO_LOCK = { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS };

function delegation(activationEpoch: bigint, deactivationEpoch: bigint): Delegation {
  return { voter: VOTE, stake: 2_000_000_000n, activationEpoch, deactivationEpoch };
}

function stake(overrides: Partial<StakeAccount> = {}): StakeAccount {
  return {
    address: STAKE,
    lamports: 2_001_666_240n,
    kind: 'initialized',
    rentExemptReserve: 1_666_240n,
    staker: MAIN,
    withdrawer: MAIN,
    lockup: NO_LOCK,
    delegation: null,
    ...overrides,
  };
}

describe('withdrawStage', () => {
  it('a staking account is deactivated first, by the main key when it manages staking', () => {
    const active = stake({ kind: 'delegated', delegation: delegation(800n, U64_MAX) });
    const activating = stake({ kind: 'delegated', delegation: delegation(850n, U64_MAX) });
    expect(withdrawStage(active, CLOCK)).toBe('deactivate');
    expect(withdrawStage(activating, CLOCK)).toBe('deactivate');
    expect(withdrawStage({ ...active, staker: SERVICE }, CLOCK)).toBe('service-staker');
    expect(withdrawStage({ ...activating, staker: SERVICE }, CLOCK)).toBe('service-staker');
  });

  it('a stake that stops at the end of this epoch waits, whoever manages staking', () => {
    const deactivating = stake({ kind: 'delegated', delegation: delegation(800n, 850n) });
    expect(withdrawStage(deactivating, CLOCK)).toBe('deactivating');
    expect(withdrawStage({ ...deactivating, staker: SERVICE }, CLOCK)).toBe('deactivating');
  });

  it('an inactive account withdraws: never delegated, deactivated in an earlier epoch, no lock or one a second key holds', () => {
    const lockedBySecond = { unixTimestamp: CLOCK.unixTimestamp + 86_400n, epoch: 0n, custodian: SECOND };
    expect(withdrawStage(stake(), CLOCK)).toBe('withdraw');
    expect(withdrawStage(stake({ kind: 'delegated', delegation: delegation(800n, 849n) }), CLOCK)).toBe('withdraw');
    expect(withdrawStage(stake({ lockup: lockedBySecond }), CLOCK)).toBe('withdraw');
    expect(withdrawStage(stake({ lockup: { ...NO_LOCK, epoch: 900n, custodian: SECOND } }), CLOCK)).toBe('withdraw');
    // A lock that ended, whoever held it.
    expect(withdrawStage(stake({ lockup: { ...lockedBySecond, unixTimestamp: CLOCK.unixTimestamp, custodian: MAIN } }), CLOCK)).toBe(
      'withdraw',
    );
  });

  it('an inactive account locked by the main key itself or by no key is not supported', () => {
    const until = CLOCK.unixTimestamp + 86_400n;
    expect(withdrawStage(stake({ lockup: { unixTimestamp: until, epoch: 0n, custodian: MAIN } }), CLOCK)).toBe('unsupported-lock');
    expect(withdrawStage(stake({ lockup: { unixTimestamp: until, epoch: 0n, custodian: ZERO_ADDRESS } }), CLOCK)).toBe(
      'unsupported-lock',
    );
    expect(withdrawStage(stake({ lockup: { unixTimestamp: 0n, epoch: 851n, custodian: ZERO_ADDRESS } }), CLOCK)).toBe(
      'unsupported-lock',
    );
  });
});
