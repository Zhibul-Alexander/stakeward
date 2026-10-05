// Review (step 3, /app "Last checked N min ago", UX rule 12): /api/health is read once per page load (or Refresh),
// while the age keeps growing with the local clock every 30 s. A page left open for 10 minutes turns the line red
// ("Alerts may be late") although the monitor ran every 2 minutes the whole time: a false alarm on the trust line.
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner } from '@solana/kit';
import type { ChainPort } from '@stakeward/core';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Health } from '@/api/health';
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

afterEach(() => {
  vi.useRealTimers();
});

describe('review: /app monitoring line on a page left open', () => {
  it('does not turn red while the monitor keeps running', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const address = (await generateKeyPairSigner()).address;
    const unused = () => Promise.reject(new Error('not used'));
    const chain: ChainPort = {
      getAccounts: unused,
      getLatestBlockhash: unused,
      getBlockHeight: unused,
      getBalance: unused,
      getMinimumBalanceForRentExemption: unused,
      simulate: unused,
      send: unused,
      getSignatureStatuses: unused,
      getClock: () => Promise.resolve({ slot: 1n, epoch: 1n, unixTimestamp: 1_790_812_800n }),
      findStakeAccounts: () => Promise.resolve({ slot: 1n, accounts: [] }),
    };
    // The monitor runs every 2 minutes: whenever the page asks, the last pass is at most 2 minutes old.
    const loadHealth = vi.fn((): Promise<Health> => Promise.resolve({ lastMonitorRunAt: new Date(Date.now() - 60_000) }));
    const ports: Ports = {
      chain,
      wallets: new StaticWalletRegistry([]),
      slots: createSlotStore(null),
      secondKeys: createSecondKeyMemory(null),
      protectedAccounts: createProtectedAccountMemory(null),
      api: createFakeApi(),
    };
    const location = memoryLocation({ path: `/app?address=${address}` });
    render(
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={ports}>
          <AppPage loadHealth={loadHealth} />
        </PortsProvider>
      </Router>,
    );
    expect(await screen.findByText('Last checked 1 min ago')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(12 * 60_000);
      await Promise.resolve();
    });
    const line = document.querySelector('[data-slot="monitoring"]');
    expect(line).not.toHaveAttribute('data-state', 'stale');
  });
});
