// Review (step 3, /app "Is this lock yours? Connect your second key"): KeySlot only refuses an address that already
// fills another slot. On /app?address=A (UX rule 1: look first, no main key connected) the viewed main key A is in no
// slot, so a wallet that offers A takes the Second key slot with A. Worse, KeySlot picks the wallet's FIRST free
// account, so a wallet that shares both of the user's accounts (main A first, second K) always fills the slot with A.
// Then A is the only known second key and the user's own lock (held by K) turns "Locked by a second key", view only.
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { shortAddress } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort } from '@stakeward/core/test/test-wallet-port';
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

describe('review: /app second key slot', () => {
  it('never fills the Second key slot with the main key being viewed', async () => {
    const testChain = await TestChain.create();
    const [main, K] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const stake = await testChain.createStakeAccount({
      staker: main.address,
      withdrawer: main.address,
      lockup: { unixTimestamp: START_UNIX_TIMESTAMP + 100n * 86_400n, epoch: 0n, custodian: K.address },
    });
    // One wallet app with both of the user's accounts, the main one listed first (Backpack, Solflare multi-account).
    const wallet = await createTestWalletPort({ name: 'Both Accounts', signers: [main, K] });
    const ports: Ports = {
      chain: new LiteSvmChain(testChain),
      wallets: new StaticWalletRegistry([wallet]),
      slots: createSlotStore(null),
      secondKeys: createSecondKeyMemory(null),
      protectedAccounts: createProtectedAccountMemory(null),
      api: createFakeApi(),
    };
    const location = memoryLocation({ path: `/app?address=${main.address}` });
    render(
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={ports}>
          <AppPage loadHealth={() => Promise.resolve({ lastMonitorRunAt: null })} />
        </PortsProvider>
      </Router>,
    );
    const row = await screen.findByRole('article', { name: `Stake account ${shortAddress(stake)}` });
    // No second key known yet: the lock is not called the viewer's (D14; fix round of step 3).
    expect(row).toHaveAttribute('data-status', 'locked-by-other');

    const heading = screen.getByRole('heading', { level: 2, name: 'Is this lock yours?' });
    const section = within(heading.closest('section') as HTMLElement);
    await userEvent.click(section.getByRole('button', { name: 'Connect a wallet as Second key' }));
    await userEvent.click(section.getByRole('button', { name: 'Both Accounts' }));

    await waitFor(() => {
      expect(ports.slots.getSnapshot().second).not.toBeNull();
    });
    expect(ports.slots.getSnapshot().second?.address).not.toBe(main.address);
    // The user's own lock must not turn into someone else's: with K connected it is Protected.
    await waitFor(() => {
      expect(screen.getByRole('article', { name: `Stake account ${shortAddress(stake)}` })).toHaveAttribute(
        'data-status',
        'protected',
      );
    });
  });
});
