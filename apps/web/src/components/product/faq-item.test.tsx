import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FaqItem } from './faq-item.tsx';

const QUESTION = 'What happens when the lock ends?';

function details(): HTMLDetailsElement {
  const element = document.getElementById('faq-lock-ends');
  if (!(element instanceof HTMLDetailsElement)) throw new Error('no details#faq-lock-ends');
  return element;
}

// Native <details> (D3): the browser opens it from the keyboard (Enter, Space) and from a link's hash.
// e2e/dev-ui.spec.ts presses Enter on it in a real browser; jsdom has no keyboard activation for <summary>.
describe('FaqItem', () => {
  it('is closed by default, with the question as its summary and the answer inside', () => {
    render(
      <FaqItem id="faq-lock-ends" question={QUESTION}>
        <p>It ends at 00:00 UTC on its end date.</p>
      </FaqItem>,
    );
    const item = details();
    expect(item).toHaveAttribute('data-slot', 'faq-item');
    expect(item.open).toBe(false);
    expect(item.querySelector('summary')).toHaveTextContent(QUESTION);
    expect(item).toHaveTextContent('It ends at 00:00 UTC on its end date.');
    // The browser's disclosure triangle is replaced by the chevron.
    expect(item.querySelector('summary')).toHaveClass('summary-plain');
  });

  it('is open with defaultOpen', () => {
    render(
      <FaqItem id="faq-lock-ends" question={QUESTION} defaultOpen>
        <p>Answer</p>
      </FaqItem>,
    );
    expect(details().open).toBe(true);
  });

  it('opens and closes when the question is clicked', async () => {
    const user = userEvent.setup();
    render(
      <FaqItem id="faq-lock-ends" question={QUESTION}>
        <p>Answer</p>
      </FaqItem>,
    );
    await user.click(screen.getByText(QUESTION));
    expect(details().open).toBe(true);
    await user.click(screen.getByText(QUESTION));
    expect(details().open).toBe(false);
  });

  it('the question is reachable with Tab', async () => {
    const user = userEvent.setup();
    render(
      <FaqItem id="faq-lock-ends" question={QUESTION}>
        <p>Answer</p>
      </FaqItem>,
    );
    await user.tab();
    expect(details().querySelector('summary')).toHaveFocus();
  });

  // It sits inside an FAQ group that is a <details> too: an unnamed Tailwind group would turn every chevron of an open
  // group, so the item names its own group and the chevron follows this item only.
  it('turns its chevron with its own open state, not with the group around it', () => {
    render(
      <details open className="group">
        <summary>Group</summary>
        <FaqItem id="faq-lock-ends" question={QUESTION}>
          <p>Answer</p>
        </FaqItem>
      </details>,
    );
    expect(details()).toHaveClass('group/faq-item');
    expect(details()).not.toHaveClass('group');
    expect(details().querySelector('svg')).toHaveClass('group-open/faq-item:rotate-180');
    expect(details().querySelector('svg')?.getAttribute('class')).not.toMatch(/(^|\s)group-open:/);
  });

  it('the chevron is decorative', () => {
    render(
      <FaqItem id="faq-lock-ends" question={QUESTION}>
        <p>Answer</p>
      </FaqItem>,
    );
    const icons = details().querySelectorAll('svg');
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true');
    // The summary's accessible text is the question alone.
    expect(details().querySelector('summary')?.textContent).toBe(QUESTION);
  });
});
