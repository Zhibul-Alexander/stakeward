import type { Address } from '@solana/kit';
import { shortAddress } from '@stakeward/core';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KeyList, KeyListSkeleton } from './key-list.tsx';

const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8' as Address;
const SECOND = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi' as Address;

describe('KeyList', () => {
  it('names each key by its role, shows its whole address with copy and explorer, and says what it does', () => {
    render(
      <KeyList
        items={[
          { role: 'main', address: MAIN, note: 'Receives the SOL and pays the network fee' },
          { role: 'second', address: SECOND, note: 'Locked until 12 April 2027: co-signs this withdrawal' },
        ]}
      />,
    );
    const list = document.querySelector('dl[data-slot="key-list"]') as HTMLElement;
    expect([...list.querySelectorAll('dt')].map((term) => term.textContent)).toEqual(['Main key', 'Second key']);
    // Full addresses before signing (UX rule 9, DECISIONS.md D23), each with copy and an explorer link.
    for (const address of [MAIN, SECOND]) {
      const row = list.querySelector(`[data-role="${address === MAIN ? 'main' : 'second'}"]`) as HTMLElement;
      expect(within(row).getByText(address)).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: `Copy address ${shortAddress(address)}` })).toBeInTheDocument();
      expect(within(row).getByRole('link', { name: new RegExp(`${shortAddress(address)}.*Solana Explorer`) })).toBeInTheDocument();
    }
    expect(screen.getByText('Locked until 12 April 2027: co-signs this withdrawal')).toBeInTheDocument();
  });

  it('a key without a note is just its role and address', () => {
    render(<KeyList items={[{ role: 'main', address: MAIN }]} />);
    const row = document.querySelector('[data-role="main"]') as HTMLElement;
    expect(row.querySelector('dd')?.textContent).toBe(MAIN);
  });

  it('loading: the same panel, hidden from assistive technology', () => {
    render(<KeyListSkeleton rows={3} />);
    const skeleton = document.querySelector('[data-slot="key-list-skeleton"]') as HTMLElement;
    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    expect(skeleton.children).toHaveLength(3);
  });
});
