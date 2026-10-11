import '@testing-library/jest-dom/vitest';
import { address } from '@solana/kit';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  PortsProvider,
  StaticWalletRegistry,
  type Ports,
} from '@/ports';
import { ForgetKeys } from './ForgetKeys.tsx';

const MAIN = address('Stake11111111111111111111111111111111111111');
const SECOND = address('Vote111111111111111111111111111111111111111');

function ports(): Ports {
  return {
    chain: {} as Ports['chain'],
    wallets: new StaticWalletRegistry([]),
    slots: createSlotStore(null),
    secondKeys: createSecondKeyMemory(null),
    protectedAccounts: createProtectedAccountMemory(null),
    api: {} as Ports['api'],
  };
}

describe('ForgetKeys', () => {
  it('is hidden when this browser remembers no key', () => {
    render(
      <PortsProvider ports={ports()}>
        <ForgetKeys />
      </PortsProvider>,
    );
    expect(screen.queryByRole('button', { name: en.app.forgetKeys.button })).not.toBeInTheDocument();
  });

  it('clears every slot and the remembered second keys, a key kept as Second key included', async () => {
    const p = ports();
    p.slots.assign('main', { walletId: 'phantom', address: MAIN });
    p.slots.assign('second', { walletId: 'phantom', address: SECOND });
    p.secondKeys.remember(SECOND);
    render(
      <PortsProvider ports={p}>
        <ForgetKeys />
      </PortsProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: en.app.forgetKeys.button }));
    expect(p.slots.getSnapshot()).toEqual({ main: null, second: null, new: null });
    expect(p.secondKeys.getSnapshot()).toEqual([]);
    expect(screen.queryByRole('button', { name: en.app.forgetKeys.button })).not.toBeInTheDocument();
  });
});
