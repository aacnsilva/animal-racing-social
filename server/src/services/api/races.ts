import { zstdDecompressSync } from 'node:zlib';
import { decodeCursor, page, pageLimit } from '../../lib/cursor.ts';
import { many, one } from '../../lib/db.ts';
import { ApiError, pathId, Reply, v, type Router } from '../../lib/http.ts';
import { entrantKey } from '../../lib/ids.ts';
import { callRaw, raceEngine } from '../../lib/internal.ts';
import { HOUR_MS, iso } from '../../lib/time.ts';
import { marketsForRace } from '../../read/markets.ts';
import { liveState, loadRace, RACE_SELECT, raceJson } from '../../read/races.ts';
import type { Deps } from './context.ts';

const UPCOMING = ['SCHEDULED', 'OPEN', 'LOCKED', 'LIVE'];
const STATUSES = ['SCHEDULED', 'OPEN', 'LOCKED', 'LIVE', 'FINISHED', 'SETTLED', 'CANCELLED'] as const;
const scriptCache = new Map<string, Buffer>();

function remember(raceId: string, script: Buffer): Buffer {
  scriptCache.set(raceId, script);
  while (scriptCache.size > 16) scriptCache.delete(scriptCache.keys().next().value!);
  return script;
}

async function finishedRace(deps: Deps, raceId: string) {
  const race = await one(deps.pool, 'SELECT * FROM racing.races WHERE race_id = $1', [raceId]);
  if (!race) throw new ApiError(404, 'NOT_FOUND', 'Unknown race');
  if (!['FINISHED', 'SETTLED'].includes(race.status)) throw new ApiError(409, 'RACE_NOT_FINISHED', 'The script is sealed until the race finishes');
  return race;
}

export async function scriptBytes(deps: Deps, raceId: string): Promise<Buffer> {
  const cached = scriptCache.get(raceId);
  if (cached) return cached;
  const race = await finishedRace(deps, raceId);
  const replay = await one(deps.pool, 'SELECT script, expires_at FROM racing.race_replays WHERE race_id = $1', [raceId]);
  if (replay && replay.expires_at > new Date()) return remember(raceId, zstdDecompressSync(replay.script));
  const engine = await one(deps.pool, 'SELECT replayable FROM racing.engine_versions WHERE engine_version = $1', [race.engine_version]);
  if (!engine?.replayable || !race.seed) throw new ApiError(410, 'REPLAY_EXPIRED', 'Replay retention has passed for this race');
  const entrants = await many(deps.pool, 'SELECT * FROM racing.race_entrants WHERE race_id = $1 ORDER BY entrant_id', [raceId]);
  const response = await callRaw(raceEngine.base(), '/internal/simulate', {
      raceId,
      engineVersion: race.engine_version,
      venueId: race.venue_id,
      venueVersion: race.venue_version,
      species: race.species,
      laps: race.laps,
      seed: race.seed.toString('hex'),
      entrants: entrants.map((entrant) => ({
        entrantId: entrantKey(entrant.entrant_id), animalId: entrant.animal_id, lane: entrant.lane, temperament: entrant.temperament, stats: entrant.stats_snapshot,
      })),
  }, 60_000).catch(() => null);
  if (!response || response.status !== 200) throw new ApiError(410, 'REPLAY_EXPIRED', 'Replay could not be regenerated');
  return remember(raceId, response.bytes);
}

function statusFilter(raw: string | null): string[] | null {
  if (!raw) return null;
  const statuses = raw.split(',').map((status) => v.oneOf(status.trim().toUpperCase(), 'status', STATUSES));
  if (statuses.includes('FINISHED') && !statuses.includes('SETTLED')) statuses.push('SETTLED');
  return statuses;
}

