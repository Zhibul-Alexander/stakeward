import type { Address } from '@solana/kit';
import { U64_MAX } from './constants.ts';
import type { StakeAccount } from './decode.ts';
import { formatSol, formatUtcDate, shortAddress } from './format.ts';
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

/** Every event type, in the order `diffSnapshots` returns them. */
export const MONITOR_EVENT_TYPES: readonly MonitorEventType[] = [
  'DEACTIVATED',
  'DELEGATION_CHANGED',
  'STAKER_CHANGED',
  'WITHDRAWER_CHANGED',
  'LOCKUP_CHANGED',
  'BALANCE_DECREASED',
  'ACCOUNT_CLOSED',
  'EXPIRED',
];

/**
 * Last seen state of a watched account: the chain columns of the D1 `accounts` row
 * (apps/worker/migrations/0001_init.sql). u64 values are bigint here; D1 stores lamports and epochs as decimal TEXT.
 * Worker bookkeeping columns (created_at, last_reminder_days) are not part of the snapshot.
 * The lockup epoch is not stored either: Stakeward never sets it (it stays 0), so a change of it is not an event.
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
  /** The lockup ran out since the previous check (lock_until is in (previous checked_at, this checked_at]). */
  | { type: 'EXPIRED'; details: { lockUntil: string } };

/** One row of the `events` table; (stakeAccount, type, slot) is its UNIQUE key. */
export type MonitorEvent = MonitorEventDetails & { stakeAccount: Address; slot: bigint };

export type DiffContext = {
  /** Slot of the read that produced `next`; becomes the events' slot. */
  slot: bigint;
  /**
   * checked_at of this read (unix ms): exactly the value the worker stores with `snapshotOf(next, slot, checkedAt)`.
   * EXPIRED is decided on it alone: it comes out when the lockup end falls in (previous.checkedAt, checkedAt], so with
   * every pass storing its own checkedAt each end falls into exactly one pass, whenever the worker samples the clock.
   */
  checkedAt: number;
  /**
   * Current time (seconds) and epoch. `clock.unixTimestamp` only tells a shortened lock from a removed one;
   * `clock.epoch` tells whether the lockup epoch still holds the lock (no EXPIRED then).
   */
  clock: ClockView;
};

/**
 * Events between the stored snapshot and the account as read now. `previous === null` is the first sighting: no
 * events. `next === null` means the account no longer exists, or no longer decodes as a usable stake account
 * (ACCOUNT_CLOSED, and nothing else). A snapshot cannot say "closed", so ACCOUNT_CLOSED comes out again on every call
 * with `next === null`: after it the worker marks the row closed and stops diffing it (it keeps the row, the alerts
 * need its withdrawer and custodian). An unchanged account gives no events, and each event type appears at most once
 * per call, in the order of {@link MONITOR_EVENT_TYPES}.
 *
 * - DEACTIVATED: the account now has a deactivation epoch it did not have before (MAX -> E, or a new deactivation
 *   after a re-delegation, E1 -> E2).
 * - DELEGATION_CHANGED: the delegation was made or redone: another voter (including the first delegation of an
 *   initialized account), a new activation epoch (re-delegation to the same voter after a full cooldown), or a
 *   deactivation that was cancelled (re-activation, E -> MAX).
 * - STAKER_CHANGED / WITHDRAWER_CHANGED: that authority is another key.
 * - LOCKUP_CHANGED: the lockup timestamp or custodian changed. A later timestamp is `extended`; an earlier one is
 *   `removed` when it is no longer in the future (`clock.unixTimestamp` or before, e.g. 0) and `shortened` otherwise.
 * - BALANCE_DECREASED: fewer lamports (a withdrawal or a split).
 * - EXPIRED: the lockup timestamp T is unchanged and T * 1000 is in (previous.checkedAt, context.checkedAt] (at
 *   exactly T the lock is over, as in the stake program), and the lockup epoch does not hold the lock
 *   (lockup.epoch <= clock.epoch). An earlier end set by the second key is LOCKUP_CHANGED, not EXPIRED. A lock that
 *   its epoch still holds when T passes gives no EXPIRED at all: the snapshot does not store the epoch of the previous
 *   check, so its later end cannot be placed in a pass. Stakeward never sets the lockup epoch (D19).
 *
 * Throws when `next` is another account than `previous` (a caller bug).
 */
