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

  // D35: once this browser knows a second key, a lock that none of them holds is what a fake site leaves. A stronger
  // word, the same tone and icon.
  it('locked-by-other once a second key is known: "Locked by another key", the same tone and icon', () => {
    const { container: soft } = render(<StatusBadge status="locked-by-other" />);
    const softIcon = soft.querySelector('svg')?.getAttribute('class');
    const { container } = render(<StatusBadge status="locked-by-other" secondKeyKnown />);
    const badge = screen.getByText('Locked by another key');
    expect(badge).toHaveAttribute('data-status', 'locked-by-other');
    expect(badge).toHaveAttribute('data-tone', 'info');
    expect(badge).toHaveTextContent(/^Locked by another key$/);
    expect(container.querySelector('svg')?.getAttribute('class')).toBe(softIcon);
  });

  it('a known second key changes no other status', () => {
    for (const [status, word] of EXPECTED.filter(([status]) => status !== 'locked-by-other')) {
      const { unmount } = render(<StatusBadge status={status} secondKeyKnown />);
      expect(screen.getByText(word)).toHaveAttribute('data-status', status);
      unmount();
    }
  });

  it('F6: "no longer protected" is the only danger status', () => {
    const danger = EXPECTED.filter(([, , tone]) => tone === 'danger').map(([status]) => status);
    expect(danger).toEqual(['was-protected']);
  });

  it('is small (text-xs) by default, for rows and lists, and md (text-sm) where it stands alone', () => {
    const { unmount } = render(<StatusBadge status="protected" />);
    expect(screen.getByText('Protected')).toHaveAttribute('data-size', 'sm');
    unmount();
    render(<StatusBadge status="protected" size="md" />);
    expect(screen.getByText('Protected')).toHaveAttribute('data-size', 'md');
  });
});
