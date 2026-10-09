import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert, AlertDescription, AlertTitle } from './alert.tsx';

describe('Alert', () => {
  // The /cosign stop panel (size="lg") has larger text in its body too, not only in its title: the description takes
  // its size from the Alert instead of setting text-sm itself.
  it.each([
    ['md', 'text-sm'],
    ['lg', 'text-base'],
  ] as const)('size %s: title and description both take the Alert\'s %s', (size, textClass) => {
    render(
      <Alert tone="danger" size={size}>
        <AlertTitle>Do not sign this</AlertTitle>
        <AlertDescription>
          <p>The new owner is not one of the wallets signing this transaction.</p>
        </AlertDescription>
      </Alert>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass(textClass);
    const description = screen.getByText('The new owner is not one of the wallets signing this transaction.').parentElement;
    expect(description).toHaveAttribute('data-slot', 'alert-description');
    expect(description?.className).not.toMatch(/(^|\s)text-(xs|sm|base|lg|2xl|3xl)(\s|$)/);
    expect(screen.getByText('Do not sign this').className).not.toMatch(/(^|\s)text-(xs|sm|base|lg|2xl|3xl)(\s|$)/);
  });

  it('underlines prose links in the description but not a button rendered as a link', () => {
    render(
      <Alert tone="warning">
        <AlertDescription>
          <a href="#faq">Read why</a>
        </AlertDescription>
      </Alert>,
    );
    expect(screen.getByText('Read why').parentElement).toHaveClass('[&_a:not([data-slot=button])]:underline');
  });
});
