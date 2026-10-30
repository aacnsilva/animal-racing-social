CREATE SCHEMA identity;
CREATE SCHEMA stable;
CREATE SCHEMA racing;
CREATE SCHEMA sealed;
CREATE SCHEMA market;
CREATE SCHEMA betting;
CREATE SCHEMA wallet;
CREATE SCHEMA season;
CREATE SCHEMA notification;
CREATE SCHEMA admin;

CREATE TABLE identity.users (
  user_id       BIGINT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  role          TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER','ADMIN')),
  banned_at     TIMESTAMPTZ,
  ban_reason    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE identity.user_identities (
  provider          TEXT NOT NULL CHECK (provider IN ('google','github')),
  provider_subject  TEXT NOT NULL,
  user_id           BIGINT NOT NULL,
  email             TEXT,
  linked_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_subject)
);
CREATE INDEX ON identity.user_identities (user_id);

CREATE TABLE identity.refresh_tokens (
  user_id     BIGINT NOT NULL,
  token_id    BIGINT NOT NULL,
  token_hash  BYTEA NOT NULL,
  family_id   BIGINT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token_id)
);
CREATE UNIQUE INDEX ON identity.refresh_tokens (token_hash);

CREATE TABLE stable.species (
  species            TEXT PRIMARY KEY,
  max_career_days    INT  NOT NULL,
  life_stages        JSONB NOT NULL,
  age_curve          JSONB NOT NULL,
  surface_affinity   JSONB NOT NULL,
  segment_affinity   JSONB NOT NULL,
  retire_threshold   NUMERIC(6,3) NOT NULL,
  target_pool_size   INT NOT NULL
);

CREATE TABLE stable.animals (
  animal_id        BIGINT PRIMARY KEY,
  species          TEXT NOT NULL REFERENCES stable.species,
  name             TEXT NOT NULL,
  temperament      TEXT NOT NULL CHECK (temperament IN ('FRONT_RUNNER','STALKER','CLOSER','STEADY')),
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  recruited_at     TIMESTAMPTZ NOT NULL,
  career_day       INT NOT NULL,
  age_weeks        INT NOT NULL,
  life_stage       TEXT NOT NULL CHECK (life_stage IN ('ROOKIE','PRIME','VETERAN')),
  base_velocity    NUMERIC(6,3) NOT NULL,
  base_stamina     NUMERIC(6,3) NOT NULL,
  base_acceleration NUMERIC(6,3) NOT NULL,
  base_consistency NUMERIC(6,3) NOT NULL,
  cur_velocity     NUMERIC(6,3) NOT NULL,
  cur_stamina      NUMERIC(6,3) NOT NULL,
  cur_acceleration NUMERIC(6,3) NOT NULL,
  cur_consistency  NUMERIC(6,3) NOT NULL,
  resting_until    TIMESTAMPTZ,
  retired_at       TIMESTAMPTZ,
  retire_reason    TEXT CHECK (retire_reason IN ('AGE','DECLINE','ADMIN')),

  races            INT NOT NULL DEFAULT 0,
  wins             INT NOT NULL DEFAULT 0,
  podiums          INT NOT NULL DEFAULT 0,
  last5            TEXT[] NOT NULL DEFAULT '{}',
  UNIQUE (species, name)
);
CREATE INDEX ON stable.animals (species, status, resting_until);

CREATE TABLE stable.animal_daily_stats (
  animal_id   BIGINT NOT NULL REFERENCES stable.animals,
  day         DATE NOT NULL,
  career_day  INT NOT NULL,
  life_stage  TEXT NOT NULL,
  stats       JSONB NOT NULL,
  PRIMARY KEY (animal_id, day)
);

CREATE TABLE stable.animal_venue_form (
  animal_id  BIGINT NOT NULL REFERENCES stable.animals,
  venue_id   TEXT NOT NULL,
  races      INT NOT NULL DEFAULT 0,
  wins       INT NOT NULL DEFAULT 0,
  podiums    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (animal_id, venue_id)
);

CREATE TABLE racing.venues (
  venue_id     TEXT NOT NULL,
  version      INT  NOT NULL,
  name         TEXT NOT NULL,
  race_class   TEXT NOT NULL CHECK (race_class IN ('SPRINT','STANDARD','ENDURANCE')),
  surface      TEXT NOT NULL CHECK (surface IN ('DIRT','GRASS','SAND','MUD','ICE')),
  lanes        INT  NOT NULL DEFAULT 10,
  lap_length   NUMERIC(8,2) NOT NULL,
  laps_min     INT NOT NULL,
  laps_max     INT NOT NULL,
  segments     JSONB NOT NULL,
  assets       JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, version)
);

