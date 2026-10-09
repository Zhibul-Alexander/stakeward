import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddressText } from './address-text.tsx';

const ADDRESS = 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW';
const SHORT = 'AYA...DfW';

describe('AddressText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('short (default): shortened text, explorer link to the address on the build cluster (devnet in tests)', () => {
    render(<AddressText address={ADDRESS} />);
    expect(screen.getByText(SHORT)).toBeInTheDocument();
    expect(screen.queryByText(ADDRESS)).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: `View ${SHORT} on Solana Explorer (opens in a new tab)` });
    expect(link).toHaveAttribute('href', `https://explorer.solana.com/address/${ADDRESS}?cluster=devnet`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('copies the full address, not the short one, and says so', async () => {
    const user = userEvent.setup();
    render(<AddressText address={ADDRESS} />);
    await user.click(screen.getByRole('button', { name: `Copy address ${SHORT}` }));
    expect(await navigator.clipboard.readText()).toBe(ADDRESS);
    expect(screen.getByRole('status')).toHaveTextContent('Address copied');
  });

  it('when the clipboard refuses, says how to copy by hand', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('NotAllowedError'));
    render(<AddressText address={ADDRESS} />);
    await user.click(screen.getByRole('button', { name: `Copy address ${SHORT}` }));
    expect(screen.getByRole('status')).toHaveTextContent('Could not copy. Select the address and copy it by hand.');
    expect(screen.getByText('Copy failed')).toBeVisible();
  });

  it('full (signing screens): the whole address as text, copy, no explorer link unless asked', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AddressText address={ADDRESS} variant="full" />);
    expect(screen.getByText(ADDRESS)).toHaveClass('break-all');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Copy address ${SHORT}` }));
    expect(await navigator.clipboard.readText()).toBe(ADDRESS);

    rerender(<AddressText address={ADDRESS} variant="full" explorer />);
    expect(screen.getByRole('link')).toHaveAttribute('href', `https://explorer.solana.com/address/${ADDRESS}?cluster=devnet`);
  });

  // The recovery card is printed: paper cannot copy or open a link (DECISIONS.md D77).
  it('hides the copy and explorer buttons in print', () => {
    render(<AddressText address={ADDRESS} variant="full" explorer />);
    expect(screen.getByRole('button', { name: `Copy address ${SHORT}` })).toHaveClass('print:hidden');
    expect(screen.getByRole('link')).toHaveClass('print:hidden');
    expect(screen.getByText(ADDRESS)).not.toHaveClass('print:hidden');
  });

  it('kind="tx" links a transaction signature; mainnet links carry no cluster parameter', () => {
    const signature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
    render(<AddressText address={signature} kind="tx" cluster="mainnet" copy={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', `https://explorer.solana.com/tx/${signature}`);
  });
});