export function diffSnapshots(
  previous: AccountSnapshot | null,
  next: StakeAccount | null,
  context: DiffContext,
): MonitorEvent[] {
  if (previous === null) return [];
  const event = (payload: MonitorEventDetails): MonitorEvent => ({
    ...payload,
    stakeAccount: previous.stakeAccount,
    slot: context.slot,
  });
  if (next === null) return [event({ type: 'ACCOUNT_CLOSED', details: {} })];
  if (next.address !== previous.stakeAccount) {
    throw new Error(`Snapshot of ${previous.stakeAccount} compared with account ${next.address}`);
  }

  const now = context.clock.unixTimestamp;
  const events: MonitorEvent[] = [];
  const delegation = next.delegation;

  if (
    delegation !== null &&
    delegation.deactivationEpoch !== U64_MAX &&
    delegation.deactivationEpoch !== previous.deactivationEpoch
  ) {
    events.push(event({ type: 'DEACTIVATED', details: { deactivationEpoch: delegation.deactivationEpoch.toString() } }));
  }

  const toVoter = delegation?.voter ?? null;
  const redelegated =
    delegation !== null && previous.activationEpoch !== null && delegation.activationEpoch !== previous.activationEpoch;
  const reactivated =
    delegation !== null &&
    delegation.deactivationEpoch === U64_MAX &&
    previous.deactivationEpoch !== null &&
    previous.deactivationEpoch !== U64_MAX;
  if (toVoter !== previous.voter || redelegated || reactivated) {
    events.push(event({ type: 'DELEGATION_CHANGED', details: { fromVoter: previous.voter, toVoter } }));
  }

  if (next.staker !== previous.staker) {
    events.push(event({ type: 'STAKER_CHANGED', details: { from: previous.staker, to: next.staker } }));
  }
  if (next.withdrawer !== previous.withdrawer) {
    events.push(event({ type: 'WITHDRAWER_CHANGED', details: { from: previous.withdrawer, to: next.withdrawer } }));
  }

  const { lockup } = next;
  const changes: LockupChange[] = [];
  if (lockup.unixTimestamp > previous.lockUntil) changes.push('extended');
  else if (lockup.unixTimestamp < previous.lockUntil) changes.push(lockup.unixTimestamp <= now ? 'removed' : 'shortened');
  if (lockup.custodian !== previous.custodian) changes.push('custodian-changed');
  if (changes.length > 0) {
    events.push(
      event({
        type: 'LOCKUP_CHANGED',
        details: {
          changes,
          fromLockUntil: previous.lockUntil.toString(),
          toLockUntil: lockup.unixTimestamp.toString(),
          fromCustodian: previous.custodian,
          toCustodian: lockup.custodian,
        },
      }),
    );
  }

  if (next.lamports < previous.lamports) {
    events.push(
      event({
        type: 'BALANCE_DECREASED',
        details: { fromLamports: previous.lamports.toString(), toLamports: next.lamports.toString() },
      }),
    );
  }

  const lockUntil = previous.lockUntil;
  const endMs = lockUntil * 1000n;
  const endedInThisPass =
    endMs > BigInt(Math.floor(previous.checkedAt)) && endMs <= BigInt(Math.floor(context.checkedAt));
  const heldByEpoch = lockup.epoch > context.clock.epoch;
  if (lockup.unixTimestamp === lockUntil && endedInThisPass && !heldByEpoch) {
    events.push(event({ type: 'EXPIRED', details: { lockUntil: lockUntil.toString() } }));
  }

  return events;
}

/** The snapshot to store for `account` as read at `slot`, at `checkedAt` (unix ms). */
export function snapshotOf(account: StakeAccount, slot: bigint, checkedAt: number): AccountSnapshot {
  const { delegation } = account;
  return {
    stakeAccount: account.address,
    withdrawer: account.withdrawer,
    staker: account.staker,
    custodian: account.lockup.custodian,
    lockUntil: account.lockup.unixTimestamp,
    lamports: account.lamports,
    state: account.kind,
    voter: delegation?.voter ?? null,
    activationEpoch: delegation?.activationEpoch ?? null,
    deactivationEpoch: delegation?.deactivationEpoch ?? null,
    slot,
    checkedAt,
  };
}

