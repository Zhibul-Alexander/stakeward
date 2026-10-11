// "Try to steal it" (D123) against the mainnet stake program in LiteSVM, through the product's ChainPort.
import type { KeyPairSigner } from '@solana/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { runTheftTest, type StakeAccount } from '../src/index.ts';
import { LiteSvmChain } from './litesvm-chain.ts';
import { START_UNIX_TIMESTAMP, TestChain } from './svm.ts';

const HOUR = 3_600n;

describe('runTheftTest', () => {
  let testChain: TestChain;
  let chain: LiteSvmChain;
  let A: KeyPairSigner;
  let K: KeyPairSigner;

  beforeEach(async () => {
    testChain = await TestChain.create();
    chain = new LiteSvmChain(testChain);
    [A, K] = await Promise.all([testChain.fundedKey(), testChain.fundedKey()]);
  });

  function read(address: Parameters<TestChain['stakeAccount']>[0]): StakeAccount {
    const account = testChain.stakeAccount(address);
    if (account === null) throw new Error('no stake account');
    return account;
  }

  it('a locked account: the network refuses both attempts for want of the second key', async () => {
    const stake = await testChain.createStakeAccount({
      staker: A.address,
      withdrawer: A.address,
      lockup: { unixTimestamp: START_UNIX_TIMESTAMP + HOUR, epoch: 0n, custodian: K.address },
    });
    const results = await runTheftTest(chain, read(stake));
    expect(results.map((result) => [result.attempt, result.verdict, result.code])).toEqual([
      ['withdraw', 'blocked', 'lockup-in-force'],
      ['remove-lock', 'blocked', 'missing-signature'],
    ]);
  });

  it('an unlocked, undelegated account: both would succeed', async () => {
    const stake = await testChain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const results = await runTheftTest(chain, read(stake));
    expect(results.map((result) => [result.attempt, result.verdict])).toEqual([
      ['withdraw', 'would-succeed'],
      ['remove-lock', 'would-succeed'],
    ]);
    // Simulation only: nothing changed.
    expect(read(stake).lamports).toBe(testChain.balance(stake));
    expect(testChain.balance(stake)).toBeGreaterThan(0n);
  });

  it('an unlocked, delegated account: the withdraw waits for unstaking', async () => {
    const vote = await testChain.createVoteAccount();
    const stake = await testChain.createStakeAccount({ staker: A.address, withdrawer: A.address, delegateTo: { voteAccount: vote, stakerKey: A } });
    const results = await runTheftTest(chain, read(stake));
    expect(results.map((result) => [result.attempt, result.verdict])).toEqual([
      ['withdraw', 'after-unstaking'],
      ['remove-lock', 'would-succeed'],
    ]);
  });

  it('a main key with no SOL for the fee: the test cannot run, and says so', async () => {
    const empty = await testChain.fundedKey(0n);
    const stake = await testChain.createStakeAccount({
      staker: empty.address,
      withdrawer: empty.address,
      lockup: { unixTimestamp: START_UNIX_TIMESTAMP + HOUR, epoch: 0n, custodian: K.address },
    });
    const results = await runTheftTest(chain, read(stake));
    expect(results.map((result) => [result.verdict, result.code])).toEqual([
      ['unknown', 'insufficient-funds'],
      ['unknown', 'insufficient-funds'],
    ]);
  });
});
