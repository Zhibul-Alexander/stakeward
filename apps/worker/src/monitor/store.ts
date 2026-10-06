import type { Address } from '@solana/kit';
import {
  reminderDue,
  snapshotOf,
  stakeDataFingerprint,
  type AccountSnapshot,
  type StakeAccount,
} from '@stakeward/core';
import type { RowUpdate, StoredEvent } from './classify.ts';

/**
 * Every SQL statement of the monitor, the Telegram webhook and the public API (D1, migrations 0001 and 0002), and the
 * helpers that bind them. Statements are literals with `?n` parameters only; a list goes in as ONE JSON parameter read
 * with json_each. In JSON parameters u64 and i64 values are decimal strings, slot, checked_at and ids are JSON numbers
 * (below 2^53), meta values are strings.
 *
 * `accounts.lock_until` is an INTEGER that may hold any i64 (a lock can end at i64::MAX). D1 hands INTEGER columns to
 * JavaScript as numbers, which round above 2^53, so it is always read as `CAST(lock_until AS TEXT)` and written as
 * `CAST(<decimal string> AS INTEGER)`. `(slot, checked_at)` is the version of an `accounts` row: every monitor write
 * to a row checks it (compare-and-set), so two passes never both apply the same change.
 *
 * `INSERT ... SELECT ... ON CONFLICT` always has a WHERE clause: without one SQLite cannot tell the upsert's ON from a
 * join constraint.
 */

/** A watched account as PAGE returns it (never `closed`). `lock_until` and the u64 columns are decimal strings. */
export type AccountRow = {
  stake_account: Address;
  withdrawer: Address;
  staker: Address;
  custodian: Address;
  lock_until: string;
  lamports: string;
  state: 'initialized' | 'delegated';
  voter: Address | null;
  activation_epoch: string | null;
  deactivation_epoch: string | null;
  slot: number;
  checked_at: number;
  last_reminder_days: number | null;
  fingerprint: string | null;
};

/** A PENDING row: an undelivered event with its account's keys and lock end as stored now. */
export type PendingRow = {
  id: number;
  stake_account: Address;
  type: string;
  details_json: string;
  detected_at: number;
  withdrawer: Address;
  custodian: Address;
  lock_until: string;
};

/** A LINKS_FOR row. */
export type LinkRow = { wallet: Address; chat_id: string; last_event_id: number };

/** The chain columns of an `accounts` row, as the JSON payload of a write: u64 and i64 as decimal strings. */
export type RowColumns = {
  stakeAccount: Address;
  withdrawer: Address;
  staker: Address;
  custodian: Address;
  lockUntil: string;
  lamports: string;
  state: 'initialized' | 'delegated';
  voter: Address | null;
  activationEpoch: string | null;
  deactivationEpoch: string | null;
  slot: number;
  checkedAt: number;
};

/** A row for INSERT_WATCHED: the first sighting of an account (POST /api/watch, or a monitor rescan). */
export type WatchRow = RowColumns & { lastReminderDays: number | null; fingerprint: string | null };

