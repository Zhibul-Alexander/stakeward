import { useCallback, useEffect, useRef } from 'react';

/**
 * A stable function that calls `fn` at most once per `ms`. A call inside the window is not dropped: it runs when the
 * window ends (one pending call at a time; more calls meanwhile join it). Nothing runs after unmount. `fn` is read when
 * it runs, so it may change between renders.
 */
export function useThrottledCall(fn: () => void, ms: number): () => void {
  const latest = useRef(fn);
  const last = useRef<number | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latest.current = fn;
  }, [fn]);

  useEffect(
    () => () => {
      if (pending.current !== null) clearTimeout(pending.current);
      pending.current = null;
    },
    [],
  );

  return useCallback(() => {
    if (pending.current !== null) return;
    const run = () => {
      pending.current = null;
      last.current = Date.now();
      latest.current();
    };
    const wait = last.current === null ? 0 : last.current + ms - Date.now();
    if (wait <= 0) run();
    else pending.current = setTimeout(run, wait);
  }, [ms]);
}
