import { render, screen, within } from '@testing-library/react';
import { LockIcon } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { SolAmount } from './sol-amount.tsx';
import { StatTile } from './stat-tile.tsx';

const tile = () => {
  const list = document.querySelector('dl[data-slot="stat-tile"]');
  if (!(list instanceof HTMLElement)) throw new Error('no stat tile');
  return list;
};

describe('StatTile', () => {
  it('reads as a name and its value: a description list with the note', () => {
    render(
      <StatTile status="ready" label="SOL locked" note="In those stake accounts." icon={LockIcon} value={<SolAmount lamports={1_250_500_000_000n} />} />,
    );
    expect(tile()).toHaveAttribute('data-state', 'ready');
    expect(within(tile()).getByRole('term')).toHaveTextContent('SOL locked');
    const [value, note] = within(tile()).getAllByRole('definition');
    expect(value).toHaveTextContent('1,250.5 SOL');
    expect(value).toHaveAttribute('data-slot', 'stat-value');
    expect(note).toHaveTextContent('In those stake accounts.');
    // The icon is decoration: the name says it.
    expect(tile().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows zero like any other number (no placeholder, no dash)', () => {
    render(<StatTile status="ready" label="Alerts sent" value="0" />);
    expect(within(tile()).getByRole('definition')).toHaveTextContent(/^0$/);
  });

  it('loading: the name stays, the value is a skeleton announced as Loading', () => {
    render(<StatTile status="loading" label="Stake accounts locked" note="Watched now." />);
    expect(tile()).toHaveAttribute('data-state', 'loading');
    expect(within(tile()).getByRole('term')).toHaveTextContent('Stake accounts locked');
    const [value, note] = within(tile()).getAllByRole('definition');
    expect(value).toHaveTextContent(/^Loading$/);
    expect(value?.querySelector('[data-slot="skeleton"]')).toHaveAttribute('aria-hidden', 'true');
    expect(note).toHaveTextContent('Watched now.');
  });

  it('error: a message in place of the value, the name and the note stay', () => {
    render(<StatTile status="error" label="SOL locked" note="In those stake accounts." message="Not available" />);
    expect(tile()).toHaveAttribute('data-state', 'error');
    const [value, note] = within(tile()).getAllByRole('definition');
    expect(value).toHaveTextContent(/^Not available$/);
    expect(note).toHaveTextContent('In those stake accounts.');
    expect(screen.queryByText('Loading')).not.toBeInTheDocument();
  });

  it('lets a long value wrap rather than overflow a narrow screen', () => {
    render(<StatTile status="ready" label="SOL locked" value="18,446,744,073.709551615 SOL" />);
    expect(within(tile()).getByRole('definition')).toHaveClass('wrap-anywhere');
    expect(tile()).toHaveClass('min-w-0');
  });
});
