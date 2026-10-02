import { address, getAddressDecoder } from '@solana/kit';
import { createRpcFromSvm } from '@solana/kit-plugin-litesvm';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STAKE_ACCOUNT_OFFSETS, STAKE_ACCOUNT_SIZE, STAKE_PROGRAM_ADDRESS } from '../src/index.ts';
import { START_EPOCH, START_UNIX_TIMESTAMP, STAKE_PROGRAM_PATH, TestChain } from './svm.ts';

/** Upgradeable loader programdata header: u32 tag, u64 slot, option<pubkey> upgrade authority. */
const PROGRAMDATA_HEADER = 45;

describe('LiteSVM harness', () => {
  it('runs the committed stake program v5.1.0, not the build bundled with LiteSVM', async () => {
    const chain = await TestChain.create();
    const program = chain.svm.getAccount(STAKE_PROGRAM_ADDRESS);
    if (!program.exists) throw new Error('stake program missing');
    expect(program.executable).toBe(true);
    const programData = chain.svm.getAccount(getAddressDecoder().decode(program.data, 4));
    if (!programData.exists) throw new Error('programdata missing');
    expect(Buffer.from(programData.data.slice(PROGRAMDATA_HEADER)).equals(readFileSync(STAKE_PROGRAM_PATH))).toBe(true);
  });

  it('starts from a realistic clock', async () => {
    const chain = await TestChain.create();
    expect(chain.clock()).toEqual({ unixTimestamp: START_UNIX_TIMESTAMP, epoch: START_EPOCH });
    chain.advanceTime(60n);
    chain.warpToEpoch(START_EPOCH + 1n);
    expect(chain.clock()).toEqual({ unixTimestamp: START_UNIX_TIMESTAMP + 60n, epoch: START_EPOCH + 1n });
  });

  it('answers a stake getProgramAccounts query through the kit RPC adapter', async () => {
    const chain = await TestChain.create();
    const withdrawer = address('57RQ3ocAibVdC3n3S9i4gT39EpF4DhRCbqAivyg6wtQ6');
    const stake = await chain.createStakeAccount({ staker: withdrawer, withdrawer });
    const accounts = await createRpcFromSvm(chain.svm)
      .getProgramAccounts(STAKE_PROGRAM_ADDRESS, {
        encoding: 'base64',
        filters: [
          { dataSize: BigInt(STAKE_ACCOUNT_SIZE) },
          { memcmp: { offset: BigInt(STAKE_ACCOUNT_OFFSETS.withdrawer), bytes: withdrawer, encoding: 'base58' } },
        ],
      })
      .send();
    expect(accounts.map((account) => account.pubkey)).toEqual([stake]);
  });
});
