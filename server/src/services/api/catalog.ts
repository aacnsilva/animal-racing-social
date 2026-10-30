import { decodeCursor, page, pageLimit } from '../../lib/cursor.ts';
import { many, one } from '../../lib/db.ts';
import { ApiError, pathId, v, type Router } from '../../lib/http.ts';
import { iso } from '../../lib/time.ts';
import { activeSeason, seasonJson, type SeasonRow } from '../../lib/seasons.ts';
import { BOARDS, type Board } from '../../domain/leaderboard.ts';
import { animalDetail, animalSummary } from '../../read/animals.ts';
import { RACE_SELECT, raceJson } from '../../read/races.ts';
import { optionalUser, type Deps } from './context.ts';

export function venueJson(row: Record<string, any>) {
  return {
    id: row.venue_id,
    version: row.version,
    name: row.name,
    class: row.race_class,
    surface: row.surface,
    description: row.description,
    lanes: row.lanes,
    lapLength: Number(row.lap_length),
    lapsRange: [row.laps_min, row.laps_max],
    segments: row.segments,
    assets: row.assets,
    status: row.status,
  };
}

async function namesFor(deps: Deps, userIds: string[]): Promise<Map<string, { displayName: string; avatarUrl: string | null }>> {
  if (userIds.length === 0) return new Map();
  const rows = await many(deps.pool, 'SELECT user_id, display_name, avatar_url FROM identity.users WHERE user_id = ANY($1)', [userIds]);
  return new Map(rows.map((row) => [row.user_id, { displayName: row.display_name, avatarUrl: row.avatar_url }]));
}

async function leaderboard(deps: Deps, season: SeasonRow, board: Board, limit: number, me: string | null, around: boolean) {
  let entries: { rank: number; userId: string; score: number }[];
  let mine: { rank: number; userId: string; score: number } | null = null;
  if (season.status === 'ENDED') {
    const rows = await many(deps.pool, 'SELECT rank, user_id, score FROM season.season_results WHERE season_id = $1 AND board = $2 ORDER BY rank LIMIT $3', [season.season_id, board, limit]);
    entries = rows.map((row) => ({ rank: row.rank, userId: row.user_id, score: Number(row.score) }));
    if (me) {
      const row = await one(deps.pool, 'SELECT rank, user_id, score FROM season.season_results WHERE season_id = $1 AND board = $2 AND user_id = $3', [season.season_id, board, me]);
      mine = row ? { rank: row.rank, userId: row.user_id, score: Number(row.score) } : null;
    }
  } else {
    const key = `lb:${season.season_id}:${board}`;
    let start = 0;
    if (me) {
      const rank = await deps.redis.zRevRank(key, me);
      if (rank !== null) {
        const score = await deps.redis.zScore(key, me);
        mine = { rank: rank + 1, userId: me, score: Number(score) };
        if (around) start = Math.max(0, rank - Math.floor(limit / 2));
      }
    }
    const rows = await deps.redis.zRangeWithScores(key, start, start + limit - 1, { REV: true });
    entries = rows.map((row, index) => ({ rank: start + index + 1, userId: String(row.value), score: row.score }));
  }
  const names = await namesFor(deps, [...entries.map((entry) => entry.userId), ...(mine ? [mine.userId] : [])]);
  const decorate = (entry: { rank: number; userId: string; score: number }) => ({
    ...entry,
    displayName: names.get(entry.userId)?.displayName ?? 'Unknown racer',
    avatarUrl: names.get(entry.userId)?.avatarUrl ?? null,
  });
  return { items: entries.map(decorate), me: mine ? decorate(mine) : null };
}

