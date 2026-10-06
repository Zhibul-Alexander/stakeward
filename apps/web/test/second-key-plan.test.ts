import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { networkFeeFor, ZERO_ADDRESS, type Lockup } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { LAMPORTS_PER_SOL, START_EPOCH, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import { secondKeyPlan, secondKeyRefusalText } from '@/pages/second-key/plan';

// The /second-key plan on the real stake program: every refusal rule, the done rule, what it builds and who pays.

const DAY = 86_400n;
const T = START_UNIX_TIMESTAMP + 100n * DAY;

type World = { testChain: TestChain; chain: LiteSvmChain; A: KeyPairSigner; K: KeyPairSigner; K2: KeyPairSigner };

async function world(): Promise<World> {
  const testChain = await TestChain.create();
  const [A, K, K2] = await Promise.all([testChain.fundedKey(), testChain.fundedKey(), generateKeyPairSigner()]);
  return { testChain, chain: new LiteSvmChain(testChain), A, K, K2 };
}

function stakeWith(w: World, lockup: Lockup, staker: Address = w.A.address): Promise<Address> {
  return w.testChain.createStakeAccount({ staker, withdrawer: w.A.address, lockup });
}

async function decide(w: World, id: Address, keys: { secondKey?: Address; newSecondKey?: Address } = {}) {
  const plan = secondKeyPlan({ secondKey: keys.secondKey ?? w.K.address, newSecondKey: keys.newSecondKey ?? w.K2.address });
  const { jobs, clock } = await plan.prepare(w.chain, [id]);
  expect(clock.unixTimestamp).toBe(w.testChain.clock().unixTimestamp);
  return jobs[id];
}

describe('secondKeyPlan', () => {
  it('refuses a missing account, a wallet and a lock an epoch holds', async () => {
    const w = await world();
    const missing = (await generateKeyPairSigner()).address;
    const byEpoch = await stakeWith(w, { unixTimestamp: T, epoch: START_EPOCH + 5n, custodian: w.K.address });

    expect(await decide(w, missing)).toEqual({ kind: 'refused', reason: 'not-found', before: null });
    expect(await decide(w, w.A.address)).toEqual({ kind: 'refused', reason: 'not-stake-account', before: null });
    expect(await decide(w, byEpoch)).toMatchObject({ kind: 'refused', reason: 'epoch-locked', before: { address: byEpoch } });
  });

  it('is done when the new second key already holds the lock', async () => {
    const w = await world();
    const handed = await stakeWith(w, { unixTimestamp: T, epoch: 0n, custodian: w.K2.address });
    expect(await decide(w, handed)).toEqual({ kind: 'done', after: w.testChain.stakeAccount(handed) });
  });

  it('refuses no lock, a lock of the main key or of no key, another key, and a lock about to end', async () => {
    const w = await world();
    const other = (await generateKeyPairSigner()).address;
    const open = await stakeWith(w, { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS });
    const ended = await stakeWith(w, { unixTimestamp: START_UNIX_TIMESTAMP - 1n, epoch: 0n, custodian: w.K.address });
    const selfLocked = await stakeWith(w, { unixTimestamp: T, epoch: 0n, custodian: w.A.address });
    const zeroLocked = await stakeWith(w, { unixTimestamp: T, epoch: 0n, custodian: ZERO_ADDRESS });
    const othersLock = await stakeWith(w, { unixTimestamp: T, epoch: 0n, custodian: other });
    const soon = await stakeWith(w, { unixTimestamp: START_UNIX_TIMESTAMP + 30n, epoch: 0n, custodian: w.K.address });

    for (const id of [open, ended, selfLocked, zeroLocked]) {
      expect(await decide(w, id)).toMatchObject({ kind: 'refused', reason: 'not-locked', before: { address: id } });
    }
    expect(await decide(w, othersLock)).toMatchObject({ kind: 'refused', reason: 'not-current-second-key' });
    expect(await decide(w, soon)).toMatchObject({ kind: 'refused', reason: 'lock-ending' });
  });

  it('refuses a new second key that is the main key, the staking key, the stake account or the key now', async () => {
    const w = await world();
    const service = (await generateKeyPairSigner()).address;
    const S = await stakeWith(w, { unixTimestamp: T, epoch: 0n, custodian: w.K.address }, service);

    expect(await decide(w, S, { newSecondKey: w.A.address })).toMatchObject({ kind: 'refused', reason: 'main-key' });
    expect(await decide(w, S, { newSecondKey: service })).toMatchObject({ kind: 'refused', reason: 'staker' });
    expect(await decide(w, S, { newSecondKey: S })).toMatchObject({ kind: 'refused', reason: 'stake-account' });
    expect(await decide(w, S, { newSecondKey: w.K.address })).toMatchObject({ kind: 'refused', reason: 'current-second-key' });
  });

  it('builds the change, paid by the new second key when it can, else by the main key; never by the old key', async () => {
    const w = await world();
    const S = await stakeWith(w, { unixTimestamp: T, epoch: 0n, custodian: w.K.address });
    const before = w.testChain.stakeAccount(S);
    const action = { kind: 'change-second-key', stakeAccount: S, secondKey: w.K.address, newSecondKey: w.K2.address };

    // K2 holds nothing: the main key pays (K is funded, and still never pays).
    expect(await decide(w, S)).toEqual({ kind: 'build', action, feePayer: w.A.address, before });
    // K2 holds the minimum balance and a little: paying two signatures would leave it below, so the main key still pays.
    const rent0 = await w.chain.getMinimumBalanceForRentExemption(0);
    w.testChain.airdrop(w.K2.address, rent0 + networkFeeFor(2) - 1n);
    expect(await decide(w, S)).toMatchObject({ kind: 'build', feePayer: w.A.address });
    // One lamport more and it pays.
    w.testChain.airdrop(w.K2.address, 1n);
    expect(await decide(w, S)).toEqual({ kind: 'build', action, feePayer: w.K2.address, before });
    w.testChain.airdrop(w.K2.address, LAMPORTS_PER_SOL / 100n);
    expect(await decide(w, S)).toMatchObject({ kind: 'build', feePayer: w.K2.address });
  });
});

describe('secondKeyRefusalText', () => {
  it('says every refusal in plain words, the new-key rules as on the step that connects it, an unknown one as unknown', () => {
    for (const [reason, text] of Object.entries(en.secondKey.refused)) expect(secondKeyRefusalText(reason)).toBe(text);
    for (const [reason, text] of Object.entries(en.secondKey.choose.problem)) expect(secondKeyRefusalText(reason)).toBe(text);
    expect(secondKeyRefusalText('nope')).toBe('Something went wrong. Refresh to see the current state, then try again.');
  });
});
