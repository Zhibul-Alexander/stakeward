import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { loadLocale, useLocale } from '@/i18n';
import en from '@/i18n/en.json';
import { KeyDiagram } from '@/pages/landing/KeyDiagram';

/**
 * The landing figure must say what the stake program does (CLAUDE.md section 4), case by case. While the lock holds:
 * Withdraw and Authorize(Withdrawer) need the main key (withdrawer) and the second key (custodian); SetLockup needs the
 * second key alone; Deactivate, DelegateStake, Split and Authorize(Staker) need the main key alone; a rescue needs the
 * main key, the second key and the new wallet (AuthorizeChecked). After the end date the main key works alone again.
 */
const ACTIONS = ['withdraw', 'owner', 'lock', 'deactivate', 'redelegate', 'split', 'manager', 'rescue'] as const;

const EXPECTED: Record<keyof typeof en.landing.diagram.scenarios, Record<(typeof ACTIONS)[number], 'yes' | 'no' | 'later'>> = {
  // The thief holds a copy of the main key; the owner holds the second key.
  thief: { withdraw: 'no', owner: 'no', lock: 'no', deactivate: 'yes', redelegate: 'yes', split: 'yes', manager: 'yes', rescue: 'no' },
  // The owner holds only the main key: the lock's actions wait for the end date, staking is untouched.
  lost: { withdraw: 'later', owner: 'later', lock: 'later', deactivate: 'yes', redelegate: 'yes', split: 'yes', manager: 'yes', rescue: 'later' },
  // The thief holds only the second key: the lock (freeze), nothing else.
  secondStolen: { withdraw: 'no', owner: 'no', lock: 'yes', deactivate: 'no', redelegate: 'no', split: 'no', manager: 'no', rescue: 'no' },
  // The owner with both keys and a new wallet: everything.
  rescue: { withdraw: 'yes', owner: 'yes', lock: 'yes', deactivate: 'yes', redelegate: 'yes', split: 'yes', manager: 'yes', rescue: 'yes' },
};

const HOLDERS: Record<keyof typeof EXPECTED, { main: string; second: string; lock: string }> = {
  thief: { main: 'thief', second: 'you', lock: 'holds' },
  lost: { main: 'you', second: 'lost', lock: 'wait' },
  secondStolen: { main: 'you', second: 'thief', lock: 'anyDate' },
  rescue: { main: 'you', second: 'you', lock: 'unchanged' },
};

function Rerendered() {
  // App reads the language the same way, so a switch re-renders the figure from the top.
  useLocale();
  return <KeyDiagram />;
}

describe('KeyDiagram', () => {
  afterEach(async () => {
    await loadLocale('en');
  });

  it.each(Object.keys(EXPECTED) as (keyof typeof EXPECTED)[])('%s: every action, who holds each key and the lock match the stake program', async (id) => {
    const user = userEvent.setup();
    const { container } = render(<KeyDiagram />);
    await user.click(screen.getByRole('radio', { name: en.landing.diagram.scenarios[id].label }));
    expect(screen.getByRole('radio', { name: en.landing.diagram.scenarios[id].label })).toBeChecked();
    const results = Object.fromEntries(
      ACTIONS.map((action) => [action, container.querySelector(`[data-action="${action}"]`)?.getAttribute('data-result')]),
    );
    expect(results).toEqual(EXPECTED[id]);
    expect(container.querySelector('[data-key="main"]')).toHaveAttribute('data-holder', HOLDERS[id].main);
    expect(container.querySelector('[data-key="second"]')).toHaveAttribute('data-holder', HOLDERS[id].second);
    expect(container.querySelector('[data-key="lock"]')).toHaveAttribute('data-lock', HOLDERS[id].lock);
    expect(screen.getByText(en.landing.diagram.scenarios[id].caption)).toBeInTheDocument();
  });

  it('opens on the thief with the main key, and the drawing itself has no words', () => {
    const { container } = render(<KeyDiagram />);
    expect(screen.getByRole('radio', { name: en.landing.diagram.scenarios.thief.label })).toBeChecked();
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg.querySelector('text')).toBeNull();
    }
  });

  it('writes the example end date in the language picked after the first render', async () => {
    const { container } = render(<Rerendered />);
    const lock = () => container.querySelector('[data-key="lock"]')?.textContent ?? '';
    const english = lock();
    await act(async () => {
      await loadLocale('es');
    });
    expect(lock()).not.toBe(english);
    expect(lock()).toMatch(/\d{4}/);
    expect(lock()).not.toMatch(/January|February|March|April|May|June|July|August|September|October|November|December/);
  });
});
