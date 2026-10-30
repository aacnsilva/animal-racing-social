import { randomInt } from 'node:crypto';
import { isUniqueViolation, many, one, tx, type Client, type Queryable } from '../../lib/db.ts';
import { entrantNumber, newId } from '../../lib/ids.ts';
import { payload, runConsumer, Topics, type PayloadOf } from '../../lib/kafka.ts';
import { log } from '../../lib/log.ts';
import { enqueue } from '../../lib/outbox.ts';
import { bootstrap, every, type Runtime } from '../../lib/runtime.ts';
import { DAY_MS, MINUTE_MS, utcDay } from '../../lib/time.ts';
import {
  ageFactor, currentStats, formToken, lifeStage, pushForm, randomBase, retirementReason, type SpeciesConfig, type Stats,
} from '../../domain/aging.ts';
import { animalName, TEMPERAMENTS } from '../../domain/names.ts';

type AnimalRow = {
  animal_id: string;
  species: string;
  status: string;
  recruited_at: Date;
  career_day: number;
  entry_career_day: number;
  decline_rate: number;
  base_velocity: number;
  base_stamina: number;
  base_acceleration: number;
  base_consistency: number;
  races: number;
  wins: number;
  podiums: number;
};

export async function loadSpecies(db: Queryable): Promise<SpeciesConfig[]> {
  const rows = await many(db, 'SELECT * FROM stable.species ORDER BY species');
  return rows.map((row) => ({
    species: row.species,
    maxCareerDays: row.max_career_days,
    lifeStages: row.life_stages,
    ageCurve: row.age_curve,
    retireThreshold: Number(row.retire_threshold),
    targetPoolSize: row.target_pool_size,
    baseRanges: row.base_ranges,
  }));
}

const baseOf = (row: AnimalRow): Stats => ({
  velocity: row.base_velocity, stamina: row.base_stamina, acceleration: row.base_acceleration, consistency: row.base_consistency,
});

