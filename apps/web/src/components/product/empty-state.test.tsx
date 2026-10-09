import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';
import { EmptyState, NoStakeAccounts } from './empty-state.tsx';

describe('EmptyState', () => {
  it('a soft panel without a frame: icon, title at the asked level, its lines and one action', () => {
    render(
      <EmptyState title="No stake accounts found" headingLevel={3} action={<Button variant="outline">Check another address</Button>}>
        <p>Stakeward protects native stake.</p>
      </EmptyState>,
    );
    const heading = screen.getByRole('heading', { level: 3, name: 'No stake accounts found' });
    const panel = heading.closest('[data-slot="empty-state"]');
    expect(panel).toHaveClass('bg-subtle');
    expect(panel?.className).not.toMatch(/\bborder\b/);
    expect(screen.getByText('Stakeward protects native stake.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check another address' })).toBeInTheDocument();
  });

  it('NoStakeAccounts explains native stake and what is not a stake account (UX rule 13)', () => {
    render(<NoStakeAccounts headingLevel={2} />);
    expect(screen.getByRole('heading', { level: 2, name: 'No stake accounts found' })).toBeInTheDocument();
    expect(screen.getByText(/^Liquid staking tokens \(LSTs\)/)).toBeInTheDocument();
  });
});