CREATE TABLE racing.engine_versions (
  engine_version  TEXT PRIMARY KEY,
  params          JSONB NOT NULL,
  params_hash     BYTEA NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT false,
  replayable      BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON racing.engine_versions (is_active) WHERE is_active;

CREATE TABLE racing.races (
  race_id              BIGINT PRIMARY KEY,
  season_id            BIGINT NOT NULL,
  species              TEXT NOT NULL,
  race_class           TEXT NOT NULL,
  venue_id             TEXT NOT NULL,
  venue_version        INT  NOT NULL,
  engine_version       TEXT NOT NULL REFERENCES racing.engine_versions,
  laps                 INT  NOT NULL,
  estimated_duration_s INT  NOT NULL,
  tick_ms              INT  NOT NULL DEFAULT 500,
  status               TEXT NOT NULL CHECK (status IN
                         ('SCHEDULED','OPEN','LOCKED','LIVE','FINISHED','SETTLED','CANCELLED')),
  start_at             TIMESTAMPTZ NOT NULL,
  betting_closes_at    TIMESTAMPTZ NOT NULL,
  seed_hash            BYTEA,
  script_hash          BYTEA,
  seed                 BYTEA,
  finish_tick          INT,
  started_at           TIMESTAMPTZ,
  finished_at          TIMESTAMPTZ,
  replay_expires_at    TIMESTAMPTZ,
  cancelled_reason     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (venue_id, venue_version) REFERENCES racing.venues,
  CHECK (betting_closes_at = start_at - interval '60 seconds')
);
CREATE INDEX ON racing.races (status, start_at);
CREATE INDEX ON racing.races (start_at DESC);
CREATE INDEX ON racing.races (venue_id, start_at DESC);
CREATE INDEX ON racing.races (season_id);

CREATE TABLE racing.race_entrants (
  race_id          BIGINT NOT NULL REFERENCES racing.races,
  entrant_id       INT    NOT NULL,
  animal_id        BIGINT NOT NULL REFERENCES stable.animals,
  lane             INT    NOT NULL,
  temperament      TEXT   NOT NULL,
  stats_snapshot   JSONB  NOT NULL,

  official_position INT,
  as_run_position   INT,
  result_status     TEXT CHECK (result_status IN ('FINISHED','DISQUALIFIED','DNF','NON_RUNNER')),
  finish_time_ms    INT,
  distance_covered  NUMERIC(10,2),
  PRIMARY KEY (race_id, entrant_id),
  UNIQUE (race_id, lane),
  UNIQUE (race_id, animal_id),
  UNIQUE (race_id, official_position)
);
CREATE INDEX ON racing.race_entrants (animal_id, race_id DESC);

CREATE TABLE racing.race_lap_leaders (
  race_id     BIGINT NOT NULL REFERENCES racing.races,
  lap         INT NOT NULL,
  entrant_id  INT NOT NULL,
  tick        INT NOT NULL,
  PRIMARY KEY (race_id, lap)
);

CREATE TABLE racing.race_incidents (
  race_id     BIGINT NOT NULL REFERENCES racing.races,
  seq         INT NOT NULL,
  tick        INT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN
                ('STUMBLE','FALSE_START','REFUSED_TO_RUN','PULLED_UP','DISQUALIFIED','PHOTO_FINISH')),
  entrant_id  INT,
  data        JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (race_id, seq)
);

CREATE TABLE racing.programme (
  version          INT PRIMARY KEY,
  races_per_hour   INT NOT NULL DEFAULT 3,
  class_mix        JSONB NOT NULL,
  species_rotation TEXT[] NOT NULL,
  horizon_hours    INT NOT NULL DEFAULT 24,
  recovery_minutes JSONB NOT NULL,
  effective_from   TIMESTAMPTZ NOT NULL,
  created_by       BIGINT NOT NULL
);

CREATE TABLE sealed.race_scripts (
  race_id         BIGINT PRIMARY KEY,
  key_id          TEXT  NOT NULL,
  seed_ciphertext BYTEA NOT NULL,
  script_ciphertext BYTEA NOT NULL,
  script_bytes    INT   NOT NULL,
  sealed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revealed_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ
);

