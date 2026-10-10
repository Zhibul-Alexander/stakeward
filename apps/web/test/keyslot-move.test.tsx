// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner } from '@solana/kit';
import type { ChainPort } from '@stakeward/core';
import { createTestWalletPort } from '@stakeward/core/test/test-wallet-port';
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

// A wallet offers only the key this device keeps as Second key, and the user wants it as Main key: the conflict offers
// "Use it as Main key instead", which lets the second key slot go first. The key never changes role without that click.

const noChain = {} as unknown as ChainPort;

describe('KeySlot: a key kept in another role', () => {
  it('moves to this role only on "Use it as … instead"; the other slot lets it go', async () => {
    const key = await generateKeyPairSigner();
    const wallet = await createTestWalletPort({ name: 'Phantom', signers: [key] });
    const ports: Ports = {
      chain: noChain,
      wallets: new StaticWalletRegistry([wallet]),
      slots: createSlotStore(null),
      secondKeys: createSecondKeyMemory(null),
      protectedAccounts: createProtectedAccountMemory(null),
      api: createFakeApi(),
    };
    ports.slots.assign('second', { walletId: wallet.id, address: key.address });
    render(
      <PortsProvider ports={ports}>
        <KeySlot role="main" />
      </PortsProvider>,
    );
    const group = screen.getByRole('group', { name: 'Main key' });
    await userEvent.click(within(group).getByRole('button', { name: 'Connect a wallet as Main key' }));
    await userEvent.click(within(group).getByRole('button', { name: 'Phantom' }));

    expect(await within(group).findByText('This account is already your Second key.')).toBeInTheDocument();
    expect(ports.slots.getSnapshot()).toMatchObject({ main: null, second: { address: key.address } });

    await userEvent.click(within(group).getByRole('button', { name: 'Use it as Main key instead' }));
    expect(ports.slots.getSnapshot()).toMatchObject({ main: { address: key.address }, second: null });
    expect(await within(group).findByText('Connected')).toBeInTheDocument();
  });
});
