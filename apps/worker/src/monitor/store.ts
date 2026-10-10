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
  /** The chat bound to the account's ready rescue kit, null without one. */
  kit_chat_id: string | null;
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

  // ?1 = now s, ?2 and ?3 = the last pair of the previous page ('', '' = from the start), ?4 = page size. Pairs of
  // locks not ended, keyset by (withdrawer, custodian). Closed rows included: a rescan can reopen a row closed by a bad
  // answer.
  DAILY_PAIRS: `SELECT DISTINCT withdrawer, custodian FROM accounts
WHERE lock_until > ?1 AND (withdrawer, custodian) > (?2, ?3)
ORDER BY withdrawer, custodian LIMIT ?4`,

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
  // the undelivered rows only, however many events were delivered before. kit_chat_id: the chat bound to the
  // account's ready rescue kit (migration 0005), whose alerts carry the "Rescue now" button; null otherwise.
  PENDING: `SELECT e.id, e.stake_account, e.type, e.details_json, e.detected_at,
       a.withdrawer, a.custodian, CAST(a.lock_until AS TEXT) AS lock_until,
       (SELECT k.chat_id FROM rescue_kits k WHERE k.stake_account = e.stake_account AND k.status = 'ready')
         AS kit_chat_id
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
  // /start added on one UTC day: {"day", "n": all chats, "chats": {"<counter key>": n}, "last": token}. The counter
  // key of a chat is linkCounterKey(): an HMAC of the day and the chat id, never the chat id itself, which lives only
  // in alert_links, so /stop and a blocked bot forget it (DECISIONS D60) while the chat's count survives /stop.
  // LINK_COUNT counts the link only when it is new and every limit allows it, and leaves its token in "last";
  // LINK_WALLET inserts only under that token. A batch is one transaction, so a link is added exactly when it is
  // counted. A new day starts from 0 with no chats. Counter keys are hex: safe inside a JSON path label.

  // ?1 wallet, ?2 chat, ?3 today (YYYY-MM-DD, UTC), ?4 token, ?5 links per chat (20), ?6 links per day (all chats),
  // ?7 links per chat per day, ?8 the chat's counter key.
  LINK_COUNT: `INSERT INTO meta (key, value)
