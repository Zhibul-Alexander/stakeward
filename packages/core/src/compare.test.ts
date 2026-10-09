import { blockhash, getAddressDecoder, type Address, type Nonce } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import type { Lifetime, ProtectAction, TransactionAction } from './actions.ts';
import { buildTransaction } from './builders.ts';
import { actionsEqual, summariesMatchExceptStakeAccount } from './compare.ts';
import { LIGHTHOUSE_PROGRAM_ADDRESS } from './constants.ts';
import { inspectTransaction, type LighthouseTail, type TransactionSummary } from './inspect.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const A = key(1);
const K = key(2);
const S1 = key(11);
const S2 = key(12);
const T = 1_800_000_000n;
const BLOCKHASH = blockhash('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N');
const OTHER_BLOCKHASH = blockhash('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
const LIFETIME: Lifetime = { kind: 'blockhash', blockhash: BLOCKHASH, lastValidBlockHeight: 100n };
const NONCE = { kind: 'nonce', nonceAccount: key(20), nonceAuthority: A, nonceValue: BLOCKHASH as string as Nonce } as const;

async function summaryOf(action: TransactionAction, feePayer: Address = A, lifetime: Lifetime = LIFETIME) {
  const inspected = await inspectTransaction(buildTransaction(action, { feePayer, lifetime }).bytes);
  if (!inspected.ok) throw new Error(inspected.error.message);
  return inspected.summary;
}

const protect = (stakeAccount: Address, lockUntil = T): ProtectAction => ({
  kind: 'protect',
  stakeAccount,
  mainKey: A,
  secondKey: K,
  lockUntil,
});

describe('actionsEqual', () => {
  it('compares bigint fields by value', () => {
    expect(actionsEqual(protect(S1), { ...protect(S1), lockUntil: BigInt('1800000000') })).toBe(true);
    expect(actionsEqual(protect(S1), protect(S1, T + 1n))).toBe(false);
  });

  it('compares every address field', () => {
    expect(actionsEqual(protect(S1), protect(S2))).toBe(false);
    expect(actionsEqual(protect(S1), { ...protect(S1), secondKey: key(3) })).toBe(false);
  });

  it('compares null fields strictly and tells kinds apart', () => {
    const withdraw = { kind: 'withdraw', stakeAccount: S1, mainKey: A, secondKey: null, recipient: A, lamports: 5n } as const;
    expect(actionsEqual(withdraw, { ...withdraw })).toBe(true);
    expect(actionsEqual(withdraw, { ...withdraw, secondKey: K })).toBe(false);
    const unlock = { kind: 'unlock', stakeAccount: S1, secondKey: K } as const;
    expect(actionsEqual(unlock, { ...unlock, kind: 'extend', lockUntil: 0n })).toBe(false);
  });
});

describe('summariesMatchExceptStakeAccount', () => {
  it('holds for protects of different stake accounts with the same lock, keys, fee and blockhash', async () => {
    const summaries = await Promise.all([summaryOf(protect(S1)), summaryOf(protect(S2)), summaryOf(protect(key(13)))]);
    expect(summariesMatchExceptStakeAccount(summaries)).toBe(true);
  });

  it('needs at least two summaries', async () => {
    expect(summariesMatchExceptStakeAccount([])).toBe(false);
    expect(summariesMatchExceptStakeAccount([await summaryOf(protect(S1))])).toBe(false);
  });

  it('fails on a different lock end, second key, kind or fee payer', async () => {
    const first = await summaryOf(protect(S1));
    const others: TransactionSummary[] = await Promise.all([
      summaryOf(protect(S2, T + 86_400n)),
      summaryOf({ ...protect(S2), secondKey: key(3) }),
      summaryOf({ kind: 'extend', stakeAccount: S2, secondKey: K, lockUntil: T }, A),
      summaryOf({ kind: 'unlock', stakeAccount: S2, secondKey: K }, K),
    ]);
    for (const other of others) expect(summariesMatchExceptStakeAccount([first, other])).toBe(false);
  });

  it('fails on different signers or signatures present, fee, compute budget or lifetime', async () => {
    const [first, second] = await Promise.all([summaryOf(protect(S1)), summaryOf(protect(S2))]);
    const variants: TransactionSummary[] = [
      { ...second, requiredSigners: [K, A] },
      { ...second, presentSignatures: [A] },
      { ...second, networkFeeLamports: second.networkFeeLamports + 5_000n },
      { ...second, computeBudget: { ...second.computeBudget, microLamportsPerUnit: 1n } },
      { ...second, computeBudget: { ...second.computeBudget, unitLimit: 1 } },
      { ...second, feePayer: K },
      await summaryOf(protect(S2), A, { ...LIFETIME, blockhash: OTHER_BLOCKHASH }),
      { ...second, lifetime: NONCE },
    ];
    expect(summariesMatchExceptStakeAccount([first, second])).toBe(true);
    for (const variant of variants) expect(summariesMatchExceptStakeAccount([first, variant])).toBe(false);
  });

  it('compares every field of a nonce lifetime', async () => {
    const [first, second] = await Promise.all([summaryOf(protect(S1), A, NONCE), summaryOf(protect(S2), A, NONCE)]);
    expect(summariesMatchExceptStakeAccount([first, second])).toBe(true);
    for (const lifetime of [
      { ...NONCE, nonceAccount: key(21) },
      { ...NONCE, nonceAuthority: K },
      { ...NONCE, nonceValue: OTHER_BLOCKHASH as string as Nonce },
    ]) {
      expect(summariesMatchExceptStakeAccount([first, { ...second, lifetime }])).toBe(false);
    }
  });

  it('compares Lighthouse tails: both absent, or the same instructions and accounts', async () => {
    const [first, second] = await Promise.all([summaryOf(protect(S1)), summaryOf(protect(S2))]);
    const tail = { instructionCount: 1, addedAccounts: [LIGHTHOUSE_PROGRAM_ADDRESS] };
    const withTail = (summary: TransactionSummary, lighthouseTail: LighthouseTail | null) => ({ ...summary, lighthouseTail });
    expect(summariesMatchExceptStakeAccount([withTail(first, tail), withTail(second, { ...tail })])).toBe(true);
    for (const other of [
      null,
      { ...tail, instructionCount: 2 },
      { ...tail, addedAccounts: [LIGHTHOUSE_PROGRAM_ADDRESS, key(30)] },
      { ...tail, addedAccounts: [key(30)] },
    ]) {
      expect(summariesMatchExceptStakeAccount([withTail(first, tail), withTail(second, other)])).toBe(false);
    }
  });

  it('is false for actions without a stake account (nonce kinds)', async () => {
    const close = () =>
      summaryOf({ kind: 'nonce-close', nonceAccount: key(40), nonceAuthority: A, recipient: A, lamports: 1_000_000n });
    expect(summariesMatchExceptStakeAccount(await Promise.all([close(), close()]))).toBe(false);
  });
});
