import type { Signature } from '@solana/kit';
import {
  actionApplied,
  actionTarget,
  decodeStakeAccount,
  readNonceAccount,
  translateError,
  type ChainPort,
  type Lifetime,
  type NonceLifetime,
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
  /** A recent blockhash, or a durable nonce (signing by link); null when unknown. */
  lifetime: Lifetime | null;
  bytes: Uint8Array | null;
  /** The target account as read before building, when known (a withdrawal needs it). */
  before: StakeAccount | null;
  /**
   * Durable nonce only: the context slot of the read that found the nonce value this transaction uses. A nonce account
   * read at an older slot comes from a node that lags behind that read: it proves nothing about the nonce moving on.
   */
  nonceSlot?: bigint | undefined;
  /** The network confirmed it. */
  confirmed: boolean;
  /** Why it was uncertain until now; kept when this check learns nothing new. Default 'timeout'. */
  why?: UnknownWhy | undefined;
};

/**
 * "Did it land?" from the chain alone (CLAUDE.md section 12): the target account must show the change
 * (core `actionApplied`). Shared by the signing engine (after a confirmation, and while a link is open) and the Done
 * screen's "Check again".
 *
 * 1. One `getAccounts` over the targets, plus the nonce accounts of unconfirmed durable-nonce items, so both are read
 *    at one slot. An applied change is `done` (with the account, decoded when it is a stake account): found even when
 *    the node's status cache dropped the transaction.
 * 2. Confirmed but not applied (a lagging node): read again up to `rereads` times, `rereadDelayMs` apart, then
 *    `unknown(not-applied)`.
 * 3. The rest with a signature: one `getSignatureStatuses` (and one `getBlockHeight` when a blockhash item has no
 *    status). An error -> `failed`; landed but not applied -> `unknown(not-applied)`; no status and the blockhash
 *    passed -> `expired`; no status and the nonce account no longer holds the item's nonce value (moved, closed or
 *    unusable: the link was used, cancelled or failed, and nothing changed) -> `expired`, unless that read is older than
 *    the item's `nonceSlot` (a lagging node); otherwise still `unknown` with its earlier reason.
 * Rejects on a read failure, and with the signal's reason once aborted.
 */
export async function checkLanded(
  chain: ChainPort,
  items: readonly LandedItem[],
  options: { signal?: AbortSignal | undefined; rereads?: number | undefined; rereadDelayMs?: number | undefined } = {},
): Promise<Record<string, JobState>> {
  const results: Record<string, JobState> = {};
  const rereads = options.rereads ?? 0;
  const delay = options.rereadDelayMs ?? REREAD_DELAY_MS;

  /** Nonce account of each unconfirmed durable-nonce item, as read with its target in step 1, and the read's slot. */
  const nonces = new Map<string, NonceRead>();

  const read = async (pending: readonly LandedItem[]): Promise<LandedItem[]> => {
    const targets = pending.map((item) => actionTarget(item.action));
    const withNonce = pending.flatMap((item) => {
      const nonce = item.confirmed ? null : nonceLifetime(item);
      return nonce === null ? [] : [{ id: item.id, nonceAccount: nonce.nonceAccount }];
    });
    const { slot, accounts } = await chain.getAccounts([...targets, ...withNonce.map((item) => item.nonceAccount)]);
    options.signal?.throwIfAborted();
    withNonce.forEach((item, index) => nonces.set(item.id, { raw: accounts[targets.length + index] ?? null, slot }));
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
  options.signal?.throwIfAborted();
  // A durable nonce never expires by height: only an unseen blockhash item needs the block height.
  const unseenBlockhash = withSignature.some(
    (item, index) => (statuses[index] ?? null) === null && item.lifetime?.kind === 'blockhash',
  );
  const height = unseenBlockhash ? await chain.getBlockHeight() : null;
  options.signal?.throwIfAborted();
  withSignature.forEach((item, index) => {
    const status = statuses[index] ?? null;
    const nonce = nonceLifetime(item);
    if (status !== null && status.error !== null && status.error !== undefined) {
      results[item.id] = {
        kind: 'failed',
        error: translateError(status.error, item.bytes === null ? {} : { transaction: item.bytes }),
      };
    } else if (status === null && nonce !== null && nonceMovedOn(nonces.get(item.id), nonce, item.nonceSlot)) {
      results[item.id] = { kind: 'expired' };
    } else if (
      status === null &&
      height !== null &&
      item.lifetime?.kind === 'blockhash' &&
      height > item.lifetime.lastValidBlockHeight
    ) {
      results[item.id] = { kind: 'expired' };
    } else if (status !== null) {
      results[item.id] = { kind: 'unknown', why: 'not-applied' };
    } else {
      results[item.id] = { kind: 'unknown', why: item.why ?? 'timeout' };
    }
  });
  return results;
}

function nonceLifetime(item: LandedItem): NonceLifetime | null {
  return item.lifetime?.kind === 'nonce' ? item.lifetime : null;
}

type NonceRead = { raw: RawAccount | null; slot: bigint };

/**
 * The nonce account no longer holds the transaction's nonce value: missing, unusable, or advanced. Never from a read
 * older than `nonceSlot` (the read that found that value): a node behind it may still show an older value, or none.
 */
function nonceMovedOn(read: NonceRead | undefined, lifetime: NonceLifetime, nonceSlot: bigint | undefined): boolean {
  if (read !== undefined && nonceSlot !== undefined && read.slot < nonceSlot) return false;
  const state = readNonceAccount(read?.raw ?? null, lifetime.nonceAuthority);
  return state.kind !== 'ready' || state.value !== lifetime.nonceValue;
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
