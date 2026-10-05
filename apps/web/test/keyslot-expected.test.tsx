// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type KeyPairSigner } from '@solana/kit';
import type { ChainPort } from '@stakeward/core';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { act, render, screen, within } from '@testing-library/react';
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

// KeySlot `expected` (step 6 spec 4.1): a signing step names its signer, so only that account fills the slot. A wallet
// that offers other accounts is told which one this step needs; a slot already holding another account offers only
// Disconnect (D35: replacing a key is Disconnect, then Connect). No wallet is ever asked to sign here.

/** KeySlot reads no chain. */
const noChain = {} as unknown as ChainPort;

const EXPECTED_TEXT = 'This step needs this account. Switch to it in the wallet:';
/** A filled slot keeps its account whatever the wallet offers: the way to the expected one is Disconnect, then Connect. */
const RECONNECT_TEXT = 'This step needs this account. Disconnect, then connect again with this account:';

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

function show(ports: Ports, slot: { role: 'main' | 'second'; expected: KeyPairSigner; mainKey?: KeyPairSigner }) {
  render(
    <PortsProvider ports={ports}>
      <KeySlot role={slot.role} expected={slot.expected.address} mainKey={slot.mainKey?.address} />
    </PortsProvider>,
  );
  return screen.getByRole('group', { name: slot.role === 'main' ? 'Main key' : 'Second key' });
}

async function connect(group: HTMLElement, role: string, wallet: string) {
  await userEvent.click(within(group).getByRole('button', { name: `Connect a wallet as ${role}` }));
  await userEvent.click(within(group).getByRole('button', { name: wallet }));
}

describe('KeySlot expected', () => {
  it('takes the expected account even when the wallet offers another one first', async () => {
    const [other, main] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const wallet = await createTestWalletPort({ name: 'Two Accounts', signers: [other, main] });
    const ports = setup(wallet);
    const group = show(ports, { role: 'main', expected: main });

    await connect(group, 'Main key', 'Two Accounts');

    expect(ports.slots.getSnapshot().main).toEqual({ walletId: wallet.id, address: main.address });
    expect(await within(group).findByText('Connected')).toBeInTheDocument();
    expect(wallet.requests).toHaveLength(0);
  });

  it('a wallet that offers only another account: names the expected one in full; Continue after switching takes it', async () => {
    const [other, main] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const wallet = await createTestWalletPort({ name: 'One At A Time', signers: [other, main], exposed: [other.address] });
    const ports = setup(wallet);
    const group = show(ports, { role: 'main', expected: main });

    await connect(group, 'Main key', 'One At A Time');

    expect(await within(group).findByText(EXPECTED_TEXT)).toBeInTheDocument();
    expect(within(group).getByText(main.address)).toBeInTheDocument();
    expect(ports.slots.getSnapshot().main).toBeNull();

    // Continue while the wallet still offers the other account: nothing is taken.
    await userEvent.click(within(group).getByRole('button', { name: 'Continue' }));
    expect(ports.slots.getSnapshot().main).toBeNull();
    expect(within(group).getByText(EXPECTED_TEXT)).toBeInTheDocument();

    // The user switches the wallet to the expected account, then presses Continue.
    act(() => {
      wallet.setExposedAccounts([main.address]);
    });
    await userEvent.click(within(group).getByRole('button', { name: 'Continue' }));
    expect(ports.slots.getSnapshot().main).toEqual({ walletId: wallet.id, address: main.address });
    expect(wallet.requests).toHaveLength(0);
  });

  it('a slot that holds another account: says which one this step needs and offers only Disconnect', async () => {
    const [other, main] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const wallet = await createTestWalletPort({ name: 'Two Accounts', signers: [other, main], connected: true });
    const ports = setup(wallet);
    expect(ports.slots.assign('main', { walletId: wallet.id, address: other.address })).toEqual({ ok: true });
    const group = show(ports, { role: 'main', expected: main });

    expect(within(group).getByText(RECONNECT_TEXT)).toBeInTheDocument();
    expect(within(group).queryByText(EXPECTED_TEXT)).not.toBeInTheDocument();
    expect(within(group).getByText(main.address)).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    // Switching in the wallet changes nothing here: the slot holds its account.
    act(() => {
      wallet.setExposedAccounts([main.address]);
    });
    expect(within(group).getByText(RECONNECT_TEXT)).toBeInTheDocument();
    expect(ports.slots.getSnapshot().main).toEqual({ walletId: wallet.id, address: other.address });

    await userEvent.click(within(group).getByRole('button', { name: 'Disconnect Two Accounts from Main key' }));
    expect(ports.slots.getSnapshot().main).toBeNull();
    expect(within(group).getByRole('button', { name: 'Connect a wallet as Main key' })).toBeInTheDocument();

    // Connect again: the expected account fills the slot, not the one it held before.
    await connect(group, 'Main key', 'Two Accounts');
    expect(ports.slots.getSnapshot().main).toEqual({ walletId: wallet.id, address: main.address });
    expect(wallet.requests).toHaveLength(0);
  });

  it('the expected account already filling another role is a conflict, never moved', async () => {
    const [main, second] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const wallet = await createTestWalletPort({ name: 'Two Accounts', signers: [main, second] });
    const ports = setup(wallet);
    const group = show(ports, { role: 'second', expected: main, mainKey: main });

    await connect(group, 'Second key', 'Two Accounts');

    expect(await within(group).findByText('This account is already your Main key.')).toBeInTheDocument();
    expect(ports.slots.getSnapshot().second).toBeNull();
  });
});