/**
 * Event types after which the monitor searches the withdrawer's accounts again in the same pass, to catch a Split
 * (CLAUDE.md section 8: DEACTIVATED, STAKER_CHANGED, BALANCE_DECREASED). ACCOUNT_CLOSED is added: a Split of the whole
 * balance empties the source account, and the stake program then closes it. Search by the stored (previous)
 * withdrawer: the new account carries the authorities the source had.
 */
export const WITHDRAWER_RESCAN_EVENTS: ReadonlySet<MonitorEventType> = new Set<MonitorEventType>([
  'DEACTIVATED',
  'STAKER_CHANGED',
  'BALANCE_DECREASED',
  'ACCOUNT_CLOSED',
]);

/** True when any of `events` calls for a new search of the withdrawer's accounts. */
export function needsWithdrawerRescan(events: readonly { type: MonitorEventType }[]): boolean {
  return events.some((e) => WITHDRAWER_RESCAN_EVENTS.has(e.type));
}

/**
 * A Telegram alert: plain text without markup, and one link button. `path` is a site path such as `/rescue` or
 * `/app?address=...`; the worker prefixes the Stakeward domain (alerts link only there, CLAUDE.md section 11).
 */
export type Alert = { text: string; buttonLabel: string; path: string };

export type AlertContext = {
  /** Withdrawer of the account as stored after this pass; the accounts page link opens for this address. */
  withdrawer: Address;
  /**
   * Lockup end of the account as stored after this pass (unix seconds, 0 = none). The texts call the lock in force
   * while `lockUntil > now`; a lock its epoch holds past that is not modelled (Stakeward never sets the epoch, D19).
   */
  lockUntil: bigint;
  /** Current time, unix seconds. */
  now: bigint;
};

/**
 * The alert for one event. Key roles use the UI names only (UX rule 4: main key, second key; never "custodian" or
 * "withdrawer"). Example (CLAUDE.md section 8): "Stake 7xK...9fQ was deactivated. If this was not you, your main key
 * may be stolen. Your SOL cannot be withdrawn without the second key." with the button "Open Rescue".
 */
export function formatAlert(event: MonitorEventDetails & { stakeAccount: Address }, context: AlertContext): Alert {
  const stakeName = `stake ${shortAddress(event.stakeAccount)}`;
  const stake = `Stake ${shortAddress(event.stakeAccount)}`;
  const accountsPage = `/app?address=${context.withdrawer}`;
  const mainKeyStolen = 'If this was not you, your main key may be stolen.';
  const lockLine =
    context.lockUntil > context.now
      ? 'Your SOL cannot be withdrawn without the second key.'
      : 'The lock is not in force, so the main key alone can withdraw this SOL.';
  const rescue = (what: string): Alert => ({
    text: `${what} ${mainKeyStolen} ${lockLine}`,
    buttonLabel: 'Open Rescue',
    path: '/rescue',
  });

  switch (event.type) {
    case 'DEACTIVATED':
      return rescue(`${stake} was deactivated.`);
    case 'DELEGATION_CHANGED': {
      const { fromVoter, toVoter } = event.details;
      const validator = (voter: Address) => `validator ${shortAddress(voter)}`;
      let what: string;
      if (toVoter === null) what = `${stake} is no longer delegated.`;
      else if (fromVoter === null) what = `${stake} was delegated to ${validator(toVoter)}.`;
      else if (fromVoter === toVoter) what = `${stake} was delegated again to ${validator(toVoter)}.`;
      else what = `${stake} was moved from ${validator(fromVoter)} to ${validator(toVoter)}.`;
      return rescue(what);
    }
    case 'STAKER_CHANGED':
      return rescue(
        `The key that can deactivate and delegate ${stakeName} changed to ${shortAddress(event.details.to)}.`,
      );
    case 'WITHDRAWER_CHANGED': {
      const who =
        context.lockUntil > context.now
          ? 'This also needs the second key. If this was not your rescue, both of your keys may be stolen.'
          : mainKeyStolen;
      return {
        text: `The main key of ${stakeName} changed to ${shortAddress(event.details.to)}. ${who}`,
        buttonLabel: 'Open Stakeward',
        path: `/app?address=${event.details.to}`,
      };
    }
    case 'LOCKUP_CHANGED': {
      const { changes, fromLockUntil, toLockUntil, toCustodian } = event.details;
      const lockOf = `The lock on ${stakeName}`;
      const until = dateOrFallback(BigInt(toLockUntil));
      const removed = changes.includes('removed');
      const sentences: string[] = [];
      if (changes.includes('extended')) sentences.push(`${lockOf} was extended to ${until}.`);
      else if (changes.includes('shortened')) sentences.push(`${lockOf} was shortened to ${until}.`);
      else if (removed) sentences.push(`${lockOf} was removed.`);
      if (changes.includes('custodian-changed')) {
        sentences.push(
          sentences.length === 0
            ? `The second key of ${stakeName} changed to ${shortAddress(toCustodian)}.`
            : `Its second key is now ${shortAddress(toCustodian)}.`,
        );
      }
      // While the old lock was in force only the second key could change it; after it ended the main key could.
      sentences.push(
        BigInt(fromLockUntil) > context.now
          ? 'Only the second key can do this. If this was not you, your second key may be stolen.'
          : mainKeyStolen,
      );
      if (removed) sentences.push('The main key alone can now withdraw this SOL.');
      return { text: sentences.join(' '), buttonLabel: 'Open Stakeward', path: accountsPage };
    }
    case 'BALANCE_DECREASED': {
      const from = BigInt(event.details.fromLamports);
      const to = BigInt(event.details.toLamports);
      return {
        text:
          `${formatSol(from - to)} left ${stakeName}; ${formatSol(to)} remains. ` +
          `This can be a withdrawal or a split into a new stake account. ${mainKeyStolen} ${lockLine}`,
        buttonLabel: 'Open Stakeward',
        path: accountsPage,
      };
    }
    case 'ACCOUNT_CLOSED':
      return {
        text: `${stake} was closed: its SOL was withdrawn or moved into another stake account. ${mainKeyStolen}`,
        buttonLabel: 'Open Stakeward',
        path: accountsPage,
      };
    case 'EXPIRED':
      return {
        text:
          `The lock on ${stakeName} ended on ${dateOrFallback(BigInt(event.details.lockUntil))}. ` +
          'The main key alone can now withdraw this SOL. Protect it again to keep it safe.',
        buttonLabel: 'Protect again',
        path: accountsPage,
      };
  }
}

