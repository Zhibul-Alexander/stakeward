import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepProgress } from './step-progress.tsx';

const STEPS = ['Accounts', 'Second key', 'Lock period', 'Sign'];

describe('StepProgress', () => {
  it('marks done steps, the current step (aria-current) and upcoming ones', () => {
    render(<StepProgress steps={STEPS} current={2} />);
    const nav = screen.getByRole('navigation', { name: 'Progress' });
    const items = within(nav).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-state'))).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveTextContent('Done: Accounts');
    expect(items[2]).toHaveTextContent('Current step: Lock period');
    expect(items[3]).toHaveTextContent(/^4Sign$/);
  });

  it('shows a failed step', () => {
    render(<StepProgress steps={STEPS} current={3} failed={3} />);
    const items = screen.getAllByRole('listitem');
    expect(items[3]).toHaveAttribute('data-state', 'failed');
    expect(items[3]).toHaveTextContent('Failed: Sign');
  });

  // Below 640 px a line and a bar stand in for the dots; the list stays in the page for screen readers, never
  // display: none, so assistive technology at 360 px still gets every step and where you are.
  it('keeps the list for screen readers below 640 px, next to a decorative line and bar', () => {
    render(<StepProgress steps={STEPS} current={1} />);
    const nav = screen.getByRole('navigation', { name: 'Progress' });
    const list = within(nav).getByRole('list');
    expect(list).toHaveClass('sr-only', 'sm:not-sr-only');
    expect(list.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    const current = within(list).getAllByRole('listitem').find((item) => item.textContent.startsWith('2Current step:'));
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(current).toHaveTextContent('Current step: Second key');
    const line = within(nav).getByText('Step 2 of 4: Second key');
    expect(line.closest('[aria-hidden="true"]')).not.toBeNull();
    const segments = [...nav.querySelectorAll('[aria-hidden="true"] span[data-state]')];
    expect(segments.map((segment) => segment.getAttribute('data-state'))).toEqual(['done', 'current', 'upcoming', 'upcoming']);
  });

  it('a failed step shows in the bar too', () => {
    render(<StepProgress steps={STEPS} current={3} failed={3} />);
    const segments = [...document.querySelectorAll('[aria-hidden="true"] span[data-state]')];
    expect(segments.at(-1)).toHaveClass('bg-danger');
  });

  // UX rule 5 and WCAG 1.4.1: below 640 px the failure is not the red segment alone. The line says it in words, in
  // danger, with an X.
  it('below 640 px the line says the step failed, in words and with an X', () => {
    const { rerender } = render(<StepProgress steps={STEPS} current={3} failed={3} />);
    const line = screen.getByText('Failed: Step 4 of 4: Sign');
    expect(line).toHaveClass('text-danger');
    expect(line.querySelector('svg')).not.toBeNull();
    expect(line.closest('[aria-hidden="true"]')).not.toBeNull();
    rerender(<StepProgress steps={STEPS} current={3} />);
    expect(screen.getByText('Step 4 of 4: Sign')).not.toHaveClass('text-danger');
    expect(screen.queryByText(/^Failed: Step/)).toBeNull();
  });
});
