import type { Signature } from '@solana/kit';
import type { BlockhashLifetime, ChainPort, NonceLifetime } from '@stakeward/core';

/**
 * Waiting for a sent transaction (CLAUDE.md section 3: no WebSocket, poll getSignatureStatuses until it is confirmed
 * or its blockhash expires). Every wait is finite and cancellable (section 12, UX rule 7): it ends with one of the
 * outcomes below, or rejects with the signal's reason when cancelled.
 */
export type ConfirmationOutcome =
  /** Landed and reached the requested commitment. Re-read the accounts before showing success (section 12). */
  | { status: 'confirmed'; slot: bigint; confirmationStatus: 'confirmed' | 'finalized' }
  /** Landed with an error (`translateError(error, { transaction })` explains it). */
  | { status: 'failed'; slot: bigint; error: unknown }
  /** Never landed and its blockhash is past lastValidBlockHeight: it never will. Safe to build and sign again. */
  | { status: 'expired' }
  /**
   * Gave up waiting. Not proof that it failed: a nonce transaction can still land, and so can one whose status could
   * not be read. `lastError` is the last read failure, if any. Offer to check again.
   */
  | { status: 'timeout'; lastError: unknown };

/** What the wait needs from the lifetime the transaction was built with (core's Lifetime fits). */
export type ConfirmationLifetime = Pick<BlockhashLifetime, 'kind' | 'lastValidBlockHeight'> | Pick<NonceLifetime, 'kind'>;

export type ConfirmationOptions = {
  signal?: AbortSignal;
  /** Default 'confirmed'. */
  commitment?: 'confirmed' | 'finalized';
  /** Between status checks. Default 2 s. */
  pollIntervalMs?: number;
  /** Upper bound of the whole wait, for both lifetimes. Default 120 s (a blockhash lives about 60-90 s). */
  timeoutMs?: number;
  /** Clock and timer, replaceable in tests. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export const DEFAULT_POLL_INTERVAL_MS = 2_000;
export const DEFAULT_CONFIRMATION_TIMEOUT_MS = 120_000;

export async function waitForConfirmation(
  chain: ChainPort,
  signature: Signature,
  lifetime: ConfirmationLifetime,
  options: ConfirmationOptions = {},
): Promise<ConfirmationOutcome> {
  const { signal } = options;
  const commitment = options.commitment ?? 'confirmed';
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableSleep;
  const deadline = now() + (options.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS);
  let lastError: unknown;

  for (;;) {
    signal?.throwIfAborted();
    try {
      const outcome = await check(chain, signature, lifetime, commitment);
      if (outcome !== null) return outcome;
      lastError = null;
    } catch (error) {
      // HttpChain already retried this read; keep polling until the deadline and report the error if it persists.
      lastError = error;
    }
    signal?.throwIfAborted();
    const left = deadline - now();
    if (left <= 0) return { status: 'timeout', lastError };
    await sleep(Math.min(pollIntervalMs, left), signal);
  }
}

/** One round: an outcome, or null to keep waiting. */
async function check(
  chain: ChainPort,
  signature: Signature,
  lifetime: ConfirmationLifetime,
  commitment: 'confirmed' | 'finalized',
): Promise<ConfirmationOutcome | null> {
  const landed = await statusOutcome(chain, signature, commitment);
  if (landed !== undefined) return landed;
  if (lifetime.kind !== 'blockhash') return null;
  if ((await chain.getBlockHeight()) <= lifetime.lastValidBlockHeight) return null;
  // Past the last valid height. It may have landed in the very last valid block: look once more.
  const last = await statusOutcome(chain, signature, commitment);
  return last === undefined ? { status: 'expired' } : last;
}

/** undefined: the cluster does not know the transaction; null: it landed but is not at `commitment` yet. */
async function statusOutcome(
  chain: ChainPort,
  signature: Signature,
  commitment: 'confirmed' | 'finalized',
): Promise<ConfirmationOutcome | null | undefined> {
  const [status] = await chain.getSignatureStatuses([signature]);
  if (status === null || status === undefined) return undefined;
  if (status.error !== null && status.error !== undefined) return { status: 'failed', slot: status.slot, error: status.error };
  const reached = status.confirmationStatus;
  if (reached === 'finalized' || (reached === 'confirmed' && commitment === 'confirmed')) {
    return { status: 'confirmed', slot: status.slot, confirmationStatus: reached };
  }
  return null;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error('The wait was cancelled');
  error.name = 'AbortError';
  return error;
}
