// @vitest-environment node
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { ZERO_ADDRESS } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_EPOCH, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { changeStaker, deactivateAs } from '@stakeward/core/test/thief';
import { beforeAll, describe, expect, it } from 'vitest';
import { delegatePlan, rescuePlan, rescueRefusalText } from '@/pages/rescue/plan';

// The rescue and delegate plans' rules (step 7 spec 9.2), each decided on accounts as LiteSVM holds them.

const T = START_UNIX_TIMESTAMP + 30n * 86_400n;

describe('rescuePlan and delegatePlan', () => {
  let testChain: TestChain;
  let chain: LiteSvmChain;
  let A: KeyPairSigner;
  let K: Address;
  let K2: Address;
  let D: KeyPairSigner;
  let vote: Address;
  const nonce = () => ({ nonceAccount: ZERO_ADDRESS, nonceAuthority: D.address });

  beforeAll(async () => {
    testChain = await TestChain.create();
    chain = new LiteSvmChain(testChain);
    [A, D] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner()]);
    K = (await generateKeyPairSigner()).address;
    K2 = (await generateKeyPairSigner()).address;
    vote = await testChain.createVoteAccount();
  });

  const create = (options: { staker?: Address; withdrawer?: Address; custodian?: Address; delegated?: boolean } = {}) =>
    testChain.createStakeAccount({
      staker: options.staker ?? A.address,
      withdrawer: options.withdrawer ?? A.address,
      ...(options.custodian === undefined ? {} : { lockup: { unixTimestamp: T, epoch: 0n, custodian: options.custodian } }),
      ...(options.delegated === true ? { delegateTo: { voteAccount: vote, stakerKey: A } } : {}),
    });

  it('rescue: refuses what it cannot move, says done for what D already holds, builds the rest on D\'s nonce', async () => {
    const missing = (await generateKeyPairSigner()).address;
    // One at a time: the harness gives each setup transaction the latest blockhash.
    const locked = await create({ custodian: K });
    const unlocked = await create();
    const alreadyD = await create({ staker: D.address, withdrawer: D.address });
    const otherMain = await create({ withdrawer: K2 });
    const selfLocked = await create({ custodian: A.address });
    const zeroLocked = await create({ custodian: ZERO_ADDRESS });
    const otherKey = await create({ custodian: K2 });
    const plan = rescuePlan({ mainKey: A.address, secondKey: K, newWallet: D.address, nonce: nonce(), remote: [K] });
    expect(plan.nonce).toEqual(nonce());
    expect(plan.remote).toEqual([K]);
    const ids = [locked, unlocked, alreadyD, otherMain, selfLocked, zeroLocked, otherKey, missing, A.address];
    const { jobs } = await plan.prepare(chain, ids);
    const kinds = Object.fromEntries(ids.map((id) => [id, jobs[id]?.kind === 'refused' ? jobs[id].reason : jobs[id]?.kind]));
    expect(kinds).toEqual({
      [locked]: 'build',
      [unlocked]: 'build',
      [alreadyD]: 'done',
      [otherMain]: 'not-main-key',
      [selfLocked]: 'unsupported-lock',
      [zeroLocked]: 'unsupported-lock',
      [otherKey]: 'other-second-key',
      [missing]: 'not-found',
      [A.address]: 'not-stake-account',
    });
    expect(jobs[locked]).toMatchObject({
      kind: 'build',
      action: { kind: 'rescue', stakeAccount: locked, mainKey: A.address, secondKey: K, newWallet: D.address },
      feePayer: D.address,
      before: { address: locked },
    });
    // The second key may not be the new wallet: the keys must all differ.
    const same = await rescuePlan({ mainKey: A.address, secondKey: D.address, newWallet: D.address, nonce: nonce(), remote: [] }).prepare(
      chain,
      [unlocked],
    );
    expect(same.jobs[unlocked]).toMatchObject({ kind: 'refused', reason: 'key-rule' });
  });

  it('delegate: only accounts D stakes, that were delegated and stopped, go back to the same validator', async () => {
    const stopped = await create({ delegated: true });
    const active = await create({ delegated: true });
    const never = await create({ staker: D.address, withdrawer: D.address });
    const notD = await create({ delegated: true });
    testChain.warpToEpoch(START_EPOCH + 1n);
    // Hand `stopped` and `active` to D the way a rescue does, then stop `stopped` (as a thief did before the rescue).
    await changeStaker(testChain, { stake: stopped, withdrawer: A, newStaker: D });
    await changeStaker(testChain, { stake: active, withdrawer: A, newStaker: D });
    await deactivateAs(testChain, { stake: stopped, staker: D });
    const ids = [stopped, active, never, notD];
    const { jobs } = await delegatePlan({ newWallet: D.address }).prepare(chain, ids);
    expect(jobs[stopped]).toMatchObject({
      kind: 'build',
      action: { kind: 'delegate', stakeAccount: stopped, staker: D.address, voteAccount: vote },
      feePayer: D.address,
    });
    expect(jobs[active]).toMatchObject({ kind: 'done' });
    expect(jobs[never]).toMatchObject({ kind: 'refused', reason: 'no-validator' });
    expect(jobs[notD]).toMatchObject({ kind: 'refused', reason: 'not-new-wallet' });
  });

  it('says every refusal in words', () => {
    for (const reason of ['not-found', 'not-stake-account', 'not-main-key', 'other-second-key', 'unsupported-lock', 'key-rule', 'not-new-wallet', 'no-validator']) {
      expect(rescueRefusalText(reason)).not.toBe(rescueRefusalText('something-else'));
    }
  });
});
