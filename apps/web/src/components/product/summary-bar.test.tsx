import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';
import { SummaryBar } from './summary-bar.tsx';

const monitoring = <span data-slot="monitoring">Last checked 2 min ago</span>;
const tools = <Button variant="ghost" size="icon-sm" aria-label="Refresh" />;

describe('SummaryBar', () => {
  it('ready: the answer first, then how fresh it is, the tools, one action and the footer', () => {
    render(
      <SummaryBar
        label="Summary"
        state="ready"
        headline="1,293.25 of 1,490.45 SOL protected"
        detail="2 of 6 stake accounts"
        monitoring={monitoring}
        tools={tools}
        action={<Button variant="outline">Connect second key</Button>}
        footer={<a href="/rescue">Rescue your stake</a>}
      />,
    );
    const bar = screen.getByRole('region', { name: 'Summary' });
    expect(bar).toHaveAttribute('data-slot', 'summary-bar');
    const headline = within(bar).getByText('1,293.25 of 1,490.45 SOL protected');
    expect(headline).toHaveClass('text-2xl', 'tabular-nums');
    expect(within(bar).getByText('2 of 6 stake accounts')).toBeInTheDocument();
    expect(within(bar).getByText('Last checked 2 min ago')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Connect second key' })).toBeInTheDocument();
    expect(within(bar).getByRole('link', { name: 'Rescue your stake' })).toBeInTheDocument();
  });

  // UX rule 12: "Last checked" matters most when the worker or the RPC may be down.
  it.each(['loading', 'error'] as const)('%s: no answer, but monitoring and Refresh still show', (state) => {
    render(<SummaryBar label="Summary" state={state} headline="ignored" detail="ignored" monitoring={monitoring} tools={tools} />);
    const bar = screen.getByRole('region', { name: 'Summary' });
    expect(bar).toHaveAttribute('data-state', state);
    expect(within(bar).queryByText('ignored')).toBeNull();
    expect(within(bar).getByText('Last checked 2 min ago')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(bar.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(state === 'loading' ? 2 : 0);
  });

  it('ready without a headline (a second-key holder with no accounts of their own): the detail alone', () => {
    render(<SummaryBar label="Summary" state="ready" detail="Second key for 2 stake accounts" monitoring={monitoring} />);
    const bar = screen.getByRole('region', { name: 'Summary' });
    expect(within(bar).getByText('Second key for 2 stake accounts')).toBeInTheDocument();
    expect(bar.querySelector('.text-2xl')).toBeNull();
  });
});
