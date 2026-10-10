import type { Address } from '@solana/kit';
import {
  canSkipDecode,
  decodeStakeAccount,
  diffSnapshots,
  needsWithdrawerRescan,
  snapshotOf,
  stakeDataFingerprint,
  type MonitorEventType,
  type REMINDER_DAYS,
  type StakeAccount,
} from '@stakeward/core';
import { decodeBase64 } from '../base64.ts';
import type { ChunkRead } from './read.ts';
import { columnsOfRow, rowColumnsOf, snapshotOfRow, type AccountRow, type RowColumns } from './store.ts';

/**
 * One chunk of the monitor pass, pure (test/monitor/classify.test.ts; CPU in test/monitor-cpu.test.ts): the stored rows
 * against one getMultipleAccounts read, into row writes, events and rescan pairs. Most accounts take the fast path
 * (DECISIONS.md D49): the fingerprint of the bytes diffSnapshots reads is unchanged and the balance did not drop, so
 * there is nothing to decode and, unless rewards came in, nothing to write.
 */

/** A (main key, second key) pair whose stake accounts are searched again: Split copies both and the lock. */
export type Pair = readonly [withdrawer: Address, custodian: Address];

/** A row write, compare-and-set on the version (prevSlot, prevCheckedAt) the diff was computed from. */
export type RowUpdate = Omit<RowColumns, 'state'> & {
  state: 'initialized' | 'delegated' | 'closed';
  fingerprint: string | null;
  prevSlot: number;
  prevCheckedAt: number;
};

export type StoredEventType =
  | MonitorEventType
  | `REMINDER_${(typeof REMINDER_DAYS)[number]}`
  /** From the daily validator check (pass.ts checkValidators, D128), not from a snapshot diff. */
  | 'VALIDATOR_AT_RISK';

/** An `events` row to insert, gated on the row version (prevSlot, prevCheckedAt) it was computed from. */
export type StoredEvent = {
  stakeAccount: Address;
  type: StoredEventType;
  detailsJson: string;
  slot: number;
  prevSlot: number;
  prevCheckedAt: number;
};

export type ChunkOutcome = {
  /** rows[0..processed) are handled; the rest wait for the next pass (the decode cap was reached). */
  processed: number;
  updates: RowUpdate[];
  events: StoredEvent[];
  rescan: Pair[];
  counts: { stale: number; fastPath: number; lamportsOnly: number; decoded: number; closed: number };
};

/**
 * Classifies `rows` against `read` (read.items[i] is rows[i]'s account), decoding at most `decodeLeft` accounts.
 * Per row, in order:
 * 1. The read is older than the row (a lagging fallback node): skipped, nothing written (`stale`).
 * 2. checked_at = max(row.checked_at, cluster clock of the read): the stake program judges locks by the cluster clock,
 *    and the max keeps EXPIRED windows adjacent when a read lags.
 * 3. Fast path (core canSkipDecode): same lamports -> nothing (`fastPath`); more lamports (rewards) -> the stored row
 *    with the new balance, slot and checked_at (`lamportsOnly`).
 * 4. Decode cap reached -> stop: `processed` is this row's index.
 * 5. Full path: decode (a missing account, or one that no longer decodes as a stake account, is null), diffSnapshots,
 *    and always a write: the new snapshot and fingerprint, or `closed` with the last known columns (D25: the alerts
 *    still need its keys). Events that call for a rescan add the stored (main key, second key) pair.
 */
export function classifyChunk(rows: readonly AccountRow[], read: ChunkRead, decodeLeft: number): ChunkOutcome {
  if (read.items.length !== rows.length) {
    throw new Error(`classifyChunk: ${String(rows.length)} rows, ${String(read.items.length)} accounts read`);
  }
  const outcome: ChunkOutcome = {
    processed: rows.length,
    updates: [],
    events: [],
    rescan: [],
    counts: { stale: 0, fastPath: 0, lamportsOnly: 0, decoded: 0, closed: 0 },
  };
  const { counts } = outcome;

  for (const [index, row] of rows.entries()) {
    const item = read.items[index] ?? null;
    if (read.slot < row.slot) {
      counts.stale += 1;
      continue;
    }
    const checkedAt = Math.max(row.checked_at, read.clockMs);
    const version = { prevSlot: row.slot, prevCheckedAt: row.checked_at };
    const lamports = BigInt(row.lamports);

    if (item !== null) {
      const lockUntil = BigInt(row.lock_until);
      const stored = { fingerprint: row.fingerprint, lamports, lockUntil, checkedAt: row.checked_at };
      if (canSkipDecode(stored, item, checkedAt)) {
        if (item.lamports === lamports) {
          counts.fastPath += 1;
        } else {
          counts.lamportsOnly += 1;
          outcome.updates.push({
            ...columnsOfRow(row),
            lamports: item.lamports.toString(),
            slot: read.slot,
            checkedAt,
            fingerprint: row.fingerprint,
            ...version,
          });
        }
        continue;
      }
      if (counts.decoded >= decodeLeft) {
        outcome.processed = index;
        break;
      }
    }

    let next: StakeAccount | null = null;
    if (item !== null) {
      const data = decodeBase64(item.dataBase64);
      // parseMultipleAccounts accepts canonical base64 only, which always decodes.
      if (data === null) throw new Error('classifyChunk: account data is not canonical base64');
      counts.decoded += 1;
      const raw = { address: row.stake_account, data, lamports: item.lamports, owner: item.owner };
      const decoded = decodeStakeAccount(raw);
      if (decoded.ok) next = decoded.account;
    }

    const events = diffSnapshots(snapshotOfRow(row), next, {
      slot: BigInt(read.slot),
      checkedAt,
      clock: read.clock,
    });
    for (const event of events) {
      outcome.events.push({
        stakeAccount: event.stakeAccount,
        type: event.type,
        detailsJson: JSON.stringify(event.details),
        slot: read.slot,
        ...version,
      });
    }

    if (next === null || item === null) {
      counts.closed += 1;
      outcome.updates.push({
        ...columnsOfRow(row),
        state: 'closed',
        slot: read.slot,
        checkedAt,
        fingerprint: null,
        ...version,
      });
    } else {
      outcome.updates.push({
        ...rowColumnsOf(snapshotOf(next, BigInt(read.slot), checkedAt)),
        fingerprint: stakeDataFingerprint(item.dataBase64),
        ...version,
      });
    }

    if (needsWithdrawerRescan(events)) outcome.rescan.push([row.withdrawer, row.custodian]);
  }
  return outcome;
}
