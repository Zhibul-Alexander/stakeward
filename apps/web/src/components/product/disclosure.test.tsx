import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Disclosure } from './disclosure.tsx';
import { ErrorDetails } from './error-state.tsx';

describe('Disclosure', () => {
  it('is a native <details>: closed by default, opened by its summary, its text always in the page (find-in-page)', async () => {
    const user = userEvent.setup();
    render(
      <Disclosure summary="Technical details" id="tech">
        <p>Nonce account in full</p>
      </Disclosure>,
    );
    const details = screen.getByText('Technical details').closest('details');
    if (details === null) throw new Error('no details');
    expect(details).toHaveAttribute('id', 'tech');
    expect(details).toHaveAttribute('data-slot', 'disclosure');
    expect(details).toHaveAttribute('data-variant', 'inline');
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText('Nonce account in full')).toBeInTheDocument();
    await user.click(screen.getByText('Technical details'));
    expect(details).toHaveAttribute('open');
  });

  it('defaultOpen starts open; the row variant draws its chevron at the end', () => {
    render(
      <Disclosure summary="Why a second key?" variant="row" defaultOpen>
        <p>Answer</p>
      </Disclosure>,
    );
    const details = screen.getByText('Why a second key?').closest('details');
    expect(details).toHaveAttribute('open');
    expect(details).toHaveAttribute('data-variant', 'row');
    // The chevron is decorative: the summary's name is its text alone.
    const icons = details?.querySelectorAll('summary svg') ?? [];
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true');
  });

  it('ErrorDetails sits on it: the label "Details", the raw text as plain text inside, nothing for an empty detail', () => {
    const { rerender, container } = render(<ErrorDetails detail="HTTP 500 <b>not html</b>" />);
    const details = screen.getByText('Details').closest('details');
    expect(details).toHaveAttribute('data-slot', 'disclosure');
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent('HTTP 500 <b>not html</b>');
    expect(container.querySelector('b')).toBeNull();
    rerender(<ErrorDetails detail="   " />);
    expect(container).toBeEmptyDOMElement();
  });
});
