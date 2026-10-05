import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { buildTransaction, ZERO_ADDRESS, type Lockup, type TransactionAction } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_EPOCH, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { describe, expect, it } from 'vitest';
import { deactivatePlan, withdrawPlan, withdrawRefusalText } from '@/pages/withdraw/plan';

// The /withdraw plans on the real stake program: every refusal rule, the done rule and what they build.

const DAY = 86_400n;

type World = { testChain: TestChain; chain: LiteSvmChain; A: KeyPairSigner; K: KeyPairSigner; X: KeyPairSigner; vote: Address };

async function world(): Promise<World> {
  const testChain = await TestChain.create();
  const [A, K, X] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner(), testChain.fundedKey()]);
  return { testChain, chain: new LiteSvmChain(testChain), A, K, X, vote: await testChain.createVoteAccount() };
}

function lockBy(custodian: Address, unixTimestamp = START_UNIX_TIMESTAMP + 30n * DAY): Lockup {
  return { unixTimestamp, epoch: 0n, custodian };
}

async function send(w: World, action: TransactionAction, signers: readonly KeyPairSigner[]) {
  const { bytes } = buildTransaction(action, { feePayer: signers[0]?.address ?? w.A.address, lifetime: w.testChain.blockhashLifetime() });
  const result = await w.testChain.send(bytes, signers);
  if (!result.ok) throw new Error(`setup transaction failed: ${JSON.stringify(result.error)}`);
}

async function decide(plan: ReturnType<typeof withdrawPlan>, w: World, id: Address) {
  const { jobs, clock } = await plan.prepare(w.chain, [id]);
  expect(clock.epoch).toBe(w.testChain.clock().epoch);
  return jobs[id];
}

describe('withdrawPlan', () => {
  it('refuses a missing account, a wallet, another main key, a staked account and a lock no second key holds', async () => {
    const w = await world();
    const plan = withdrawPlan({ mainKey: w.A.address });
    const missing = (await generateKeyPairSigner()).address;
    const otherMain = await w.testChain.createStakeAccount({ staker: w.X.address, withdrawer: w.X.address });
    const staked = await w.testChain.createStakeAccount({
      staker: w.A.address,
      withdrawer: w.A.address,
      delegateTo: { voteAccount: w.vote, stakerKey: w.A },
    });
    const selfLocked = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address, lockup: lockBy(w.A.address) });
    const zeroLocked = await w.testChain.createStakeAccount({
      staker: w.A.address,
      withdrawer: w.A.address,
      lockup: { unixTimestamp: 0n, epoch: START_EPOCH + 5n, custodian: ZERO_ADDRESS },
    });

    expect(await decide(plan, w, missing)).toEqual({ kind: 'refused', reason: 'not-found', before: null });
    expect(await decide(plan, w, w.X.address)).toEqual({ kind: 'refused', reason: 'not-stake-account', before: null });
    expect(await decide(plan, w, otherMain)).toMatchObject({ kind: 'refused', reason: 'not-main-key', before: { address: otherMain } });
    expect(await decide(plan, w, staked)).toMatchObject({ kind: 'refused', reason: 'not-inactive', before: { address: staked } });
    expect(await decide(plan, w, selfLocked)).toMatchObject({ kind: 'refused', reason: 'unsupported-lock' });
    expect(await decide(plan, w, zeroLocked)).toMatchObject({ kind: 'refused', reason: 'unsupported-lock' });
  });

  it('a stake still stopping is not inactive yet; after the epoch it withdraws', async () => {
    const w = await world();
    const plan = withdrawPlan({ mainKey: w.A.address });
    const S = await w.testChain.createStakeAccount({
      staker: w.A.address,
      withdrawer: w.A.address,
      delegateTo: { voteAccount: w.vote, stakerKey: w.A },
    });
    w.testChain.warpToEpoch(START_EPOCH + 1n);
    await send(w, { kind: 'deactivate', stakeAccount: S, staker: w.A.address }, [w.A]);
    expect(await decide(plan, w, S)).toMatchObject({ kind: 'refused', reason: 'not-inactive' });
    w.testChain.warpToEpoch(START_EPOCH + 2n);
    expect(await decide(plan, w, S)).toMatchObject({ kind: 'build', action: { kind: 'withdraw', secondKey: null } });
  });

  it('builds a withdrawal of the whole balance to the main key: co-signed by the second key while its lock holds', async () => {
    const w = await world();
    const plan = withdrawPlan({ mainKey: w.A.address });
    const locked = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address, lockup: lockBy(w.K.address) });
    const unlocked = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address });
    const ended = await w.testChain.createStakeAccount({
      staker: w.A.address,
      withdrawer: w.A.address,
      lockup: lockBy(w.K.address, START_UNIX_TIMESTAMP - 1n),
    });
    const byEpoch = await w.testChain.createStakeAccount({
      staker: w.A.address,
      withdrawer: w.A.address,
      lockup: { unixTimestamp: 0n, epoch: START_EPOCH + 5n, custodian: w.K.address },
    });

    const lamports = (address: Address) => w.testChain.account(address)?.lamports;
    expect(await decide(plan, w, locked)).toEqual({
      kind: 'build',
      action: {
        kind: 'withdraw',
        stakeAccount: locked,
        mainKey: w.A.address,
        secondKey: w.K.address,
        recipient: w.A.address,
        lamports: lamports(locked),
      },
      feePayer: w.A.address,
      before: w.testChain.stakeAccount(locked),
    });
    expect(await decide(plan, w, unlocked)).toMatchObject({ kind: 'build', action: { secondKey: null, lamports: lamports(unlocked) } });
    expect(await decide(plan, w, ended)).toMatchObject({ kind: 'build', action: { secondKey: null } });
    expect(await decide(plan, w, byEpoch)).toMatchObject({ kind: 'build', action: { secondKey: w.K.address } });
  });
});

