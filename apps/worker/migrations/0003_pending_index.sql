-- Step 5 review fix. The monitor's PENDING (store.ts) reads undelivered events oldest first: WHERE notified_at IS NULL
-- ORDER BY id. The partial index of 0001 is on detected_at, which that ORDER BY cannot use, so every pass scanned the
-- whole events table (rows are never deleted) against the shared daily D1 read quota. Nothing else reads it.
DROP INDEX events_pending;
CREATE INDEX events_pending ON events (id) WHERE notified_at IS NULL;
