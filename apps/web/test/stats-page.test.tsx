// /stats (CLAUDE.md sections 8 and 9): the worker's public numbers (GET /api/stats) and the monitor's freshness
// (GET /api/health), read through the page's loaders. Rendered without <PortsProvider>: a page that touched the
// chain or a wallet would throw, so these tests also show it needs neither.
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Health } from '@/api/health';
import { StatsHttpError, type Stats } from '@/api/stats';
import { StatsPage } from '@/pages/StatsPage';

const COUNTED_AT = new Date('2026-10-06T12:00:00.000Z');
const STATS: Stats = { accountsLocked: 1_204, lamportsLocked: 48_250_750_000_000n, alertsSent: 37, countedAt: COUNTED_AT };
const ZERO: Stats = { accountsLocked: 0, lamportsLocked: 0n, alertsSent: 0, countedAt: COUNTED_AT };

const LABELS = ['Stake accounts locked', 'SOL locked', 'Alerts sent'];

/** The monitor ran 2.5 minutes ago and the worker says it is fine. */
const freshHealth = (): Promise<Health> => Promise.resolve({ ok: true, lastMonitorRunAt: new Date(Date.now() - 150_000) });
const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);

function renderStats(loadStats: () => Promise<Stats>, loadHealth: () => Promise<Health> = freshHealth) {
  const location = memoryLocation({ path: '/stats', record: true });
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <StatsPage loadStats={loadStats} loadHealth={loadHealth} />
    </Router>,
  );
  return location;
}

/** The value of each tile, in page order. */
const values = () => [...document.querySelectorAll('[data-slot="stat-value"]')].map((value) => value.textContent);
/** The tile named `label`: its description list. */
const tile = (label: string) => {
  const list = screen.getByText(label, { selector: 'dt' }).closest('dl');
  if (list === null) throw new Error(`no tile ${label}`);
  return list;
};
const monitoringLine = () => document.querySelector('[data-slot="monitoring"]');

