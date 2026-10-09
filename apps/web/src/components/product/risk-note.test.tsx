import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RiskNote, riskText } from './risk-note.tsx';

const T = 1_807_488_000n; // 12 April 2027 00:00 UTC

describe('RiskNote', () => {
  it('says the risk with its date (UX rule 6); the date alone by default, so other screens stay as they are', () => {
    render(<RiskNote risk="lock-ends" date={T} />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'On 12 April 2027 the lock ends and anyone with your main key can withdraw this stake. Extend it before then.',
    );
  });

  // The recovery card's reader may live in any time zone (spec L5).
  it('dateStyle="date-time" adds the time and UTC', () => {
    render(<RiskNote risk="lock-ends" date={T} dateStyle="date-time" />);
    expect(screen.getByRole('note')).toHaveTextContent('On 12 April 2027, 00:00 UTC the lock ends');
    expect(riskText('lose-second-key', T + 600n, 'date-time')).toBe(
      'If you lose the second key, you wait until 12 April 2027, 00:10 UTC to withdraw or rescue this stake.',
    );
  });

  // At 360 px "until 3" / "April 2027" read as two facts: the note keeps the date on one line (non-breaking spaces).
  // The words stay the same; riskText, which other places quote, keeps plain spaces.
  it.each(['date', 'date-time'] as const)('keeps the date (%s) on one line', (dateStyle) => {
    render(<RiskNote risk="lose-second-key" date={T} dateStyle={dateStyle} variant="inline" />);
    const date = dateStyle === 'date' ? '12 April 2027' : '12 April 2027, 00:00 UTC';
    expect(screen.getByRole('note').textContent).toContain(` ${date.replaceAll(' ', ' ')} `);
    expect(riskText('lose-second-key', T, dateStyle)).toContain(` ${date} `);
  });

  it('renders nothing when a dated risk has no usable date', () => {
    const { container } = render(<RiskNote risk="lock-ends" dateStyle="date-time" />);
    expect(container).toBeEmptyDOMElement();
    expect(riskText('lock-ends', 10n ** 30n, 'date-time')).toBeNull();
    expect(riskText('second-key-can-freeze', undefined, 'date-time')).toBe(
      'Whoever holds the second key can freeze this stake by moving the lock date. Keep it as safe as your main key.',
    );
  });

  // The ActionBar's line right above the button it guards (D109): the same words and date, no fill, the tone's icon.
  it.each([
    ['warning', 'lose-second-key', 'If you lose the second key, you wait until 12 April 2027 to withdraw or rescue this stake.'],
    ['danger', 'unlock-opens-window', null],
  ] as const)('variant="inline" (%s): one line with the same text and an icon in the tone', (tone, risk, expected) => {
    const { container } = render(
      <RiskNote risk={risk} date={T} tone={tone} variant="inline">
        <a href="/rescue">Rescue your stake instead</a>
      </RiskNote>,
    );
    const note = screen.getByRole('note');
    expect(note).toHaveAttribute('data-slot', 'risk-note');
    expect(note).toHaveAttribute('data-variant', 'inline');
    expect(note).toHaveAttribute('data-risk', risk);
    expect(note).toHaveTextContent(expected ?? riskText(risk) ?? '');
    expect(note).toHaveTextContent('Rescue your stake instead');
    expect(container.querySelector('[data-slot="alert"]')).toBeNull();
    const icon = note.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveClass(tone === 'danger' ? 'text-danger' : 'text-warning');
  });
});
