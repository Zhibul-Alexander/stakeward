import { getAddressDecoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { actionRoles } from './actions.ts';
import { NONCE_ACCOUNT_SEED } from './constants.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const A = key(1);
const K = key(2);
const D = key(3);
const S = key(9);

describe('actionRoles', () => {
  it('names the main key, the second key and the new wallet the action holds', () => {
    expect(actionRoles({ kind: 'protect', stakeAccount: S, mainKey: A, secondKey: K, lockUntil: 1n })).toEqual({ main: A, second: K });
    expect(actionRoles({ kind: 'rescue', stakeAccount: S, mainKey: A, secondKey: K, newWallet: D })).toEqual({
      main: A,
      second: K,
      new: D,
    });
    expect(actionRoles({ kind: 'extend', stakeAccount: S, secondKey: K, lockUntil: 1n })).toEqual({ second: K });
  });

  it('leaves out a withdraw without a second key, and keys without a role', () => {
    expect(actionRoles({ kind: 'withdraw', stakeAccount: S, mainKey: A, secondKey: null, recipient: D, lamports: 1n })).toEqual({
      main: A,
    });
    expect(actionRoles({ kind: 'deactivate', stakeAccount: S, staker: A })).toEqual({});
    expect(
      actionRoles({ kind: 'nonce-setup', nonceAccount: key(20), nonceAuthority: D, seed: NONCE_ACCOUNT_SEED, lamports: 1n }),
    ).toEqual({});
  });
});
