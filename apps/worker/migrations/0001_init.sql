-- Schema from CLAUDE.md section 8. Only public chain data and Telegram chat ids; chat ids are never logged.
-- u64 values from the chain that can exceed 2^53 (lamports, epochs; deactivation_epoch is u64::MAX while active)
-- are stored as decimal TEXT so neither SQLite nor JavaScript numbers lose precision.
-- Timestamps (*_at) are unix milliseconds; lock_until is the lockup unix timestamp in seconds (0 = no lockup).

-- Last seen state of every watched stake account.
CREATE TABLE accounts (
  stake_account TEXT PRIMARY KEY,
  withdrawer TEXT NOT NULL,
  staker TEXT NOT NULL,
  custodian TEXT NOT NULL,
  lock_until INTEGER NOT NULL,
  lamports TEXT NOT NULL,
  state TEXT NOT NULL,
  voter TEXT,
  activation_epoch TEXT,
  deactivation_epoch TEXT,
  slot INTEGER NOT NULL,
  checked_at INTEGER NOT NULL,
  last_reminder_days INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX accounts_withdrawer ON accounts (withdrawer);
CREATE INDEX accounts_custodian ON accounts (custodian);

-- Detected changes; UNIQUE keeps a monitor pass that runs twice from writing duplicates.
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  stake_account TEXT NOT NULL,
  type TEXT NOT NULL,
  details_json TEXT NOT NULL,
  slot INTEGER NOT NULL,
  detected_at INTEGER NOT NULL,
  notified_at INTEGER,
  UNIQUE (stake_account, type, slot)
);
CREATE INDEX events_pending ON events (detected_at) WHERE notified_at IS NULL;

-- Telegram subscriptions: wallet address -> chat.
CREATE TABLE alert_links (
  wallet TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (wallet, chat_id)
);
CREATE INDEX alert_links_chat ON alert_links (chat_id);

-- Monitor bookkeeping: last pass time, cursor, daily-run marker.
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
