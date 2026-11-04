ALTER TABLE racing.venues DROP CONSTRAINT venues_surface_check;
ALTER TABLE racing.venues ADD CONSTRAINT venues_surface_check CHECK (surface IN
  ('DIRT','GRASS','SAND','MUD','ICE','POOL','AQUARIUM','OPEN_SEA'));
ALTER TABLE racing.venues ADD COLUMN habitat TEXT NOT NULL GENERATED ALWAYS AS (
  CASE WHEN surface IN ('POOL','AQUARIUM','OPEN_SEA') THEN 'AQUATIC' ELSE 'TERRAIN' END
) STORED;
CREATE INDEX ON racing.venues (race_class, habitat);

ALTER TABLE stable.species ADD COLUMN habitat TEXT NOT NULL DEFAULT 'TERRAIN'
  CHECK (habitat IN ('TERRAIN','AQUATIC'));

INSERT INTO racing.programme (version, races_per_hour, class_mix, species_rotation, horizon_hours, recovery_minutes, effective_from, created_by)
SELECT version + 1, 6, class_mix, ARRAY['HORSE','SHARK','GIRAFFE','OCTOPUS'], horizon_hours, recovery_minutes, now(), 0
FROM racing.programme
WHERE effective_from <= now()
  AND NOT ('SHARK' = ANY(species_rotation) OR 'OCTOPUS' = ANY(species_rotation))
ORDER BY version DESC
LIMIT 1;
