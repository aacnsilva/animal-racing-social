ALTER TABLE wallet.ledger_entries DROP CONSTRAINT ledger_entries_type_check;
ALTER TABLE wallet.ledger_entries ADD CONSTRAINT ledger_entries_type_check CHECK (type IN
  ('SEASON_GRANT','DAILY_GRANT','BET_STAKE','BET_PAYOUT','BET_REFUND','BET_LOST','CASHOUT','ADMIN_ADJUST'));

ALTER TABLE season.seasons ADD COLUMN ending_notified_at TIMESTAMPTZ;

ALTER TABLE stable.animals ADD COLUMN entry_career_day INT NOT NULL DEFAULT 0;

ALTER TABLE market.markets ADD COLUMN suspend_reason TEXT;
