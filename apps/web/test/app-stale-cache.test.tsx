// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { buildTransaction, shortAddress, type StakeAccount, type StakeAccountFilter } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { AppPage } from '@/pages/AppPage';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  PortsProvider,
  StaticWalletRegistry,
  type Ports,
} from '@/ports';
import { createFakeApi } from './support/fake-api.ts';

// /api/stake-accounts is cached for 30 s at the edge (DECISIONS D51): right after a lock lands, the search still answers
// what it found before. The accounts page uses the search only to learn which accounts exist and reads their state
// fresh, so a lock that just landed shows as Protected, not as a lock that ended (no false F6 banner).

/** The edge cache: the first answer of each search is kept, whatever happens on chain afterwards. */
class EdgeCachedChain extends LiteSvmChain {
  private readonly cache = new Map<string, { slot: bigint; accounts: readonly StakeAccount[] }>();

  override async findStakeAccounts(filter: StakeAccountFilter): Promise<{ slot: bigint; accounts: readonly StakeAccount[] }> {
    const key = JSON.stringify(filter);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const answer = await super.findStakeAccounts(filter);
    this.cache.set(key, answer);
    return answer;
  }
}

async function protect(testChain: TestChain, chain: LiteSvmChain, stakeAccount: Address, main: KeyPairSigner, second: KeyPairSigner) {
  const lifetime = { kind: 'blockhash', ...(await chain.getLatestBlockhash()) } as const;
  const built = buildTransaction(
    { kind: 'protect', stakeAccount, mainKey: main.address, secondKey: second.address, lockUntil: START_UNIX_TIMESTAMP + 180n * 86_400n },
    { feePayer: main.address, lifetime },
  );
  const result = await testChain.send(built.bytes, [main, second]);
  if (!result.ok) throw new Error(`protect failed: ${JSON.stringify(result.error)}`);
}

describe('/app reads fresh state behind the cached stake account search', () => {
  it('a lock that just landed shows Protected after Refresh, without the F6 banner', async () => {
    const testChain = await TestChain.create();
    const chain = new EdgeCachedChain(testChain);
    const [main, second] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner()]);
    const account = await testChain.createStakeAccount({ staker: main.address, withdrawer: main.address });

    const ports: Ports = {
      chain,
      wallets: new StaticWalletRegistry([]),
      slots: createSlotStore(null),
      secondKeys: createSecondKeyMemory(null),
      protectedAccounts: createProtectedAccountMemory(null),
      api: createFakeApi(),
    };
    ports.secondKeys.remember(second.address);
    const location = memoryLocation({ path: `/app?address=${main.address}`, record: true });
    render(
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={ports}>
          <AppPage loadHealth={() => Promise.resolve({ lastMonitorRunAt: null })} />
        </PortsProvider>
      </Router>,
    );
    const row = () => screen.getByRole('article', { name: `Stake account ${shortAddress(account)}` });
    await screen.findByRole('article', { name: `Stake account ${shortAddress(account)}` });
    expect(row()).toHaveAttribute('data-status', 'unprotected');

    // The lock lands and this device remembers the account as protected (as the protect flow's Done screen does);
    // the search keeps answering the list from before the lock.
    await protect(testChain, chain, account, main, second);
    ports.protectedAccounts.remember([account]);
    expect((await chain.findStakeAccounts({ withdrawer: main.address })).accounts[0]?.lockup.custodian).not.toBe(second.address);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(row()).toHaveAttribute('data-status', 'protected');
    });
    expect(within(row()).getByText('Protected')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="no-longer-protected"]')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leaves out an account the search still lists but that is gone from the chain', async () => {
    const testChain = await TestChain.create();
    const chain = new EdgeCachedChain(testChain);
    const main = await testChain.fundedKey();
    const kept = await testChain.createStakeAccount({ staker: main.address, withdrawer: main.address });
    const gone = await testChain.createStakeAccount({ staker: main.address, withdrawer: main.address });
    await chain.findStakeAccounts({ withdrawer: main.address }); // cached with both
    // The main key withdraws everything: the account is closed.
    const lifetime = { kind: 'blockhash', ...(await chain.getLatestBlockhash()) } as const;
    const withdraw = buildTransaction(
      { kind: 'withdraw', stakeAccount: gone, mainKey: main.address, secondKey: null, recipient: main.address, lamports: testChain.balance(gone) },
      { feePayer: main.address, lifetime },
    );
    expect((await testChain.send(withdraw.bytes, [main])).ok).toBe(true);
    expect(testChain.account(gone)).toBeNull();

    const ports: Ports = {
      chain,
      wallets: new StaticWalletRegistry([]),
      slots: createSlotStore(null),
      secondKeys: createSecondKeyMemory(null),
      protectedAccounts: createProtectedAccountMemory(null),
      api: createFakeApi(),
    };
    const location = memoryLocation({ path: `/app?address=${main.address}`, record: true });
    render(
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={ports}>
          <AppPage loadHealth={() => Promise.resolve({ lastMonitorRunAt: null })} />
        </PortsProvider>
      </Router>,
    );
    await screen.findByRole('article', { name: `Stake account ${shortAddress(kept)}` });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('1 stake account')).toBeInTheDocument();
  });
});