export function raceRoutes(router: Router, deps: Deps): void {
  router.get('/v1/schedule', async (ctx) => {
    const from = ctx.query.get('from') ? v.date(ctx.query.get('from'), 'from') : new Date(Date.now() - 15 * 60_000);
    const to = ctx.query.get('to') ? v.date(ctx.query.get('to'), 'to') : new Date(Date.now() + 24 * HOUR_MS);
    const limit = pageLimit(ctx.query, 100);
    const cursor = decodeCursor(ctx.query.get('cursor'));
    const rows = await many(
      deps.pool,
      `${RACE_SELECT}
       WHERE r.status = ANY($1) AND r.start_at BETWEEN $2 AND $3
         AND ($4::text IS NULL OR r.species = $4) AND ($5::text IS NULL OR r.race_class = $5)
         AND ($6::timestamptz IS NULL OR (r.start_at, r.race_id) > ($6, $7::bigint))
       ORDER BY r.start_at, r.race_id LIMIT $8`,
      [UPCOMING, from, to, ctx.query.get('species'), ctx.query.get('class'), cursor?.[0] ?? null, cursor?.[1] ?? '0', limit + 1],
    );
    const live = new Map(await Promise.all(rows.filter((row) => row.status === 'LIVE').map(async (row) => [row.race_id, await liveState(deps.redis, row.race_id)] as const)));
    return page(rows.map((row) => raceJson(row, live.get(row.race_id) ?? null)), limit, (race) => [race.startAt!, race.id]);
  });

  router.get('/v1/races', async (ctx) => {
    const limit = pageLimit(ctx.query);
    const cursor = decodeCursor(ctx.query.get('cursor'));
    const rows = await many(
      deps.pool,
      `${RACE_SELECT}
       WHERE ($1::text[] IS NULL OR r.status = ANY($1))
         AND ($2::timestamptz IS NULL OR r.start_at >= $2) AND ($3::timestamptz IS NULL OR r.start_at <= $3)
         AND ($4::text IS NULL OR r.species = $4) AND ($5::text IS NULL OR r.venue_id = $5)
         AND ($6::bigint IS NULL OR EXISTS (SELECT 1 FROM racing.race_entrants x WHERE x.race_id = r.race_id AND x.animal_id = $6))
         AND ($7::timestamptz IS NULL OR (r.start_at, r.race_id) < ($7, $8::bigint))
       ORDER BY r.start_at DESC, r.race_id DESC LIMIT $9`,
      [statusFilter(ctx.query.get('status')), ctx.query.get('from'), ctx.query.get('to'), ctx.query.get('species'), ctx.query.get('venueId'),
        ctx.query.get('animalId'), cursor?.[0] ?? null, cursor?.[1] ?? '0', limit + 1],
    );
    return page(rows.map((row) => raceJson(row)), limit, (race) => [race.startAt!, race.id]);
  });

  router.get('/v1/races/:raceId', async (ctx) => {
    const race = await loadRace(deps.pool, deps.redis, pathId(ctx, 'raceId'));
    if (!race) throw new ApiError(404, 'NOT_FOUND', 'Unknown race');
    return race;
  });

  router.get('/v1/races/:raceId/markets', async (ctx) => {
    const raceId = pathId(ctx, 'raceId');
    const status = ctx.query.get('status');
    return marketsForRace(deps.pool, deps.redis, raceId, status ? v.oneOf(status, 'status', ['PENDING', 'OPEN', 'SUSPENDED', 'CLOSED', 'RESULTED', 'VOID']) : null);
  });

  router.get('/v1/races/:raceId/result', async (ctx) => {
    const raceId = pathId(ctx, 'raceId');
    const raceRow = await finishedRace(deps, raceId);
    const race = (await loadRace(deps.pool, deps.redis, raceId))!;
    const entrants = race.entrants;
    const asRun = [...entrants].filter((e) => e.result).sort((a, b) => a.result!.asRunPosition - b.result!.asRunPosition).map((e) => e.entrantId);
    const lapLeaders = await many(deps.pool, 'SELECT lap, entrant_id, tick FROM racing.race_lap_leaders WHERE race_id = $1 ORDER BY lap', [raceId]);
    const incidents = await many(deps.pool, 'SELECT seq, tick, type, entrant_id, data FROM racing.race_incidents WHERE race_id = $1 ORDER BY seq', [raceId]);
    const markets = await marketsForRace(deps.pool, deps.redis, raceId);
    const replay = await one(deps.pool, 'SELECT expires_at FROM racing.race_replays WHERE race_id = $1', [raceId]);
    return {
      race,
      order: race.result ?? [],
      asRun,
      lapLeaders: lapLeaders.map((row) => ({ lap: row.lap, entrantId: entrantKey(row.entrant_id), tick: row.tick })),
      incidents: incidents.map((row) => ({ seq: row.seq, tick: row.tick, type: row.type, entrantId: row.entrant_id ? entrantKey(row.entrant_id) : null, data: row.data })),
      markets: markets.map((market) => ({
        marketId: market.id,
        type: market.type,
        params: market.params,
        status: market.status,
        winning: market.selections.filter((selection) => market.result?.winning.includes(selection.selectionId)),
        order: market.result?.order ?? [],
      })),
      seed: raceRow.seed ? raceRow.seed.toString('hex') : null,
      seedHash: race.seedHash,
      scriptHash: race.scriptHash,
      engineVersion: raceRow.engine_version,
      replay: { available: Boolean(replay && replay.expires_at > new Date()), expiresAt: iso(replay?.expires_at) },
    };
  });

  router.get('/v1/races/:raceId/script', async (ctx) => new Reply(200, await scriptBytes(deps, pathId(ctx, 'raceId'))));

  router.get('/v1/races/:raceId/ticks', async (ctx) => {
    const fromTick = ctx.query.get('fromTick') ? v.int(ctx.query.get('fromTick'), 'fromTick', { min: 0 }) : 0;
    const script = JSON.parse((await scriptBytes(deps, pathId(ctx, 'raceId'))).toString('utf8'));
    return (script.ticks as { tick: number }[]).filter((tick) => tick.tick >= fromTick);
  });
}
