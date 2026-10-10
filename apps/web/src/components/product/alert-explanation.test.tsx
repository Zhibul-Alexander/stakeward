import { address } from '@solana/kit';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AlertExplanation, alertEventText, alertLockEndText, alertStatusText } from './alert-explanation.tsx';

const STAKE = address('AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW');

describe('AlertExplanation', () => {
  it('names every event type the monitor sends, reminders by their kind, and anything else as a change', () => {
    for (const type of ['DEACTIVATED', 'DELEGATION_CHANGED', 'STAKER_CHANGED', 'WITHDRAWER_CHANGED', 'LOCKUP_CHANGED', 'BALANCE_DECREASED', 'ACCOUNT_CLOSED', 'EXPIRED', 'VALIDATOR_AT_RISK']) {
      expect(alertEventText(type), type).not.toBe(alertEventText('SOMETHING_NEW'));
    }
    expect(alertEventText('REMINDER_7')).toBe('Reminder: the lock on this stake ends soon.');
    expect(alertEventText('toString')).toBe('The monitor saw a change on this stake account.');
  });

  it('says the account as stored, or that it is not watched', () => {
    const current = { address: STAKE, roles: ['main' as const], lockUntil: 1_807_488_000n, lock: 'ended' as const, daysLeft: null, lamports: 1n, state: 'closed' as const };
    expect(alertStatusText(current)).toBe('No lock in force · closed');
    expect(alertLockEndText(current)).toBe('No lock');
    expect(alertLockEndText({ ...current, lock: 'in-force' })).toBe('12 April 2027');
    expect(alertStatusText(null)).toBe('Not watched any more');
  });

  it('loading, error and empty states', () => {
    const { rerender } = render(<AlertExplanation state="loading" event="DEACTIVATED" stake={STAKE} />);
    expect(screen.getByText("Reading this account's recent changes")).toHaveAttribute('role', 'status');
    expect(screen.getByText('The stake was deactivated: unstaking started.')).toBeInTheDocument();

    rerender(<AlertExplanation state="error" event="DEACTIVATED" stake={STAKE} detail="HTTP 500" />);
    expect(screen.getByText("Could not read this account's recent changes")).toBeInTheDocument();

    rerender(<AlertExplanation state="ready" event="DEACTIVATED" stake={STAKE} detectedAt={null} current={null} recent={[]} />);
    expect(screen.getByText('No other change is recorded.')).toBeInTheDocument();
    expect(screen.getByText('Not known')).toBeInTheDocument();
  });
});