async function recruit(client: Client, config: SpeciesConfig, initial: boolean): Promise<void> {
  const rookieEnd = config.lifeStages.PRIME[0];
  const careerDay = initial ? randomInt(Math.floor(config.maxCareerDays * 0.85)) : randomInt(Math.max(1, rookieEnd));
  const base = randomBase(config);
  const declineRate = Math.round((0.8 + Math.random() * 0.5) * 1000) / 1000;
  const factor = ageFactor(config, careerDay, declineRate);
  const current = currentStats(base, factor);
  const temperament = TEMPERAMENTS[randomInt(TEMPERAMENTS.length)]!;
  const animalId = newId(0);
  let name = animalName(config.species);
  for (let attempt = 0; ; attempt++) {
    try {
      await client.query('SAVEPOINT recruit');
      await client.query(
        `INSERT INTO stable.animals (animal_id, species, name, temperament, recruited_at, career_day, entry_career_day, age_weeks, life_stage,
           base_velocity, base_stamina, base_acceleration, base_consistency, cur_velocity, cur_stamina, cur_acceleration, cur_consistency, decline_rate)
         VALUES ($1, $2, $3, $4, now(), $5, $5, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [animalId, config.species, name, temperament, careerDay, lifeStage(config, careerDay),
          base.velocity, base.stamina, base.acceleration, base.consistency,
          current.velocity, current.stamina, current.acceleration, current.consistency, declineRate],
      );
      await client.query('RELEASE SAVEPOINT recruit');
      break;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT recruit');
      if (!isUniqueViolation(error) || attempt > 20) throw error;
      name = attempt < 10 ? animalName(config.species) : `${animalName(config.species)} ${attempt}`;
    }
  }
  await client.query(
    'INSERT INTO stable.animal_daily_stats (animal_id, day, career_day, life_stage, stats) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
    [animalId, utcDay(), careerDay, lifeStage(config, careerDay), JSON.stringify(current)],
  );
  await enqueue(client, 'stable', Topics.stableEvents, animalId, payload('animalRecruited', {
    animalId, species: config.species, name, base, temperament,
  }));
}

async function ageAnimal(client: Client, config: SpeciesConfig, animal: AnimalRow, targetDay: number): Promise<void> {
  const factor = ageFactor(config, targetDay, animal.decline_rate);
  const stage = lifeStage(config, targetDay);
  const current = currentStats(baseOf(animal), factor);
  await client.query(
    `UPDATE stable.animals SET career_day = $2, age_weeks = $2, life_stage = $3,
       cur_velocity = $4, cur_stamina = $5, cur_acceleration = $6, cur_consistency = $7 WHERE animal_id = $1`,
    [animal.animal_id, targetDay, stage, current.velocity, current.stamina, current.acceleration, current.consistency],
  );
  await client.query(
    'INSERT INTO stable.animal_daily_stats (animal_id, day, career_day, life_stage, stats) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
    [animal.animal_id, utcDay(), targetDay, stage, JSON.stringify(current)],
  );
  await enqueue(client, 'stable', Topics.stableEvents, animal.animal_id, payload('animalAged', {
    animalId: animal.animal_id, ageWeeks: targetDay, lifeStage: stage, current, careerDay: targetDay,
  }));
  const reason = retirementReason(config, targetDay, factor);
  if (reason) await retire(client, animal, reason);
}

export async function retire(client: Client, animal: Pick<AnimalRow, 'animal_id' | 'races' | 'wins' | 'podiums'>, reason: 'AGE' | 'DECLINE' | 'ADMIN'): Promise<void> {
  await client.query(`UPDATE stable.animals SET status = 'RETIRED', retired_at = now(), retire_reason = $2 WHERE animal_id = $1 AND status = 'ACTIVE'`, [animal.animal_id, reason]);
  await enqueue(client, 'stable', Topics.stableEvents, animal.animal_id, payload('animalRetired', {
    animalId: animal.animal_id, reason, careerStats: { races: animal.races, wins: animal.wins, podiums: animal.podiums },
  }));
}

async function maintainStable(runtime: Runtime): Promise<void> {
  const configs = await loadSpecies(runtime.pool);
  for (const config of configs) {
    await tx(runtime.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`stable-${config.species}`]);
      const animals = await many<AnimalRow>(client, `SELECT * FROM stable.animals WHERE species = $1 AND status = 'ACTIVE'`, [config.species]);
      let aged = 0;
      for (const animal of animals) {
        const targetDay = animal.entry_career_day + Math.floor((Date.now() - animal.recruited_at.getTime()) / DAY_MS);
        if (targetDay !== animal.career_day) {
          await ageAnimal(client, config, animal, targetDay);
          aged++;
        }
      }
      const active = (await one(client, `SELECT count(*)::int AS n FROM stable.animals WHERE species = $1 AND status = 'ACTIVE'`, [config.species]))!.n;
      const initial = animals.length === 0;
      for (let i = active; i < config.targetPoolSize; i++) await recruit(client, config, initial);
      if (aged > 0 || active < config.targetPoolSize) log.info('stable maintained', { species: config.species, aged, recruited: Math.max(0, config.targetPoolSize - active) });
    });
  }
}

async function onRaceFinished(runtime: Runtime, eventId: string, finished: PayloadOf<'raceFinished'>): Promise<void> {
  await tx(runtime.pool, async (client) => {
    const fresh = await client.query('INSERT INTO stable.processed_events (consumer, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', ['stable', eventId]);
    if (fresh.rowCount === 0) return;
    const race = await one(client, 'SELECT race_class, venue_id FROM racing.races WHERE race_id = $1', [finished.raceId]);
    if (!race) return;
    const programme = await one(client, 'SELECT recovery_minutes FROM racing.programme ORDER BY version DESC LIMIT 1');
    const recovery = Number(programme?.recovery_minutes?.[race.race_class] ?? 90);
    const finishedAt = finished.finishedAt ? new Date(finished.finishedAt) : new Date();
    const entrants = await many(client, 'SELECT entrant_id, animal_id FROM racing.race_entrants WHERE race_id = $1', [finished.raceId]);
    const animalOf = new Map(entrants.map((row) => [row.entrant_id as number, row.animal_id as string]));
    for (const result of finished.results) {
      const animalId = animalOf.get(entrantNumber(result.entrantId));
      if (!animalId) continue;
      const animal = await one(client, 'SELECT last5 FROM stable.animals WHERE animal_id = $1 FOR UPDATE', [animalId]);
      if (!animal) continue;
      const finishedCleanly = result.resultStatus === 'FINISHED';
      const win = finishedCleanly && result.officialPosition === 1 ? 1 : 0;
      const podium = finishedCleanly && result.officialPosition <= 3 ? 1 : 0;
      await client.query(
        `UPDATE stable.animals SET races = races + 1, wins = wins + $2, podiums = podiums + $3, last5 = $4, resting_until = $5 WHERE animal_id = $1`,
        [animalId, win, podium, pushForm(animal.last5, formToken(result.resultStatus, result.officialPosition)), new Date(finishedAt.getTime() + recovery * MINUTE_MS)],
      );
      await client.query(
        `INSERT INTO stable.animal_venue_form (animal_id, venue_id, races, wins, podiums) VALUES ($1, $2, 1, $3, $4)
         ON CONFLICT (animal_id, venue_id) DO UPDATE SET races = stable.animal_venue_form.races + 1,
           wins = stable.animal_venue_form.wins + $3, podiums = stable.animal_venue_form.podiums + $4`,
        [animalId, race.venue_id, win, podium],
      );
    }
  });
}

export async function start(): Promise<void> {
  const runtime = await bootstrap('stable', { outbox: ['stable'] });
  every(10 * MINUTE_MS, () => maintainStable(runtime), runtime, 'stable maintenance');
  runtime.consumers.push(await runConsumer({
    kafka: runtime.kafka,
    groupId: 'stable',
    topics: [Topics.raceLifecycle],
    pool: runtime.pool,
    handler: async (envelope) => {
      if (envelope.payload?.$case === 'raceFinished') await onRaceFinished(runtime, envelope.eventId, envelope.payload.value);
    },
  }));
}
