ALTER TABLE wallet.ledger_entries DROP CONSTRAINT ledger_entries_type_check;
ALTER TABLE wallet.ledger_entries ADD CONSTRAINT ledger_entries_type_check CHECK (type IN
  ('SEASON_GRANT','DAILY_GRANT','LIFESAVER','BET_STAKE','BET_PAYOUT','BET_REFUND','BET_LOST','CASHOUT',
   'ADMIN_ADJUST','ADMIN_BONUS','ADMIN_PENALTY'));
ALTER TABLE wallet.ledger_entries ADD COLUMN note TEXT;

ALTER TABLE notification.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notification.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
  ('RACE_STARTING','BET_WON','BET_LOST','BET_VOID','BET_REJECTED',
   'CASHOUT_DONE','CASHOUT_REJECTED','DAILY_REWARD_READY',
   'LEADERBOARD_MOVE','SEASON_ENDING','SEASON_RESULT',
   'POINTS_BONUS','POINTS_PENALTY'));
