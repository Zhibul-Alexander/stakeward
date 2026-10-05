import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { lockupEnd, ZERO_ADDRESS, type Lockup } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { LAMPORTS_PER_SOL, START_EPOCH, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { describe, expect, it } from 'vitest';
import { extendPlan, extendRefusalText } from '@/pages/extend/plan';

// The /extend plan on the real stake program: every refusal rule, both done rules, what it builds and who pays.

const DAY = 86_400n;
const T = START_UNIX_TIMESTAMP + 100n * DAY;
const T2 = lockupEnd(START_UNIX_TIMESTAMP, '12-months', 'devnet');

type World = { testChain: TestChain; chain: LiteSvmChain; A: KeyPairSigner; K: KeyPairSigner };

async function world(): Promise<World> {
  const testChain = await TestChain.create();
  const [A, K] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner()]);
  return { testChain, chain: new LiteSvmChain(testChain), A, K };
}

function stakeWith(w: World, lockup: Lockup): Promise<Address> {
  return w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address, lockup });
}

async function decide(w: World, input: { secondKey?: Address; lockUntil: bigint }, id: Address) {
  const plan = extendPlan({ secondKey: input.secondKey ?? w.K.address, lockUntil: input.lockUntil });
  const { jobs, clock } = await plan.prepare(w.chain, [id]);
  expect(clock.unixTimestamp).toBe(w.testChain.clock().unixTimestamp);
  return jobs[id];
}

describe('extendPlan', () => {
  it('refuses a missing account, a wallet and a lock an epoch holds', async () => {
    const w = await world();
    const missing = (await generateKeyPairSigner()).address;
    const byEpoch = await stakeWith(w, { unixTimestamp: T, epoch: START_EPOCH + 5n, custodian: w.K.address });

    expect(await decide(w, { lockUntil: T2 }, missing)).toEqual({ kind: 'refused', reason: 'not-found', before: null });
    expect(await decide(w, { lockUntil: T2 }, w.A.address)).toEqual({ kind: 'refused', reason: 'not-stake-account', before: null });
    expect(await decide(w, { lockUntil: T2 }, byEpoch)).toMatchObject({ kind: 'refused', reason: 'epoch-locked', before: { address: byEpoch } });
    expect(await decide(w, { lockUntil: 0n }, byEpoch)).toMatchObject({ kind: 'refused', reason: 'epoch-locked' });
  });

  it('is done when the chain already shows the change: no lock to remove, or the lock already ends then', async () => {
    const w = await world();
    const open = await stakeWith(w, { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS });
    const ended = await stakeWith(w, { unixTimestamp: START_UNIX_TIMESTAMP - 1n, epoch: 0n, custodian: w.K.address });
    const extended = await stakeWith(w, { unixTimestamp: T2, epoch: 0n, custodian: w.K.address });

    expect(await decide(w, { lockUntil: 0n }, open)).toEqual({ kind: 'done', after: w.testChain.stakeAccount(open) });
    expect(await decide(w, { lockUntil: 0n }, ended)).toEqual({ kind: 'done', after: w.testChain.stakeAccount(ended) });
    expect(await decide(w, { lockUntil: T2 }, extended)).toEqual({ kind: 'done', after: w.testChain.stakeAccount(extended) });
  });

  it('refuses no lock, a lock of the main key or of no key, another second key, a date not later and one too close', async () => {
    const w = await world();
    const other = (await generateKeyPairSigner()).address;
    const open = await stakeWith(w, { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS });
    const selfLocked = await stakeWith(w, { unixTimestamp: T, epoch: 0n, custodian: w.A.address });
    const zeroLocked = await stakeWith(w, { unixTimestamp: T, epoch: 0n, custodian: ZERO_ADDRESS });
    const othersLock = await stakeWith(w, { unixTimestamp: T, epoch: 0n, custodian: other });
    const locked = await stakeWith(w, { unixTimestamp: T, epoch: 0n, custodian: w.K.address });
    const soon = await stakeWith(w, { unixTimestamp: START_UNIX_TIMESTAMP + 30n, epoch: 0n, custodian: w.K.address });

    expect(await decide(w, { lockUntil: T2 }, open)).toMatchObject({ kind: 'refused', reason: 'not-locked' });
    expect(await decide(w, { lockUntil: T2 }, selfLocked)).toMatchObject({ kind: 'refused', reason: 'not-locked' });
    expect(await decide(w, { lockUntil: 0n }, zeroLocked)).toMatchObject({ kind: 'refused', reason: 'not-locked' });
    expect(await decide(w, { lockUntil: T2 }, othersLock)).toMatchObject({ kind: 'refused', reason: 'other-second-key' });
    expect(await decide(w, { lockUntil: 0n }, othersLock)).toMatchObject({ kind: 'refused', reason: 'other-second-key' });
    expect(await decide(w, { lockUntil: T - DAY }, locked)).toMatchObject({ kind: 'refused', reason: 'not-later', before: { address: locked } });
    expect(await decide(w, { lockUntil: START_UNIX_TIMESTAMP + 50n }, soon)).toMatchObject({ kind: 'refused', reason: 'lock-end-passed' });
  });

  it('builds an extend or an unlock that the second key pays when it can, else the main key', async () => {
    const w = await world();
    const S = await stakeWith(w, { unixTimestamp: T, epoch: 0n, custodian: w.K.address });
    const before = w.testChain.stakeAccount(S);

    // K holds nothing: the main key pays.
    expect(await decide(w, { lockUntil: T2 }, S)).toEqual({
      kind: 'build',
      action: { kind: 'extend', stakeAccount: S, secondKey: w.K.address, lockUntil: T2 },
      feePayer: w.A.address,
      before,
    });
    // K holds the minimum balance and a little: paying would leave it below the minimum, so the main key still pays.
    const rent0 = await w.chain.getMinimumBalanceForRentExemption(0);
    w.testChain.airdrop(w.K.address, rent0 + 1_000n);
    expect(await decide(w, { lockUntil: 0n }, S)).toEqual({
      kind: 'build',
      action: { kind: 'unlock', stakeAccount: S, secondKey: w.K.address },
      feePayer: w.A.address,
      before,
    });
    // K holds enough: it pays and signs alone.
    w.testChain.airdrop(w.K.address, LAMPORTS_PER_SOL / 100n);
    expect(await decide(w, { lockUntil: T2 }, S)).toMatchObject({ kind: 'build', feePayer: w.K.address });
    expect(await decide(w, { lockUntil: 0n }, S)).toMatchObject({ kind: 'build', action: { kind: 'unlock' }, feePayer: w.K.address });
  });
});

describe('extendRefusalText', () => {
  it('says each refusal in plain words and an unknown one as an unknown error', () => {
    expect(extendRefusalText('not-later')).toBe('The lock already ends later than this. Choose again.');
    expect(extendRefusalText('epoch-locked')).toBe('An epoch holds this lock, so Stakeward cannot change it.');
    expect(extendRefusalText('nope')).toBe('Something went wrong. Refresh to see the current state, then try again.');
  });
});
