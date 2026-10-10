-- Validator health (DECISIONS.md D128): the risks (core ValidatorRisk) the monitor's daily check last found for each
-- validator a watched stake account is delegated to, as a JSON array ('[]' = none). An alert goes out only for a risk
-- that is new since then, so a validator that stays down is not reported every day. Public chain data only.
CREATE TABLE validators (
  voter TEXT PRIMARY KEY,
  risks TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);
