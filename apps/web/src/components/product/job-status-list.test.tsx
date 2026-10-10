import type { Address, Signature } from '@solana/kit';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JobStatusList, type JobStatus, type JobStatusItem } from './job-status-list.tsx';

const STAKE = 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW' as Address;
const STAKE_SHORT = 'AYA9...9DfW';
const STAKE_2 = '2Xtq6iZ2mXjxTNsv5FrYCzayG5qYRJwZ6837A1X3TjF6' as Address;
const SIGNATURE = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW' as Signature;
const SIGNATURE_SHORT = '5VER...kQUW';

// UX rule 5: every status is a word, a colour (tone) and an icon, never colour alone.
const EXPECTED: [JobStatus, string, string][] = [
  ['waiting', 'Waiting', 'outline'],
  ['sending', 'Sending', 'info'],
  ['confirming', 'Confirming', 'info'],
  ['checking', 'Checking', 'info'],
  ['done', 'Done', 'success'],
  ['failed', 'Did not go through', 'danger'],
  ['expired', 'Expired, nothing changed', 'warning'],
  ['unknown', 'Not confirmed yet', 'warning'],
  ['not-sent', 'Not sent', 'neutral'],
  ['left-out', 'Left out', 'neutral'],
];

function list(items: readonly JobStatusItem[]) {
  return render(<JobStatusList items={items} label="Stake accounts" />);
}

describe('JobStatusList', () => {
  it.each(EXPECTED)('%s: shows the word "%s", tone %s and a decorative icon', (status, word, tone) => {
    list([{ address: STAKE, status }]);
    const entry = within(screen.getByRole('list', { name: 'Stake accounts' })).getByRole('listitem');
    expect(entry).toHaveAttribute('data-status', status);
    const badge = within(entry).getByText(word);
    expect(badge).toHaveAttribute('data-tone', tone);
    expect(badge).toHaveTextContent(new RegExp(`^${word}$`));
    const icons = badge.querySelectorAll('svg');
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives every status its own icon', () => {
    const classes = EXPECTED.map(([status]) => {
      const { container, unmount } = list([{ address: STAKE, status }]);
      const icon = container.querySelector('[data-slot="badge"] svg')?.getAttribute('class') ?? '';
      unmount();
      return icon;
    });
    expect(new Set(classes).size).toBe(EXPECTED.length);
  });

  it('each stake account: short address with copy and explorer, the reason, Details and the transaction link', () => {
    list([
      {
        address: STAKE,
        status: 'failed',
        reason: 'Too many requests right now. Wait a minute, then try again.',
        detail: 'HTTP 429 Too Many Requests',
        signature: SIGNATURE,
      },
      { address: STAKE_2, status: 'done', signature: null },
    ]);
    const [failed, done] = within(screen.getByRole('list', { name: 'Stake accounts' })).getAllByRole('listitem') as [
      HTMLElement,
      HTMLElement,
    ];

    expect(within(failed).getByText(STAKE_SHORT)).toBeInTheDocument();
    expect(within(failed).getByRole('button', { name: `Copy address ${STAKE_SHORT}` })).toBeInTheDocument();
    expect(
      within(failed).getByRole('link', { name: `View ${STAKE_SHORT} on Solana Explorer (opens in a new tab)` }),
    ).toHaveAttribute('href', `https://explorer.solana.com/address/${STAKE}?cluster=devnet`);
    expect(within(failed).getByText('Too many requests right now. Wait a minute, then try again.')).toBeInTheDocument();
    // The raw error stays under "Details" (UX rule 8).
    expect(within(failed).getByText('Details').closest('details')).not.toHaveAttribute('open');
    expect(within(failed).getByText('HTTP 429 Too Many Requests')).toBeInTheDocument();
    expect(within(failed).getByText('Transaction')).toBeInTheDocument();
    expect(
      within(failed).getByRole('link', { name: `View ${SIGNATURE_SHORT} on Solana Explorer (opens in a new tab)` }),
    ).toHaveAttribute('href', `https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet`);

    // Without a reason, detail or signature, none of those lines appear.
    expect(within(done).queryByText('Details')).not.toBeInTheDocument();
    expect(within(done).queryByText('Transaction')).not.toBeInTheDocument();
    expect(within(done).getAllByRole('link')).toHaveLength(1);
    expect(done.querySelectorAll('p')).toHaveLength(0);
  });
});
