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

  it('renders nothing when a dated risk has no usable date', () => {
    const { container } = render(<RiskNote risk="lock-ends" dateStyle="date-time" />);
    expect(container).toBeEmptyDOMElement();
    expect(riskText('lock-ends', 10n ** 30n, 'date-time')).toBeNull();
    expect(riskText('second-key-can-freeze', undefined, 'date-time')).toBe(
      'Whoever holds the second key can freeze this stake by moving the lock date. Keep it as safe as your main key.',
    );
  });
});
