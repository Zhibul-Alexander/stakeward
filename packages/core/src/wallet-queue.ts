/**
 * Requests to one wallet, one after another (CLAUDE.md section 6): Phantom fails a second approval window while one is
 * open (-32002). A request whose signal aborts (the user pressed Stop waiting or left the screen) rejects at once with
 * the signal's reason and stops holding up the requests behind it, even when the wallet never answers it (a lost
 * popup, a reloaded extension): otherwise every later connect and sign would wait behind it until a page reload. If
 * the wallet's prompt is in fact still open, the wallet answers the next request with its busy error (WalletBusyError
 * in the ports). A request without a signal holds the queue until the wallet answers it.
 */
export type WalletRequestQueue = <T>(task: () => Promise<T>, signal?: AbortSignal) => Promise<T>;

export function createWalletRequestQueue(): WalletRequestQueue {
  // Settles once every request so far was answered or abandoned; never rejects.
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const previous = tail;
    const run = previous.then(() => {
      // Abandoned while it waited for its turn: the wallet is never asked.
      if (signal?.aborted === true) throw abortReason(signal);
      return task();
    });
    const result = signal === undefined ? run : untilAborted(run, signal);
    tail = previous.then(() => result).catch(() => undefined);
    return result;
  };
}

function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(abortReason(signal));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error), { cause: error }));
      },
    );
  });
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  const error = new Error('Stopped waiting for the wallet');
  error.name = 'AbortError';
  return error;
}
