-- Review fix (SECURITY-CHECK, /stop forgets the chat). meta.link_writes counted the links /start added per chat under
-- the raw chat id, so a chat that sent /stop, or blocked the bot, stayed in meta until a later day's first /start.
-- The count is now kept under an HMAC of the day and the chat id (store.ts linkCounterKey); this drops the per-chat
-- counts stored so far. The day's total ("n") stays; today's per-chat counts start over once.
UPDATE meta SET value = json_remove(value, '$.chats') WHERE key = 'link_writes';
