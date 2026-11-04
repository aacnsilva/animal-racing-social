CREATE TEMP TABLE cutoff_upgrade ON COMMIT DROP AS
SELECT t.race_class,
       (SELECT max(version) + 1 FROM market.market_templates v WHERE v.race_class = t.race_class) AS version,
       jsonb_set(t.definition, '{markets}', (
         SELECT jsonb_agg(
                  CASE WHEN entry->'closes'->>'atLap' = 'last'
                       THEN jsonb_set(entry, '{closes}', jsonb_build_object('lapsBeforeEnd',
                              CASE t.race_class WHEN 'SPRINT' THEN 1 WHEN 'STANDARD' THEN 2 ELSE 3 END))
                       ELSE entry END
                  ORDER BY ordinality)
         FROM jsonb_array_elements(t.definition->'markets') WITH ORDINALITY AS e(entry, ordinality)
       )) AS definition
FROM market.market_templates t
WHERE t.is_active
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(t.definition->'markets') entry
    WHERE entry->'closes'->>'atLap' = 'last'
  );

UPDATE market.market_templates t SET is_active = false
FROM cutoff_upgrade u WHERE t.race_class = u.race_class AND t.is_active;

INSERT INTO market.market_templates (race_class, version, definition, is_active, created_by)
SELECT race_class, version, definition, true, 0 FROM cutoff_upgrade;
