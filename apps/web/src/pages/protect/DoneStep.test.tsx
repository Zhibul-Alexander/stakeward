import type { Address } from '@solana/kit';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WatchState } from '@/api/watch';
import { ProtectDoneView, type ProtectDoneViewProps } from './DoneStep.tsx';

const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8' as Address;
const SECOND = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi' as Address;
const S1 = 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW' as Address;

function show(overrides: Partial<ProtectDoneViewProps>) {
  const props: ProtectDoneViewProps = {
    outcomes: [{ id: S1, state: { kind: 'unknown', why: 'timeout' }, before: null, action: null, lifetime: null, signature: null, bytes: null }],
    clock: { unixTimestamp: 1_790_812_800n, epoch: 850n },
    mainKey: MAIN,
    secondKey: SECOND,
    lockUntil: 1_807_488_000n,
    watch: { kind: 'idle' },
    telegramUrl: `/api/telegram/link?wallet=${MAIN}`,
    actions: { retry: vi.fn(), choosePeriod: vi.fn(), checkAgain: vi.fn(), retryMonitoring: vi.fn() },
    ...overrides,
  };
  render(<ProtectDoneView {...props} />);
}

/** The icon next to a status text, and the tone class it carries. */
function iconOf(text: string): SVGElement | null {
  return screen.getByText(text).closest('p')?.querySelector('svg') ?? null;
}

describe('ProtectDoneView with a link still open', () => {
  it('offers Check again, not Try again, and says why the rest waits', () => {
    const S2 = '2Xtq6iZ2mXjxTNsv5FrYCzayG5qYRJwZ6837A1X3TjF6' as Address;
    const empty = { before: null, action: null, lifetime: null, signature: null, bytes: null };
    show({
      outcomes: [
        { id: S1, state: { kind: 'unknown', why: 'link-open' }, ...empty },
        { id: S2, state: { kind: 'not-sent' }, ...empty },
      ],
    });
    expect(screen.queryByRole('button', { name: /^Try again/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'A link is still open, so the rest waits for it. Once the other device sent it, or you cancelled it by closing your link-signing account, press Check again. Then try the rest.',
      ),
    ).toBeInTheDocument();
  });
});

// UX rule 5: a status is shown by word, colour and icon at once, never by text alone.
describe('ProtectDoneView statuses', () => {
  it.each<[string, WatchState, string, string]>([
    ['on', { kind: 'on' }, 'Monitoring is on: Stakeward checks these stake accounts every few minutes.', 'text-success'],
    [
      'partial',
      { kind: 'partial', rejected: [{ account: S1, reason: 'not-locked' }] },
      'Monitoring is on for some of them. Turn it on for the rest in a minute.',
      'text-warning',
    ],
    [
      'failed',
      { kind: 'failed', detail: 'TypeError: Failed to fetch' },
      'Monitoring could not be turned on right now. Your stake is still protected on the network.',
      'text-danger',
    ],
  ])('monitoring %s: word, colour and icon', (_kind, watch, text, tone) => {
    show({ watch });
    const icon = iconOf(text);
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon?.getAttribute('class')).toContain(tone);
  });

  it('a failed Check again: word, colour and icon', () => {
    show({ checkFailed: true });
    const icon = iconOf('Could not read the network. Try again in a moment.');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('class')).toContain('text-danger');
  });
});