SELECT 'link_writes', json_object('day', ?3, 'n', d.n + 1, 'chats', json_set(d.chats, '$."' || ?8 || '"', d.chat_n + 1), 'last', ?4)
FROM (SELECT COALESCE(m.value ->> '$.n', 0) AS n, COALESCE(m.value -> '$.chats', '{}') AS chats,
             COALESCE(m.value ->> ('$.chats."' || ?8 || '"'), 0) AS chat_n
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

  // ?1 wallet, ?2 chat, ?3 today, ?4 the chat's counter key. Before the batch (refuse without a write) and as its
  // last statement.
  LINK_STATE: `SELECT EXISTS (SELECT 1 FROM alert_links WHERE wallet = ?1 AND chat_id = ?2) AS linked,
       (SELECT COUNT(*) FROM accounts WHERE state != 'closed' AND (withdrawer = ?1 OR custodian = ?1)) AS watched,
       (SELECT COUNT(*) FROM alert_links WHERE chat_id = ?2) AS links,
       COALESCE((SELECT value ->> '$.n' FROM meta WHERE key = 'link_writes' AND value ->> '$.day' = ?3), 0) AS day_writes,
       COALESCE((SELECT value ->> ('$.chats."' || ?4 || '"') FROM meta
                 WHERE key = 'link_writes' AND value ->> '$.day' = ?3), 0) AS chat_writes`,

  // ?1 chat
  STATUS: `SELECT l.wallet,
       (SELECT COUNT(*) FROM accounts a WHERE a.state != 'closed' AND (a.withdrawer = l.wallet OR a.custodian = l.wallet)) AS watched
FROM alert_links l WHERE l.chat_id = ?1 ORDER BY l.created_at, l.wallet`,

  // ?1 chat
  STOP: `DELETE FROM alert_links WHERE chat_id = ?1`,

  LAST_PASS_AT: `SELECT value FROM meta WHERE key = 'last_pass_at'`,

  // One-tap rescue kits (migration 0005, rescue-kits.ts, telegram/webhook.ts).

  // ?1 stake account
  WATCHED_LIVE: `SELECT 1 AS watched FROM accounts WHERE stake_account = ?1 AND state != 'closed'`,

  // ?1 stake account, ?2 tx (base64), ?3 main key, ?4 new wallet, ?5 nonce account, ?6 nonce value, ?7 now ms,
  // ?8 link token hash. A new kit, or one that replaces the account's kit whatever its status: a new token, the chat
  // the old one bound is let go, and the auto mode starts again at 'staker' (migration 0006). Only while the account
  // is watched (0 changes otherwise).
  KIT_UPSERT: `INSERT INTO rescue_kits (stake_account, tx, main_key, new_wallet, nonce_account, nonce_value, created_at,
                         status, sent_at, signature, link_token_hash, chat_id, attempted_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'ready', NULL, NULL, ?8, NULL, NULL
WHERE EXISTS (SELECT 1 FROM accounts WHERE stake_account = ?1 AND state != 'closed')
ON CONFLICT (stake_account) DO UPDATE SET
  tx = excluded.tx, main_key = excluded.main_key, new_wallet = excluded.new_wallet,
  nonce_account = excluded.nonce_account, nonce_value = excluded.nonce_value, created_at = excluded.created_at,
  status = 'ready', sent_at = NULL, signature = NULL, link_token_hash = excluded.link_token_hash, chat_id = NULL,
  attempted_at = NULL, auto_mode = 'staker'`,

  // ?1 stake account. Never the bytes, the token hash or the chat.
  KIT_STATUS: `SELECT status, new_wallet, signature, sent_at, chat_id IS NOT NULL AS linked, auto_mode
FROM rescue_kits WHERE stake_account = ?1`,

  // ?1 token hash, ?2 chat. One-time: the hash is cleared as the chat is bound.
  KIT_BIND: `UPDATE rescue_kits SET chat_id = ?2, link_token_hash = NULL WHERE link_token_hash = ?1
RETURNING stake_account, main_key`,

  // ?1 chat: /stop and a blocked bot let go of the chat's kits too.
  KIT_UNBIND_CHAT: `UPDATE rescue_kits SET chat_id = NULL WHERE chat_id = ?1`,

  // ?1 stake account, ?2 chat, ?3 now ms, ?4 cooldown ms. Claims a send from the "Rescue now" button: only the bound
  // chat, a ready kit, and no other claim within the cooldown (two taps send once).
  KIT_CLAIM: `UPDATE rescue_kits SET attempted_at = ?3
WHERE stake_account = ?1 AND chat_id = ?2 AND status = 'ready' AND (attempted_at IS NULL OR attempted_at <= ?3 - ?4)
RETURNING tx, main_key, new_wallet`,

  // ?1 stake account, ?2 chat: why a claim failed (null row: no kit bound to this chat).
  KIT_OF_CHAT: `SELECT status FROM rescue_kits WHERE stake_account = ?1 AND chat_id = ?2`,

  // ?1 = [{a: stake account, t: 'staker' | 'any'}]: the ready kits among them whose auto mode (migration 0006) the
  // trigger matches, for the monitor's auto-send. A STAKER_CHANGED ('staker') sends in modes 'staker' and 'any', the
  // other alarming events ('any') in mode 'any' only; 'off' never.
  KITS_READY_FOR: `SELECT k.stake_account, k.tx FROM rescue_kits k JOIN json_each(?1) AS q ON k.stake_account = q.value ->> '$.a'
WHERE k.status = 'ready'
  AND (k.auto_mode = 'any' OR (k.auto_mode = 'staker' AND q.value ->> '$.t' = 'staker'))
ORDER BY k.stake_account`,

  // ?1 chat: the kits bound to it, for /kits (D120), at most ?2.
  KITS_OF_CHAT: `SELECT stake_account, new_wallet, status, auto_mode FROM rescue_kits WHERE chat_id = ?1
ORDER BY stake_account LIMIT ?2`,

  // ?1 stake account, ?2 chat: the next auto mode, off -> staker -> any -> off; only the bound chat (D120).
  KIT_CYCLE_MODE: `UPDATE rescue_kits SET auto_mode = CASE auto_mode WHEN 'off' THEN 'staker' WHEN 'staker' THEN 'any' ELSE 'off' END
WHERE stake_account = ?1 AND chat_id = ?2
RETURNING stake_account, new_wallet, status, auto_mode`,

  // ?1 stake account, ?2 chat: deletes the kit; only the bound chat (D120).
  KIT_DELETE: `DELETE FROM rescue_kits WHERE stake_account = ?1 AND chat_id = ?2 RETURNING stake_account`,

  // ?1 = [{a, tx, status, sig, at}]: the outcome of sends, each only on the kit that was sent (same bytes) and only
  // while it is still ready: a kit replaced or settled meanwhile stays as it is.
  KIT_SETTLE: `UPDATE rescue_kits SET status = s.value ->> '$.status', sent_at = s.value ->> '$.at',
  signature = s.value ->> '$.sig'
FROM json_each(?1) AS s
WHERE rescue_kits.stake_account = s.value ->> '$.a' AND rescue_kits.tx = s.value ->> '$.tx'
  AND rescue_kits.status = 'ready'`,

  // ?1 wallet
  ACCOUNTS_FOR_WALLET: `SELECT stake_account, withdrawer, custodian, CAST(lock_until AS TEXT) AS lock_until, lamports, state, checked_at
FROM accounts WHERE withdrawer = ?1 OR custodian = ?1 ORDER BY stake_account LIMIT 200`,

  // Validator health (migration 0007, D128). ?1 = the last validator of the previous page ('' = from the start),
  // ?2 = page size. The validators delegated, not deactivating, watched accounts point at, with the risks stored.
  VALIDATOR_PAGE: `SELECT v.voter, val.risks FROM (SELECT DISTINCT voter FROM accounts
                                         WHERE state = 'delegated' AND deactivation_epoch = '18446744073709551615'
                                           AND voter > ?1) AS v
LEFT JOIN validators val ON val.voter = v.voter
ORDER BY v.voter LIMIT ?2`,

  // ?1 = [{v: voter, d: details JSON}], ?2 = slot of the read, ?3 = detected_at ms: a VALIDATOR_AT_RISK event for
  // every delegated, not deactivating, watched account of each validator.
  VALIDATOR_EVENTS: `INSERT INTO events (stake_account, type, details_json, slot, detected_at)
SELECT a.stake_account, 'VALIDATOR_AT_RISK', q.value ->> '$.d', ?2, ?3
FROM json_each(?1) AS q JOIN accounts a ON a.voter = q.value ->> '$.v'
WHERE a.state = 'delegated' AND a.deactivation_epoch = '18446744073709551615'
ON CONFLICT (stake_account, type, slot) DO NOTHING`,

  // ?1 = [{v: voter, r: risks JSON array}], ?2 = now ms.
  VALIDATORS_PUT: `INSERT INTO validators (voter, risks, checked_at)
SELECT q.value ->> '$.v', q.value ->> '$.r', ?2 FROM json_each(?1) AS q
WHERE true
ON CONFLICT (voter) DO UPDATE SET risks = excluded.risks, checked_at = excluded.checked_at`,

  // ?1 wallet
  EVENTS_FOR_WALLET: `SELECT stake_account, type, details_json, slot, detected_at FROM events
WHERE type NOT LIKE 'REMINDER%'
  AND stake_account IN (SELECT stake_account FROM accounts WHERE withdrawer = ?1 OR custodian = ?1)
ORDER BY id DESC LIMIT 50`,

  // /api/stats (public-api.ts) keeps its count in meta.stats_cache: {"at": unix ms, "accounts": n, "lamports":
  // "decimal"}. The sum is a decimal string: SQLite sums INTEGER exactly (all SOL is below 2^63 lamports).
  // ?1 = now ms, ?2 = now s, ?3 = how long a count stands (ms), ?4 = how far ahead a count may be (ms): the clocks of
  // the machines that run requests differ, so a request may run just after one whose clock was ahead. STATS_COUNT
  // counts only when the stored count is not from the last ?3 ms or the next ?4 ms (a missing or unreadable count, or
  // one from further ahead, counts too). `stale` has one row then, none otherwise; as the left side of a LEFT JOIN it
  // is the outer loop, so while the count stands no accounts row is read, and HAVING drops the one row an aggregate
  // gives over nothing. A batch is one transaction and D1 runs them one at a time, so requests that arrive together
  // count once.
  STATS_COUNT: `INSERT INTO meta (key, value)
SELECT 'stats_cache', json_object('at', CAST(?1 AS INTEGER), 'accounts', COUNT(a.stake_account),
                                  'lamports', CAST(COALESCE(SUM(CAST(a.lamports AS INTEGER)), 0) AS TEXT))
FROM (SELECT 1 AS one WHERE NOT EXISTS (
  SELECT 1 FROM meta WHERE key = 'stats_cache' AND CASE WHEN json_valid(value) THEN
    json_type(value, '$.at') = 'integer' AND value ->> '$.at' BETWEEN ?1 - ?3 + 1 AND ?1 + ?4
    AND json_type(value, '$.accounts') = 'integer' AND json_type(value, '$.lamports') = 'text' END)) AS stale
LEFT JOIN accounts AS a ON a.state != 'closed' AND a.lock_until > ?2
WHERE true HAVING COUNT(stale.one) > 0
ON CONFLICT (key) DO UPDATE SET value = excluded.value`,

  // After STATS_COUNT in the same batch: the count that stands.
  STATS_CACHE: `SELECT value ->> '$.at' AS at, value ->> '$.accounts' AS accounts, value ->> '$.lamports' AS lamports
FROM meta WHERE key = 'stats_cache'`,

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

/**
 * The key under which meta.link_writes counts the links a chat added on `day` (YYYY-MM-DD, UTC): the first 16 bytes of
 * HMAC-SHA-256(`secret`, "<day>:<chat id>") in hex. `secret` is TELEGRAM_WEBHOOK_SECRET. Without it the key does not
 * give the chat id back, and the day in it keeps the keys of two days apart. A new secret starts the day's per-chat
 * counts over (the day's total stays).
 */
export async function linkCounterKey(secret: string, chatId: string, day: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${day}:${chatId}`)));
  return Array.from(mac.subarray(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** LINK_STATE of `wallet` in `chatId` on `today` (YYYY-MM-DD, UTC); `counterKey` is linkCounterKey of the chat. */
export function linkStateStatement(
  db: D1Database,
  wallet: string,
  chatId: string,
  today: string,
  counterKey: string,
): D1PreparedStatement {
  return db.prepare(SQL.LINK_STATE).bind(wallet, chatId, today, counterKey);
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
 * batch (crypto.randomUUID()); `counterKey` is linkCounterKey of the chat for `today`.
 */
export function linkWalletStatements(
  db: D1Database,
  args: {
    wallet: string;
    chatId: string;
    today: string;
    counterKey: string;
    nowMs: number;
    token: string;
    limits: LinkLimits;
  },
): D1PreparedStatement[] {
  const { wallet, chatId, today, counterKey, nowMs, token, limits } = args;
  return [
    db
      .prepare(SQL.LINK_COUNT)
      .bind(wallet, chatId, today, token, limits.linksPerChat, limits.writesPerDay, limits.writesPerChatPerDay, counterKey),
    db.prepare(SQL.LINK_WALLET).bind(wallet, chatId, nowMs, token),
    linkStateStatement(db, wallet, chatId, today, counterKey),
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
