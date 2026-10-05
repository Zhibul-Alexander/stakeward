import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Countdown, formatRemaining } from './countdown.tsx';

describe('formatRemaining', () => {
  it.each([
    [2 * 86_400 + 4 * 3_600 + 59, false, '2 d 4 h'],
    [3 * 3_600 + 5 * 60 + 9, false, '3 h 05 min'],
    [12 * 60 + 9, false, '12 min 09 s'],
    [42, false, '42 s'],
    [12 * 60 + 9, true, '13 min'],
    [42, true, '1 min'],
    [0, false, '0 s'],
  ])('%s s (coarse: %s) -> %s', (seconds, coarse, text) => {
    expect(formatRemaining(seconds, coarse)).toBe(text);
  });
});

describe('Countdown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks, announces milestones politely, ends once and calls onEnd', () => {
    vi.useFakeTimers();
    let now = 1_791_000_000_000;
    const clock = () => now;
    const onEnd = vi.fn();
    const to = BigInt(now / 1000 + 62);
    render(<Countdown to={to} label="Current epoch ends in" clock={clock} onEnd={onEnd} />);

    const timer = screen.getByRole('timer', { name: 'Current epoch ends in' });
    expect(timer).toHaveTextContent('1 min 02 s');
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent('');

    act(() => {
      now += 3_000;
      vi.advanceTimersByTime(1_000);
    });
    expect(timer).toHaveTextContent('59 s');
    expect(live).toHaveTextContent('1 min left');

    act(() => {
      now += 60_000;
      vi.advanceTimersByTime(1_000);
    });
    expect(timer).toHaveTextContent('Ended');
    expect(live).toHaveTextContent('Ended');
    expect(onEnd).toHaveBeenCalledOnce();

    act(() => {
      now += 5_000;
      vi.advanceTimersByTime(5_000);
    });
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('already over when shown: shows Ended, announces nothing and calls onEnd once (the wait it shows is over)', () => {
    vi.useFakeTimers();
    let now = 1_791_000_000_000;
    const clock = () => now;
    const onEnd = vi.fn();
    render(<Countdown to={BigInt(now / 1000 - 1)} label="Current epoch ends in" clock={clock} onEnd={onEnd} />);
    expect(screen.getByRole('timer', { name: 'Current epoch ends in' })).toHaveTextContent('Ended');
    act(() => {
      now += 5_000;
      vi.advanceTimersByTime(5_000);
    });
    expect(onEnd).toHaveBeenCalledOnce();
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('');
  });
});