CREATE TABLE racing.race_replays (
  race_id      BIGINT PRIMARY KEY REFERENCES racing.races,
  script       BYTEA NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE market.market_templates (
  race_class   TEXT NOT NULL,
  version      INT  NOT NULL,
  definition   JSONB NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT false,
  created_by   BIGINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (race_class, version)
);
CREATE UNIQUE INDEX ON market.market_templates (race_class) WHERE is_active;

CREATE TABLE market.markets (
  market_id        BIGINT PRIMARY KEY,
  race_id          BIGINT NOT NULL REFERENCES racing.races,
  type             TEXT NOT NULL CHECK (type IN ('FINISH_POSITION','TOP_N','TRICAST','LEADER_AT_LAP')),
  params           JSONB NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL CHECK (status IN ('PENDING','OPEN','SUSPENDED','CLOSED','RESULTED','VOID')),
  template_version INT NOT NULL,
  opens_rule       JSONB NOT NULL,
  closes_rule      JSONB NOT NULL,
  price_version    INT NOT NULL DEFAULT 0,
  opened_at        TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  resulted_at      TIMESTAMPTZ,
  result           JSONB,
  UNIQUE (race_id, type, params)
);
CREATE INDEX ON market.markets (race_id, status);

CREATE TABLE market.selections (
  selection_id   BIGINT PRIMARY KEY,
  market_id      BIGINT NOT NULL REFERENCES market.markets,
  race_id        BIGINT NOT NULL,
  entrant_id     INT    NOT NULL,
  price          NUMERIC(12,4) NOT NULL,
  probability    NUMERIC(8,6)  NOT NULL,
  price_version  INT NOT NULL,
  UNIQUE (market_id, entrant_id)
);

CREATE TABLE market.price_snapshots (
  market_id   BIGINT NOT NULL REFERENCES market.markets,
  kind        TEXT NOT NULL CHECK (kind IN ('OPENING','AT_LOCK','AT_START')),
  prices      JSONB NOT NULL,
  taken_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (market_id, kind)
);

CREATE TABLE market.price_history (
  market_id   BIGINT PRIMARY KEY REFERENCES market.markets,
  race_id     BIGINT NOT NULL,
  first_tick  INT NOT NULL,
  step_ticks  INT NOT NULL DEFAULT 2,
  points      INT NOT NULL,
  series      BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON market.price_history (race_id);
CREATE INDEX ON market.price_history (expires_at);

CREATE TABLE betting.bets (
  user_id              BIGINT NOT NULL,
  bet_id               BIGINT NOT NULL,
  season_id            BIGINT NOT NULL,
  type                 TEXT NOT NULL CHECK (type IN ('SINGLE','COMBO')),
  status               TEXT NOT NULL CHECK (status IN
                         ('PENDING','ACCEPTED','REJECTED','WON','LOST','VOID','CASHED_OUT')),
  stake                BIGINT NOT NULL CHECK (stake >= 1),
  leg_count            SMALLINT NOT NULL CHECK (leg_count BETWEEN 1 AND 8),
  accept_price_changes TEXT NOT NULL DEFAULT 'NONE' CHECK (accept_price_changes IN ('NONE','BETTER','ANY')),
  locked_price         NUMERIC(20,4),
  payout               BIGINT,
  cashout_amount       BIGINT,
  reject_reason        TEXT,
  idempotency_key      UUID NOT NULL,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at          TIMESTAMPTZ,
  settled_at           TIMESTAMPTZ,
  PRIMARY KEY (user_id, bet_id),
  UNIQUE (user_id, idempotency_key),
  CHECK ((type = 'SINGLE') = (leg_count = 1))
);
CREATE INDEX ON betting.bets (user_id, requested_at DESC);
CREATE INDEX ON betting.bets (user_id, status) WHERE status IN ('PENDING','ACCEPTED');

CREATE TABLE betting.bet_legs (
  user_id          BIGINT NOT NULL,
  bet_id           BIGINT NOT NULL,
  leg_no           SMALLINT NOT NULL,
  market_id        BIGINT NOT NULL,
  race_id          BIGINT NOT NULL,
  entrant_id       INT,
  tricast_order    INT[],
  accepted_price   NUMERIC(12,4) NOT NULL,
  price_version    INT NOT NULL,
  locked_price     NUMERIC(12,4),
  status           TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','WON','LOST','VOID')),
  placed_at_tick   INT,
  settled_at       TIMESTAMPTZ,
  PRIMARY KEY (user_id, bet_id, leg_no),
  FOREIGN KEY (user_id, bet_id) REFERENCES betting.bets,
  UNIQUE (user_id, bet_id, race_id),
  CHECK ((entrant_id IS NULL) <> (tricast_order IS NULL))
);

CREATE INDEX ON betting.bet_legs (market_id) WHERE status = 'OPEN';
CREATE INDEX ON betting.bet_legs (race_id, user_id);

CREATE TABLE betting.cashouts (
  user_id          BIGINT NOT NULL,
  bet_id           BIGINT NOT NULL,
  cashout_id       BIGINT NOT NULL,
  quote_id         TEXT   NOT NULL,
  quoted_amount    BIGINT NOT NULL,
  min_amount       BIGINT NOT NULL,
  final_amount     BIGINT,
  status           TEXT NOT NULL CHECK (status IN ('PENDING','ACCEPTED','REJECTED')),
  reject_reason    TEXT,
  idempotency_key  UUID NOT NULL,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at       TIMESTAMPTZ,
  PRIMARY KEY (user_id, cashout_id),
  FOREIGN KEY (user_id, bet_id) REFERENCES betting.bets,
  UNIQUE (user_id, idempotency_key)
);

CREATE UNIQUE INDEX ON betting.cashouts (user_id, bet_id) WHERE status = 'ACCEPTED';

CREATE TABLE wallet.wallets (
  user_id      BIGINT NOT NULL,
  season_id    BIGINT NOT NULL,
  balance      BIGINT NOT NULL CHECK (balance >= 0),
  open_stake   BIGINT NOT NULL DEFAULT 0 CHECK (open_stake >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, season_id)
);

CREATE TABLE wallet.ledger_entries (
  user_id        BIGINT NOT NULL,
  entry_id       BIGINT NOT NULL,
  season_id      BIGINT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN
                   ('SEASON_GRANT','DAILY_GRANT','BET_STAKE','BET_PAYOUT','BET_REFUND','CASHOUT','ADMIN_ADJUST')),
  amount         BIGINT NOT NULL,
  ref_id         TEXT   NOT NULL,
  balance_after  BIGINT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entry_id),
  UNIQUE (user_id, type, ref_id)
);
CREATE INDEX ON wallet.ledger_entries (user_id, season_id, created_at DESC);