export function catalogRoutes(router: Router, deps: Deps): void {
  router.get('/v1/seasons', async () => {
    const rows = await many<SeasonRow>(deps.pool, 'SELECT * FROM season.seasons ORDER BY starts_at DESC');
    return rows.map(seasonJson);
  });

  router.get('/v1/seasons/current', async () => {
    const season = await activeSeason(deps.pool);
    if (!season) throw new ApiError(404, 'NOT_FOUND', 'No active season');
    return seasonJson(season);
  });

  router.get('/v1/seasons/:seasonId/leaderboards/:board', async (ctx) => {
    const season = await one<SeasonRow>(deps.pool, 'SELECT * FROM season.seasons WHERE season_id = $1', [pathId(ctx, 'seasonId')]);
    if (!season) throw new ApiError(404, 'NOT_FOUND', 'Unknown season');
    const board = v.oneOf(ctx.params.board, 'board', BOARDS);
    const limit = ctx.query.get('limit') ? v.int(ctx.query.get('limit'), 'limit', { min: 1, max: 200 }) : 50;
    return leaderboard(deps, season, board, limit, optionalUser(ctx)?.userId ?? null, ctx.query.get('around') === 'me');
  });

  router.get('/v1/venues', async (ctx) => {
    const rows = await many(
      deps.pool,
      `SELECT DISTINCT ON (venue_id) * FROM racing.venues WHERE ($1::text IS NULL OR race_class = $1) ORDER BY venue_id, version DESC`,
      [ctx.query.get('class')],
    );
    const order = { SPRINT: 0, STANDARD: 1, ENDURANCE: 2 } as Record<string, number>;
    return rows.map(venueJson).sort((a, b) => (order[a.class]! - order[b.class]!) || a.name.localeCompare(b.name));
  });

  router.get('/v1/venues/:venueId', async (ctx) => {
    const version = ctx.query.get('version') ? v.int(ctx.query.get('version'), 'version', { min: 1 }) : null;
    const row = await one(
      deps.pool,
      `SELECT * FROM racing.venues WHERE venue_id = $1 AND ($2::int IS NULL OR version = $2) ORDER BY version DESC LIMIT 1`,
      [ctx.params.venueId, version],
    );
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Unknown venue');
    return venueJson(row);
  });

  router.get('/v1/venues/:venueId/history', async (ctx) => {
    const limit = pageLimit(ctx.query);
    const cursor = decodeCursor(ctx.query.get('cursor'));
    const rows = await many(
      deps.pool,
      `${RACE_SELECT} WHERE r.venue_id = $1 AND r.status IN ('FINISHED', 'SETTLED')
         AND ($2::timestamptz IS NULL OR (r.start_at, r.race_id) < ($2, $3::bigint))
       ORDER BY r.start_at DESC, r.race_id DESC LIMIT $4`,
      [ctx.params.venueId, cursor?.[0] ?? null, cursor?.[1] ?? '0', limit + 1],
    );
    return page(rows.map((row) => raceJson(row)), limit, (race) => [race.startAt!, race.id]);
  });

  router.get('/v1/animals', async (ctx) => {
    const limit = pageLimit(ctx.query, 50);
    const cursor = decodeCursor(ctx.query.get('cursor'));
    const status = ctx.query.get('status') ? v.oneOf(ctx.query.get('status'), 'status', ['ACTIVE', 'RETIRED']) : null;
    const species = ctx.query.get('species') ? v.oneOf(ctx.query.get('species'), 'species', ['HORSE', 'GIRAFFE']) : null;
    const rows = await many(
      deps.pool,
      `SELECT * FROM stable.animals WHERE ($1::text IS NULL OR species = $1) AND ($2::text IS NULL OR status = $2)
         AND ($3::text IS NULL OR (name, animal_id) > ($3, $4::bigint))
       ORDER BY name, animal_id LIMIT $5`,
      [species, status, cursor?.[0] ?? null, cursor?.[1] ?? '0', limit + 1],
    );
    return page(rows.map(animalSummary), limit, (animal) => [animal.name, animal.id]);
  });

  router.get('/v1/animals/:animalId', async (ctx) => {
    const animalId = pathId(ctx, 'animalId');
    const row = await one(deps.pool, 'SELECT * FROM stable.animals WHERE animal_id = $1', [animalId]);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Unknown animal');
    const venueForm = await many(
      deps.pool,
      `SELECT f.*, (SELECT name FROM racing.venues v WHERE v.venue_id = f.venue_id ORDER BY version DESC LIMIT 1) AS venue_name
       FROM stable.animal_venue_form f WHERE f.animal_id = $1 ORDER BY f.wins DESC, f.races DESC`,
      [animalId],
    );
    const aging = await many(deps.pool, 'SELECT * FROM stable.animal_daily_stats WHERE animal_id = $1 ORDER BY day', [animalId]);
    return animalDetail(row, venueForm, aging);
  });

  router.get('/v1/animals/:animalId/history', async (ctx) => {
    const animalId = pathId(ctx, 'animalId');
    const limit = pageLimit(ctx.query);
    const cursor = decodeCursor(ctx.query.get('cursor'));
    const rows = await many(
      deps.pool,
      `SELECT r.race_id, r.finished_at, r.start_at, r.race_class, r.venue_id, v.name AS venue_name, e.official_position, e.result_status, e.finish_time_ms,
         e.stats_snapshot, e.entrant_id,
         (SELECT array_agg(l.lap ORDER BY l.lap) FROM racing.race_lap_leaders l WHERE l.race_id = r.race_id AND l.entrant_id = e.entrant_id) AS laps_led,
         (SELECT count(*)::int FROM racing.race_entrants x WHERE x.race_id = r.race_id) AS field_size
       FROM racing.race_entrants e JOIN racing.races r USING (race_id)
       JOIN racing.venues v ON v.venue_id = r.venue_id AND v.version = r.venue_version
       WHERE e.animal_id = $1 AND r.status IN ('FINISHED', 'SETTLED')
         AND ($2::timestamptz IS NULL OR (r.start_at, r.race_id) < ($2, $3::bigint))
       ORDER BY r.start_at DESC, r.race_id DESC LIMIT $4`,
      [animalId, cursor?.[0] ?? null, cursor?.[1] ?? '0', limit + 1],
    );
    const result = page(rows, limit, (row) => [row.start_at.toISOString(), row.race_id]);
    return {
      items: result.items.map((row) => ({
        raceId: row.race_id,
        finishedAt: iso(row.finished_at),
        class: row.race_class,
        venueId: row.venue_id,
        venueName: row.venue_name,
        position: row.official_position,
        resultStatus: row.result_status,
        timeSec: row.finish_time_ms === null || !['FINISHED', 'DISQUALIFIED'].includes(row.result_status) ? null : row.finish_time_ms / 1000,
        lapsLed: row.laps_led ?? [],
        statsSnapshot: row.stats_snapshot,
        fieldSize: row.field_size,
      })),
      nextCursor: result.nextCursor,
    };
  });
}
