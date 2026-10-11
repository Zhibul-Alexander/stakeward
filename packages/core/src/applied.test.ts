import { getAddressDecoder, type Address } from '@solana/kit';
import { getNonceEncoder, NonceState, NonceVersion } from '@solana-program/system';
import { describe, expect, it } from 'vitest';
import { rawStakeAccount, stakeAccountOf } from '../test/raw-stake.ts';
import type { TransactionAction } from './actions.ts';
import { actionApplied, actionTarget } from './applied.ts';
import { NONCE_ACCOUNT_SEED, SYSTEM_PROGRAM_ADDRESS, U64_MAX } from './constants.ts';
import type { RawAccount, StakeAccount } from './decode.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const A = key(1); // main key
const K = key(2); // second key
const D = key(3); // new wallet
const VOTE = key(4);
const S = key(9); // the stake account (stakeAccountOf's default address)
const NONCE_ACCOUNT = key(20);
const T = 1_800_000_000n;

const locked = (fields: Partial<StakeAccount> = {}) =>
  stakeAccountOf({ lockup: { unixTimestamp: T, epoch: 0n, custodian: K }, ...fields });
const delegation = (deactivationEpoch: bigint, voter: Address = VOTE): StakeAccount['delegation'] => ({
  voter,
  stake: 4_000_000_000n,
  activationEpoch: 900n,
  deactivationEpoch,
});

const raw = (fields: Partial<StakeAccount> = {}): RawAccount => rawStakeAccount(stakeAccountOf(fields));
const notAStakeAccount: RawAccount = { address: S, data: new Uint8Array(), lamports: 1n, owner: SYSTEM_PROGRAM_ADDRESS };

function nonceAccount(authority: Address, lamports = 1_056_640n): RawAccount {
  const data = getNonceEncoder().encode({
    version: NonceVersion.Current,
    state: NonceState.Initialized,
    authority,
    blockhash: key(30),
    lamportsPerSignature: 5_000n,
  });
  return { address: NONCE_ACCOUNT, data, lamports, owner: SYSTEM_PROGRAM_ADDRESS };
}

