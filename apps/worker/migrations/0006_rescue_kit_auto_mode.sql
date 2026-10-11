-- Kit management from the bound Telegram chat (DECISIONS.md D120). auto_mode: when the monitor sends a ready kit by
-- itself. 'off' never; 'staker' after a STAKER_CHANGED (the D118 behaviour, the default); 'any' after a STAKER_CHANGED,
-- DEACTIVATED, DELEGATION_CHANGED or BALANCE_DECREASED. Only the chat bound to the kit changes it (/kits); a new kit
-- for the account starts again at 'staker'.
ALTER TABLE rescue_kits ADD COLUMN auto_mode TEXT NOT NULL DEFAULT 'staker';