export const SQL = {
  LOAD_META: `SELECT key, value FROM meta`,

  // ?1 lease JSON {"pass","until"}, ?2 now ms, ?3 pass id. Returns the row only when this pass holds the lease: it was
  // free or expired, or this pass already holds it (a retried acquire is idempotent).
  LEASE_ACQUIRE: `INSERT INTO meta (key, value) VALUES ('pass_lease', ?1)
ON CONFLICT (key) DO UPDATE SET value = excluded.value
WHERE CAST(meta.value ->> '$.until' AS INTEGER) <= ?2 OR meta.value ->> '$.pass' = ?3
RETURNING value`,

  // ?1 = rows per pass (plan.maxChunks * 99), from the cursor on.
  PAGE: `SELECT stake_account, withdrawer, staker, custodian, CAST(lock_until AS TEXT) AS lock_until, lamports, state,
       voter, activation_epoch, deactivation_epoch, slot, checked_at, last_reminder_days, fingerprint
FROM accounts
WHERE state != 'closed'
  AND stake_account > COALESCE((SELECT value FROM meta WHERE key = 'cursor'), '')
ORDER BY stake_account LIMIT ?1`,

  // ?1 = [{a, t, d, s, ps, pc}], ?2 = detected_at ms. Gate: the row still has the version the diff read.
  CHUNK_EVENTS: `INSERT INTO events (stake_account, type, details_json, slot, detected_at)
SELECT e.value ->> '$.a', e.value ->> '$.t', e.value ->> '$.d', e.value ->> '$.s', ?2
FROM json_each(?1) AS e
WHERE EXISTS (SELECT 1 FROM accounts a
              WHERE a.stake_account = e.value ->> '$.a'
                AND a.slot = e.value ->> '$.ps' AND a.checked_at = e.value ->> '$.pc')
ON CONFLICT (stake_account, type, slot) DO NOTHING`,

  // ?1 = [RowUpdate]. Compare-and-set on the version; comes AFTER CHUNK_EVENTS in the same batch. A new lock end
  // starts the reminders over (SET reads the row as it was before the update): the threshold last sent for the old
  // end must not hold back the same threshold for the new one (an extension right after the 30-day reminder).
  CHUNK_UPDATE: `UPDATE accounts SET
  withdrawer = u.value ->> '$.withdrawer', staker = u.value ->> '$.staker', custodian = u.value ->> '$.custodian',
  lock_until = CAST(u.value ->> '$.lockUntil' AS INTEGER), lamports = u.value ->> '$.lamports',
  state = u.value ->> '$.state', voter = u.value ->> '$.voter',
  activation_epoch = u.value ->> '$.activationEpoch', deactivation_epoch = u.value ->> '$.deactivationEpoch',
  slot = u.value ->> '$.slot', checked_at = u.value ->> '$.checkedAt', fingerprint = u.value ->> '$.fingerprint',
  last_reminder_days = CASE WHEN accounts.lock_until = CAST(u.value ->> '$.lockUntil' AS INTEGER)
                            THEN accounts.last_reminder_days END
FROM json_each(?1) AS u
WHERE accounts.stake_account = u.value ->> '$.stakeAccount'
  AND accounts.slot = u.value ->> '$.prevSlot' AND accounts.checked_at = u.value ->> '$.prevCheckedAt'`,

  // ?1 = JSON object of string values, ?2 = pass id. Fenced: a pass that lost its lease writes nothing.
  PUT_META: `INSERT INTO meta (key, value)
SELECT m.key, m.value FROM json_each(?1) AS m
WHERE EXISTS (SELECT 1 FROM meta WHERE key = 'pass_lease' AND value ->> '$.pass' = ?2)
ON CONFLICT (key) DO UPDATE SET value = excluded.value`,

  // ?1 = now s. Closed rows included: a rescan can reopen a row closed by a bad answer.
  DAILY_PAIRS: `SELECT DISTINCT withdrawer, custodian FROM accounts WHERE lock_until > ?1 ORDER BY withdrawer, custodian`,

  // ?1 = now s, ?2 = the last stake account of the previous page ('' = from the start), ?3 = page size. Live locks
  // ending within 30 days whose reminder is due: the CASE is core reminderDue (1, 3, 7, 14 or 30 days left; a test
  // holds them equal), and a threshold already recorded in last_reminder_days takes no place in the page. Keyset by
  // address: a page that comes back full is followed by the next one after its last row, so every row of the window
  // is reached however many locks end before it (anyone can have locks watched, D49).
  DAILY_REMINDER_ROWS: `SELECT stake_account, CAST(lock_until AS TEXT) AS lock_until, last_reminder_days, slot, checked_at
FROM accounts
WHERE stake_account > ?2 AND state != 'closed' AND lock_until > ?1 AND lock_until <= ?1 + 2592000
  AND last_reminder_days IS NOT (CASE WHEN lock_until <= ?1 + 86400 THEN 1
                                      WHEN lock_until <= ?1 + 259200 THEN 3
                                      WHEN lock_until <= ?1 + 604800 THEN 7
                                      WHEN lock_until <= ?1 + 1209600 THEN 14
                                      ELSE 30 END)
ORDER BY stake_account LIMIT ?3`,

  // Reminder events go through CHUNK_EVENTS (t = 'REMINDER_<d>', s = ps = row slot, pc = row checked_at).
  // ?1 = [{a, days, ps, pc}]
  REMINDER_DAYS: `UPDATE accounts SET last_reminder_days = r.value ->> '$.days'
FROM json_each(?1) AS r
WHERE accounts.stake_account = r.value ->> '$.a'
  AND accounts.slot = r.value ->> '$.ps' AND accounts.checked_at = r.value ->> '$.pc'`,

  // ?1 = how many. Walks the partial index events_pending (id) WHERE notified_at IS NULL (migration 0003): it reads
  // the undelivered rows only, however many events were delivered before.
  PENDING: `SELECT e.id, e.stake_account, e.type, e.details_json, e.detected_at,
       a.withdrawer, a.custodian, CAST(a.lock_until AS TEXT) AS lock_until
FROM events e JOIN accounts a ON a.stake_account = e.stake_account
WHERE e.notified_at IS NULL ORDER BY e.id LIMIT ?1`,

  // ?1 = [wallet]
  LINKS_FOR: `SELECT wallet, chat_id, last_event_id FROM alert_links WHERE wallet IN (SELECT value FROM json_each(?1))`,

  // ?1 = [{chat, id}]: advances every link of the chat.
  LINK_PROGRESS: `UPDATE alert_links SET last_event_id = max(last_event_id, p.value ->> '$.id')
FROM json_each(?1) AS p WHERE alert_links.chat_id = p.value ->> '$.chat'`,

  // ?1 = [chat_id]
  UNLINK_CHATS: `DELETE FROM alert_links WHERE chat_id IN (SELECT value FROM json_each(?1))`,

  // ?1 = [id], ?2 = now ms
  MARK_NOTIFIED: `UPDATE events SET notified_at = ?2 WHERE notified_at IS NULL AND id IN (SELECT value FROM json_each(?1))`,

  // ?1 = [stake account]
  KNOWN_LIVE: `SELECT stake_account FROM accounts WHERE state != 'closed' AND stake_account IN (SELECT value FROM json_each(?1))`,

  // ?1 = [WatchRow], ?2 = created_at ms. Inserts a new row; revives a closed row only from a fresher read; never
  // touches a live row (a thief must not refresh the snapshot of the account they just deactivated).
  INSERT_WATCHED: `INSERT INTO accounts (stake_account, withdrawer, staker, custodian, lock_until, lamports, state, voter,
                      activation_epoch, deactivation_epoch, slot, checked_at, last_reminder_days, created_at, fingerprint)
SELECT r.value ->> '$.stakeAccount', r.value ->> '$.withdrawer', r.value ->> '$.staker', r.value ->> '$.custodian',
       CAST(r.value ->> '$.lockUntil' AS INTEGER), r.value ->> '$.lamports', r.value ->> '$.state', r.value ->> '$.voter',
       r.value ->> '$.activationEpoch', r.value ->> '$.deactivationEpoch', r.value ->> '$.slot', r.value ->> '$.checkedAt',
       r.value ->> '$.lastReminderDays', ?2, r.value ->> '$.fingerprint'
FROM json_each(?1) AS r WHERE true
ON CONFLICT (stake_account) DO UPDATE SET
  withdrawer = excluded.withdrawer, staker = excluded.staker, custodian = excluded.custodian,
  lock_until = excluded.lock_until, lamports = excluded.lamports, state = excluded.state, voter = excluded.voter,
  activation_epoch = excluded.activation_epoch, deactivation_epoch = excluded.deactivation_epoch,
  slot = excluded.slot, checked_at = excluded.checked_at, last_reminder_days = excluded.last_reminder_days,
  fingerprint = excluded.fingerprint
WHERE accounts.state = 'closed' AND excluded.slot > accounts.slot`,

  // The /start batch (telegram/webhook.ts): LINK_COUNT, LINK_WALLET, LINK_STATE. meta.link_writes counts the links
  // /start added on one UTC day: {"day", "n": all chats, "chats": {"<chat id>": n}, "last": token}. LINK_COUNT counts
  // the link only when it is new and every limit allows it, and leaves its token in "last"; LINK_WALLET inserts only
  // under that token. A batch is one transaction, so a link is added exactly when it is counted. A new day starts
  // from 0 with no chats. Chat ids are decimal integers: safe inside a JSON path label.

  // ?1 wallet, ?2 chat, ?3 today (YYYY-MM-DD, UTC), ?4 token, ?5 links per chat (20), ?6 links per day (all chats),
  // ?7 links per chat per day.
  LINK_COUNT: `INSERT INTO meta (key, value)
SELECT 'link_writes', json_object('day', ?3, 'n', d.n + 1, 'chats', json_set(d.chats, '$."' || ?2 || '"', d.chat_n + 1), 'last', ?4)
FROM (SELECT COALESCE(m.value ->> '$.n', 0) AS n, COALESCE(m.value -> '$.chats', '{}') AS chats,
             COALESCE(m.value ->> ('$.chats."' || ?2 || '"'), 0) AS chat_n
      FROM (SELECT 1) AS one LEFT JOIN meta m ON m.key = 'link_writes' AND m.value ->> '$.day' = ?3) AS d
WHERE NOT EXISTS (SELECT 1 FROM alert_links WHERE wallet = ?1 AND chat_id = ?2)
  AND (SELECT COUNT(*) FROM alert_links WHERE chat_id = ?2) < ?5
  AND d.n < ?6 AND d.chat_n < ?7
ON CONFLICT (key) DO UPDATE SET value = excluded.value`,

  // ?1 wallet, ?2 chat, ?3 now ms, ?4 token: inserts only after a LINK_COUNT with this token counted it.
  LINK_WALLET: `INSERT INTO alert_links (wallet, chat_id, created_at, last_event_id)
SELECT ?1, ?2, ?3, (SELECT COALESCE(MAX(id), 0) FROM events)
WHERE EXISTS (SELECT 1 FROM meta WHERE key = 'link_writes' AND value ->> '$.last' = ?4)
ON CONFLICT (wallet, chat_id) DO NOTHING`,

  // ?1 wallet, ?2 chat, ?3 today. Before the batch (refuse without a write) and as its last statement.
  LINK_STATE: `SELECT EXISTS (SELECT 1 FROM alert_links WHERE wallet = ?1 AND chat_id = ?2) AS linked,
       (SELECT COUNT(*) FROM accounts WHERE state != 'closed' AND (withdrawer = ?1 OR custodian = ?1)) AS watched,
       (SELECT COUNT(*) FROM alert_links WHERE chat_id = ?2) AS links,
       COALESCE((SELECT value ->> '$.n' FROM meta WHERE key = 'link_writes' AND value ->> '$.day' = ?3), 0) AS day_writes,
       COALESCE((SELECT value ->> ('$.chats."' || ?2 || '"') FROM meta
                 WHERE key = 'link_writes' AND value ->> '$.day' = ?3), 0) AS chat_writes`,

  // ?1 chat
  STATUS: `SELECT l.wallet,
       (SELECT COUNT(*) FROM accounts a WHERE a.state != 'closed' AND (a.withdrawer = l.wallet OR a.custodian = l.wallet)) AS watched
FROM alert_links l WHERE l.chat_id = ?1 ORDER BY l.created_at, l.wallet`,

  // ?1 chat
  STOP: `DELETE FROM alert_links WHERE chat_id = ?1`,

  LAST_PASS_AT: `SELECT value FROM meta WHERE key = 'last_pass_at'`,

  // ?1 wallet
  ACCOUNTS_FOR_WALLET: `SELECT stake_account, withdrawer, custodian, CAST(lock_until AS TEXT) AS lock_until, lamports, state, checked_at
FROM accounts WHERE withdrawer = ?1 OR custodian = ?1 ORDER BY stake_account LIMIT 200`,

  // ?1 wallet
  EVENTS_FOR_WALLET: `SELECT stake_account, type, details_json, slot, detected_at FROM events
WHERE type NOT LIKE 'REMINDER%'
  AND stake_account IN (SELECT stake_account FROM accounts WHERE withdrawer = ?1 OR custodian = ?1)
ORDER BY id DESC LIMIT 50`,

  // ?1 = now s. The sum is a decimal string: SQLite sums INTEGER exactly (all SOL is below 2^63 lamports).
  STATS: `SELECT COUNT(*) AS accounts, CAST(COALESCE(SUM(CAST(lamports AS INTEGER)), 0) AS TEXT) AS lamports
FROM accounts WHERE state != 'closed' AND lock_until > ?1`,

  ALERTS_SENT: `SELECT value FROM meta WHERE key = 'alerts_sent'`,
} as const;

