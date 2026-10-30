DO $$
DECLARE
  r TEXT;
  s TEXT;
  all_schemas TEXT[] := ARRAY['identity','stable','racing','market','betting','wallet','season','notification','admin'];
  service_roles TEXT[] := ARRAY['ars_api','ars_sse','ars_scheduler','ars_stable','ars_market','ars_betting','ars_wallet','ars_season','ars_notification','ars_race_engine','ars_broadcaster','ars_odds'];
BEGIN
  FOREACH r IN ARRAY service_roles LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I LOGIN', r);
    END IF;
    EXECUTE format('REVOKE ALL ON SCHEMA sealed FROM %I', r);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA sealed FROM %I', r);
    FOREACH s IN ARRAY all_schemas LOOP
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', s, r);
    END LOOP;
    EXECUTE format('GRANT INSERT ON admin.dlq TO %I', r);
    EXECUTE format('GRANT USAGE ON SEQUENCE admin.dlq_dlq_id_seq TO %I', r);
  END LOOP;

  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA identity, stable, racing, market, betting, wallet, season, notification, admin TO ars_api';
  EXECUTE 'GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity TO ars_api';
  EXECUTE 'GRANT INSERT, UPDATE ON betting.bets, betting.bet_legs, betting.cashouts, betting.outbox TO ars_api';
  EXECUTE 'GRANT UPDATE ON notification.notifications TO ars_api';
  EXECUTE 'GRANT INSERT, UPDATE ON notification.settings TO ars_api';
  EXECUTE 'GRANT INSERT, UPDATE ON admin.audit_log, admin.outbox, admin.dlq TO ars_api';
  EXECUTE 'GRANT INSERT, UPDATE ON racing.venues, racing.programme, racing.engine_versions TO ars_api';
  EXECUTE 'GRANT INSERT, UPDATE ON market.market_templates TO ars_api';
  EXECUTE 'GRANT INSERT, UPDATE ON season.seasons TO ars_api';
  EXECUTE 'GRANT UPDATE ON stable.species, stable.animals TO ars_api';
  EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA betting, admin TO ars_api';

  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA identity, stable, racing, market, betting, wallet, season, notification TO ars_sse';

  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA racing TO ars_scheduler';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA stable, season, market TO ars_scheduler';
  EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA racing TO ars_scheduler';

  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA stable TO ars_stable';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA racing TO ars_stable';
  EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA stable TO ars_stable';

  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA market TO ars_market';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA racing, stable TO ars_market';
  EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA market TO ars_market';

  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA betting TO ars_betting';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA market, racing, season, wallet TO ars_betting';
  EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA betting TO ars_betting';

  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA wallet TO ars_wallet';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA season, betting, identity TO ars_wallet';
  EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA wallet TO ars_wallet';

  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA season TO ars_season';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA wallet, betting, identity TO ars_season';
  EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA season TO ars_season';

  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notification TO ars_notification';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA betting, identity, season, wallet, racing TO ars_notification';
  EXECUTE 'GRANT USAGE ON ALL SEQUENCES IN SCHEMA notification TO ars_notification';

  EXECUTE 'GRANT USAGE ON SCHEMA sealed TO ars_race_engine';
  EXECUTE 'GRANT INSERT ON sealed.race_scripts TO ars_race_engine';
  EXECUTE 'GRANT SELECT (race_id, sealed_at) ON sealed.race_scripts TO ars_race_engine';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA racing, stable TO ars_race_engine';
  EXECUTE 'GRANT INSERT, UPDATE ON racing.engine_versions TO ars_race_engine';
  EXECUTE 'GRANT UPDATE (seed_hash, script_hash) ON racing.races TO ars_race_engine';

  EXECUTE 'GRANT USAGE ON SCHEMA sealed TO ars_broadcaster';
  EXECUTE 'GRANT SELECT, DELETE ON sealed.race_scripts TO ars_broadcaster';
  EXECUTE 'GRANT UPDATE (revealed_at, expires_at) ON sealed.race_scripts TO ars_broadcaster';
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA racing, stable TO ars_broadcaster';
  EXECUTE 'GRANT UPDATE ON racing.races, racing.race_entrants TO ars_broadcaster';
  EXECUTE 'GRANT INSERT, UPDATE, DELETE ON racing.race_lap_leaders, racing.race_incidents, racing.race_replays TO ars_broadcaster';

  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA racing, stable, market TO ars_odds';
END $$;
