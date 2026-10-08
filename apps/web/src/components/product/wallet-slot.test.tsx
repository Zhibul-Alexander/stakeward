import { address } from '@solana/kit';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WalletSlot } from './wallet-slot.tsx';

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

  it('the Connect button is outline by default and primary only when connecting is the step\'s main action', () => {
    const { rerender } = render(<WalletSlot role="main" status="empty" wallets={WALLETS} onConnect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Connect a wallet as Main key' })).toHaveAttribute('data-variant', 'outline');
    rerender(<WalletSlot role="main" status="empty" wallets={WALLETS} onConnect={vi.fn()} emphasis="primary" />);
    expect(screen.getByRole('button', { name: 'Connect a wallet as Main key' })).toHaveAttribute('data-variant', 'primary');
  });

  // WCAG 2.5.3: the accessible name holds the visible text.
  it('connectLabel is the visible text; the name adds the role only when the label does not say it', () => {
    const { rerender } = render(
      <WalletSlot role="main" status="empty" wallets={WALLETS} onConnect={vi.fn()} connectLabel="Connect main key" />,
    );
    const named = screen.getByRole('button', { name: 'Connect main key' });
    expect(named).not.toHaveAttribute('aria-label');
    expect(named).toHaveTextContent('Connect main key');
    rerender(<WalletSlot role="main" status="empty" wallets={WALLETS} onConnect={vi.fn()} connectLabel="or connect a wallet" />);
    const other = screen.getByRole('button', { name: 'or connect a wallet as Main key' });
    expect(other).toHaveTextContent('or connect a wallet');
  });

  it('inline and empty: only the Connect button with its wallet list, in a group named by the role', async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    render(
      <WalletSlot
        role="second"
        status="empty"
        wallets={WALLETS}
        onConnect={onConnect}
        layout="inline"
        description="Connecting signs nothing."
        connectLabel="Connect second key"
      />,
    );
    const group = screen.getByRole('group', { name: 'Second key' });
    expect(group).toHaveAttribute('data-layout', 'inline');
    expect(within(group).queryByText('Not connected')).toBeNull();
    expect(within(group).queryByText('Connecting signs nothing.')).toBeNull();
    await user.click(within(group).getByRole('button', { name: 'Connect second key' }));
    await user.click(screen.getByRole('button', { name: 'Alpha Wallet' }));
    expect(onConnect).toHaveBeenCalledWith('alpha');
  });

  it('inline and connected: one line with the role, the wallet, the short address and Disconnect', async () => {
    const user = userEvent.setup();
    const onDisconnect = vi.fn();
    render(<WalletSlot role="main" status="connected" wallet={ALPHA} address={MAIN} onDisconnect={onDisconnect} layout="inline" />);
    const group = screen.getByRole('group', { name: 'Main key' });
    expect(group).toHaveTextContent(/^Main key\s*Alpha Wallet\s*B1a\.\.\.Xu8/);
    await user.click(within(group).getByRole('button', { name: 'Disconnect Alpha Wallet from Main key' }));
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it('inline still shows the full card for an error or a wrong account: they need their words', () => {
    const { rerender } = render(
      <WalletSlot role="new" status="error" wallet={BETA} message="The wallet did not answer." onRetry={vi.fn()} onCancel={vi.fn()} layout="inline" />,
    );
    expect(screen.getByRole('group', { name: 'New wallet' })).not.toHaveAttribute('data-layout');
    expect(screen.getByRole('alert')).toHaveTextContent('The wallet did not answer.');
    rerender(
      <WalletSlot role="second" status="wrong-account" wallet={ALPHA} address={MAIN} conflictRole="main" onContinue={vi.fn()} onDisconnect={vi.fn()} layout="inline" />,
    );
    expect(screen.getByText('Switch to your second account in the wallet, then press Continue.')).toBeInTheDocument();
  });
});