/** Latest unix ms a Date can show (ECMA-262: 8.64e15). */
const MAX_DATE_MS = 8_640_000_000_000_000;

/**
 * The `meta.last_pass_at` marker of a LAST_PASS_AT row (ms of the last successful monitor pass), or null when there is
 * none or it is not a time a Date can show.
 */
export function lastPassAtOf(row: { value: unknown } | null | undefined): number | null {
  if (typeof row?.value !== 'string' || !/^[0-9]{1,16}$/.test(row.value)) return null;
  const ms = Number(row.value);
  return ms <= MAX_DATE_MS ? ms : null;
}

/** The stored snapshot of a row, for diffSnapshots. */
export function snapshotOfRow(row: AccountRow): AccountSnapshot {
  return {
    stakeAccount: row.stake_account,
    withdrawer: row.withdrawer,
    staker: row.staker,
    custodian: row.custodian,
    lockUntil: BigInt(row.lock_until),
    lamports: BigInt(row.lamports),
    state: row.state,
    voter: row.voter,
    activationEpoch: row.activation_epoch === null ? null : BigInt(row.activation_epoch),
    deactivationEpoch: row.deactivation_epoch === null ? null : BigInt(row.deactivation_epoch),
    slot: BigInt(row.slot),
    checkedAt: row.checked_at,
  };
}

