import { address, type Address } from '@solana/kit';
import { setupCheck, type StakeAccount } from '@stakeward/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProtectionCheck, type ProtectionCheckLinks } from './protection-check.tsx';

const MAIN = address('B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8');
const SECOND = address('9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi');
const STAKE = address('AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW');
const NOW = 1_800_000_000n;
const clock = { unixTimestamp: NOW, epoch: 900n };

const LINKS: ProtectionCheckLinks = {
  protect: (accounts) => `/protect?${accounts.map((a) => `account=${a}`).join('&')}`,
  extend: (account) => `/extend/${account}`,
  rescue: `/rescue?address=${MAIN}`,
  rescueKit: '/rescue-kit',
  telegram: `/api/telegram/link?wallet=${MAIN}`,
  recovery: (account) => `/recovery/${account}`,
};

const account = (custodian: Address): StakeAccount => ({
  address: STAKE,
  lamports: 10_000_000_000n,
  kind: 'initialized',
  rentExemptReserve: 2_282_880n,
  staker: MAIN,
  withdrawer: MAIN,
  lockup: { unixTimestamp: NOW + 200n * 86_400n, epoch: 0n, custodian },
  delegation: null,
});

describe('ProtectionCheck', () => {
  it('ready: the score in the heading line, every check by word, passing ones folded', () => {
    const result = setupCheck({ mainKey: MAIN, accounts: [account(SECOND)], clock, knownSecondKeys: [SECOND], rescueKits: { [STAKE]: 'ready' } });
    render(<ProtectionCheck state="ready" result={result} links={LINKS} />);
    const region = screen.getByRole('region', { name: 'Protection check' });
    expect(within(region).getByText('5 of 5 checks pass')).toBeInTheDocument();
    expect(within(region).getAllByText('Pass')).toHaveLength(5);
    expect(within(region).getByText('Unknown')).toBeInTheDocument();
    expect(within(region).getByText('Reminder')).toBeInTheDocument();
    expect([...region.querySelectorAll('details')].filter((d) => d.open)).toEqual([]);
  });

  it('a folded check opens to its sentence and its per-account links', async () => {
    const result = setupCheck({ mainKey: MAIN, accounts: [account(SECOND)], clock, knownSecondKeys: [SECOND], rescueKits: {} });
    const { container } = render(<ProtectionCheck state="ready" result={result} links={LINKS} />);
    const details = container.querySelector<HTMLDetailsElement>('[data-check="recovery-card"] details');
    const summary = details?.querySelector('summary');
    if (details == null || summary == null) throw new Error('no fold');
    expect(details.open).toBe(false);
    await userEvent.click(summary);
    expect(details.open).toBe(true);
    expect(within(details).getByText(/Print the recovery card of each lock/)).toBeVisible();
    expect(within(details).getByRole('link', { name: /Recovery card for stake account/ })).toHaveAttribute('href', `/recovery/${STAKE}`);
  });

  it('loading, error and empty states', async () => {
    const { rerender } = render(<ProtectionCheck state="loading" />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking how this stake is protected');

    const onRetry = vi.fn();
    rerender(<ProtectionCheck state="error" message="The network did not answer." detail="HTTP 503" onRetry={onRetry} />);
    expect(screen.getByText('Could not run the protection check')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalledOnce();

    const empty = setupCheck({ mainKey: MAIN, accounts: [], clock, knownSecondKeys: [], rescueKits: {} });
    rerender(<ProtectionCheck state="ready" result={empty} links={LINKS} />);
    expect(screen.getByText('Nothing to check yet')).toBeInTheDocument();
    expect(screen.getByText('Nothing to score yet')).toBeInTheDocument();
  });
});
