import { generateKeyPairSigner, type Address, type Nonce } from '@solana/kit';
import {
  deriveNonceAccountAddress,
  inspectTransaction,
  buildTransaction,
  SYSTEM_PROGRAM_ADDRESS,
  type ChainClock,
  type ChainPort,
  type RawAccount,
  type TransactionSummary,
  type WalletPort,
} from '@stakeward/core';
import { key } from '@stakeward/core/test/craft';
import { describe, expect, it } from 'vitest';
import { cosignPlan, cosignRefusalText, cosignResolver } from '@/pages/cosign/plan';
import type { SignerResolver } from '@/signing/types';

// The /cosign plan's rules that need no nonce account (step 7 spec 8.2); the chain cases (done, link-used, stale) run
// on LiteSVM in cosign.test.tsx C3.

const CLOCK: ChainClock = { unixTimestamp: 1_800_000_000n, epoch: 900n, slot: 1n };
const NONCE_VALUE = 'BZFufDqppShyDDC1njm4fMpRbfnLwrpzzwG6WGgcmsxb' as Nonce;
const S = key(11);

/** A chain that answers getAccounts with `accounts` (in order) and the clock; anything else fails the test. */
function stubChain(accounts: readonly (RawAccount | null)[], reads: Address[][]): ChainPort {
  const fail = () => Promise.reject(new Error('not expected'));
  return {
    getAccounts: (addresses) => {
      reads.push([...addresses]);
      return Promise.resolve({ slot: 1n, accounts });
    },
    getClock: () => Promise.resolve(CLOCK),
    getLatestBlockhash: fail,
    getBlockHeight: fail,
    getEpochInfo: fail,
    getBalance: fail,
    getMinimumBalanceForRentExemption: fail,
    simulate: fail,
    send: fail,
    getSignatureStatuses: fail,
    findStakeAccounts: fail,
  };
}

async function linkSummary(): Promise<{ bytes: Uint8Array; summary: TransactionSummary; A: Address; K: Address; nonce: Address }> {
  const [A, K] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
  const nonce = await deriveNonceAccountAddress(A.address);
  const { bytes } = buildTransaction(
    { kind: 'protect', stakeAccount: S, mainKey: A.address, secondKey: K.address, lockUntil: 1_900_000_000n },
    { feePayer: A.address, lifetime: { kind: 'nonce', nonceAccount: nonce, nonceAuthority: A.address, nonceValue: NONCE_VALUE } },
  );
  const inspected = await inspectTransaction(bytes);
  if (!inspected.ok) throw new Error(inspected.error.message);
  return { bytes, summary: inspected.summary, A: A.address, K: K.address, nonce };
}

describe('cosignPlan', () => {
  it('reads the stake account and the link\'s nonce account in one call; no account -> not-found', async () => {
    const { bytes, summary, nonce } = await linkSummary();
    const reads: Address[][] = [];
    const { clock, jobs } = await cosignPlan(bytes, summary).prepare(stubChain([null, null], reads), [S]);
    expect(reads).toEqual([[S, nonce]]);
    expect(clock).toEqual(CLOCK);
    expect(jobs[S]).toEqual({ kind: 'refused', reason: 'not-found', before: null });
  });

  it('an account that is not a stake account -> not-stake-account', async () => {
    const { bytes, summary } = await linkSummary();
    const raw: RawAccount = { address: S, data: new Uint8Array(200), lamports: 1n, owner: SYSTEM_PROGRAM_ADDRESS };
    const { jobs } = await cosignPlan(bytes, summary).prepare(stubChain([raw, null], []), [S]);
    expect(jobs[S]).toEqual({ kind: 'refused', reason: 'not-stake-account', before: null });
  });
});

describe('cosignResolver', () => {
  it('names a key by the link\'s action, whatever slot of this browser holds it; the wallet comes from the slots', async () => {
    const { summary, A, K } = await linkSummary();
    const wallet = { name: 'Second Wallet' } as WalletPort;
    const base: SignerResolver = (address) => (address === K ? { kind: 'ready', role: 'main', wallet } : { kind: 'missing', role: 'main' });
    const resolve = cosignResolver(base, summary.action);
    expect(resolve(K, null)).toEqual({ kind: 'ready', role: 'second', wallet });
    expect(resolve(A, null)).toEqual({ kind: 'missing', role: 'main' });
    expect(resolve(key(3), 'new')).toEqual({ kind: 'missing', role: 'main' });
  });
});

describe('cosignRefusalText', () => {
  it('has words for every refusal and the unknown error otherwise', () => {
    expect(cosignRefusalText('link-used')).toBe('This link was already used or cancelled.');
    expect(cosignRefusalText('stale')).toBe('The stake account has changed since this link was made.');
    expect(cosignRefusalText('something-else')).toBe(cosignRefusalText('another'));
  });
});
