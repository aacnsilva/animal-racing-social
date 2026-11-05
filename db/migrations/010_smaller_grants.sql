ALTER TABLE season.seasons ALTER COLUMN starting_grant SET DEFAULT 1000;
ALTER TABLE season.seasons ALTER COLUMN lifesaver_grant SET DEFAULT 500;

UPDATE season.seasons SET lifesaver_grant = 500 WHERE status IN ('ACTIVE','UPCOMING');
UPDATE season.seasons SET starting_grant = 1000 WHERE status = 'UPCOMING';
