import type { Address } from '@solana/kit';
import type { StakeAccount } from './decode.ts';
import type { ClockView } from './lockup.ts';

/**
 * Snapshot comparison for the worker's monitor (CLAUDE.md section 8). The worker stores the last seen state of every
 * watched stake account in D1, reads the account again each pass, and turns the difference into events.
 */

export type MonitorEventType =
  | 'DEACTIVATED'
  | 'DELEGATION_CHANGED'
  | 'STAKER_CHANGED'
  | 'WITHDRAWER_CHANGED'
  | 'LOCKUP_CHANGED'
  | 'BALANCE_DECREASED'
  | 'ACCOUNT_CLOSED'
  | 'EXPIRED';

/**
 * Last seen state of a watched account: the chain columns of the D1 `accounts` row
 * (apps/worker/migrations/0001_init.sql). u64 values are bigint here; D1 stores lamports and epochs as decimal TEXT.
 * Worker bookkeeping columns (created_at, last_reminder_days) are not part of the snapshot.
 */
export type AccountSnapshot = {
  stakeAccount: Address;
  withdrawer: Address;
  staker: Address;
  custodian: Address;
  /** lock_until: lockup unix timestamp in seconds; 0 = no lockup. */
  lockUntil: bigint;
  lamports: bigint;
  state: StakeAccount['kind'];
  /** Delegation columns; null for an initialized (never delegated) account. */
  voter: Address | null;
  activationEpoch: bigint | null;
  deactivationEpoch: bigint | null;
  /** Slot of the read that produced this snapshot. */
  slot: bigint;
  /** checked_at: unix milliseconds of that read. */
  checkedAt: number;
};

/** What changed in a LOCKUP_CHANGED event; several can apply at once. */
export type LockupChange = 'extended' | 'shortened' | 'removed' | 'custodian-changed';

/**
 * Event payloads. `details` is stored as details_json, so it holds only JSON values: u64 amounts and timestamps are
 * decimal strings.
 */
export type MonitorEventDetails =
  | { type: 'DEACTIVATED'; details: { deactivationEpoch: string } }
  | { type: 'DELEGATION_CHANGED'; details: { fromVoter: Address | null; toVoter: Address | null } }
  | { type: 'STAKER_CHANGED'; details: { from: Address; to: Address } }
  | { type: 'WITHDRAWER_CHANGED'; details: { from: Address; to: Address } }
  | {
      type: 'LOCKUP_CHANGED';
      details: {
        changes: readonly LockupChange[];
        fromLockUntil: string;
        toLockUntil: string;
        fromCustodian: Address;
        toCustodian: Address;
      };
    }
  | { type: 'BALANCE_DECREASED'; details: { fromLamports: string; toLamports: string } }
  | { type: 'ACCOUNT_CLOSED'; details: Record<string, never> }
  /** The lockup ran out since the previous check (lock_until was after checked_at and is not after now). */
  | { type: 'EXPIRED'; details: { lockUntil: string } };

/** One row of the `events` table; (stakeAccount, type, slot) is its UNIQUE key. */
export type MonitorEvent = MonitorEventDetails & { stakeAccount: Address; slot: bigint };

export type DiffContext = {
  /** Slot of the read that produced `next`; becomes the events' slot. */
  slot: bigint;
  /** Current time (seconds) and epoch, for EXPIRED and the deactivation check. */
  clock: ClockView;
};

/**
 * Events between the stored snapshot and the account as read now. `previous === null` is the first sighting: no
 * events. `next === null` means the account no longer exists (ACCOUNT_CLOSED). An unchanged account gives no events,
 * and each event type appears at most once per call.
 */
export function diffSnapshots(
  previous: AccountSnapshot | null,
  next: StakeAccount | null,
  context: DiffContext,
): MonitorEvent[] {
  return notImplemented(previous, next, context);
}

/** The snapshot to store for `account` as read at `slot`, at `checkedAt` (unix ms). */
export function snapshotOf(account: StakeAccount, slot: bigint, checkedAt: number): AccountSnapshot {
  return notImplemented(account, slot, checkedAt);
}

/** Placeholder body until this module is implemented; takes the parameters so they count as used. */
function notImplemented(..._args: unknown[]): never {
  throw new Error('not implemented');
}
