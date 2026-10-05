import type { Signature } from '@solana/kit';
import type { BlockhashLifetime, ChainPort, NonceLifetime, TransactionStatus } from '@stakeward/core';

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

/** One sent transaction to wait for. */
export type ConfirmationEntry = { signature: Signature; lifetime: ConfirmationLifetime };

/**
 * Waits for several sent transactions at once: each poll round reads every pending status in ONE getSignatureStatuses
 * call and, when a blockhash transaction is still unseen, the block height in ONE getBlockHeight call. The result maps
 * each signature (once, in the order given; for a repeated signature the first lifetime counts) to its outcome. The
 * deadline, the cancellation and `lastError` work as in {@link waitForConfirmation}, for the whole batch: at the
 * deadline every transaction still pending gets `timeout`.
 */
export async function waitForConfirmations(
  chain: ChainPort,
  entries: readonly ConfirmationEntry[],
  options: ConfirmationOptions = {},
): Promise<ReadonlyMap<Signature, ConfirmationOutcome>> {
  const { signal } = options;
  const commitment = options.commitment ?? 'confirmed';
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableSleep;
  const deadline = now() + (options.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS);
  const unique: ConfirmationEntry[] = [];
  for (const entry of entries) {
    if (!unique.some((known) => known.signature === entry.signature)) unique.push(entry);
  }
  const outcomes = new Map<Signature, ConfirmationOutcome>();
  let pending = unique;
  let lastError: unknown;
  const finish = (): ReadonlyMap<Signature, ConfirmationOutcome> =>
    new Map(unique.map((entry) => [entry.signature, outcomes.get(entry.signature) ?? { status: 'timeout', lastError }]));

  for (;;) {
    signal?.throwIfAborted();
    if (pending.length === 0) return finish();
    try {
      // A round of reads can take long (HttpChain retries each one; about 92 s in the worst case), so the round, not
      // only the pause between rounds, stops at the deadline and on cancel. A read left behind changes nothing: the
      // outcomes of a round count only once the whole round is done.
      const round = await withinDeadline(checkRound(chain, pending, commitment), Math.max(0, deadline - now()), signal);
      if (round === PAST_DEADLINE) return finish();
      for (const [signature, outcome] of round) outcomes.set(signature, outcome);
      pending = pending.filter((entry) => !round.has(entry.signature));
      if (pending.length === 0) return finish();
      lastError = null;
    } catch (error) {
      if (signal?.aborted === true) throw abortReason(signal);
      // HttpChain already retried this read; keep polling until the deadline and report the error if it persists.
      lastError = error;
    }
    signal?.throwIfAborted();
    const left = deadline - now();
    if (left <= 0) return finish();
    await sleep(Math.min(pollIntervalMs, left), signal);
  }
}

/** {@link waitForConfirmations} for one transaction. */
export async function waitForConfirmation(
  chain: ChainPort,
  signature: Signature,
  lifetime: ConfirmationLifetime,
  options: ConfirmationOptions = {},
): Promise<ConfirmationOutcome> {
  const outcomes = await waitForConfirmations(chain, [{ signature, lifetime }], options);
  const outcome = outcomes.get(signature);
  if (outcome === undefined) throw new Error(`No outcome for ${signature}`);
  return outcome;
}

const PAST_DEADLINE = Symbol('past deadline');

/**
 * `work`, or PAST_DEADLINE once `ms` (real time) pass first, or the signal's reason once it aborts first. The timer is a
 * real one even when tests replace `now` and `sleep`: it only bounds reads that hang.
 */
function withinDeadline<T>(work: Promise<T>, ms: number, signal: AbortSignal | undefined): Promise<T | typeof PAST_DEADLINE> {
  return new Promise((resolve, reject) => {
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      settle();
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      settle();
      resolve(PAST_DEADLINE);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        settle();
        resolve(value);
      },
      (error: unknown) => {
        settle();
        reject(error instanceof Error ? error : new Error(String(error), { cause: error }));
      },
    );
  });
}

/** One round over the pending transactions: the outcomes it settled (the others keep waiting). */
async function checkRound(
  chain: ChainPort,
  pending: readonly ConfirmationEntry[],
  commitment: 'confirmed' | 'finalized',
): Promise<Map<Signature, ConfirmationOutcome>> {
  const settled = new Map<Signature, ConfirmationOutcome>();
  const statuses = await chain.getSignatureStatuses(pending.map((entry) => entry.signature));
  // Unseen transactions that can expire (a nonce transaction never does).
  const unseen: { signature: Signature; lastValidBlockHeight: bigint }[] = [];
  pending.forEach((entry, index) => {
    const outcome = statusOutcome(statuses[index], commitment);
    if (outcome === undefined) {
      if (entry.lifetime.kind === 'blockhash') {
        unseen.push({ signature: entry.signature, lastValidBlockHeight: entry.lifetime.lastValidBlockHeight });
      }
    } else if (outcome !== null) {
      settled.set(entry.signature, outcome);
    }
  });
  if (unseen.length === 0) return settled;
  const height = await chain.getBlockHeight();
  const past = unseen.filter((entry) => height > entry.lastValidBlockHeight);
  if (past.length === 0) return settled;
  // Past the last valid height. One may have landed in the very last valid block: look once more.
  const last = await chain.getSignatureStatuses(past.map((entry) => entry.signature));
  past.forEach((entry, index) => {
    const outcome = statusOutcome(last[index], commitment);
    if (outcome === undefined) settled.set(entry.signature, { status: 'expired' });
    else if (outcome !== null) settled.set(entry.signature, outcome);
  });
  return settled;
}

/** undefined: the cluster does not know the transaction; null: it landed but is not at `commitment` yet. */
function statusOutcome(
  status: TransactionStatus | null | undefined,
  commitment: 'confirmed' | 'finalized',
): ConfirmationOutcome | null | undefined {
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
