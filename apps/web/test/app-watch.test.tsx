// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { buildTransaction, shortAddress } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
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
import { createFakeApi, type FakeApi } from './support/fake-api.ts';

// /app takes the confirmed locks of the connected main key under monitoring (POST /api/watch), each once per page. A
// view by address posts nothing: viewing a stranger's stake must not make this browser report it.

const DAY = 86_400n;
const lock = (custodian: Address, days = 100n) => ({ unixTimestamp: START_UNIX_TIMESTAMP + days * DAY, epoch: 0n, custodian });

describe('/app turns on monitoring for the connected main key', () => {
  let testChain: TestChain;
  let chain: LiteSvmChain;
  let main: KeyPairSigner;
  let K: KeyPairSigner;
  let mainWallet: TestWalletPort;
  const stake = {} as Record<'locked' | 'expiring' | 'open' | 'foreign', Address>;

  beforeEach(async () => {
    testChain = await TestChain.create();
    chain = new LiteSvmChain(testChain);
    [main, K] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner()]);
    const A = main.address;
    const stranger = (await generateKeyPairSigner()).address;
    stake.locked = await testChain.createStakeAccount({ staker: A, withdrawer: A, lockup: lock(K.address) });
    stake.expiring = await testChain.createStakeAccount({ staker: A, withdrawer: A, lockup: lock(K.address, 10n) });
    stake.open = await testChain.createStakeAccount({ staker: A, withdrawer: A });
    stake.foreign = await testChain.createStakeAccount({ staker: A, withdrawer: A, lockup: lock(stranger) });
    mainWallet = await createTestWalletPort({ name: 'Main Wallet', signers: [main], connected: true });
  });

  function renderApp(path: string, options: { mainSlot: boolean; api?: FakeApi }): { ports: Ports; api: FakeApi } {
    const api = options.api ?? createFakeApi(chain);
    const ports: Ports = {
      chain,
      wallets: new StaticWalletRegistry([mainWallet]),
      slots: createSlotStore(null),
      secondKeys: createSecondKeyMemory(null),
      protectedAccounts: createProtectedAccountMemory(null),
      api,
    };
    ports.secondKeys.remember(K.address);
    if (options.mainSlot) ports.slots.assign('main', { walletId: mainWallet.id, address: main.address });
    const location = memoryLocation({ path, record: true });
    render(
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={ports}>
          <AppPage loadHealth={() => Promise.resolve({ lastMonitorRunAt: null })} />
        </PortsProvider>
      </Router>,
    );
    return { ports, api };
  }

  const findRow = (account: Address) => screen.findByRole('article', { name: `Stake account ${shortAddress(account)}` });

  it('posts the locks its second key holds once, then only new ones', async () => {
    const { api } = renderApp('/app', { mainSlot: true });
    await findRow(stake.locked);
    await waitFor(() => {
      expect(api.calls).toHaveLength(1);
    });
    // Protected and expiring locks of a known second key; not the open account, not someone else's lock.
    expect([...(api.calls[0] ?? [])].sort()).toEqual([stake.locked, stake.expiring].sort());
    expect([...api.watched].sort()).toEqual([stake.locked, stake.expiring].sort());

    // A reload of the list posts nothing new.
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await findRow(stake.locked);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.calls).toHaveLength(1);

    // The open account gets locked elsewhere: the next read posts just that one.
    const lifetime = { kind: 'blockhash', ...(await chain.getLatestBlockhash()) } as const;
    const built = buildTransaction(
      { kind: 'protect', stakeAccount: stake.open, mainKey: main.address, secondKey: K.address, lockUntil: START_UNIX_TIMESTAMP + 30n * DAY },
      { feePayer: main.address, lifetime },
    );
    expect((await testChain.send(built.bytes, [main, K])).ok).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(api.calls).toEqual([expect.any(Array), [stake.open]]);
    });
  });

  it('a failed post is silent: the page shows the stake as usual', async () => {
    const api = createFakeApi(chain);
    api.failNext(new TypeError('Failed to fetch'));
    renderApp('/app', { mainSlot: true, api });
    await findRow(stake.locked);
    await waitFor(() => {
      expect(api.calls).toHaveLength(1);
    });
    expect(api.watched.size).toBe(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(4);
  });

  it('a view by address posts nothing', async () => {
    const { api, ports } = renderApp(`/app?address=${main.address}`, { mainSlot: false });
    await findRow(stake.locked);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.calls).toEqual([]);
    expect(ports.protectedAccounts.getSnapshot()).toEqual([]);
  });

  it("viewing another address with the main key connected posts nothing for that address", async () => {
    const other = await testChain.fundedKey();
    const theirs = await testChain.createStakeAccount({ staker: other.address, withdrawer: other.address, lockup: lock(K.address) });
    const { api } = renderApp(`/app?address=${other.address}`, { mainSlot: true });
    await findRow(theirs);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.calls).toEqual([]);
  });
});
