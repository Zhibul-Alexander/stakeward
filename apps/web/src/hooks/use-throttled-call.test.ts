import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThrottledCall } from './use-throttled-call.ts';

// The /withdraw countdown's automatic re-read (step 6 spec 5.3): at most once per window, and a call inside the window
// is deferred to its end, never dropped (a second countdown that ends early must still lead to a re-read).
describe('useThrottledCall', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs at once, then defers a call inside the window to its end; one pending call at a time', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useThrottledCall(fn, 20_000));
    act(() => {
      result.current();
    });
    expect(fn).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5_000);
      result.current();
      result.current();
    });
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(14_999);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(fn).toHaveBeenCalledTimes(2);

    // After a full window, a call runs at once again.
    act(() => {
      vi.advanceTimersByTime(20_000);
      result.current();
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('a pending call never runs after unmount', () => {
    const fn = vi.fn();
    const { result, unmount } = renderHook(() => useThrottledCall(fn, 20_000));
    act(() => {
      result.current();
      result.current();
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
