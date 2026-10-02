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
});