/** The stored columns of a row, unchanged (decimal strings stay strings). */
export function columnsOfRow(row: AccountRow): RowColumns {
  return {
    stakeAccount: row.stake_account,
    withdrawer: row.withdrawer,
    staker: row.staker,
    custodian: row.custodian,
    lockUntil: row.lock_until,
    lamports: row.lamports,
    state: row.state,
    voter: row.voter,
    activationEpoch: row.activation_epoch,
    deactivationEpoch: row.deactivation_epoch,
    slot: row.slot,
    checkedAt: row.checked_at,
  };
}

/** The columns to store for a snapshot. */
export function rowColumnsOf(snapshot: AccountSnapshot): RowColumns {
  return {
    stakeAccount: snapshot.stakeAccount,
    withdrawer: snapshot.withdrawer,
    staker: snapshot.staker,
    custodian: snapshot.custodian,
    lockUntil: snapshot.lockUntil.toString(),
    lamports: snapshot.lamports.toString(),
    state: snapshot.state,
    voter: snapshot.voter,
    activationEpoch: snapshot.activationEpoch?.toString() ?? null,
    deactivationEpoch: snapshot.deactivationEpoch?.toString() ?? null,
    slot: Number(snapshot.slot),
    checkedAt: snapshot.checkedAt,
  };
}

