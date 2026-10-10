-- One-tap rescue kits (DECISIONS.md D118). A kit is the rescue of one stake account, signed in advance by the main
-- key, the second key and the new wallet on the new wallet's own durable nonce: sent by anyone, it can only move both
-- authorities to the owner's new wallet. Not a secret, but stored transactions are an exception to CLAUDE.md
-- section 2.6 ("the worker does not store transactions"); see D118.
-- tx is the base64 of the wire bytes. status: ready (stored, not sent), sent (an RPC node took it; signature and
-- sent_at are set), stale (the nonce moved on: the kit can never land). Times are unix milliseconds.
-- link_token_hash: SHA-256 (hex) of the one-time token of the bot link `/start kit-<token>`, NULL once used; the token
-- itself is only ever in the answer to the POST that stored the kit. chat_id: the Telegram chat that used it, the only
-- one whose "Rescue now" button sends this kit (never logged; /stop clears it). attempted_at: the last send from that
-- button, a cooldown.
CREATE TABLE rescue_kits (
  stake_account TEXT PRIMARY KEY,
  tx TEXT NOT NULL,
  main_key TEXT NOT NULL,
  new_wallet TEXT NOT NULL,
  nonce_account TEXT NOT NULL,
  nonce_value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  sent_at INTEGER,
  signature TEXT,
  link_token_hash TEXT,
  chat_id TEXT,
  attempted_at INTEGER
);
CREATE INDEX rescue_kits_token ON rescue_kits (link_token_hash) WHERE link_token_hash IS NOT NULL;
CREATE INDEX rescue_kits_chat ON rescue_kits (chat_id) WHERE chat_id IS NOT NULL;