describe('actionApplied', () => {
  describe('protect', () => {
    const action: TransactionAction = { kind: 'protect', stakeAccount: S, mainKey: A, secondKey: K, lockUntil: T };
    it.each([
      ['the second key holds the lock until T', rawStakeAccount(locked()), true],
      ['no lock yet', raw(), false],
      ['another lock end', rawStakeAccount(locked({ lockup: { unixTimestamp: T + 1n, epoch: 0n, custodian: K } })), false],
      ['another custodian', rawStakeAccount(locked({ lockup: { unixTimestamp: T, epoch: 0n, custodian: D } })), false],
      ['the main key no longer withdraws', rawStakeAccount(locked({ withdrawer: D })), false],
      ['the account is gone', null, false],
      ['not a stake account', notAStakeAccount, false],
    ] as const)('%s -> %s', (_name, after, expected) => {
      expect(actionApplied(action, after, stakeAccountOf())).toBe(expected);
    });
  });

  describe('extend', () => {
    const action: TransactionAction = { kind: 'extend', stakeAccount: S, secondKey: K, lockUntil: T + 100n };
    it.each([
      ['the lock ends at the new date', rawStakeAccount(locked({ lockup: { unixTimestamp: T + 100n, epoch: 0n, custodian: K } })), true],
      ['the lock still ends at the old date', rawStakeAccount(locked()), false],
      ['another custodian', rawStakeAccount(locked({ lockup: { unixTimestamp: T + 100n, epoch: 0n, custodian: D } })), false],
      ['the account is gone', null, false],
    ] as const)('%s -> %s', (_name, after, expected) => {
      expect(actionApplied(action, after, locked())).toBe(expected);
    });
  });

  describe('unlock', () => {
    const action: TransactionAction = { kind: 'unlock', stakeAccount: S, secondKey: K };
    it.each([
      ['the lock timestamp is 0', rawStakeAccount(locked({ lockup: { unixTimestamp: 0n, epoch: 0n, custodian: K } })), true],
      ['still locked', rawStakeAccount(locked()), false],
      ['the account is gone', null, false],
      ['not a stake account', notAStakeAccount, false],
    ] as const)('%s -> %s', (_name, after, expected) => {
      expect(actionApplied(action, after, locked())).toBe(expected);
    });
  });

  describe('withdraw', () => {
    const before = locked({ lamports: 5_000_000_000n });
    const action: TransactionAction = {
      kind: 'withdraw',
      stakeAccount: S,
      mainKey: A,
      secondKey: K,
      recipient: A,
      lamports: 1_000_000_000n,
    };
    it.each([
      ['the account is closed', null, before, true],
      ['the account is closed, nothing known before', null, null, true],
      ['the balance fell by the amount', rawStakeAccount(locked({ lamports: 4_000_000_000n })), before, true],
      ['the balance fell by more (rewards are not counted)', rawStakeAccount(locked({ lamports: 3_000_000_000n })), before, true],
      ['the balance fell by less', rawStakeAccount(locked({ lamports: 4_000_000_001n })), before, false],
      ['the balance did not change', rawStakeAccount(before), before, false],
      ['the balance fell, nothing known before', rawStakeAccount(locked({ lamports: 1n })), null, false],
      ['not a stake account', { ...notAStakeAccount, lamports: 1n }, before, false],
    ] as const)('%s -> %s', (_name, after, previous, expected) => {
      expect(actionApplied(action, after, previous)).toBe(expected);
    });
  });

  describe('deactivate', () => {
    const action: TransactionAction = { kind: 'deactivate', stakeAccount: S, staker: A };
    it.each([
      ['deactivating', raw({ kind: 'delegated', delegation: delegation(1_000n) }), true],
      ['still active', raw({ kind: 'delegated', delegation: delegation(U64_MAX) }), false],
      ['never delegated', raw(), false],
      ['the account is gone', null, false],
    ] as const)('%s -> %s', (_name, after, expected) => {
      expect(actionApplied(action, after, null)).toBe(expected);
    });
  });

  describe('delegate', () => {
    const action: TransactionAction = { kind: 'delegate', stakeAccount: S, staker: A, voteAccount: VOTE };
    it.each([
      ['delegated to the vote account', raw({ kind: 'delegated', delegation: delegation(U64_MAX) }), true],
      ['delegated elsewhere', raw({ kind: 'delegated', delegation: delegation(U64_MAX, key(5)) }), false],
      ['still the old, deactivated delegation', raw({ kind: 'delegated', delegation: delegation(1_000n) }), false],
      ['not delegated', raw(), false],
      ['the account is gone', null, false],
    ] as const)('%s -> %s', (_name, after, expected) => {
      expect(actionApplied(action, after, null)).toBe(expected);
    });
  });

  describe('change-second-key', () => {
    const action: TransactionAction = { kind: 'change-second-key', stakeAccount: S, secondKey: K, newWallet: D };
    const after = (lockup: StakeAccount['lockup']) => rawStakeAccount(locked({ lockup }));
    it.each([
      ['the new key holds the lock, same end', after({ unixTimestamp: T, epoch: 0n, custodian: D }), locked(), true],
      ['the new key holds the lock, nothing known before', after({ unixTimestamp: T, epoch: 0n, custodian: D }), null, true],
      ['the old key still holds it', rawStakeAccount(locked()), locked(), false],
      ['the end moved', after({ unixTimestamp: T + 1n, epoch: 0n, custodian: D }), locked(), false],
      ['the epoch moved', after({ unixTimestamp: T, epoch: 3n, custodian: D }), locked(), false],
      ['the account is gone', null, locked(), false],
    ] as const)('%s -> %s', (_name, read, previous, expected) => {
      expect(actionApplied(action, read, previous)).toBe(expected);
    });
  });

  describe('rescue', () => {
    const action: TransactionAction = { kind: 'rescue', stakeAccount: S, mainKey: A, secondKey: K, newWallet: D };
    const before = locked({ staker: key(6) }); // the thief moved the staker
    it.each([
      ['both authorities moved, lock unchanged', rawStakeAccount(locked({ staker: D, withdrawer: D })), before, true],
      ['both authorities moved, nothing known before', rawStakeAccount(locked({ staker: D, withdrawer: D })), null, true],
      [
        'both authorities moved, but the lock end changed',
        rawStakeAccount(locked({ staker: D, withdrawer: D, lockup: { unixTimestamp: 0n, epoch: 0n, custodian: K } })),
        before,
        false,
      ],
      [
        'both authorities moved, but the lock epoch changed',
        rawStakeAccount(locked({ staker: D, withdrawer: D, lockup: { unixTimestamp: T, epoch: 5n, custodian: K } })),
        before,
        false,
      ],
      [
        'both authorities moved, but the custodian changed',
        rawStakeAccount(locked({ staker: D, withdrawer: D, lockup: { unixTimestamp: T, epoch: 0n, custodian: D } })),
        before,
        false,
      ],
      ['only the staker moved', rawStakeAccount(locked({ staker: D })), before, false],
      ['only the withdrawer moved', rawStakeAccount(locked({ staker: key(6), withdrawer: D })), before, false],
      ['the account is gone', null, before, false],
    ] as const)('%s -> %s', (_name, after, previous, expected) => {
      expect(actionApplied(action, after, previous)).toBe(expected);
    });
  });

  describe('nonce setup and close', () => {
    const setup: TransactionAction = {
      kind: 'nonce-setup',
      nonceAccount: NONCE_ACCOUNT,
      nonceAuthority: D,
      seed: NONCE_ACCOUNT_SEED,
      lamports: 1_056_640n,
    };
    const close: TransactionAction = {
      kind: 'nonce-close',
      nonceAccount: NONCE_ACCOUNT,
      nonceAuthority: D,
      recipient: D,
      lamports: 1_056_640n,
    };

    it.each([
      ['a ready nonce account of the authority', nonceAccount(D), true],
      ['a nonce account of another authority', nonceAccount(A), false],
      ['a plain wallet', { ...notAStakeAccount, address: NONCE_ACCOUNT }, false],
      ['the account is missing', null, false],
    ] as const)('setup: %s -> %s', (_name, after, expected) => {
      expect(actionApplied(setup, after, null)).toBe(expected);
    });

    it.each([
      ['the account is closed', null, true],
      ['an empty account', nonceAccount(D, 0n), true],
      ['the nonce account still holds its deposit', nonceAccount(D), false],
    ] as const)('close: %s -> %s', (_name, after, expected) => {
      expect(actionApplied(close, after, null)).toBe(expected);
    });
  });
});