CREATE TABLE wallet.daily_rewards (
  user_id         BIGINT PRIMARY KEY,
  last_claim_day  DATE,
  streak          INT NOT NULL DEFAULT 0,
  best_streak     INT NOT NULL DEFAULT 0
);

CREATE TABLE season.seasons (
  season_id       BIGINT PRIMARY KEY,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('UPCOMING','ACTIVE','ENDED')),
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  last_race_at    TIMESTAMPTZ NOT NULL,
  starting_grant  BIGINT NOT NULL DEFAULT 10000,
  daily_grant     BIGINT NOT NULL DEFAULT 50,
  CHECK (ends_at > starts_at),
  CHECK (last_race_at = ends_at - interval '1 hour'),
  EXCLUDE USING gist (tstzrange(starts_at, ends_at) WITH &&)
);

CREATE TABLE season.user_season_stats (
  user_id         BIGINT NOT NULL,
  season_id       BIGINT NOT NULL,
  settled_bets    INT    NOT NULL DEFAULT 0,
  total_staked    BIGINT NOT NULL DEFAULT 0,
  total_returned  BIGINT NOT NULL DEFAULT 0,
  biggest_payout  BIGINT NOT NULL DEFAULT 0,
  biggest_payout_bet BIGINT,
  current_streak  INT    NOT NULL DEFAULT 0,
  best_streak     INT    NOT NULL DEFAULT 0,
  rank_score      BIGINT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, season_id)
);

CREATE TABLE season.season_results (
  season_id   BIGINT NOT NULL REFERENCES season.seasons,
  board       TEXT   NOT NULL CHECK (board IN ('balance','biggest-payout','roi','win-streak')),
  rank        INT    NOT NULL,
  user_id     BIGINT NOT NULL,
  score       NUMERIC(20,4) NOT NULL,
  PRIMARY KEY (season_id, board, rank)
);
CREATE INDEX ON season.season_results (user_id);

CREATE TABLE notification.notifications (
  user_id          BIGINT NOT NULL,
  notification_id  BIGINT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN
                     ('RACE_STARTING','BET_WON','BET_LOST','BET_VOID','BET_REJECTED',
                      'CASHOUT_DONE','CASHOUT_REJECTED','DAILY_REWARD_READY',
                      'LEADERBOARD_MOVE','SEASON_ENDING','SEASON_RESULT')),
  dedupe_key       TEXT NOT NULL,
  payload          JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at          TIMESTAMPTZ,
  PRIMARY KEY (user_id, notification_id),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX ON notification.notifications (user_id, created_at DESC);
CREATE INDEX ON notification.notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE notification.settings (
  user_id     BIGINT PRIMARY KEY,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  types       JSONB   NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin.audit_log (
  audit_id       BIGINT PRIMARY KEY,
  admin_user_id  BIGINT NOT NULL,
  action         TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  target_id      TEXT NOT NULL,
  before         JSONB,
  after          JSONB,
  reason         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON admin.audit_log (target_type, target_id, created_at DESC);

CREATE TABLE betting.outbox (
  outbox_id     BIGSERIAL PRIMARY KEY,
  topic         TEXT  NOT NULL,
  msg_key       TEXT  NOT NULL,
  event_type    TEXT  NOT NULL,
  payload       BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ
);
CREATE INDEX ON betting.outbox (outbox_id) WHERE published_at IS NULL;

CREATE TABLE betting.processed_events (
  consumer      TEXT NOT NULL,
  event_id      UUID NOT NULL,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);
