import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';
import { ActionBar } from './action-bar.tsx';
import { RiskNote } from './risk-note.tsx';

const T = 1_807_488_000n; // 12 April 2027 00:00 UTC

describe('ActionBar', () => {
  it('puts the risk, then the note, then the main button first and Back after it', () => {
    render(
      <ActionBar
        risk={<RiskNote risk="lose-second-key" date={T} variant="inline" />}
        note="Your Main key signs first."
        primary={<Button>Sign 2 transactions</Button>}
        secondary={<Button variant="ghost">Back</Button>}
      />,
    );
    const bar = document.querySelector('[data-slot="action-bar"]');
    if (!(bar instanceof HTMLElement)) throw new Error('no action bar');
    const risk = screen.getByRole('note');
    const note = screen.getByText('Your Main key signs first.');
    const sign = screen.getByRole('button', { name: 'Sign 2 transactions' });
    const back = screen.getByRole('button', { name: 'Back' });
    const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(risk, note)).toBe(true);
    expect(follows(note, sign)).toBe(true);
    expect(follows(sign, back)).toBe(true);
    // Below 640 px the main button takes the full width (its wrapper stretches it); from 640 px it is as wide as its words.
    expect(sign.parentElement?.className).toContain('[&>[data-slot=button]]:w-full');
    expect(sign.parentElement?.className).toContain('sm:[&>[data-slot=button]]:w-auto');
  });

  it('needs only the main button', () => {
    render(<ActionBar primary={<Button>Protect 2 accounts</Button>} />);
    expect(screen.getByRole('button', { name: 'Protect 2 accounts' })).toBeInTheDocument();
    expect(screen.queryByRole('note')).toBeNull();
  });
});
