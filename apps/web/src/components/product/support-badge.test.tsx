import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SupportBadge, type SupportVerdict } from './support-badge.tsx';

// UX rule 5: a verdict is a word, a colour (tone) and an icon, never colour alone.
const EXPECTED: [SupportVerdict, string, string][] = [
  ['not-verified', 'Not verified yet', 'outline'],
  ['works', 'Works', 'success'],
  ['works-with-warning', 'Works, with a wallet warning', 'warning'],
  ['blind-signing', 'Ledger needs blind signing', 'warning'],
  ['does-not-work', 'Does not work', 'danger'],
];

describe('SupportBadge', () => {
  it.each(EXPECTED)('%s: the word "%s", tone %s and a decorative icon', (verdict, word, tone) => {
    const { container } = render(<SupportBadge verdict={verdict} />);
    const badge = screen.getByText(word);
    expect(badge).toHaveAttribute('data-verdict', verdict);
    expect(badge).toHaveAttribute('data-tone', tone);
    expect(badge).toHaveTextContent(new RegExp(`^${word}$`));
    const icons = container.querySelectorAll('svg');
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true');
    // The longest verdict wraps at 360 px instead of overflowing (the Badge itself does not wrap).
    expect(badge).toHaveClass('whitespace-normal', 'text-sm');
    expect(badge).not.toHaveClass('whitespace-nowrap');
  });

  it('gives every verdict its own icon', () => {
    const icons = EXPECTED.map(([verdict]) => {
      const { container, unmount } = render(<SupportBadge verdict={verdict} />);
      const icon = container.querySelector('svg')?.getAttribute('class') ?? '';
      unmount();
      return icon;
    });
    expect(new Set(icons).size).toBe(EXPECTED.length);
  });
});
