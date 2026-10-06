import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge, type StatusBadgeStatus } from './status-badge.tsx';

// UX rule 5: every status is a word, a colour (tone) and an icon, never colour alone.
const EXPECTED: [StatusBadgeStatus, string, string][] = [
  ['protected', 'Protected', 'success'],
  ['expiring', 'Expiring soon', 'warning'],
  ['unprotected', 'Not protected', 'neutral'],
  // Not "another key": on a new device the owner's own lock looks like this too. Never Protected (D35).
  ['locked-by-other', 'Locked by a second key', 'info'],
  ['was-protected', 'No longer protected', 'danger'],
  ['unknown', 'Status unknown', 'outline'],
];

describe('StatusBadge', () => {
  it.each(EXPECTED)('%s: shows the word "%s", tone %s and a decorative icon', (status, word, tone) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = screen.getByText(word);
    expect(badge).toHaveAttribute('data-status', status);
    expect(badge).toHaveAttribute('data-tone', tone);
    const icons = container.querySelectorAll('svg');
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true');
    // The accessible text is the word alone.
    expect(badge).toHaveTextContent(new RegExp(`^${word}$`));
  });

  it('gives every status its own icon', () => {
    const classes = EXPECTED.map(([status]) => {
      const { container, unmount } = render(<StatusBadge status={status} />);
      const icon = container.querySelector('svg')?.getAttribute('class') ?? '';
      unmount();
      return icon;
    });
    expect(new Set(classes).size).toBe(EXPECTED.length);
  });

  it('F6: "no longer protected" is the only danger status', () => {
    const danger = EXPECTED.filter(([, , tone]) => tone === 'danger').map(([status]) => status);
    expect(danger).toEqual(['was-protected']);
  });
});