describe('/stats', () => {
  it('loading: one h1, the intro, a status line that says what it waits for, every tile named', () => {
    renderStats(never<Stats>, never<Health>);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Stakeward in numbers');
    expect(screen.getByText(/^Three numbers, counted when you open this page/)).toBeInTheDocument();
    expect(screen.getByText(/^Accounts and SOL come from public network data/)).toBeInTheDocument();

    expect(screen.getByRole('status')).toHaveTextContent('Loading the numbers from Stakeward');
    for (const label of LABELS) expect(tile(label)).toHaveAttribute('data-state', 'loading');
    expect(values()).toEqual(['Loading', 'Loading', 'Loading']);
    expect(document.querySelector('[aria-busy="true"]')).toContainElement(tile('SOL locked'));
  });

  it('ready: the three numbers, exact, each read with its name, when they were counted and how fresh', async () => {
    renderStats(() => Promise.resolve(STATS));
    expect(await screen.findByText('48,250.75 SOL')).toBeInTheDocument();
    expect(values()).toEqual(['1,204', '48,250.75 SOL', '37']);
    expect(within(tile('Stake accounts locked')).getAllByRole('definition')[0]).toHaveTextContent('1,204');
    expect(within(tile('Alerts sent')).getAllByRole('definition')[0]).toHaveTextContent('37');
    expect(within(tile('SOL locked')).getByText('A lock covers the whole balance of a stake account, so all of it counts.')).toBeInTheDocument();
    expect(screen.getByText('Counted on 6 October 2026, 12:00 UTC.')).toBeInTheDocument();

    // The wait is over: no status line, nothing busy, no error and no empty-state note.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="stats-zero"]')).toBeNull();

    // The monitor's freshness, as on /app (UX rule 12).
    expect(await screen.findByText('Last checked 2 min ago')).toBeInTheDocument();
    expect(monitoringLine()).toHaveAttribute('data-state', 'fresh');
  });

  it('shows the SOL to the lamport, beyond what a float holds', async () => {
    renderStats(() => Promise.resolve({ ...STATS, lamportsLocked: 9_007_199_254_740_993n }));
    expect(await screen.findByText('9,007,199.254740993 SOL')).toHaveAttribute('data-lamports', '9007199254740993');
  });

  it('zero: honest zeros with a way forward, nothing made up', async () => {
    const location = renderStats(() => Promise.resolve(ZERO));
    const note = await screen.findByText('No stake account Stakeward watches has a lock in force right now.');
    expect(values()).toEqual(['0', '0 SOL', '0']);
    expect(screen.getByText(/^Three numbers, counted when you open this page/)).toBeInTheDocument();
    const action = within(note).getByRole('link', { name: 'Check your stake' });
    expect(action).toHaveAttribute('href', '/app');
    await userEvent.click(action);
    expect(location.history).toEqual(['/stats', '/app']);
  });

  it('error: what happened, the original text under Details, and Try again reads the numbers and the monitor again', async () => {
    const loadStats = vi.fn<() => Promise<Stats>>().mockRejectedValueOnce(new StatsHttpError(500)).mockResolvedValueOnce(STATS);
    const loadHealth = vi.fn(freshHealth);
    renderStats(loadStats, loadHealth);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the numbers');
    expect(alert).toHaveTextContent('Stakeward could not count the numbers just now. Try again in a minute.');
    const details = within(alert).getByText('Details').closest('details');
    expect(details).toHaveTextContent('StatsHttpError: GET /api/stats answered HTTP 500');
    // The tiles keep their names and say the number is missing; nothing is guessed.
    for (const label of LABELS) expect(tile(label)).toHaveAttribute('data-state', 'error');
    expect(values()).toEqual(['Not available', 'Not available', 'Not available']);
    expect(screen.queryByText('Counted on', { exact: false })).toBeNull();

    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('48,250.75 SOL')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(loadStats).toHaveBeenCalledTimes(2);
    expect(loadHealth).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['the rate limit', new StatsHttpError(429), 'Too many requests from your network. Wait a minute, then try again.'],
    [
      'the timeout',
      Object.assign(new Error('No answer within 8 s'), { name: 'TimeoutError' }),
      'Stakeward did not answer. Check your connection, then try again.',
    ],
    ['a failed fetch', new TypeError('Failed to fetch'), 'Stakeward did not answer. Check your connection, then try again.'],
    [
      'a malformed answer',
      Object.assign(new Error('Malformed /api/stats response: now is not an ISO 8601 UTC time'), { name: 'InvalidStatsResponseError' }),
      'Stakeward could not count the numbers just now. Try again in a minute.',
    ],
  ])('error: says what to do after %s', async (_name, error, message) => {
    renderStats(() => Promise.reject(error));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(within(alert).getByText('Details').closest('details')).toHaveTextContent(error.message);
  });

  it('Refresh reads the numbers and the monitor again', async () => {
    const loadStats = vi
      .fn<() => Promise<Stats>>()
      .mockResolvedValueOnce(STATS)
      .mockResolvedValueOnce({ ...STATS, accountsLocked: 1_205, lamportsLocked: 48_260_750_000_000n });
    const loadHealth = vi.fn(freshHealth);
    renderStats(loadStats, loadHealth);
    expect(await screen.findByText('48,250.75 SOL')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('48,260.75 SOL')).toBeInTheDocument();
    expect(values()).toEqual(['1,205', '48,260.75 SOL', '37']);
    expect(loadStats).toHaveBeenCalledTimes(2);
    expect(loadHealth).toHaveBeenCalledTimes(2);
  });

  it('a late monitor turns the line red next to the numbers (alerts may be late)', async () => {
    const lateHealth = (): Promise<Health> =>
      Promise.resolve({ ok: false, lastMonitorRunAt: new Date(Date.now() - 15 * 60_000), serverTime: new Date() });
    renderStats(() => Promise.resolve(STATS), lateHealth);
    expect(await screen.findByText('Last checked 15 min ago. Alerts may be late.')).toBeInTheDocument();
    expect(monitoringLine()).toHaveAttribute('data-state', 'stale');
    expect(values()).toEqual(['1,204', '48,250.75 SOL', '37']);
  });

  it('a failed monitoring read says so on its own line, the numbers still show', async () => {
    renderStats(() => Promise.resolve(STATS), () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await screen.findByText('Monitoring status unavailable. Press Refresh to try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(await screen.findByText('48,250.75 SOL')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
