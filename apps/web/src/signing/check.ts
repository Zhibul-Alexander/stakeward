import type { Signature } from '@solana/kit';
import {
  actionApplied,
  actionTarget,
  decodeStakeAccount,
  translateError,
  type BlockhashLifetime,
  type ChainPort,
  type RawAccount,
  type StakeAccount,
  type TransactionAction,
} from '@stakeward/core';
import type { JobState, UnknownWhy } from './machine.ts';
import { REREAD_DELAY_MS } from './rules.ts';

/** A transaction that was (or may have been) sent, and what the chain should show if it landed. */
export type LandedItem = {
  id: string;
  action: TransactionAction;
  signature: Signature | null;
  lifetime: BlockhashLifetime | null;
  bytes: Uint8Array | null;
  /** The target account as read before building, when known (a withdrawal needs it). */
  before: StakeAccount | null;
  /** The network confirmed it. */
  confirmed: boolean;
  /** Why it was uncertain until now; kept when this check learns nothing new. Default 'timeout'. */
  why?: UnknownWhy | undefined;
};

/**
 * "Did it land?" from the chain alone (CLAUDE.md section 12): the target account must show the change
 * (core `actionApplied`). Shared by the signing engine (after a confirmation) and the Done screen's "Check again".
 *
 * 1. One `getAccounts` over the targets; an applied change is `done` (with the account, decoded when it is a stake
 *    account).
 * 2. Confirmed but not applied (a lagging node): read again up to `rereads` times, `rereadDelayMs` apart, then
 *    `unknown(not-applied)`.
 * 3. The rest with a signature: one `getSignatureStatuses` (and one `getBlockHeight` when a status is missing).
 *    An error -> `failed`; no status and the blockhash passed -> `expired`; landed but not applied ->
 *    `unknown(not-applied)`; otherwise still `unknown` with its earlier reason.
 * Rejects on a read failure (and with the signal's reason when aborted during a pause).
 */
export async function checkLanded(
  chain: ChainPort,
  items: readonly LandedItem[],
  options: { signal?: AbortSignal | undefined; rereads?: number | undefined; rereadDelayMs?: number | undefined } = {},
): Promise<Record<string, JobState>> {
  const results: Record<string, JobState> = {};
  const rereads = options.rereads ?? 0;
  const delay = options.rereadDelayMs ?? REREAD_DELAY_MS;

  const read = async (pending: readonly LandedItem[]): Promise<LandedItem[]> => {
    const { accounts } = await chain.getAccounts(pending.map((item) => actionTarget(item.action)));
    return pending.filter((item, index) => {
      const raw = accounts[index] ?? null;
      if (!actionApplied(item.action, raw, item.before)) return true;
      results[item.id] = { kind: 'done', after: stakeAccountOf(raw) };
      return false;
    });
  };

  if (items.length === 0) return results;
  const notApplied = await read(items);

  let confirmed = notApplied.filter((item) => item.confirmed);
  for (let attempt = 0; attempt < rereads && confirmed.length > 0; attempt += 1) {
    await sleep(delay, options.signal);
    confirmed = await read(confirmed);
  }
  for (const item of confirmed) results[item.id] = { kind: 'unknown', why: 'not-applied' };

  const unconfirmed = notApplied.filter((item) => !item.confirmed);
  const withSignature = unconfirmed.filter((item): item is LandedItem & { signature: Signature } => item.signature !== null);
  for (const item of unconfirmed) {
    if (item.signature === null) results[item.id] = { kind: 'unknown', why: item.why ?? 'timeout' };
  }
  if (withSignature.length === 0) return results;

  const statuses = await chain.getSignatureStatuses(withSignature.map((item) => item.signature));
  const unseen = withSignature.some((_, index) => (statuses[index] ?? null) === null);
  const height = unseen ? await chain.getBlockHeight() : null;
  withSignature.forEach((item, index) => {
    const status = statuses[index] ?? null;
    if (status !== null && status.error !== null && status.error !== undefined) {
      results[item.id] = {
        kind: 'failed',
        error: translateError(status.error, item.bytes === null ? {} : { transaction: item.bytes }),
      };
    } else if (status === null && height !== null && item.lifetime !== null && height > item.lifetime.lastValidBlockHeight) {
      results[item.id] = { kind: 'expired' };
    } else if (status !== null) {
      results[item.id] = { kind: 'unknown', why: 'not-applied' };
    } else {
      results[item.id] = { kind: 'unknown', why: item.why ?? 'timeout' };
    }
  });
  return results;
}

function stakeAccountOf(raw: RawAccount | null): StakeAccount | null {
  if (raw === null) return null;
  const decoded = decodeStakeAccount(raw);
  return decoded.ok ? decoded.account : null;
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortReason(signal));
      return;
    }
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
  const error = new Error('The check was cancelled');
  error.name = 'AbortError';
  return error;
}
