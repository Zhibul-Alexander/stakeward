// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address } from '@solana/kit';
import { ZERO_ADDRESS, type ChainPort } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { SLOTS_PER_EPOCH, START_EPOCH, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { loadAccountState, parseAccountParam, useAccountState } from '@/pages/account/load';

// The read of one stake account page (/withdraw/:account, /extend/:account): the account, the clock and the epoch,
// read together and never through the cached search.

/** Records every ChainPort method called. */
function recorded(chain: LiteSvmChain): { chain: ChainPort; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    chain: new Proxy(chain, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          calls.push(String(property));
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    }),
  };
}

describe('parseAccountParam', () => {
  it('accepts a base58 address other than the zero key', async () => {
    const { address } = await generateKeyPairSigner();
    expect(parseAccountParam(address)).toBe(address);
    expect(parseAccountParam(undefined)).toBeNull();
    expect(parseAccountParam('')).toBeNull();
    expect(parseAccountParam('not-an-address')).toBeNull();
    expect(parseAccountParam(`${address}x`)).toBeNull();
    expect(parseAccountParam(ZERO_ADDRESS)).toBeNull();
  });
});

describe('loadAccountState', () => {
  it('reads the account, the clock and the epoch in three calls and decodes a stake account', async () => {
    const testChain = await TestChain.create();
    const A = await testChain.fundedKey();
    const stake = await testChain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const { chain, calls } = recorded(new LiteSvmChain(testChain));

    const state = await loadAccountState(chain, stake);

    expect(calls.sort()).toEqual(['getAccounts', 'getClock', 'getEpochInfo']);
    expect(state.raw?.address).toBe(stake);
    expect(state.account).toMatchObject({ address: stake, withdrawer: A.address, staker: A.address });
    expect(state.clock).toMatchObject({ epoch: START_EPOCH, unixTimestamp: START_UNIX_TIMESTAMP });
    expect(state.epoch).toMatchObject({ epoch: START_EPOCH, slotsInEpoch: SLOTS_PER_EPOCH });
  });

  it('a missing account has no raw data; a wallet is present but not a stake account', async () => {
    const testChain = await TestChain.create();
    const chain = new LiteSvmChain(testChain);
    const wallet = await testChain.fundedKey();
    const missing = (await generateKeyPairSigner()).address;

    expect(await loadAccountState(chain, missing)).toMatchObject({ raw: null, account: null });
    const notStake = await loadAccountState(chain, wallet.address);
    expect(notStake.raw?.address).toBe(wallet.address);
    expect(notStake.account).toBeNull();
  });

  it('rejects when one of the reads fails', async () => {
    const testChain = await TestChain.create();
    const chain = new LiteSvmChain(testChain);
    const offline = new TypeError('Failed to fetch');
    chain.failNext('getEpochInfo', offline);
    await expect(loadAccountState(chain, (await generateKeyPairSigner()).address)).rejects.toBe(offline);
  });
});

describe('useAccountState', () => {
  it('is idle without an address, reads again for a new attempt and reports a failure as an error', async () => {
    const testChain = await TestChain.create();
    const A = await testChain.fundedKey();
    const stake = await testChain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const chain = new LiteSvmChain(testChain);

    const { result, rerender } = renderHook(
      ({ address, attempt }: { address: Address | null; attempt: number }) => useAccountState(chain, address, attempt),
      { initialProps: { address: null as Address | null, attempt: 0 } },
    );
    expect(result.current).toEqual({ status: 'idle' });

    rerender({ address: stake, attempt: 0 });
    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    chain.failNext('getClock', new TypeError('Failed to fetch'));
    rerender({ address: stake, attempt: 1 });
    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current).toMatchObject({ status: 'error', error: { code: 'network' } });
    });

    rerender({ address: stake, attempt: 2 });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
  });
});
