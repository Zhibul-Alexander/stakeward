import { generateKeyPairSigner } from '@solana/kit';
import { createTestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  PortsProvider,
  StaticWalletRegistry,
  useChain,
  useKnownSecondKeys,
  useSlot,
  useWallets,
  type Ports,
} from '@/ports';

function Probe() {
  const wallets = useWallets();
  const second = useSlot('second');
  const known = useKnownSecondKeys();
  const chain = useChain();
  return (
    <ul>
      <li>wallets: {wallets.map((wallet) => wallet.name).join(',')}</li>
      <li>second: {second === null ? 'empty' : second.ready ? 'ready' : 'not ready'}</li>
      <li>known: {known.length}</li>
      <li>chain: {typeof chain.getClock}</li>
    </ul>
  );
}

describe('ports in React', () => {
  it('re-renders when slots, wallet accounts or remembered second keys change', async () => {
    const [main, second, remembered] = await Promise.all([1, 2, 3].map(() => generateKeyPairSigner()));
    if (main === undefined || second === undefined || remembered === undefined) throw new Error('keys');
    const wallet = await createTestWalletPort({ name: 'Solflare', signers: [main, second], exposed: [main.address] });
    const ports: Ports = {
      chain: { getClock: () => Promise.reject(new Error('unused')) } as unknown as Ports['chain'],
      wallets: new StaticWalletRegistry([wallet]),
      slots: createSlotStore(null),
      secondKeys: createSecondKeyMemory(null),
      protectedAccounts: createProtectedAccountMemory(null),
    };
    render(
      <PortsProvider ports={ports}>
        <Probe />
      </PortsProvider>,
    );
    screen.getByText('wallets: Solflare');
    screen.getByText('second: empty');
    screen.getByText('chain: function');

    act(() => {
      ports.slots.assign('second', { walletId: 'Solflare', address: second.address });
    });
    screen.getByText('second: not ready');
    screen.getByText('known: 0');

    await act(async () => {
      await wallet.connect();
      wallet.setExposedAccounts([second.address]); // the user switched to the second account
    });
    screen.getByText('second: ready');
    screen.getByText('known: 1');

    act(() => {
      ports.secondKeys.remember(remembered.address);
    });
    screen.getByText('known: 2');
  });

  it('usePorts outside the provider is a clear error', () => {
    expect(() => render(<Probe />)).toThrow(/PortsProvider/);
  });
});
