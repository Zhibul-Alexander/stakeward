import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContinueButtons } from './StepButtons.tsx';

const PROBLEMS = ['Connect your main key to continue.', 'Choose at least one stake account.'];

describe('ContinueButtons', () => {
  it('ready: the step button is the screen\'s one filled button, named by its label, and goes on', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onBack = vi.fn();
    render(<ContinueButtons label="Continue with 2 accounts" problems={[]} onContinue={onContinue} onBack={onBack} />);
    const step = screen.getByRole('button', { name: 'Continue with 2 accounts' });
    expect(step).toHaveAttribute('data-variant', 'primary');
    expect(step).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('data-variant', 'ghost');
    expect(document.querySelector('[data-slot="step-blockers"]')).toBeNull();
    await user.click(step);
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('blocked: outline and aria-disabled, the first reason under it before any click; a click names them all in danger', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<ContinueButtons label="Continue" problems={PROBLEMS} onContinue={onContinue} />);
    const step = screen.getByRole('button', { name: 'Continue' });
    expect(step).toHaveAttribute('data-variant', 'outline');
    expect(step).toHaveAttribute('aria-disabled', 'true');
    // Still clickable: aria-disabled alone would turn pointer events off.
    expect(step).toHaveClass('aria-disabled:pointer-events-auto');
    expect(step).toHaveAccessibleDescription(PROBLEMS[0]);
    const reason = document.querySelector('[data-slot="step-blockers"]');
    expect(reason).toHaveClass('text-muted');
    expect(reason).toHaveAttribute('data-pressed', 'false');
    expect(screen.queryByText(PROBLEMS[1] ?? '')).toBeNull();
    // The reason stands under the button.
    expect(step.compareDocumentPosition(reason as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(step);
    expect(onContinue).not.toHaveBeenCalled();
    expect(reason).toHaveClass('text-danger');
    expect(reason).toHaveFocus();
    expect(step).toHaveAccessibleDescription(PROBLEMS.join(' '));
  });

  it('Enter on the blocked button does the same as a click', async () => {
    const user = userEvent.setup();
    render(<ContinueButtons label="Continue" problems={PROBLEMS.slice(0, 1)} onContinue={vi.fn()} />);
    screen.getByRole('button', { name: 'Continue' }).focus();
    await user.keyboard('{Enter}');
    expect(document.querySelector('[data-slot="step-blockers"]')).toHaveFocus();
  });
});
