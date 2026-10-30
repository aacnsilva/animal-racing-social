import { randomInt } from 'node:crypto';
import { envInt } from '../../lib/config.ts';
import { many, one, tx, type Client, type Queryable } from '../../lib/db.ts';
import { entrantKey, newId } from '../../lib/ids.ts';
import { raceEngine, type EntrantInput } from '../../lib/internal.ts';
import { payload, runConsumer, Topics, type PayloadOf } from '../../lib/kafka.ts';
import { errorFields, log } from '../../lib/log.ts';
import { enqueue } from '../../lib/outbox.ts';
import { bootstrap, every, type Runtime } from '../../lib/runtime.ts';
import { HOUR_MS, MINUTE_MS } from '../../lib/time.ts';
import { isAvailable, shuffle, slotPlan, slotsBetween, type Booking, type Programme, type RaceClass, type Species } from '../../domain/scheduler.ts';

const FIELD_MIN = () => envInt('FIELD_MIN', 6);
const FIELD_MAX = () => envInt('FIELD_MAX', 10);

export async function loadProgramme(db: Queryable): Promise<Programme & { version: number }> {
  const row = await one(db, 'SELECT * FROM racing.programme WHERE effective_from <= now() ORDER BY version DESC LIMIT 1');
  if (!row) throw new Error('No programme configured');
  return {
    version: row.version,
    racesPerHour: row.races_per_hour,
    classMix: row.class_mix,
    speciesRotation: row.species_rotation,
    horizonHours: row.horizon_hours,
    recoveryMinutes: row.recovery_minutes,
  };
}

type ScheduleRequest = { raceId?: string; startAt: Date; species: Species; raceClass: RaceClass; venueId?: string; fieldSize?: number };

async function seasonFor(client: Client, startAt: Date) {
  return one(
    client,
    `SELECT season_id FROM season.seasons WHERE status IN ('ACTIVE', 'UPCOMING') AND starts_at <= $1 AND $1 <= last_race_at ORDER BY starts_at LIMIT 1`,
    [startAt],
  );
}

async function pickVenue(client: Client, raceClass: RaceClass, venueId?: string) {
  const venues = await many(
    client,
    `SELECT DISTINCT ON (venue_id) * FROM racing.venues WHERE race_class = $1 AND ($2::text IS NULL OR venue_id = $2) ORDER BY venue_id, version DESC`,
    [raceClass, venueId ?? null],
  );
  const active = venues.filter((venue) => venue.status === 'ACTIVE');
  return active.length ? active[randomInt(active.length)] : undefined;
}

async function pickEntrants(client: Client, request: ScheduleRequest, programme: Programme) {
  const daysAhead = Math.ceil((request.startAt.getTime() - Date.now()) / (24 * HOUR_MS));
  const candidates = await many(
    client,
    `SELECT a.* FROM stable.animals a JOIN stable.species s USING (species)
     WHERE a.species = $1 AND a.status = 'ACTIVE' AND a.career_day + $2 < s.max_career_days - 1`,
    [request.species, daysAhead],
  );
  if (candidates.length === 0) return [];
  const window = (10 + 130) * MINUTE_MS;
  const bookings = await many(
    client,
    `SELECT e.animal_id, r.start_at, r.race_class FROM racing.race_entrants e JOIN racing.races r USING (race_id)
     WHERE r.status <> 'CANCELLED' AND e.animal_id = ANY($1) AND r.start_at BETWEEN $2 AND $3`,
    [candidates.map((c) => c.animal_id), new Date(request.startAt.getTime() - window), new Date(request.startAt.getTime() + window)],
  );
  const byAnimal = new Map<string, Booking[]>();
  for (const booking of bookings) {
    const list = byAnimal.get(booking.animal_id) ?? [];
    list.push({ startAt: booking.start_at, raceClass: booking.race_class });
    byAnimal.set(booking.animal_id, list);
  }
  const available = candidates.filter((animal) => isAvailable(byAnimal.get(animal.animal_id) ?? [], request.startAt, request.raceClass, programme.recoveryMinutes));
  const size = request.fieldSize ?? FIELD_MIN() + randomInt(FIELD_MAX() - FIELD_MIN() + 1);
  return shuffle(available).slice(0, Math.min(size, 10));
}