describe('deactivatePlan', () => {
  it('refuses a missing account, a wallet, another main key, a stake that is not staking and another staking key', async () => {
    const w = await world();
    const plan = deactivatePlan({ mainKey: w.A.address });
    const missing = (await generateKeyPairSigner()).address;
    const otherMain = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.X.address });
    const idle = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address });
    const service = await w.testChain.createStakeAccount({
      staker: w.X.address,
      withdrawer: w.A.address,
      delegateTo: { voteAccount: w.vote, stakerKey: w.X },
    });

    expect(await decide(plan, w, missing)).toEqual({ kind: 'refused', reason: 'not-found', before: null });
    expect(await decide(plan, w, w.X.address)).toEqual({ kind: 'refused', reason: 'not-stake-account', before: null });
    expect(await decide(plan, w, otherMain)).toMatchObject({ kind: 'refused', reason: 'not-main-key' });
    expect(await decide(plan, w, idle)).toMatchObject({ kind: 'refused', reason: 'not-active', before: { address: idle } });
    expect(await decide(plan, w, service)).toMatchObject({ kind: 'refused', reason: 'not-staker', before: { address: service } });
  });

  it('builds a Deactivate the main key signs and pays, also while activating and while locked; done once it shows', async () => {
    const w = await world();
    const plan = deactivatePlan({ mainKey: w.A.address });
    const S = await w.testChain.createStakeAccount({
      staker: w.A.address,
      withdrawer: w.A.address,
      lockup: lockBy(w.K.address),
      delegateTo: { voteAccount: w.vote, stakerKey: w.A },
    });
    const action = { kind: 'deactivate', stakeAccount: S, staker: w.A.address } as const;

    // Activating in its first epoch, active after it.
    expect(await decide(plan, w, S)).toEqual({ kind: 'build', action, feePayer: w.A.address, before: w.testChain.stakeAccount(S) });
    w.testChain.warpToEpoch(START_EPOCH + 1n);
    expect(await decide(plan, w, S)).toMatchObject({ kind: 'build', action });

    await send(w, action, [w.A]);
    const after = w.testChain.stakeAccount(S);
    expect(await decide(plan, w, S)).toEqual({ kind: 'done', after });
  });
});

describe('withdrawRefusalText', () => {
  it('says each refusal in plain words and an unknown one as an unknown error', () => {
    expect(withdrawRefusalText('not-inactive')).toBe('This stake is still staked or stopping. Wait until it is inactive.');
    expect(withdrawRefusalText('not-staker')).toBe('Another key manages staking for this stake account.');
    expect(withdrawRefusalText('something-else')).toBe('Something went wrong. Refresh to see the current state, then try again.');
  });
});