/** Days before the lockup end T at which the daily pass sends a reminder (CLAUDE.md section 8). */
export const REMINDER_DAYS = [30, 14, 7, 3, 1] as const;

const DAY_SECONDS = 86_400n;

/**
 * Which reminder is due now, or null. The due threshold is the smallest of {@link REMINDER_DAYS} that the time left
 * fits in (6.5 days left -> 7). It is due unless it equals `lastReminderDays` (the D1 column the worker stores the
 * result in; the worker clears it when the lock end changes, so a new end starts the reminders over even when its
 * first threshold is the one last sent). Null when the lock has ended or more than 30 days are left.
 */
export function reminderDue(lockUntil: bigint, now: bigint, lastReminderDays: number | null): number | null {
  const left = lockUntil - now;
  if (left <= 0n) return null;
  const due = [...REMINDER_DAYS].reverse().find((days) => left <= BigInt(days) * DAY_SECONDS);
  if (due === undefined || due === lastReminderDays) return null;
  return due;
}

/**
 * The reminder that the lock on `stakeAccount` ends soon (when {@link reminderDue} says so); the button opens the
 * extend page for the second key. The day count rounds up: 6 days 18 hours left reads "in 7 days".
 */
export function formatReminder(input: { stakeAccount: Address; lockUntil: bigint; now: bigint }): Alert {
  const left = input.lockUntil - input.now;
  const lockOf = `The lock on stake ${shortAddress(input.stakeAccount)}`;
  const date = dateOrFallback(input.lockUntil);
  if (left <= 0n) {
    // Not sent by the monitor (EXPIRED covers it); the second key can no longer extend an ended lock.
    return {
      text: `${lockOf} ended on ${date}. The main key alone can now withdraw this SOL. Protect it again to keep it safe.`,
      buttonLabel: 'Open Stakeward',
      path: '/app',
    };
  }
  const days = (left + DAY_SECONDS - 1n) / DAY_SECONDS;
  const when = days === 1n ? 'within a day' : `in ${days.toString()} days`;
  return {
    text:
      `${lockOf} ends on ${date} (${when}). After that the main key alone can withdraw this SOL. ` +
      'Your second key can extend the lock.',
    buttonLabel: 'Extend lock',
    path: `/extend/${input.stakeAccount}`,
  };
}

function dateOrFallback(unixSeconds: bigint): string {
  return formatUtcDate(unixSeconds) ?? 'a date far in the future';
}