// SECURITY-CHECK П11: "Monitoring is on" does not remind anyone; the Done screen says when the lock ends and that only
// Telegram alerts remind before then.
describe('ProtectDoneView: when the lock ends', () => {
  const T = 1_807_488_000n; // 12 April 2027
  const after = {
    address: S1,
    lamports: 2_000_000_000n,
    kind: 'initialized' as const,
    rentExemptReserve: 1_000_000n,
    staker: MAIN,
    withdrawer: MAIN,
    lockup: { unixTimestamp: T, epoch: 0n, custodian: SECOND },
    delegation: null,
  };
  const protectedOutcome = { id: S1, state: { kind: 'done' as const, after }, before: null, action: null, lifetime: null, signature: null, bytes: null };

  it('names the end date and that nobody reminds before it without Telegram alerts', () => {
    show({ outcomes: [protectedOutcome], lockUntil: T, watch: { kind: 'on' } });
    // The headline's line says when the lock ends, with the second key that holds it.
    expect(document.querySelector('[data-slot="done-subtitle"]')).toHaveTextContent(/^Locked until 12 April 2027 · Second key/);
    const note = document.querySelector('[data-risk="lock-ends"]');
    expect(note).not.toBeNull();
    expect(note).toHaveTextContent(
      'On 12 April 2027 the lock ends and anyone with your main key can withdraw this stake. Extend it before then.',
    );
    expect(note).toHaveTextContent('Without alerts, nobody reminds you.');
    expect(note?.querySelector('svg')?.getAttribute('class')).toContain('text-warning');
    // It sits in the Telegram step, right under the button that turns the reminders on.
    const step = screen.getByRole('heading', { name: 'Get alerts in Telegram' }).closest('li');
    expect(step).toContainElement(note as HTMLElement);
    const telegram = screen.getByRole('link', { name: 'Open Telegram bot (opens in a new tab)' });
    expect(step).toContainElement(telegram);
    expect(telegram.compareDocumentPosition(note as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('all protected: the headline with a check, Telegram is the one filled button, Back is quiet', () => {
    show({ outcomes: [protectedOutcome], lockUntil: T, watch: { kind: 'on' } });
    const heading = screen.getByRole('heading', { level: 2, name: '1 stake account is protected' });
    expect(heading.querySelector('svg')?.getAttribute('class')).toContain('text-success');
    const filled = [...document.querySelectorAll<HTMLElement>('[data-slot="button"]')].filter((button) =>
      ['primary', 'danger'].includes(button.dataset['variant'] ?? ''),
    );
    expect(filled.map((button) => button.textContent)).toEqual(['Open Telegram bot']);
    expect(screen.getByRole('link', { name: 'Back to your accounts' })).toHaveAttribute('data-variant', 'ghost');
    const steps = within(screen.getByRole('region', { name: 'Next steps' })).getAllByRole('listitem');
    expect(steps.map((step) => within(step).getByRole('heading').textContent)).toEqual([
      'Get alerts in Telegram',
      'Keep a recovery card',
      'Optional: prepare a one-tap rescue',
    ]);
    expect(screen.getByRole('link', { name: 'Open recovery card' })).toHaveAttribute('href', `/recovery/${S1}`);
    expect(screen.getByRole('link', { name: 'Prepare one-tap rescue' })).toHaveAttribute('href', expect.stringMatching(/^\/rescue-kit\?address=/));
    // The second key's risk was said before signing; Done does not repeat it.
    expect(document.querySelector('[data-risk="lose-second-key"]')).toBeNull();
  });

  it('not all protected: Try again is the one filled button and Telegram is outline', () => {
    const S2 = '2Xtq6iZ2mXjxTNsv5FrYCzayG5qYRJwZ6837A1X3TjF6' as Address;
    show({
      outcomes: [protectedOutcome, { id: S2, state: { kind: 'not-sent' }, before: null, action: null, lifetime: null, signature: null, bytes: null }],
      lockUntil: T,
    });
    expect(screen.getByRole('heading', { level: 2, name: '1 of 2 stake accounts are protected' })).toBeInTheDocument();
    const filled = [...document.querySelectorAll<HTMLElement>('[data-slot="button"]')].filter((button) =>
      ['primary', 'danger'].includes(button.dataset['variant'] ?? ''),
    );
    expect(filled.map((button) => button.textContent)).toEqual(['Try again for 1 stake account']);
    expect(screen.getByRole('link', { name: 'Open Telegram bot (opens in a new tab)' })).toHaveAttribute('data-variant', 'outline');
  });

  it('says nothing about an end date when nothing was protected, and offers no next steps for a lock that is not there', () => {
    show({ lockUntil: T });
    expect(document.querySelector('[data-risk="lock-ends"]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Next steps' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Open Telegram bot/ })).toBeNull();
  });
});
