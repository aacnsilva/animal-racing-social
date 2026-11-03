ALTER TABLE wallet.ledger_entries DROP CONSTRAINT ledger_entries_type_check;
ALTER TABLE wallet.ledger_entries ADD CONSTRAINT ledger_entries_type_check CHECK (type IN
  ('SEASON_GRANT','DAILY_GRANT','LIFESAVER','BET_STAKE','BET_PAYOUT','BET_REFUND','BET_LOST','CASHOUT','ADMIN_ADJUST'));

ALTER TABLE season.seasons ADD COLUMN lifesaver_grant BIGINT NOT NULL DEFAULT 5000 CHECK (lifesaver_grant > 0);
