CREATE TEMP TABLE half_race_template_upgrade ON COMMIT DROP AS
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
      AND NOT (entry->'closes' ? 'lapsBeforeHalf' OR coalesce(entry->'closes'->>'at' = 'LOCK', false))
  );

UPDATE market.market_templates t SET is_active = false
FROM half_race_template_upgrade u WHERE t.race_class = u.race_class AND t.is_active;

INSERT INTO market.market_templates (race_class, version, definition, is_active, created_by)
SELECT race_class, version, definition, true, 0 FROM half_race_template_upgrade;

CREATE TEMP TABLE half_race_markets ON COMMIT DROP AS
SELECT m.market_id,
       r.status AS race_status,
       CASE WHEN m.type IN ('AGAINST_FINISH_POSITION', 'AGAINST_TOP_N')
              OR r.race_class = 'SPRINT'
              OR r.laps / 2 - 1 <= 1
            THEN NULL
            ELSE r.laps / 2 - 1 END AS closes_at_lap
FROM market.markets m
JOIN racing.races r ON r.race_id = m.race_id
WHERE r.status IN ('SCHEDULED', 'OPEN', 'LOCKED', 'LIVE')
  AND m.status IN ('PENDING', 'OPEN', 'SUSPENDED')
  AND m.type IN ('FINISH_POSITION', 'TOP_N', 'AGAINST_FINISH_POSITION', 'AGAINST_TOP_N');

UPDATE market.markets m
SET closes_rule = CASE WHEN h.closes_at_lap IS NULL THEN '{"at": "LOCK"}'::jsonb
                       ELSE '{"lapsBeforeHalf": 1}'::jsonb END,
    closes_at_lap = CASE WHEN h.race_status IN ('LOCKED', 'LIVE') THEN coalesce(h.closes_at_lap, 1)
                         ELSE h.closes_at_lap END
FROM half_race_markets h
WHERE m.market_id = h.market_id;

CREATE TEMP TABLE half_race_shapes ON COMMIT DROP AS
SELECT t.race_class, t.version,
       (SELECT jsonb_agg(CASE WHEN entry->>'type' IN ('FINISH_POSITION', 'TOP_N', 'AGAINST_FINISH_POSITION', 'AGAINST_TOP_N')
                              THEN entry - 'closes' ELSE entry END
                         ORDER BY ordinality)
        FROM jsonb_array_elements(t.definition->'markets') WITH ORDINALITY AS e(entry, ordinality)) AS shape
FROM market.market_templates t;

UPDATE market.markets m
SET template_version = active.version
FROM racing.races r, market.market_templates active, half_race_shapes old_shape, half_race_shapes new_shape
WHERE m.race_id = r.race_id
  AND r.status IN ('SCHEDULED', 'OPEN', 'LOCKED', 'LIVE')
  AND active.race_class = r.race_class AND active.is_active
  AND m.template_version < active.version
  AND old_shape.race_class = r.race_class AND old_shape.version = m.template_version
  AND new_shape.race_class = r.race_class AND new_shape.version = active.version
  AND old_shape.shape = new_shape.shape
  AND active.definition->'markets' @> '[{"type": "AGAINST_TOP_N", "closes": {"at": "LOCK"}}]'::jsonb;
