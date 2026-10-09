import type { Address } from '@solana/kit';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SignerList, SignerListSkeleton, type SignerListItem, type SignerStatus } from './signer-list.tsx';

const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8' as Address;
const SECOND = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi' as Address;
const NEW_WALLET = '21KaHQkRg8ntwcEF3Q1Y5wooZ1GC372Eu4yFQc5LRRFH' as Address;

// UX rule 5: every status is a word, a colour (tone) and an icon, never colour alone.
const EXPECTED: [SignerStatus, string, string][] = [
  ['waiting', 'Not asked yet', 'outline'],
  ['current', 'Your turn', 'info'],
  ['signed', 'Signed', 'success'],
  ['switch', 'Switch account', 'warning'],
  ['stopped', 'Stopped', 'danger'],
  ['missing', 'Not connected', 'neutral'],
  ['link', 'Signs by link', 'info'],
];

function item(status: SignerStatus): SignerListItem {
  return { role: 'second', walletName: 'Beta Wallet', address: SECOND, count: 2, status };
}

/** UX rule 4: the words custodian, withdrawer and staker never appear on screen (checked per text node). */
function forbiddenRoleWords(): string[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const found: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    if (/\b(?:custodian|withdrawer|staker)s?\b/i.test(text)) found.push(text);
  }
  return found;
}

describe('SignerList', () => {
  it.each(EXPECTED)('%s: shows the word "%s", tone %s and a decorative icon', (status, word, tone) => {
    render(<SignerList items={[item(status)]} />);
    const entry = screen.getByRole('listitem');
    expect(entry).toHaveAttribute('data-status', status);
    const badge = within(entry).getByText(word);
    expect(badge).toHaveAttribute('data-tone', tone);
    expect(badge).toHaveTextContent(new RegExp(`^${word}$`));
    const icons = badge.querySelectorAll('svg');
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true');
    // Only the signer whose turn it is is the current step.
    if (status === 'current') expect(entry).toHaveAttribute('aria-current', 'step');
    else expect(entry).not.toHaveAttribute('aria-current');
  });

  it('gives every status its own icon', () => {
    const classes = EXPECTED.map(([status]) => {
      const { container, unmount } = render(<SignerList items={[item(status)]} />);
      const icon = container.querySelector('[data-slot="badge"] svg')?.getAttribute('class') ?? '';
      unmount();
      return icon;
    });
    expect(new Set(classes).size).toBe(EXPECTED.length);
  });

  it('lists the signers in order: number, role, wallet, FULL address and how many transactions each approves', () => {
    render(
      <SignerList
        items={[
          { role: 'main', walletName: 'Alpha Wallet', address: MAIN, count: 2, status: 'signed' },
          { role: 'second', walletName: 'Beta Wallet', address: SECOND, count: 1, status: 'current' },
          { role: 'new', walletName: null, address: NEW_WALLET, count: 3, status: 'missing' },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Signatures' });
    expect(list.tagName).toBe('OL');
    const entries = within(list).getAllByRole('listitem');
    expect(entries.map((entry) => entry.getAttribute('data-role'))).toEqual(['main', 'second', 'new']);

    const [main, second, fresh] = entries as [HTMLElement, HTMLElement, HTMLElement];
    expect(within(main).getByText('1. Main key in Alpha Wallet')).toBeInTheDocument();
    expect(within(main).getByText('Approves 2 transactions in one request')).toBeInTheDocument();
    expect(within(second).getByText('2. Second key in Beta Wallet')).toBeInTheDocument();
    expect(within(second).getByText('Approves 1 transaction')).toBeInTheDocument();
    expect(within(fresh).getByText('3. New wallet: not connected')).toBeInTheDocument();
    expect(within(fresh).getByText('Approves 3 transactions in one request')).toBeInTheDocument();

    // A signing screen never shortens an address (DECISIONS.md D23).
    for (const [entry, address] of [
      [main, MAIN],
      [second, SECOND],
      [fresh, NEW_WALLET],
    ] as const) {
      expect(within(entry).getByText(address)).toBeInTheDocument();
      expect(entry.querySelector('[data-slot="address-text"]')).toHaveAttribute('data-variant', 'full');
    }
    expect(screen.queryByText(/\.\.\./)).not.toBeInTheDocument();
    expect(forbiddenRoleWords()).toEqual([]);
  });

  it('loading: a decorative placeholder, hidden from assistive technology', () => {
    const { container } = render(<SignerListSkeleton />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('SignerList compact (the signing screen, above the summary that holds the addresses)', () => {
  it('one line per key in order: number, role, wallet and status, no address; the count once when all share it', () => {
    render(
      <SignerList
        variant="compact"
        items={[
          { role: 'main', walletName: 'Alpha Wallet', address: MAIN, count: 2, status: 'current' },
          { role: 'second', walletName: 'Beta Wallet', address: SECOND, count: 2, status: 'waiting' },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Signatures' });
    expect(list.tagName).toBe('OL');
    const entries = within(list).getAllByRole('listitem');
    expect(entries.map((entry) => entry.getAttribute('data-role'))).toEqual(['main', 'second']);
    expect(entries.map((entry) => entry.getAttribute('data-status'))).toEqual(['current', 'waiting']);
    const [main, second] = entries as [HTMLElement, HTMLElement];
    expect(main).toHaveTextContent(/^1Main key·Alpha WalletYour turn$/);
    expect(main).toHaveAttribute('aria-current', 'step');
    expect(second).toHaveTextContent(/^2Second key·Beta WalletNot asked yet$/);
    expect(second).not.toHaveAttribute('aria-current');
    // No address on this list: the summary's "Who signs" holds them in full.
    expect(screen.queryByText(MAIN)).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="address-text"]')).toBeNull();
    // The same count for every key: said once under the list, not on each line.
    expect(screen.getAllByText('Approves 2 transactions in one request')).toHaveLength(1);
    expect(within(list).queryByText('Approves 2 transactions in one request')).not.toBeInTheDocument();
    expect(forbiddenRoleWords()).toEqual([]);
  });

  it('different counts are said on each line; a key no wallet here offers shows its role and status only', () => {
    render(
      <SignerList
        variant="compact"
        items={[
          { role: 'new', walletName: 'Gamma Wallet', address: NEW_WALLET, count: 1, status: 'signed' },
          { role: 'second', walletName: null, address: SECOND, count: 3, status: 'link' },
        ]}
      />,
    );
    const [fresh, second] = within(screen.getByRole('list', { name: 'Signatures' })).getAllByRole('listitem') as [HTMLElement, HTMLElement];
    expect(within(fresh).getByText('Approves 1 transaction')).toBeInTheDocument();
    expect(within(second).getByText('Approves 3 transactions in one request')).toBeInTheDocument();
    expect(second).toHaveTextContent(/^2Second keySigns by link/);
    expect(within(second).getByText('Signs by link')).toHaveAttribute('data-tone', 'info');
  });

  it('loading: two decorative lines', () => {
    const { container } = render(<SignerListSkeleton variant="compact" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild?.children).toHaveLength(2);
  });
});