/**
 * The row for the first sighting of `account`, read at context `slot` with the cluster clock at `checkedAtMs`.
 * `dataBase64` is the account data of that read (null: no fingerprint, the next pass decodes it). The reminder
 * threshold already reached counts as sent: a lock first watched 10 days before its end gets no late "14 days"
 * reminder, only the 7-day one and later.
 */
export function watchRowOf(
  account: StakeAccount,
  slot: bigint,
  checkedAtMs: number,
  dataBase64: string | null,
  nowSec: bigint,
): WatchRow {
  const columns = rowColumnsOf(snapshotOf(account, slot, checkedAtMs));
  return {
    ...columns,
    lastReminderDays: reminderDue(account.lockup.unixTimestamp, nowSec, null),
    fingerprint: dataBase64 === null ? null : stakeDataFingerprint(dataBase64),
  };
}

/** Rows per INSERT_WATCHED statement. */
export const INSERT_WATCHED_ROWS = 100;

/**
 * INSERT_WATCHED for `rows`, at most 100 rows per statement (none for no rows). Its rule is the /api/watch contract
 * (step 5 spec section 11): a new row is inserted, a closed row revives only from a fresher slot, a live row is never
 * changed. `meta.changes` of a one-row statement tells inserted or revived (1) from already watched (0).
 */
