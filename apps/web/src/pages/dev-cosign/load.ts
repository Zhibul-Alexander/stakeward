import { translateError, type FriendlyError } from '@stakeward/core';
import { useEffect, useEffectEvent, useState } from 'react';

export type Load<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  /** `raw`: what was thrown, for callers that recognise their own errors. */
  | { status: 'error'; error: FriendlyError; raw: unknown };

/**
 * Reads `load()` whenever `key` changes (null: nothing to read). The state is tagged with its key, so a stale answer
 * is never shown and "loading" needs no state update inside the effect. Put a refresh counter in the key to re-read.
 */
export function useLoad<T>(key: string | null, load: () => Promise<T>): Load<T> {
  const [state, setState] = useState<{ key: string; result: Load<T> } | null>(null);
  const read = useEffectEvent(load);
  useEffect(() => {
    if (key === null) return undefined;
    let live = true;
    read().then(
      (value) => {
        if (live) setState({ key, result: { status: 'ready', value } });
      },
      (error: unknown) => {
        if (live) setState({ key, result: { status: 'error', error: translateError(error), raw: error } });
      },
    );
    return () => {
      live = false;
    };
  }, [key]);
  if (key === null) return { status: 'idle' };
  return state?.key === key ? state.result : { status: 'loading' };
}
