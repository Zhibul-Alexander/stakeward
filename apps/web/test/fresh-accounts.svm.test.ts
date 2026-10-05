// @vitest-environment node
import { generateKeyPairSigner, type Address } from '@solana/kit';
import { buildTransaction, type ChainPort } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { describe, expect, it } from 'vitest';
import { refreshStakeAccounts } from '@/ports/fresh-accounts';

// refreshStakeAccounts on the real stake program: the search (cached at the edge in production) says which accounts
// exist; this read says what they look like now.

/** Records the addresses of every getAccounts call. */
function counted(chain: LiteSvmChain): { chain: ChainPort; reads: Address[][] } {
  const reads: Address[][] = [];
  return {
    reads,
    chain: new Proxy(chain, {
      get(target, property, receiver) {
        if (property === 'getAccounts') {
          return (addresses: readonly Address[]) => {
            reads.push([...addresses]);
            return target.getAccounts(addresses);
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    }),
  };
}

describe('refreshStakeAccounts', () => {
  it('reads each account once, in order, in its current state; drops what no longer is a stake account', async () => {
    const testChain = await TestChain.create();
    const liteChain = new LiteSvmChain(testChain);
    const [main, second] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner()]);
    const A = main.address;
    const first = await testChain.createStakeAccount({ staker: A, withdrawer: A });
    const later = await testChain.createStakeAccount({ staker: A, withdrawer: A });
    const closed = await testChain.createStakeAccount({ staker: A, withdrawer: A });
    const searched = (await liteChain.findStakeAccounts({ withdrawer: A })).accounts;
    const byAddress = (address: Address) => {
      const found = searched.find((account) => account.address === address);
      if (found === undefined) throw new Error('not found');
      return found;
    };

    // After the search: `first` gets locked, `closed` is withdrawn to zero (the account is gone).
    const send = async (action: Parameters<typeof buildTransaction>[0], signers: Parameters<TestChain['send']>[1]) => {
      const lifetime = { kind: 'blockhash', ...(await liteChain.getLatestBlockhash()) } as const;
      const result = await testChain.send(buildTransaction(action, { feePayer: A, lifetime }).bytes, signers);
      if (!result.ok) throw new Error(JSON.stringify(result.error));
    };
    const lockUntil = START_UNIX_TIMESTAMP + 30n * 86_400n;
    await send({ kind: 'protect', stakeAccount: first, mainKey: A, secondKey: second.address, lockUntil }, [main, second]);
    await send({ kind: 'withdraw', stakeAccount: closed, mainKey: A, secondKey: null, recipient: A, lamports: testChain.balance(closed) }, [main]);

    // A system account dressed up as a stake account (as a bad search answer could be) decodes as nothing.
    const notStake = { ...byAddress(later), address: A };
    const { chain, reads } = counted(liteChain);
    const fresh = await refreshStakeAccounts(chain, [byAddress(first), byAddress(later), byAddress(first), byAddress(closed), notStake]);

    expect(reads).toEqual([[first, later, closed, A]]);
    expect(fresh.map((account) => account.address)).toEqual([first, later]);
    expect(fresh[0]?.lockup).toEqual({ unixTimestamp: lockUntil, epoch: 0n, custodian: second.address });
    expect(byAddress(first).lockup.unixTimestamp).toBe(0n); // the search still had the old state
    expect(fresh[1]).toEqual(byAddress(later));
  });

  it('reads nothing for no accounts', async () => {
    const { chain, reads } = counted(new LiteSvmChain(await TestChain.create()));
    expect(await refreshStakeAccounts(chain, [])).toEqual([]);
    expect(reads).toEqual([]);
  });

  it('a failed read fails the refresh (the page never shows a half-fresh list)', async () => {
    const liteChain = new LiteSvmChain(await TestChain.create());
    const main = (await generateKeyPairSigner()).address;
    liteChain.failNext('getAccounts', new TypeError('Failed to fetch'));
    const stake = {
      address: main,
      lamports: 1n,
      kind: 'initialized',
      rentExemptReserve: 1n,
      staker: main,
      withdrawer: main,
      lockup: { unixTimestamp: 0n, epoch: 0n, custodian: main },
      delegation: null,
    } as const;
    await expect(refreshStakeAccounts(liteChain, [stake])).rejects.toThrow('Failed to fetch');
  });
});
