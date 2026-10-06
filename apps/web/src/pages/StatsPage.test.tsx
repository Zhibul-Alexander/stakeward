import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Stats } from '@/api/stats';
import { StatsPage } from './StatsPage.tsx';

const stats = (accountsLocked: number, lamportsLocked: bigint, alertsSent: number): Stats => ({
  accountsLocked,
  lamportsLocked,
  alertsSent,
});

function definitions(): string[] {
  return screen.getAllByRole('definition').map((element) => element.textContent);
}

describe('StatsPage', () => {
  it('says it is loading, with no numbers yet', () => {
    render(<StatsPage load={() => new Promise<Stats>(() => undefined)} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Stakeward in numbers' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the numbers');
    expect(screen.queryByRole('definition')).not.toBeInTheDocument();
  });

  it('shows the three numbers, SOL rounded down to whole SOL, then the note', async () => {
    render(<StatsPage load={() => Promise.resolve(stats(12, 1_234_999_999_999n, 7))} />);
    expect(await screen.findAllByRole('definition')).toHaveLength(3);
    expect(screen.getAllByRole('term').map((element) => element.textContent)).toEqual([
      'Locked stake accounts Stakeward watches',
      'SOL in those stake accounts',
      'Telegram alerts sent',
    ]);
    expect(definitions()).toEqual(['12', '1,234 SOL', '7']);
    expect(screen.getByText(/^Counted from watched stake accounts whose lock is in force right now\./)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('groups thousands in the counts', async () => {
    render(<StatsPage load={() => Promise.resolve(stats(1_234_567, 0n, 1_000))} />);
    await screen.findAllByRole('definition');
    expect(definitions()).toEqual(['1,234,567', '0 SOL', '1,000']);
  });

  it('explains an empty monitor and links to the accounts page', async () => {
    render(<StatsPage load={() => Promise.resolve(stats(0, 0n, 0))} />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Nothing locked yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check your stake' })).toHaveAttribute('href', '/app');
    expect(screen.queryByRole('definition')).not.toBeInTheDocument();
  });

  it('shows the tiles when alerts were sent, even with nothing locked now', async () => {
    render(<StatsPage load={() => Promise.resolve(stats(0, 0n, 3))} />);
    await screen.findAllByRole('definition');
    expect(definitions()).toEqual(['0', '0 SOL', '3']);
    expect(screen.queryByText('Nothing locked yet')).not.toBeInTheDocument();
  });

  it('says what failed, keeps the raw error under Details and reads again on Try again', async () => {
    const load = vi
      .fn<() => Promise<Stats>>()
      .mockRejectedValueOnce(new Error('GET /api/stats answered HTTP 500'))
      .mockResolvedValueOnce(stats(12, 1_234_999_999_999n, 7));
    render(<StatsPage load={load} />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Could not load the numbers')).toBeInTheDocument();
    expect(within(alert).getByText('Could not get the numbers from the Stakeward server. Wait a minute, then try again.')).toBeInTheDocument();
    expect(within(alert).getByText('Details').closest('details')).toHaveTextContent('HTTP 500');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findAllByRole('definition')).toHaveLength(3);
    expect(definitions()).toEqual(['12', '1,234 SOL', '7']);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