export function insertWatchedStatements(
  db: D1Database,
  rows: readonly WatchRow[],
  nowMs: number,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (let start = 0; start < rows.length; start += INSERT_WATCHED_ROWS) {
    const chunk = rows.slice(start, start + INSERT_WATCHED_ROWS);
    statements.push(db.prepare(SQL.INSERT_WATCHED).bind(JSON.stringify(chunk), nowMs));
  }
  return statements;
}

/** Limits of /start (telegram/webhook.ts, telegram/texts.ts). */
export type LinkLimits = { linksPerChat: number; writesPerDay: number; writesPerChatPerDay: number };

/** A LINK_STATE row, numbers as numbers. */
export type LinkState = { linked: boolean; watched: number; links: number; dayWrites: number; chatWrites: number };

/** LINK_STATE of `wallet` in `chatId` on `today` (YYYY-MM-DD, UTC). */
export function linkStateStatement(db: D1Database, wallet: string, chatId: string, today: string): D1PreparedStatement {
  return db.prepare(SQL.LINK_STATE).bind(wallet, chatId, today);
}

/** The LINK_STATE row of a result, or null without one. */
export function linkStateOf(result: D1Result | null | undefined): LinkState | null {
  const row = result?.results[0] as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  return {
    linked: Number(row.linked) === 1,
    watched: Number(row.watched),
    links: Number(row.links),
    dayWrites: Number(row.day_writes),
    chatWrites: Number(row.chat_writes),
  };
}

/**
 * The /start batch for a link not there yet: LINK_COUNT, LINK_WALLET, LINK_STATE. `token` must be new for every
 * batch (crypto.randomUUID()).
 */
export function linkWalletStatements(
  db: D1Database,
  args: { wallet: string; chatId: string; today: string; nowMs: number; token: string; limits: LinkLimits },
): D1PreparedStatement[] {
  const { wallet, chatId, today, nowMs, token, limits } = args;
  return [
    db
      .prepare(SQL.LINK_COUNT)
      .bind(wallet, chatId, today, token, limits.linksPerChat, limits.writesPerDay, limits.writesPerChatPerDay),
    db.prepare(SQL.LINK_WALLET).bind(wallet, chatId, nowMs, token),
    linkStateStatement(db, wallet, chatId, today),
  ];
}

/** The lease value in `meta.pass_lease`; `until: 0` = free. */
export type Lease = { pass: string; until: number };

export function leaseAcquireStatement(db: D1Database, lease: Lease, nowMs: number): D1PreparedStatement {
  return db.prepare(SQL.LEASE_ACQUIRE).bind(JSON.stringify(lease), nowMs, lease.pass);
}

/** PUT_META for `entries` (key -> string value), fenced by the lease of `passId`. */
export function putMetaStatement(db: D1Database, entries: Record<string, string>, passId: string): D1PreparedStatement {
  return db.prepare(SQL.PUT_META).bind(JSON.stringify(entries), passId);
}

/** CHUNK_EVENTS for monitor and reminder events, each gated on the row version it was computed from. */
export function chunkEventsStatement(
  db: D1Database,
  events: readonly StoredEvent[],
  detectedAtMs: number,
): D1PreparedStatement {
  const payload = events.map((e) => ({
    a: e.stakeAccount,
    t: e.type,
    d: e.detailsJson,
    s: e.slot,
    ps: e.prevSlot,
    pc: e.prevCheckedAt,
  }));
  return db.prepare(SQL.CHUNK_EVENTS).bind(JSON.stringify(payload), detectedAtMs);
}

/** CHUNK_UPDATE for `updates`, each a compare-and-set on (prevSlot, prevCheckedAt). */
export function chunkUpdateStatement(db: D1Database, updates: readonly RowUpdate[]): D1PreparedStatement {
  return db.prepare(SQL.CHUNK_UPDATE).bind(JSON.stringify(updates));
}

/** REMINDER_DAYS: the reminder threshold just recorded per row, on the row version it was decided on. */
export function reminderDaysStatement(
  db: D1Database,
  rows: readonly { stakeAccount: Address; days: number; prevSlot: number; prevCheckedAt: number }[],
): D1PreparedStatement {
  const payload = rows.map((r) => ({ a: r.stakeAccount, days: r.days, ps: r.prevSlot, pc: r.prevCheckedAt }));
  return db.prepare(SQL.REMINDER_DAYS).bind(JSON.stringify(payload));
}
