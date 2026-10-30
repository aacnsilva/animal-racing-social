import { many, one, type Queryable } from '../lib/db.ts';
import { entrantKey } from '../lib/ids.ts';
import { getJson, type Redis } from '../lib/redis.ts';
import { iso } from '../lib/time.ts';
import { animalSummary } from './animals.ts';

export const RACE_SELECT = `
  SELECT r.*, v.name AS venue_name, v.surface, v.lap_length,
    (SELECT count(*)::int FROM racing.race_entrants e WHERE e.race_id = r.race_id) AS entrant_count,
    w.entrant_id AS winner_entrant, w.animal_id AS winner_animal, wa.name AS winner_name
  FROM racing.races r
  JOIN racing.venues v ON v.venue_id = r.venue_id AND v.version = r.venue_version
  LEFT JOIN racing.race_entrants w ON w.race_id = r.race_id AND w.official_position = 1
  LEFT JOIN stable.animals wa ON wa.animal_id = w.animal_id`;

export type LiveState = {
  raceId: string;
  status: string;
  tick: number;
  lap: number;
  tickMs: number;
  startAt: string;
  entrants: { id: string; dist: number; lane: number; speed: number; staminaPct: number; state: string; pos: number }[];
  events: Record<string, unknown>[];
};

export function liveState(redis: Redis, raceId: string): Promise<LiveState | null> {
  return getJson<LiveState>(redis, `race:${raceId}:state`);
}

const hex = (value: Buffer | null) => (value ? value.toString('hex') : null);

export function raceJson(row: Record<string, any>, live: LiveState | null = null) {
  const isLive = row.status === 'LIVE' && live !== null;
  return {
    id: row.race_id,
    seasonId: row.season_id,
    status: row.status,
    class: row.race_class,
    species: row.species,
    venueId: row.venue_id,
    venueVersion: row.venue_version,
    venueName: row.venue_name,
    surface: row.surface,
    laps: row.laps,
    estimatedDurationSec: row.estimated_duration_s,
    tickMs: row.tick_ms,
    startAt: iso(row.start_at),
    bettingClosesAt: iso(row.betting_closes_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    currentTick: isLive ? live.tick : row.finish_tick ?? null,
    currentLap: isLive ? live.lap : null,
    seedHash: hex(row.seed_hash),
    scriptHash: hex(row.script_hash),
    cancelledReason: row.cancelled_reason,
    entrantCount: row.entrant_count ?? 0,
    result: null as string[] | null,
    winner: row.winner_entrant ? { entrantId: entrantKey(row.winner_entrant), animalId: row.winner_animal, name: row.winner_name } : null,
  };
}

export async function entrantsJson(db: Queryable, raceId: string) {
  const rows = await many(
    db,
    `SELECT e.entrant_id, e.lane, e.temperament AS entrant_temperament, e.stats_snapshot, e.official_position, e.as_run_position,
       e.result_status, e.finish_time_ms, e.distance_covered, a.*
     FROM racing.race_entrants e JOIN stable.animals a USING (animal_id) WHERE e.race_id = $1 ORDER BY e.entrant_id`,
    [raceId],
  );
  return rows.map((row) => ({
    entrantId: entrantKey(row.entrant_id),
    lane: row.lane,
    temperament: row.entrant_temperament,
    statsSnapshot: row.stats_snapshot,
    animal: animalSummary(row),
    result: row.result_status
      ? {
        officialPosition: row.official_position,
        asRunPosition: row.as_run_position,
        resultStatus: row.result_status,
        finishTimeMs: row.finish_time_ms,
        distanceCovered: Number(row.distance_covered ?? 0),
      }
      : null,
  }));
}

export async function loadRace(db: Queryable, redis: Redis, raceId: string) {
  const row = await one(db, `${RACE_SELECT} WHERE r.race_id = $1`, [raceId]);
  if (!row) return null;
  const live = row.status === 'LIVE' ? await liveState(redis, raceId) : null;
  const race = raceJson(row, live);
  const entrants = await entrantsJson(db, raceId);
  const finished = entrants.filter((entrant) => entrant.result).sort((a, b) => a.result!.officialPosition - b.result!.officialPosition);
  return { ...race, result: finished.length ? finished.map((entrant) => entrant.entrantId) : null, entrants };
}