export async function scheduleRace(client: Client, request: ScheduleRequest, programme: Programme): Promise<string | null> {
  if (request.raceId) {
    const existing = await one(client, 'SELECT race_id FROM racing.races WHERE race_id = $1', [request.raceId]);
    if (existing) return request.raceId;
  }
  const season = await seasonFor(client, request.startAt);
  if (!season) {
    log.warn('no season accepts this start time', { startAt: request.startAt });
    return null;
  }
  const engine = await one(client, 'SELECT engine_version FROM racing.engine_versions WHERE is_active');
  if (!engine) {
    log.warn('no active engine version yet');
    return null;
  }
  const venue = await pickVenue(client, request.raceClass, request.venueId);
  if (!venue) {
    log.warn('no active venue', { raceClass: request.raceClass, venueId: request.venueId });
    return null;
  }
  const animals = await pickEntrants(client, request, programme);
  if (animals.length < FIELD_MIN()) {
    log.warn('not enough available animals', { species: request.species, startAt: request.startAt, available: animals.length });
    return null;
  }
  const lanes = shuffle(Array.from({ length: venue.lanes as number }, (_, i) => i + 1));
  const entrants = animals.map((animal, index) => ({
    number: index + 1,
    animal,
    lane: lanes[index]!,
    stats: { velocity: animal.cur_velocity, stamina: animal.cur_stamina, acceleration: animal.cur_acceleration, consistency: animal.cur_consistency },
  }));
  const inputs: EntrantInput[] = entrants.map((entrant) => ({
    entrantId: entrantKey(entrant.number),
    animalId: entrant.animal.animal_id,
    lane: entrant.lane,
    temperament: entrant.animal.temperament,
    stats: entrant.stats,
  }));
  const plan = await raceEngine.plan({
    venueId: venue.venue_id, venueVersion: venue.version, species: request.species, raceClass: request.raceClass, engineVersion: engine.engine_version, entrants: inputs,
  });
  const raceId = request.raceId ?? newId(0);
  await client.query(
    `INSERT INTO racing.races (race_id, season_id, species, race_class, venue_id, venue_version, engine_version, laps, estimated_duration_s,
       status, start_at, betting_closes_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'SCHEDULED', $10, $10::timestamptz - interval '60 seconds')`,
    [raceId, season.season_id, request.species, request.raceClass, venue.venue_id, venue.version, engine.engine_version, plan.laps, plan.estimatedDurationSec, request.startAt],
  );
  for (const entrant of entrants) {
    await client.query(
      `INSERT INTO racing.race_entrants (race_id, entrant_id, animal_id, lane, temperament, stats_snapshot) VALUES ($1, $2, $3, $4, $5, $6)`,
      [raceId, entrant.number, entrant.animal.animal_id, entrant.lane, entrant.animal.temperament, JSON.stringify(entrant.stats)],
    );
  }
  await enqueue(client, 'racing', Topics.raceCommands, raceId, payload('generateScript', {
    raceId,
    engineVersion: engine.engine_version,
    venueId: venue.venue_id,
    venueVersion: venue.version,
    laps: plan.laps,
    species: request.species,
    entrants: inputs.map((input, index) => ({ ...input, name: entrants[index]!.animal.name })),
  }));
  log.info('race scheduled', { raceId, startAt: request.startAt, species: request.species, raceClass: request.raceClass, venue: venue.venue_id, field: entrants.length });
  return raceId;
}

async function withSchedulingLock<T>(runtime: Runtime, fn: (client: Client) => Promise<T>): Promise<T> {
  return tx(runtime.pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['scheduler']);
    return fn(client);
  });
}

