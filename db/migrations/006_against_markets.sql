ALTER TABLE market.markets DROP CONSTRAINT markets_type_check;
ALTER TABLE market.markets ADD CONSTRAINT markets_type_check CHECK (type IN
  ('FINISH_POSITION','TOP_N','AGAINST_FINISH_POSITION','AGAINST_TOP_N','TRICAST','LEADER_AT_LAP'));

CREATE TEMP TABLE against_upgrade ON COMMIT DROP AS
SELECT t.race_class,
       (SELECT max(version) + 1 FROM market.market_templates v WHERE v.race_class = t.race_class) AS version,
       jsonb_set(t.definition, '{markets}', (t.definition->'markets') || '[
         { "type": "AGAINST_FINISH_POSITION", "params": { "position": 1 }, "closes": { "atLap": "last" } },
         { "type": "AGAINST_TOP_N", "params": { "n": 3 }, "closes": { "atLap": "last" } }
       ]'::jsonb) AS definition
FROM market.market_templates t
WHERE t.is_active
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(t.definition->'markets') entry
    WHERE entry->>'type' IN ('AGAINST_FINISH_POSITION', 'AGAINST_TOP_N')
  );

UPDATE market.market_templates t SET is_active = false
FROM against_upgrade u WHERE t.race_class = u.race_class AND t.is_active;

INSERT INTO market.market_templates (race_class, version, definition, is_active, created_by)
SELECT race_class, version, definition, true, 0 FROM against_upgrade;
