import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Button } from './button.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible.tsx';

function Sample() {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="More for stake account 7xKT...A9fQ" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Button variant="outline" size="sm">
          Withdraw
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}

describe('Collapsible', () => {
  it('keeps closed content out of the DOM and opens it from the trigger', async () => {
    const user = userEvent.setup();
    const { container } = render(<Sample />);
    const trigger = screen.getByRole('button', { name: 'More for stake account 7xKT...A9fQ' });
    const content = () => container.querySelector('[data-slot="collapsible-content"]');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('data-slot', 'collapsible-trigger');
    // Closed: an empty, hidden element; the actions inside are not rendered.
    expect(content()).toHaveAttribute('hidden');
    expect(content()).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(content()).not.toHaveAttribute('hidden');
    expect(trigger).toHaveAttribute('aria-controls', content()?.id);
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeVisible();

    // Keyboard: Enter on the focused trigger closes it again.
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('injects no <style> element, which the CSP would block (DECISIONS.md D3)', async () => {
    const user = userEvent.setup();
    render(<Sample />);
    await user.click(screen.getByRole('button', { name: 'More for stake account 7xKT...A9fQ' }));
    expect(document.querySelectorAll('style')).toHaveLength(0);
  });
});
