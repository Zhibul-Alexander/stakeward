import type { KeyPairSigner } from '@solana/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { U64_MAX } from '../src/index.ts';
import { LAMPORTS_PER_SOL, START_UNIX_TIMESTAMP, TestChain } from './svm.ts';
import { changeStaker, deactivateAs, splitStake, THIEF_MARKER } from './thief.ts';

// The thief's moves for the rescue tests (CLAUDE.md section 4): each lands, and the main key never pays.

describe('thief helpers', { timeout: 30_000 }, () => {
  let chain: TestChain;
  let A: KeyPairSigner;
  let K: KeyPairSigner;
  let X: KeyPairSigner;

  beforeEach(async () => {
    chain = await TestChain.create();
    [A, K, X] = await Promise.all([chain.fundedKey(0n), chain.fundedKey(0n), chain.fundedKey(0n)]);
  });

  it('changeStaker: the withdrawer and the new staker sign; the lock and the withdrawer stay', async () => {
    const lockup = { unixTimestamp: START_UNIX_TIMESTAMP + 3_600n, epoch: 0n, custodian: K.address };
    const stake = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup });
    await changeStaker(chain, { stake, withdrawer: A, newStaker: X });
    expect(chain.stakeAccount(stake)).toMatchObject({ staker: X.address, withdrawer: A.address, lockup });
    expect(chain.balance(A.address)).toBe(0n);
  });

  it('deactivateAs: the staker deactivates a delegated stake', async () => {
    const vote = await chain.createVoteAccount();
    const stake = await chain.createStakeAccount({
      staker: A.address,
      withdrawer: A.address,
      delegateTo: { voteAccount: vote, stakerKey: A },
    });
    expect(chain.stakeAccount(stake)?.delegation?.deactivationEpoch).toBe(U64_MAX);
    await deactivateAs(chain, { stake, staker: A });
    expect(chain.stakeAccount(stake)?.delegation?.deactivationEpoch).toBe(chain.clock().epoch);
    expect(chain.balance(A.address)).toBe(0n);
  });

  it('splitStake: a new stake account with the same keys and lock, holding the split lamports', async () => {
    const lockup = { unixTimestamp: START_UNIX_TIMESTAMP + 3_600n, epoch: 0n, custodian: K.address };
    const stake = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup, lamports: 3n * LAMPORTS_PER_SOL });
    const before = chain.balance(stake);
    const split = await splitStake(chain, { stake, staker: A, lamports: LAMPORTS_PER_SOL });
    expect(chain.stakeAccount(split)).toMatchObject({ staker: A.address, withdrawer: A.address, lockup });
    expect(chain.balance(stake)).toBe(before - LAMPORTS_PER_SOL);
    expect(chain.balance(A.address)).toBe(0n);
  });

  it('throws when the chain refuses (no signature of the withdrawer)', async () => {
    const stake = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    await expect(changeStaker(chain, { stake, withdrawer: X, newStaker: K })).rejects.toThrow(/changeStaker failed/);
  });

  it('a move the program refuses throws, and its error carries the test-only marker', async () => {
    expect(THIEF_MARKER.startsWith('stakeward-test-only:')).toBe(true);
    const stake = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    await expect(deactivateAs(chain, { stake, staker: X })).rejects.toThrow(THIEF_MARKER);
  });
});

