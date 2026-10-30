ALTER TABLE stable.animals ADD COLUMN decline_rate NUMERIC(4,3) NOT NULL DEFAULT 1.000;
ALTER TABLE stable.species ADD COLUMN base_ranges JSONB NOT NULL DEFAULT '{}';

ALTER TABLE market.markets ADD COLUMN closes_at_lap INT;
ALTER TABLE market.markets ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE racing.venues ADD COLUMN description TEXT NOT NULL DEFAULT '';

DO $$
DECLARE s TEXT;
BEGIN
  FOREACH s IN ARRAY ARRAY['racing','stable','market','wallet','season','notification','admin'] LOOP
    EXECUTE format('CREATE TABLE %I.outbox (
      outbox_id     BIGSERIAL PRIMARY KEY,
      topic         TEXT  NOT NULL,
      msg_key       TEXT  NOT NULL,
      event_type    TEXT  NOT NULL,
      payload       BYTEA NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      published_at  TIMESTAMPTZ)', s);
    EXECUTE format('CREATE INDEX ON %I.outbox (outbox_id) WHERE published_at IS NULL', s);
  END LOOP;
  FOREACH s IN ARRAY ARRAY['racing','stable','market','wallet','season','notification'] LOOP
    EXECUTE format('CREATE TABLE %I.processed_events (
      consumer      TEXT NOT NULL,
      event_id      UUID NOT NULL,
      processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (consumer, event_id))', s);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.outbox_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('outbox_' || TG_TABLE_SCHEMA, '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE s TEXT;
BEGIN
  FOREACH s IN ARRAY ARRAY['betting','racing','stable','market','wallet','season','notification','admin'] LOOP
    EXECUTE format('CREATE TRIGGER outbox_notify AFTER INSERT ON %I.outbox FOR EACH STATEMENT EXECUTE FUNCTION public.outbox_notify()', s);
  END LOOP;
END $$;

CREATE TABLE admin.dlq (
  dlq_id       BIGSERIAL PRIMARY KEY,
  consumer     TEXT NOT NULL,
  topic        TEXT NOT NULL,
  partition    INT  NOT NULL,
  msg_offset   TEXT NOT NULL,
  msg_key      TEXT,
  event_type   TEXT,
  payload      BYTEA NOT NULL,
  error        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  replayed_at  TIMESTAMPTZ,
  replayed_by  BIGINT
);
CREATE INDEX ON admin.dlq (created_at DESC);

CREATE TABLE notification.daily_ready_runs (
  day         DATE PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification.race_starting_runs (
  race_id     BIGINT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
