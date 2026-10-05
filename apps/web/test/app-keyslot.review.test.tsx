// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address } from '@solana/kit';
import type { ChainPort } from '@stakeward/core';
import { createTestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { act, render, screen, within } from '@testing-library/react';
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

// Review (security lens, CLAUDE.md section 6: three slots by role; "Switch to your ... account in the wallet, then
// press Continue"). A filled Main key slot whose wallet now offers a different account shows that slot's address and
// "Switch to your main account in the wallet, then press Continue". Pressing Continue while the wallet still offers
// the other account must not silently make that other account the Main key.

/** Reads nothing: the page only needs an empty stake list and a clock. */
const emptyChain = {
  findStakeAccounts: () => Promise.resolve({ slot: 1n, accounts: [] }),
  getClock: () => Promise.resolve({ unixTimestamp: 1_800_000_000n, epoch: 900n, slot: 1n }),
} as unknown as ChainPort;

describe('review: KeySlot Continue on a Main key slot whose account the wallet does not offer', () => {
  it('keeps the Main key when the wallet still offers another account', async () => {
    const [a, b] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const wallet = await createTestWalletPort({ name: 'Two Accounts', signers: [a, b], exposed: [a.address], connected: true });
    const ports: Ports = {
      chain: emptyChain,
      wallets: new StaticWalletRegistry([wallet]),
      slots: createSlotStore(null),
      secondKeys: createSecondKeyMemory(null),
      protectedAccounts: createProtectedAccountMemory(null),
      api: createFakeApi(),
    };
    expect(ports.slots.assign('main', { walletId: wallet.id, address: a.address })).toEqual({ ok: true });
    const location = memoryLocation({ path: '/app', record: true });
    render(
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={ports}>
          <AppPage loadHealth={() => Promise.resolve({ lastMonitorRunAt: null })} />
        </PortsProvider>
      </Router>,
    );

    // The user switches the wallet to its other account (for example to use it elsewhere).
    act(() => {
      wallet.setExposedAccounts([b.address]);
    });
    const slot = screen.getByRole('group', { name: 'Main key' });
    expect(within(slot).getByText('Switch to your main account in the wallet, then press Continue.')).toBeInTheDocument();

    // Continue without switching back: the wallet still offers B only.
    await userEvent.click(within(slot).getByRole('button', { name: 'Continue' }));

    const main: Address | undefined = ports.slots.getSnapshot().main?.address;
    expect(main, 'the Main key slot silently changed to the other account').toBe(a.address);
    expect(location.history.at(-1) ?? '').not.toContain(b.address);
  });
});
