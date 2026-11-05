CREATE TEMP TABLE half_race_upgrade ON COMMIT DROP AS
SELECT t.race_class,
       (SELECT max(version) + 1 FROM market.market_templates v WHERE v.race_class = t.race_class) AS version,
       jsonb_set(t.definition, '{markets}', (
         SELECT jsonb_agg(
                  CASE WHEN entry->>'type' IN ('AGAINST_FINISH_POSITION', 'AGAINST_TOP_N')
                       THEN jsonb_set(entry, '{closes}', '{"at": "LOCK"}'::jsonb)
                       WHEN entry->>'type' IN ('FINISH_POSITION', 'TOP_N')
                       THEN jsonb_set(entry, '{closes}',
                              CASE t.race_class WHEN 'SPRINT' THEN '{"at": "LOCK"}'::jsonb
                                                ELSE '{"lapsBeforeHalf": 1}'::jsonb END)
                       ELSE entry END
                  ORDER BY ordinality)
         FROM jsonb_array_elements(t.definition->'markets') WITH ORDINALITY AS e(entry, ordinality)
       )) AS definition
FROM market.market_templates t
WHERE t.is_active
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(t.definition->'markets') entry
    WHERE entry->>'type' IN ('FINISH_POSITION', 'TOP_N', 'AGAINST_FINISH_POSITION', 'AGAINST_TOP_N')
      AND NOT (entry->'closes' ? 'lapsBeforeHalf' OR entry->'closes'->>'at' = 'LOCK')
  );

UPDATE market.market_templates t SET is_active = false
FROM half_race_upgrade u WHERE t.race_class = u.race_class AND t.is_active;

INSERT INTO market.market_templates (race_class, version, definition, is_active, created_by)
SELECT race_class, version, definition, true, 0 FROM half_race_upgrade;
