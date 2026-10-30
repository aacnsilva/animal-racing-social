DO $$
DECLARE s TEXT;
BEGIN
  FOREACH s IN ARRAY ARRAY['betting','racing','stable','market','wallet','season','notification','admin'] LOOP
    EXECUTE format('ALTER TABLE %I.outbox ADD COLUMN headers JSONB NOT NULL DEFAULT ''{}''', s);
  END LOOP;
END $$;

ALTER TABLE admin.dlq ADD COLUMN headers JSONB NOT NULL DEFAULT '{}';
