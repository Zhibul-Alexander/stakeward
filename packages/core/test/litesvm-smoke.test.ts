import { address } from '@solana/kit';
import { createRpcFromSvm } from '@solana/kit-plugin-litesvm';
import { STAKE_PROGRAM_ADDRESS } from '@solana-program/stake';
import { LiteSVM } from 'litesvm';
import { describe, expect, it } from 'vitest';
import { STAKE_ACCOUNT_OFFSETS, STAKE_ACCOUNT_SIZE } from '../src/index.ts';

// Proves the native LiteSVM addon loads on this platform (locally and in CI) before step 1 builds on it.
describe('LiteSVM smoke', () => {
  it('has the stake program and answers a stake getProgramAccounts query', async () => {
    const svm = new LiteSVM();
    const program = svm.getAccount(STAKE_PROGRAM_ADDRESS);
    expect(program.exists && program.executable).toBe(true);

    const rpc = createRpcFromSvm(svm);
    const accounts = await rpc
      .getProgramAccounts(STAKE_PROGRAM_ADDRESS, {
        encoding: 'base64',
        filters: [
          { dataSize: BigInt(STAKE_ACCOUNT_SIZE) },
          {
            memcmp: {
              offset: BigInt(STAKE_ACCOUNT_OFFSETS.withdrawer),
              bytes: address('57RQ3ocAibVdC3n3S9i4gT39EpF4DhRCbqAivyg6wtQ6'),
              encoding: 'base58',
            },
          },
        ],
      })
      .send();
    expect(accounts).toEqual([]);
  });
});
