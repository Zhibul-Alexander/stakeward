// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { DemoPage } from '@/pages/DemoPage';

// /demo: the simulated theft story. Part 1 the thief takes the stake; part 2 the lock stops them, the alert goes out
// and the rescue moves the stake to the New wallet. Steps play with no delay here.

const NOW = new Date('2026-10-13T09:00:00Z');

function renderDemo() {
  const { hook } = memoryLocation({ path: '/demo' });
  render(
    <Router hook={hook}>
      <DemoPage stepMs={0} now={() => NOW} />
    </Router>,
  );
}

function holder(): string | undefined {
  const cards = document.querySelectorAll<HTMLElement>('[data-slot="demo-wallet"][data-holds="true"]');
  expect(cards).toHaveLength(1);
  return cards[0]?.dataset['role'];
}

describe('/demo', () => {
  it('plays the theft without Stakeward, then the failed theft and the rescue with it', async () => {
    const user = userEvent.setup();
    renderDemo();
    expect(document.querySelectorAll('[data-slot="demo-wallet"]')).toHaveLength(2);
    expect(holder()).toBe('main');

    await user.click(screen.getByRole('button', { name: 'Steal the stake' }));
    await screen.findByRole('heading', { name: 'Gone. One stolen key, one signature.' });
    expect(holder()).toBe('thief');

    await user.click(screen.getByRole('button', { name: 'Now add Stakeward' }));
    expect(document.querySelectorAll('[data-slot="demo-wallet"]')).toHaveLength(4);
    expect(screen.getByText(/can freeze this stake/)).toBeInTheDocument();
    expect(holder()).toBe('main');

    await user.click(screen.getByRole('button', { name: 'Protect with Stakeward' }));
    // Six months from 13 October 2026, at 00:00 UTC after the period ends.
    await screen.findByRole('heading', { name: 'Protected until 14 April 2027' });

    await user.click(screen.getByRole('button', { name: 'Steal the stake' }));
    await screen.findByRole('heading', { name: 'The thief failed. You got an alert.' });
    expect(holder()).toBe('main');
    const log = screen.getByRole('log');
    // Rejected before the unstake and again after it.
    expect(within(log).getAllByText('Rejected. The Second key must co-sign.')).toHaveLength(2);
    // Each line copies as "Actor: text".
    expect(within(log).getAllByRole('listitem')[0]).toHaveTextContent('Main key: Signs: lock this stake until 14 April 2027.', { normalizeWhitespace: false });
    const alert = document.querySelector<HTMLElement>('[data-slot="demo-alert"]');
    expect(alert).not.toBeNull();
    expect(alert).toHaveTextContent('was deactivated. If this was not you, your main key may be stolen.');

    await user.click(within(alert as HTMLElement).getByRole('button', { name: 'Open Rescue' }));
    await screen.findByRole('heading', { name: 'Saved: 100 SOL is in your New wallet' });
    expect(holder()).toBe('new');

    await user.click(screen.getByRole('button', { name: 'Start over' }));
    expect(holder()).toBe('main');
    expect(screen.queryByRole('log')).toBeNull();
  });
});