async function fillHorizon(runtime: Runtime): Promise<void> {
  const programme = await loadProgramme(runtime.pool);
  const maxHorizon = envInt('SCHEDULER_MAX_HORIZON_HOURS', 48);
  const from = new Date(Date.now() + envInt('SCHEDULER_LEAD_MINUTES', 3) * MINUTE_MS);
  const to = new Date(Date.now() + Math.min(programme.horizonHours, maxHorizon) * HOUR_MS);
  const slots = slotsBetween(from, to, programme);
  const taken = new Set((await many(runtime.pool, `SELECT start_at FROM racing.races WHERE start_at BETWEEN $1 AND $2 AND status <> 'CANCELLED'`, [from, to]))
    .map((row) => (row.start_at as Date).getTime()));
  let scheduled = 0;
  for (const slot of slots) {
    if (taken.has(slot.getTime())) continue;
    if (scheduled >= envInt('SCHEDULER_BATCH', 12)) break;
    const plan = slotPlan(slot, programme);
    try {
      const raceId = await withSchedulingLock(runtime, (client) => scheduleRace(client, { startAt: slot, ...plan }, programme));
      if (!raceId) break;
      scheduled++;
    } catch (error) {
      log.warn('slot scheduling failed', { slot, ...errorFields(error) });
      break;
    }
  }
}

async function lockAndExpire(runtime: Runtime): Promise<void> {
  await tx(runtime.pool, async (client) => {
    const locked = await many(client, `UPDATE racing.races SET status = 'LOCKED' WHERE status = 'OPEN' AND betting_closes_at <= now() RETURNING race_id`);
    for (const row of locked) await enqueue(client, 'racing', Topics.raceLifecycle, row.race_id, payload('raceLocked', { raceId: row.race_id }));
    const unsealed = await many(
      client,
      `UPDATE racing.races SET status = 'CANCELLED', cancelled_reason = 'SCRIPT_NOT_SEALED' WHERE status = 'SCHEDULED' AND betting_closes_at <= now() RETURNING race_id`,
    );
    for (const row of unsealed) {
      await enqueue(client, 'racing', Topics.raceLifecycle, row.race_id, payload('raceCancelled', { raceId: row.race_id, reason: 'SCRIPT_NOT_SEALED' }));
    }
  });
}

async function onSealed(runtime: Runtime, sealed: PayloadOf<'scriptSealed'>): Promise<void> {
  await tx(runtime.pool, async (client) => {
    const race = await one(client, 'SELECT * FROM racing.races WHERE race_id = $1 FOR UPDATE', [sealed.raceId]);
    if (!race || race.status !== 'SCHEDULED') return;
    const entrants = await many(
      client,
      `SELECT e.*, a.name FROM racing.race_entrants e JOIN stable.animals a USING (animal_id) WHERE e.race_id = $1 ORDER BY e.entrant_id`,
      [sealed.raceId],
    );
    await client.query(`UPDATE racing.races SET status = 'OPEN' WHERE race_id = $1`, [sealed.raceId]);
    await enqueue(client, 'racing', Topics.raceLifecycle, sealed.raceId, payload('raceScheduled', {
      raceId: race.race_id,
      seasonId: race.season_id,
      species: race.species,
      raceClass: race.race_class,
      venueId: race.venue_id,
      venueVersion: race.venue_version,
      engineVersion: race.engine_version,
      startAt: race.start_at.toISOString(),
      laps: race.laps,
      estimatedDurationSec: race.estimated_duration_s,
      tickMs: race.tick_ms,
      entrants: entrants.map((entrant) => ({
        entrantId: entrantKey(entrant.entrant_id),
        animalId: entrant.animal_id,
        lane: entrant.lane,
        temperament: entrant.temperament,
        stats: entrant.stats_snapshot,
        name: entrant.name,
      })),
      seedHash: sealed.seedHash,
      scriptHash: sealed.scriptHash,
    }));
    await enqueue(client, 'racing', Topics.raceLifecycle, sealed.raceId, payload('raceOpened', { raceId: sealed.raceId }));
  });
}

