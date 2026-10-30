import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env, envInt } from '../lib/config.ts';
import { allTopics, createKafka } from '../lib/kafka.ts';
import { log } from '../lib/log.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dbDir = env('DB_DIR', join(root, '..', 'db'));
const sharedDir = env('SHARED_DIR', join(root, '..', 'shared'));

export const SERVICE_ROLES = [
  'ars_api', 'ars_sse', 'ars_scheduler', 'ars_stable', 'ars_market', 'ars_betting', 'ars_wallet',
  'ars_season', 'ars_notification', 'ars_race_engine', 'ars_broadcaster', 'ars_odds',
];

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(sharedDir, file), 'utf8')) as T;
}

async function migrateSchema(client: pg.Client): Promise<void> {
  await client.query('CREATE TABLE IF NOT EXISTS public.schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  await client.query('SELECT pg_advisory_lock(hashtext($1))', ['schema_migrations']);
  try {
    const applied = new Set((await client.query('SELECT version FROM public.schema_migrations')).rows.map((row) => row.version));
    const files = readdirSync(join(dbDir, 'migrations')).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      log.info('applying migration', { file });
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(dbDir, 'migrations', file), 'utf8'));
        await client.query('INSERT INTO public.schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    await client.query(readFileSync(join(dbDir, 'grants.sql'), 'utf8'));
    for (const role of SERVICE_ROLES) {
      const specific = process.env[`DB_PASSWORD_${role.replace(/^ars_/, '').toUpperCase()}`];
      const password = specific || env('DB_SERVICE_PASSWORD', 'ars');
      const { rows } = await client.query('SELECT format($1::text, $2::text, $3::text) AS sql', ['ALTER ROLE %I PASSWORD %L', role, password]);
      await client.query(rows[0].sql);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['schema_migrations']);
  }
}

async function seed(client: pg.Client): Promise<void> {
  const venues = readJson<any[]>('venues.json');
  for (const venue of venues) {
    await client.query(
      `INSERT INTO racing.venues (venue_id, version, name, race_class, surface, lanes, lap_length, laps_min, laps_max, segments, assets, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT DO NOTHING`,
      [venue.id, venue.version, venue.name, venue.class, venue.surface, venue.lanes, venue.lapLength, venue.lapsRange[0], venue.lapsRange[1],
        JSON.stringify(venue.segments), JSON.stringify(venue.assets), venue.description],
    );
  }
  const paramsPath = join(sharedDir, 'engine-params.json');
  const params = existsSync(paramsPath) ? JSON.parse(readFileSync(paramsPath, 'utf8')) : { species: {} };
  for (const species of readJson<any[]>('species.json')) {
    const affinity = params.species?.[species.species] ?? {};
    await client.query(
      `INSERT INTO stable.species (species, max_career_days, life_stages, age_curve, surface_affinity, segment_affinity, retire_threshold, target_pool_size, base_ranges)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (species) DO UPDATE SET surface_affinity = EXCLUDED.surface_affinity, segment_affinity = EXCLUDED.segment_affinity`,
      [species.species, species.maxCareerDays, JSON.stringify(species.lifeStages), JSON.stringify(species.ageCurve),
        JSON.stringify(affinity.surfaceAffinity ?? {}), JSON.stringify(affinity.segmentAffinity ?? {}), species.retireThreshold,
        species.targetPoolSize, JSON.stringify(species.baseRanges)],
    );
  }
  const templates = readJson<Record<string, { markets: unknown[] }>>('market-templates.json');
  for (const [raceClass, definition] of Object.entries(templates)) {
    await client.query(
      `INSERT INTO market.market_templates (race_class, version, definition, is_active, created_by)
       SELECT $1, 1, $2, true, 0 WHERE NOT EXISTS (SELECT 1 FROM market.market_templates WHERE race_class = $1)`,
      [raceClass, JSON.stringify(definition)],
    );
  }
  const programme = readJson<any>('programme.json');
  await client.query(
    `INSERT INTO racing.programme (version, races_per_hour, class_mix, species_rotation, horizon_hours, recovery_minutes, effective_from, created_by)
     SELECT 1, $1, $2, $3, $4, $5, now(), 0 WHERE NOT EXISTS (SELECT 1 FROM racing.programme)`,
    [programme.racesPerHour, JSON.stringify(programme.classMix), programme.speciesRotation, programme.horizonHours, JSON.stringify(programme.recoveryMinutes)],
  );
}

async function createTopics(): Promise<void> {
  const admin = createKafka('migrate').admin();
  await admin.connect();
  try {
    const existing = new Set(await admin.listTopics());
    const retentionMs = String(envInt('KAFKA_RETENTION_DAYS', 7) * 24 * 3600 * 1000);
    const missing = allTopics.filter((topic) => !existing.has(topic));
    if (missing.length > 0) {
      await admin.createTopics({
        waitForLeaders: true,
        topics: missing.map((topic) => ({
          topic,
          numPartitions: envInt('KAFKA_PARTITIONS', 6),
          replicationFactor: envInt('KAFKA_REPLICATION_FACTOR', 1),
          configEntries: [{ name: 'retention.ms', value: retentionMs }],
        })),
      });
      log.info('created topics', { topics: missing });
    }
  } finally {
    await admin.disconnect();
  }
}

export async function start(): Promise<void> {
  const client = new pg.Client({ connectionString: env('MIGRATE_DATABASE_URL', env('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/ars')) });
  await client.connect();
  try {
    await migrateSchema(client);
    await seed(client);
  } finally {
    await client.end();
  }
  await createTopics();
  log.info('migrate complete');
  process.exit(0);
}
