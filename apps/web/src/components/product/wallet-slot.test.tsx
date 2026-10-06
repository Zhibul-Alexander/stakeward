import { address } from '@solana/kit';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RoleNamesProvider, WalletSlot, type RoleNames } from './wallet-slot.tsx';

const ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
const ALPHA = { id: 'alpha', name: 'Alpha Wallet', icon: ICON };
const BETA = { id: 'beta', name: 'Beta Wallet', icon: ICON };
const WALLETS = [ALPHA, BETA];
const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8';
const SECOND = address('9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi');

describe('WalletSlot', () => {
  it('empty: the wallet list opens from the connect button and picking a wallet reports its id', async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    render(<WalletSlot role="second" status="empty" wallets={WALLETS} onConnect={onConnect} />);
    const group = screen.getByRole('group', { name: 'Second key' });
    expect(within(group).getByText('Not connected')).toBeInTheDocument();
    const connect = screen.getByRole('button', { name: 'Connect a wallet as Second key' });
    expect(connect).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Beta Wallet' })).not.toBeInTheDocument();

    await user.click(connect);
    expect(connect).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Beta Wallet' }));
    expect(onConnect).toHaveBeenCalledWith('beta');
  });

  it('empty without wallets explains how to get one', () => {
    render(<WalletSlot role="main" status="empty" wallets={[]} onConnect={vi.fn()} defaultPickerOpen />);
    expect(screen.getByText(/No Solana wallet found in this browser/)).toBeVisible();
  });

  it('connecting has a way out', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<WalletSlot role="main" status="connecting" wallet={ALPHA} onCancel={onCancel} />);
    expect(screen.getByText('Approve the connection in Alpha Wallet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('connected: wallet name, short address, disconnect', async () => {
    const user = userEvent.setup();
    const onDisconnect = vi.fn();
    render(<WalletSlot role="main" status="connected" wallet={ALPHA} address={MAIN} onDisconnect={onDisconnect} />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Alpha Wallet')).toBeInTheDocument();
    expect(screen.getByText('B1a...Xu8')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disconnect Alpha Wallet from Main key' }));
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it('wrong account: says why and how to switch, then Continue', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(
      <WalletSlot
        role="second"
        status="wrong-account"
        wallet={ALPHA}
        address={MAIN}
        conflictRole="main"
        onContinue={onContinue}
        onDisconnect={vi.fn()}
      />,
    );
    expect(screen.getByText('This account is already your Main key.')).toBeInTheDocument();
    expect(screen.getByText('Switch to your second account in the wallet, then press Continue.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('a page may rename a role (RoleNamesProvider): the slot, its buttons and its switch line say the new name; others keep theirs', () => {
    const names: RoleNames = { new: { label: 'common.roles.newSecond', switchAccount: 'components.walletSlot.switch.newSecond' } };
    render(
      <RoleNamesProvider names={names}>
        <WalletSlot role="new" status="wrong-account" wallet={ALPHA} address={MAIN} conflictRole="main" onContinue={vi.fn()} onDisconnect={vi.fn()} />
        <WalletSlot role="second" status="empty" wallets={WALLETS} onConnect={vi.fn()} />
      </RoleNamesProvider>,
    );
    const renamed = screen.getByRole('group', { name: 'New second key' });
    expect(within(renamed).getByText('This account is already your Main key.')).toBeInTheDocument();
    expect(within(renamed).getByText("Switch to your new second key's account in the wallet, then press Continue.")).toBeInTheDocument();
    expect(within(renamed).getByRole('button', { name: 'Disconnect Alpha Wallet from New second key' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'New wallet' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect a wallet as Second key' })).toBeInTheDocument();
  });

  it('without a provider the New wallet slot keeps its name (/rescue)', () => {
    render(<WalletSlot role="new" status="wrong-account" wallet={ALPHA} address={MAIN} onDisconnect={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'New wallet' })).toBeInTheDocument();
    expect(screen.getByText("Switch to your new wallet's account in the wallet, then press Continue.")).toBeInTheDocument();
  });

  it('wrong account with the expected one: names the account this step needs in full, Continue when offered', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const { rerender } = render(
      <WalletSlot
        role="second"
        status="wrong-account"
        wallet={ALPHA}
        address={MAIN}
        expected={SECOND}
        onContinue={onContinue}
        onDisconnect={vi.fn()}
      />,
    );
    expect(screen.getByText('This step needs this account. Switch to it in the wallet:')).toBeInTheDocument();
    expect(screen.getByText(SECOND)).toBeInTheDocument();
    expect(screen.queryByText('Switch to your second account in the wallet, then press Continue.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledOnce();

    // A filled slot that holds another account: only Disconnect.
    const onDisconnect = vi.fn();
    rerender(
      <WalletSlot role="second" status="wrong-account" wallet={ALPHA} address={MAIN} expected={SECOND} onDisconnect={onDisconnect} />,
    );
    expect(screen.getByText('This step needs this account. Disconnect, then connect again with this account:')).toBeInTheDocument();
    expect(screen.queryByText(/Switch to it in the wallet/)).not.toBeInTheDocument();
    expect(screen.getByText(SECOND)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disconnect Alpha Wallet from Second key' }));
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it('error: what happened, details, try again', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <WalletSlot
        role="new"
        status="error"
        wallet={BETA}
        message="The request was declined in the wallet."
        detail="WalletSignTransactionError: User rejected the request."
        onRetry={onRetry}
        onCancel={vi.fn()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not connect Beta Wallet');
    expect(alert).toHaveTextContent('The request was declined in the wallet.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