async function onScriptFailed(runtime: Runtime, failed: PayloadOf<'scriptFailed'>): Promise<void> {
  const attempts = await runtime.redis.incr(`script-attempts:${failed.raceId}`);
  await runtime.redis.expire(`script-attempts:${failed.raceId}`, 86400);
  log.warn('script generation failed', { raceId: failed.raceId, reason: failed.reason, attempts });
  await tx(runtime.pool, async (client) => {
    const race = await one(client, 'SELECT * FROM racing.races WHERE race_id = $1 FOR UPDATE', [failed.raceId]);
    if (!race || race.status !== 'SCHEDULED') return;
    if (attempts > 2) {
      await cancelRace(client, failed.raceId, `SCRIPT_FAILED: ${failed.reason}`);
      return;
    }
    const entrants = await many(
      client,
      `SELECT e.*, a.name FROM racing.race_entrants e JOIN stable.animals a USING (animal_id) WHERE e.race_id = $1 ORDER BY e.entrant_id`,
      [failed.raceId],
    );
    await enqueue(client, 'racing', Topics.raceCommands, failed.raceId, payload('generateScript', {
      raceId: race.race_id,
      engineVersion: race.engine_version,
      venueId: race.venue_id,
      venueVersion: race.venue_version,
      laps: race.laps,
      species: race.species,
      entrants: entrants.map((entrant) => ({
        entrantId: entrantKey(entrant.entrant_id), animalId: entrant.animal_id, lane: entrant.lane,
        temperament: entrant.temperament, stats: entrant.stats_snapshot, name: entrant.name,
      })),
    }));
  });
}

async function cancelRace(client: Client, raceId: string, reason: string): Promise<boolean> {
  const cancelled = await client.query(
    `UPDATE racing.races SET status = 'CANCELLED', cancelled_reason = $2 WHERE race_id = $1 AND status IN ('SCHEDULED', 'OPEN', 'LOCKED', 'LIVE')`,
    [raceId, reason],
  );
  if (cancelled.rowCount === 0) return false;
  await enqueue(client, 'racing', Topics.raceLifecycle, raceId, payload('raceCancelled', { raceId, reason }));
  log.info('race cancelled', { raceId, reason });
  return true;
}

export async function start(): Promise<void> {
  const runtime = await bootstrap('scheduler', { outbox: ['racing'] });
  every(envInt('SCHEDULER_INTERVAL_MS', 30_000), () => fillHorizon(runtime), runtime, 'fill horizon');
  every(1000, () => lockAndExpire(runtime), runtime, 'lock races');
  runtime.consumers.push(await runConsumer({
    kafka: runtime.kafka,
    groupId: 'scheduler',
    topics: [Topics.raceLifecycle, Topics.raceCommands],
    pool: runtime.pool,
    concurrency: 6,
    handler: async (envelope) => {
      const event = envelope.payload;
      switch (event?.$case) {
        case 'scriptSealed':
          await onSealed(runtime, event.value);
          break;
        case 'scriptFailed':
          await onScriptFailed(runtime, event.value);
          break;
        case 'raceSettled':
          await runtime.pool.query(`UPDATE racing.races SET status = 'SETTLED' WHERE race_id = $1 AND status = 'FINISHED'`, [event.value.raceId]);
          break;
        case 'scheduleRace': {
          const command = event.value;
          const programme = await loadProgramme(runtime.pool);
          await withSchedulingLock(runtime, (client) => scheduleRace(client, {
            raceId: command.raceId,
            startAt: new Date(command.startAt),
            species: command.species as Species,
            raceClass: command.raceClass as RaceClass,
            ...(command.venueId ? { venueId: command.venueId } : {}),
            ...(command.fieldSize ? { fieldSize: command.fieldSize } : {}),
          }, programme));
          break;
        }
        case 'cancelRace':
          await tx(runtime.pool, (client) => cancelRace(client, event.value.raceId, event.value.reason || 'ADMIN'));
          break;
      }
    },
  }));
}
