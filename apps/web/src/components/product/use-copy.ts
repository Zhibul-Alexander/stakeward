import { useEffect, useState } from 'react';

export type CopyState = 'idle' | 'copied' | 'failed';

/** How long "Copied" / "Copy failed" stays before the button resets. */
const COPY_FEEDBACK_MS = 2000;

/**
 * Copy to the clipboard with feedback that resets after `feedbackMs`: the copy buttons of AddressText and
 * CommandBlock. `failed` when the browser refuses; the caller then says how to copy by hand.
 */
export function useCopy(feedbackMs = COPY_FEEDBACK_MS): { state: CopyState; copy: (text: string) => Promise<void> } {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state === 'idle') return undefined;
    const timer = setTimeout(() => {
      setState('idle');
    }, feedbackMs);
    return () => {
      clearTimeout(timer);
    };
  }, [state, feedbackMs]);

  async function copy(text: string) {
    try {
      // navigator.clipboard is missing on insecure origins and in some embedded wallet browsers.
      if (!('clipboard' in navigator)) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return { state, copy };
}