describe('actionApplied with a read of another account', () => {
  const other = key(10);
  const protect: TransactionAction = { kind: 'protect', stakeAccount: S, mainKey: A, secondKey: K, lockUntil: T };
  const withdraw: TransactionAction = { kind: 'withdraw', stakeAccount: S, mainKey: A, secondKey: K, recipient: A, lamports: 1n };

  it('is never proof: the after read must be the target', () => {
    expect(actionApplied(protect, rawStakeAccount(locked({ address: other })), null)).toBe(false);
    expect(actionApplied(protect, rawStakeAccount(locked()), null)).toBe(true);
  });

  it('is never proof: the before read must be the target', () => {
    expect(actionApplied(protect, rawStakeAccount(locked()), stakeAccountOf({ address: other }))).toBe(false);
    expect(actionApplied(withdraw, null, stakeAccountOf({ address: other }))).toBe(false);
  });
});

describe('actionTarget', () => {
  it('is the stake account, or the nonce account for the nonce kinds', () => {
    expect(actionTarget({ kind: 'unlock', stakeAccount: S, secondKey: K })).toBe(S);
    expect(actionTarget({ kind: 'rescue', stakeAccount: S, mainKey: A, secondKey: K, newWallet: D })).toBe(S);
    expect(
      actionTarget({ kind: 'nonce-setup', nonceAccount: NONCE_ACCOUNT, nonceAuthority: D, seed: NONCE_ACCOUNT_SEED, lamports: 1n }),
    ).toBe(NONCE_ACCOUNT);
    expect(
      actionTarget({ kind: 'nonce-close', nonceAccount: NONCE_ACCOUNT, nonceAuthority: D, recipient: D, lamports: 1n }),
    ).toBe(NONCE_ACCOUNT);
  });
});
