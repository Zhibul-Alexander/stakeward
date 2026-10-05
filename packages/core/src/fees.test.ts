import { blockhash, type Nonce } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { build, key } from '../test/craft.ts';
import { expectedFeePayer, type BlockhashLifetime, type Lifetime, type TransactionAction, type TransactionKind } from './actions.ts';
import { deriveNonceAccountAddress } from './builders.ts';
import { NONCE_ACCOUNT_SEED } from './constants.ts';
import { canPayFee, networkFeeFor } from './fees.ts';
import { inspectTransaction } from './inspect.ts';

const SETUP_NONCE = await deriveNonceAccountAddress(key(3));

describe('canPayFee: a fee payer ends at exactly 0 or at least rent-exempt (D44)', () => {
  const rent = 890_880n;
  const fee = 10_600n;

  it.each([
    ['plenty left', 1_000_000_000n, true],
    ['exactly the rent minimum left', fee + rent, true],
    ['exactly 0 left', fee, true],
    ['1 lamport below the rent minimum left', fee + rent - 1n, false],
    ['1 lamport left', fee + 1n, false],
    ['not enough for the fee', fee - 1n, false],
    ['an empty wallet', 0n, false],
  ] as const)('%s -> %s', (_name, balance, expected) => {
    expect(canPayFee(balance, fee, rent)).toBe(expected);
  });

  it('refuses a negative balance after the fee even when the rent minimum is 0', () => {
    expect(canPayFee(5_000n, 10_000n, 0n)).toBe(false);
    expect(canPayFee(10_000n, 10_000n, 0n)).toBe(true);
  });
});

describe('networkFeeFor: the fee a plan expects before anything is built', () => {
  const A = key(1);
  const K = key(2);
  const D = key(3);
  const S = key(4);
  const BLOCKHASH: BlockhashLifetime = { kind: 'blockhash', blockhash: blockhash(key(20)), lastValidBlockHeight: 100n };
  const ACTIONS: { [Kind in TransactionKind]: Extract<TransactionAction, { kind: Kind }> } = {
    protect: { kind: 'protect', stakeAccount: S, mainKey: A, secondKey: K, lockUntil: 1_825_545_600n },
    extend: { kind: 'extend', stakeAccount: S, secondKey: K, lockUntil: 1_825_545_600n },
    unlock: { kind: 'unlock', stakeAccount: S, secondKey: K },
    withdraw: { kind: 'withdraw', stakeAccount: S, mainKey: A, secondKey: K, recipient: A, lamports: 5_000_000_000n },
    deactivate: { kind: 'deactivate', stakeAccount: S, staker: A },
    delegate: { kind: 'delegate', stakeAccount: S, staker: A, voteAccount: key(5) },
    rescue: { kind: 'rescue', stakeAccount: S, mainKey: A, secondKey: K, newWallet: D },
    'nonce-setup': { kind: 'nonce-setup', nonceAccount: SETUP_NONCE, nonceAuthority: D, seed: NONCE_ACCOUNT_SEED, lamports: 1_056_640n },
    'nonce-close': { kind: 'nonce-close', nonceAccount: SETUP_NONCE, nonceAuthority: D, recipient: D, lamports: 1_056_640n },
  };

  it('is 5000 per signature plus the fixed 600 lamports of priority fee', () => {
    expect([1, 2, 3].map(networkFeeFor)).toEqual([5_600n, 10_600n, 15_600n]);
  });

  // On a nonce the fee payer owns it (the rule of every Stakeward link); the AdvanceNonce adds no signer.
  it.each(Object.values(ACTIONS))('equals the inspector fee of a built $kind for its signer count', async (action) => {
    const nonce: Lifetime = {
      kind: 'nonce',
      nonceAccount: key(6),
      nonceAuthority: expectedFeePayer(action),
      nonceValue: key(21) as string as Nonce,
    };
    const lifetimes = action.kind === 'nonce-setup' || action.kind === 'nonce-close' ? [BLOCKHASH] : [BLOCKHASH, nonce];
    for (const lifetime of lifetimes) {
      const inspected = await inspectTransaction(build(action, lifetime).bytes);
      if (!inspected.ok) throw new Error(`${action.kind}: ${inspected.error.code}`);
      const { requiredSigners, networkFeeLamports } = inspected.summary;
      expect(networkFeeFor(requiredSigners.length), `${action.kind} on ${lifetime.kind}`).toBe(networkFeeLamports);
    }
  });
});
