import { useEffect, useState } from 'react';

export type CopyState = 'idle' | 'copied' | 'failed';

/** How long "Copied" / "Copy failed" stays before the button resets. */
export const COPY_FEEDBACK_MS = 2000;

/**
 * A copy button's clipboard write and its outcome, which goes back to `idle` after COPY_FEEDBACK_MS.
 * navigator.clipboard is missing on insecure origins and in some embedded wallet browsers: that reads as `failed`,
 * and the caller says how to copy by hand.
 */
export function useCopy(): { state: CopyState; copy: (text: string) => void } {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state === 'idle') return undefined;
    const timer = setTimeout(() => {
      setState('idle');
    }, COPY_FEEDBACK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  function copy(text: string) {
    void (async () => {
      try {
        if (!('clipboard' in navigator)) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(text);
        setState('copied');
      } catch {
        setState('failed');
      }
    })();
  }

  return { state, copy };
}
