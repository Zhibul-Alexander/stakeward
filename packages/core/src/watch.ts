// POST /api/watch (CLAUDE.md section 8): the worker takes a stake account under monitoring only when the chain shows a
// lock worth watching. No login and no signature: the proof is the chain itself.
import { ZERO_ADDRESS } from './constants.ts';
import { decodeStakeAccount, type RawAccount, type StakeAccount } from './decode.ts';
import type { ClockView } from './lockup.ts';

/** Accounts per POST /api/watch request; the site splits longer lists. */
export const MAX_WATCH_ACCOUNTS = 20;

/** The latest lock end accepted, counted from the cluster clock: 400 days (real ends are at most about 13 months). */
export const WATCH_MAX_LOCK_SECONDS = 400n * 86_400n;

export type WatchRejectReason = 'not-found' | 'not-stake-account' | 'not-locked' | 'unsupported-lock';

export type WatchStatus = 'watched' | 'already-watched' | 'rejected';

export type WatchVerdict = { ok: true; account: StakeAccount } | { ok: false; reason: WatchRejectReason };

/**
 * Whether `raw`, read together with the cluster `clock`, may be watched. The first failing rule wins:
 * 1. The account does not exist -> `not-found`.
 * 2. It does not decode as a usable stake account (owner, size, malformed, uninitialized, rewards pool) ->
 *    `not-stake-account`.
 * 3. The lock timestamp is not later than the cluster clock -> `not-locked`. The epoch is ignored on purpose: an
 *    epoch-only lock is `not-locked`.
 * 4. The custodian is the withdrawer (the main key alone can lift it, D14) or the zero key, or the lock ends more than
 *    WATCH_MAX_LOCK_SECONDS after the clock -> `unsupported-lock`.
 */
export function watchVerdict(raw: RawAccount | null, clock: ClockView): WatchVerdict {
  if (raw === null) return { ok: false, reason: 'not-found' };
  const decoded = decodeStakeAccount(raw);
  if (!decoded.ok) return { ok: false, reason: 'not-stake-account' };
  const { account } = decoded;
  const { lockup } = account;
  if (lockup.unixTimestamp <= clock.unixTimestamp) return { ok: false, reason: 'not-locked' };
  if (
    lockup.custodian === account.withdrawer ||
    lockup.custodian === ZERO_ADDRESS ||
    lockup.unixTimestamp > clock.unixTimestamp + WATCH_MAX_LOCK_SECONDS
  ) {
    return { ok: false, reason: 'unsupported-lock' };
  }
  return { ok: true, account };
}
