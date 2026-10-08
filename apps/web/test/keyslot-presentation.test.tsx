// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner } from '@solana/kit';
import type { ChainPort } from '@stakeward/core';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { KeySlot } from '@/pages/app/KeySlot';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  PortsProvider,
  StaticWalletRegistry,
  type Ports,
} from '@/ports';
import { createFakeApi } from './support/fake-api.ts';

// KeySlot passes WalletSlot's presentation props (emphasis, layout, connectLabel) through in every state (D109); they
// change how the slot looks, never what it connects.

/** KeySlot reads no chain. */
const noChain = {} as unknown as ChainPort;

function setup(wallet: TestWalletPort): Ports {
  return {
    chain: noChain,
    wallets: new StaticWalletRegistry([wallet]),
    slots: createSlotStore(null),
    secondKeys: createSecondKeyMemory(null),
    protectedAccounts: createProtectedAccountMemory(null),
    api: createFakeApi(),
  };
}

describe('KeySlot presentation props', () => {
  it('empty: the label and emphasis reach the Connect button; inline, then connected: one line with Disconnect', async () => {
    const main = await generateKeyPairSigner();
    const wallet = await createTestWalletPort({ name: 'Main Wallet', signers: [main] });
    const ports = setup(wallet);
    render(
      <PortsProvider ports={ports}>
        <KeySlot role="main" layout="inline" emphasis="primary" connectLabel="Connect main key" description="Connecting signs nothing." />
      </PortsProvider>,
    );
    const group = screen.getByRole('group', { name: 'Main key' });
    expect(group).toHaveAttribute('data-layout', 'inline');
    const connect = within(group).getByRole('button', { name: 'Connect main key' });
    expect(connect).toHaveAttribute('data-variant', 'primary');
    await userEvent.click(connect);
    await userEvent.click(within(group).getByRole('button', { name: 'Main Wallet' }));

    expect(ports.slots.getSnapshot().main).toEqual({ walletId: wallet.id, address: main.address });
    const connected = await screen.findByRole('group', { name: 'Main key' });
    expect(connected).toHaveAttribute('data-status', 'connected');
    expect(connected).toHaveAttribute('data-layout', 'inline');
    await userEvent.click(within(connected).getByRole('button', { name: 'Disconnect Main Wallet from Main key' }));
    expect(ports.slots.getSnapshot().main).toBeNull();
  });

  it('a refused account still shows the full card in the inline layout, with the same words as before', async () => {
    const main = await generateKeyPairSigner();
    const wallet = await createTestWalletPort({ name: 'Main Wallet', signers: [main] });
    const ports = setup(wallet);
    render(
      <PortsProvider ports={ports}>
        <KeySlot role="second" mainKey={main.address} layout="inline" connectLabel="Connect second key" />
      </PortsProvider>,
    );
    const group = screen.getByRole('group', { name: 'Second key' });
    await userEvent.click(within(group).getByRole('button', { name: 'Connect second key' }));
    await userEvent.click(within(group).getByRole('button', { name: 'Main Wallet' }));

    const card = await screen.findByRole('group', { name: 'Second key' });
    expect(within(card).getByText('This account is already your Main key.')).toBeInTheDocument();
    expect(within(card).getByText('Switch to your second account in the wallet, then press Continue.')).toBeInTheDocument();
    expect(card).not.toHaveAttribute('data-layout');
    expect(ports.slots.getSnapshot().second).toBeNull();
  });
});
