-- Step 5 (DECISIONS.md D49, D53). Public chain data and Telegram chat ids only.

-- Monitor fast path: core stakeDataFingerprint() of the account data the stored snapshot came from (the base64 of
-- every byte diffSnapshots depends on). Same fingerprint and lamports not lower -> no decode. NULL = unknown
-- (rows from /api/watch without it): decoded on the next pass.
ALTER TABLE accounts ADD COLUMN fingerprint TEXT;

-- Telegram delivery progress: the newest events.id this chat has received for this wallet. New links start at
-- MAX(events.id). Deleted with the link (/stop, 403, bot blocked), so the chat id lives nowhere else.
ALTER TABLE alert_links ADD COLUMN last_event_id INTEGER NOT NULL DEFAULT 0;
