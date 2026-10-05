import { getAddressDecoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { U64_MAX, ZERO_ADDRESS } from './constants.ts';
import type { Delegation, StakeAccount } from './decode.ts';
import { groupForViewer, protectBlock, scannerStatus, stakeActivationStatus } from './status.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const DAY = 86_400n;

describe('stakeActivationStatus (epochs only)', () => {
  const delegation = (activationEpoch: bigint, deactivationEpoch: bigint): Delegation => ({
    voter: key(7),
    stake: 1_000_000_000n,
    activationEpoch,
    deactivationEpoch,
  });

  it.each([
    ['no delegation', null, 'inactive'],
    ['activated and deactivated in the same epoch', delegation(100n, 100n), 'inactive'],
    ['activated this epoch', delegation(100n, U64_MAX), 'activating'],
    ['activation epoch in the future', delegation(101n, U64_MAX), 'activating'],
    ['activated in an earlier epoch', delegation(99n, U64_MAX), 'active'],
    ['deactivated this epoch', delegation(90n, 100n), 'deactivating'],
    ['deactivation epoch in the future', delegation(90n, 101n), 'deactivating'],
    ['deactivated in an earlier epoch', delegation(90n, 99n), 'inactive'],
  ] as const)('%s at epoch 100 -> %s', (_name, value, expected) => {
    expect(stakeActivationStatus(value, 100n)).toBe(expected);
  });
});

describe('scannerStatus', () => {
  const now = 1_800_000_000n;
  const clock = { unixTimestamp: now, epoch: 1_000n };
  const A = key(1);
  const K = key(2);
  const other = key(3);
  const account = (lockup: Partial<StakeAccount['lockup']>, staker: Address = A): StakeAccount => ({
    address: key(9),
    lamports: 5_000_000_000n,
    kind: 'initialized',
    rentExemptReserve: 2_282_880n,
    staker,
    withdrawer: A,
    lockup: { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS, ...lockup },
    delegation: null,
  });

  it.each([
    ['no lockup', account({}), 'unprotected'],
    ['lockup ended', account({ unixTimestamp: now, custodian: K }), 'unprotected'],
    ['custodian is the main key itself', account({ unixTimestamp: now + 100n * DAY, custodian: A }), 'unprotected'],
    ['locked by the second key, 100 days left', account({ unixTimestamp: now + 100n * DAY, custodian: K }), 'protected'],
    ['locked by the second key, exactly 30 days left', account({ unixTimestamp: now + 30n * DAY, custodian: K }), 'protected'],
    ['locked by the second key, under 30 days left', account({ unixTimestamp: now + 30n * DAY - 1n, custodian: K }), 'expiring'],
    ['locked by the second key, one second left', account({ unixTimestamp: now + 1n, custodian: K }), 'expiring'],
    ['locked by epoch only, second key', account({ epoch: 1_001n, custodian: K }), 'protected'],
    ['locked by a custodian the viewer does not know', account({ unixTimestamp: now + 100n * DAY, custodian: other }), 'locked-by-other'],
    ['lock ended, custodian unknown', account({ unixTimestamp: now - 1n, custodian: other }), 'unprotected'],
  ] as const)('%s -> %s', (_name, value, expected) => {
    expect(scannerStatus(value, [K], clock).status).toBe(expected);
  });

  describe('with no known second key (a fresh device, a view by address; D14, CLAUDE.md sections 5 and 11)', () => {
    it.each([
      ['a lock held by another key, 100 days left', account({ unixTimestamp: now + 100n * DAY, custodian: other })],
      ['a lock held by another key, under 30 days left', account({ unixTimestamp: now + DAY, custodian: other })],
      ['a lock held by the epoch only', account({ epoch: 1_001n, custodian: other })],
    ] as const)('%s -> locked-by-other, never protected', (_name, value) => {
      expect(scannerStatus(value, [], clock)).toEqual({ status: 'locked-by-other', managedByService: false });
    });

    it.each([
      ['no lockup', account({})],
      ['lockup ended', account({ unixTimestamp: now, custodian: other })],
      ['custodian is the main key itself', account({ unixTimestamp: now + 100n * DAY, custodian: A })],
    ] as const)('%s -> unprotected', (_name, value) => {
      expect(scannerStatus(value, [], clock)).toEqual({ status: 'unprotected', managedByService: false });
    });
  });

  it('flags accounts whose staker is not the withdrawer as managed by a service', () => {
    expect(scannerStatus(account({}), [K], clock).managedByService).toBe(false);
    expect(scannerStatus(account({}, other), [K], clock).managedByService).toBe(true);
  });
});

describe('protectBlock', () => {
  const now = 1_800_000_000n;
  const clock = { unixTimestamp: now, epoch: 1_000n };
  const A = key(1);
  const K = key(2);
  const other = key(3);
  const account = (lockup: Partial<StakeAccount['lockup']>, withdrawer: Address = A): StakeAccount => ({
    address: key(9),
    lamports: 5_000_000_000n,
    kind: 'initialized',
    rentExemptReserve: 2_282_880n,
    staker: A,
    withdrawer,
    lockup: { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS, ...lockup },
    delegation: null,
  });

  it.each([
    ['no lockup', account({}), null],
    ['lockup ended at exactly now', account({ unixTimestamp: now, custodian: K }), null],
    ['lockup ended, held by another key', account({ unixTimestamp: now - 1n, custodian: other }), null],
    ['a lock held by the main key itself (D14)', account({ unixTimestamp: now + 100n * DAY, custodian: A }), null],
    ['an epoch lock held by the main key itself', account({ epoch: 1_001n, custodian: A }), null],
    ['withdrawer is another key', account({}, other), 'not-main-key'],
    ['withdrawer is another key, locked by the second key', account({ unixTimestamp: now + DAY, custodian: K }, other), 'not-main-key'],
    ['locked by the second key', account({ unixTimestamp: now + 100n * DAY, custodian: K }), 'already-protected'],
    ['locked by the second key, one second left', account({ unixTimestamp: now + 1n, custodian: K }), 'already-protected'],
    ['an epoch lock held by the second key', account({ epoch: 1_001n, custodian: K }), 'already-protected'],
    ['locked by another key', account({ unixTimestamp: now + 100n * DAY, custodian: other }), 'locked-by-other'],
    ['an epoch lock held by another key', account({ epoch: 1_001n, custodian: other }), 'locked-by-other'],
    ['an epoch lock with the zero key as custodian', account({ epoch: 1_001n }), 'locked-by-other'],
  ] as const)('%s -> %s', (_name, value, expected) => {
    expect(protectBlock(value, A, [K], clock)).toBe(expected);
  });

  it('calls every lock held by another key locked-by-other when no second key is known', () => {
    expect(protectBlock(account({ unixTimestamp: now + DAY, custodian: K }), A, [], clock)).toBe('locked-by-other');
    expect(protectBlock(account({ unixTimestamp: now + DAY, custodian: other }), A, [K, other], clock)).toBe(
      'already-protected',
    );
  });
});

describe('groupForViewer', () => {
  const viewer = key(1);
  const make = (n: number, withdrawer: Address, custodian: Address, staker: Address = withdrawer): StakeAccount => ({
    address: key(n),
    lamports: 1n,
    kind: 'initialized',
    rentExemptReserve: 0n,
    staker,
    withdrawer,
    lockup: { unixTimestamp: 0n, epoch: 0n, custodian },
    delegation: null,
  });

  it('puts withdrawer accounts in the main list and custodian-only accounts in the second-key list', () => {
    const owned = make(10, viewer, key(2));
    const ownedSelfCustody = make(11, viewer, viewer);
    const secondKeyFor = make(12, key(3), viewer);
    const stakerOnly = make(13, key(4), key(5), viewer);
    expect(groupForViewer([owned, ownedSelfCustody, secondKeyFor, stakerOnly], viewer)).toEqual({
      owned: [owned, ownedSelfCustody],
      secondKeyFor: [secondKeyFor],
    });
  });
});
