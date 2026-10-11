import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ChallengePage from './ChallengePage.tsx';
import { CHALLENGE } from './wallet.ts';

const SECRET = 'published-main-key';

describe('ChallengePage (D133)', () => {
  it('shows the main key in full, the lock date and the way to check it live; the second key only as an address', async () => {
    render(<ChallengePage load={() => Promise.resolve(SECRET)} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Try to steal it' })).toBeInTheDocument();
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(screen.getAllByText('12 October 2027').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'See the lock live' })).toHaveAttribute('href', `/proof/${CHALLENGE.mainKey}`);
    expect(screen.getByRole('link', { name: 'Simulate a theft' })).toHaveAttribute('href', `/try-steal/${CHALLENGE.stakeAccount}`);
    expect(screen.getByRole('link', { name: 'Open in Solana Explorer' })).toHaveAttribute(
      'href',
      `https://explorer.solana.com/address/${CHALLENGE.stakeAccount}?cluster=devnet`,
    );
  });

  it('says so when the key cannot be loaded, and loads it again on retry', async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValue(SECRET);
    render(<ChallengePage load={load} />);
    expect(await screen.findByText('Could not load the key')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
