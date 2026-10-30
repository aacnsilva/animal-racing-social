import { settings } from '../../lib/config.ts';
import { many, one, tx, type Client } from '../../lib/db.ts';
import { newId } from '../../lib/ids.ts';
import { payload, runConsumer, Topics } from '../../lib/kafka.ts';
import { log } from '../../lib/log.ts';
import { enqueue } from '../../lib/outbox.ts';
import type { Redis } from '../../lib/redis.ts';
import { bootstrap, every, type Runtime } from '../../lib/runtime.ts';
import { activeSeason, type SeasonRow } from '../../lib/seasons.ts';
import { DAY_MS, HOUR_MS } from '../../lib/time.ts';
import { applySettled, BOARDS, boardScore, thresholdCrossings, type Board, type SeasonStats } from '../../domain/leaderboard.ts';

const boardKey = (seasonId: string, board: Board) => `lb:${seasonId}:${board}`;

type StatsRow = {
  user_id: string;
  season_id: string;
  settled_bets: number;
  total_staked: string;
  total_returned: string;
  biggest_payout: string;
  biggest_payout_bet: string | null;
  current_streak: number;
  best_streak: number;
  rank_score: string;
};

function toStats(row: StatsRow): SeasonStats {
  return {
    settledBets: row.settled_bets,
    totalStaked: Number(row.total_staked),
    totalReturned: Number(row.total_returned),
    biggestPayout: Number(row.biggest_payout),
    biggestPayoutBet: row.biggest_payout_bet,
    currentStreak: row.current_streak,
    bestStreak: row.best_streak,
  };
}

async function lockStats(client: Client, userId: string, seasonId: string): Promise<StatsRow> {
  await client.query('INSERT INTO season.user_season_stats (user_id, season_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, seasonId]);
  return (await one<StatsRow>(client, 'SELECT * FROM season.user_season_stats WHERE user_id = $1 AND season_id = $2 FOR UPDATE', [userId, seasonId]))!;
}

async function syncBoards(redis: Redis, row: StatsRow): Promise<void> {
  const stats = toStats(row);
  for (const board of BOARDS) {
    const score = boardScore(board, stats, Number(row.rank_score));
    const key = boardKey(row.season_id, board);
    if (score === null) await redis.zRem(key, row.user_id);
    else await redis.zAdd(key, [{ score, value: row.user_id }]);
    await redis.expireAt(key, Math.floor((Date.now() + 40 * DAY_MS) / 1000));
  }
}

async function rebuildBoards(runtime: Runtime, seasonId: string): Promise<void> {
  if ((await runtime.redis.exists(boardKey(seasonId, 'balance'))) === 1) return;
  const rows = await many<StatsRow>(runtime.pool, 'SELECT * FROM season.user_season_stats WHERE season_id = $1', [seasonId]);
  for (const row of rows) await syncBoards(runtime.redis, row);
  log.info('rebuilt leaderboards', { seasonId, users: rows.length });
}

async function createSeason(client: Client, startsAt: Date, status: 'ACTIVE' | 'UPCOMING'): Promise<SeasonRow> {
  const count = await one(client, 'SELECT count(*)::int AS n FROM season.seasons');
  const endsAt = new Date(startsAt.getTime() + settings.seasonLengthDays * DAY_MS);
  const season = (await one<SeasonRow>(
    client,
    `INSERT INTO season.seasons (season_id, name, status, starts_at, ends_at, last_race_at)
     VALUES ($1, $2, $3, $4, $5, $5::timestamptz - interval '1 hour') RETURNING *`,
    [newId(0), `Season ${count!.n + 1}`, status, startsAt, endsAt],
  ))!;
  if (status === 'ACTIVE') await announceStart(client, season);
  log.info('season created', { seasonId: season.season_id, status, startsAt });
  return season;
}

async function announceStart(client: Client, season: SeasonRow): Promise<void> {
  await enqueue(client, 'season', Topics.seasonEvents, season.season_id, payload('seasonStarted', {
    seasonId: season.season_id,
    startsAt: season.starts_at.toISOString(),
    endsAt: season.ends_at.toISOString(),
    startingGrant: String(season.starting_grant),
    name: season.name,
  }));
}

async function endSeason(client: Client, season: SeasonRow): Promise<void> {
  await client.query(`UPDATE season.seasons SET status = 'ENDED' WHERE season_id = $1`, [season.season_id]);
  const rows = await many<StatsRow>(client, 'SELECT * FROM season.user_season_stats WHERE season_id = $1', [season.season_id]);
  for (const board of BOARDS) {
    const ranked = rows
      .map((row) => ({ userId: row.user_id, score: boardScore(board, toStats(row), Number(row.rank_score)) }))
      .filter((entry): entry is { userId: string; score: number } => entry.score !== null)
      .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
    for (const [index, entry] of ranked.entries()) {
      await client.query(
        'INSERT INTO season.season_results (season_id, board, rank, user_id, score) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
        [season.season_id, board, index + 1, entry.userId, entry.score],
      );
    }
  }
  const top = await many(client, `SELECT user_id, rank, score FROM season.season_results WHERE season_id = $1 AND board = 'balance' ORDER BY rank LIMIT 10`, [season.season_id]);
  await enqueue(client, 'season', Topics.seasonEvents, season.season_id, payload('seasonEnded', {
    seasonId: season.season_id,
    top: top.map((row) => ({ userId: row.user_id, rank: row.rank, score: Number(row.score) })),
  }));
  log.info('season ended', { seasonId: season.season_id, participants: rows.length });
}

async function maintainSeasons(runtime: Runtime): Promise<void> {
  await tx(runtime.pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['season-maintenance']);
    const now = new Date();
    for (const season of await many<SeasonRow>(client, `SELECT * FROM season.seasons WHERE status = 'ACTIVE' AND ends_at <= now()`)) {
      await endSeason(client, season);
    }
    for (const season of await many<SeasonRow>(client, `SELECT * FROM season.seasons WHERE status = 'UPCOMING' AND starts_at <= now() AND ends_at > now() ORDER BY starts_at`)) {
      await client.query(`UPDATE season.seasons SET status = 'ACTIVE' WHERE season_id = $1`, [season.season_id]);
      await announceStart(client, season);
    }
    let active = await activeSeason(client);
    if (!active) {
      const last = await one<{ ends_at: Date }>(client, 'SELECT max(ends_at) AS ends_at FROM season.seasons');
      const hour = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
      const startsAt = last?.ends_at && last.ends_at > hour ? last.ends_at : hour;
      active = await createSeason(client, startsAt, startsAt <= now ? 'ACTIVE' : 'UPCOMING');
      if (active.status !== 'ACTIVE') return;
    }
    const next = await one(client, 'SELECT 1 FROM season.seasons WHERE starts_at >= $1', [active.ends_at]);
    if (!next) await createSeason(client, active.ends_at, 'UPCOMING');
    if (!active.ending_notified_at && active.ends_at.getTime() - DAY_MS <= now.getTime()) {
      await client.query('UPDATE season.seasons SET ending_notified_at = now() WHERE season_id = $1', [active.season_id]);
      await enqueue(client, 'season', Topics.seasonEvents, active.season_id, payload('seasonEnding', {
        seasonId: active.season_id, endsAt: active.ends_at.toISOString(),
      }));
    }
  });
  const active = await activeSeason(runtime.pool);
  if (active) await rebuildBoards(runtime, active.season_id);
}

async function onBalance(runtime: Runtime, event: { userId: string; seasonId: string; balanceAfter: string; openStakeAfter: string }): Promise<void> {
  const key = boardKey(event.seasonId, 'balance');
  const before = await runtime.redis.zRevRank(key, event.userId);
  const row = await tx(runtime.pool, async (client) => {
    await lockStats(client, event.userId, event.seasonId);
    return (await one<StatsRow>(
      client,
      'UPDATE season.user_season_stats SET rank_score = $3, updated_at = now() WHERE user_id = $1 AND season_id = $2 RETURNING *',
      [event.userId, event.seasonId, Number(event.balanceAfter) + Number(event.openStakeAfter)],
    ))!;
  });
  await syncBoards(runtime.redis, row);
  const after = await runtime.redis.zRevRank(key, event.userId);
  const crossings = thresholdCrossings(before === null ? null : before + 1, after === null ? null : after + 1);
  if (crossings.length === 0) return;
  await tx(runtime.pool, async (client) => {
    for (const crossing of crossings) {
      await enqueue(client, 'season', Topics.seasonEvents, event.seasonId, payload('leaderboardMoved', {
        seasonId: event.seasonId,
        userId: event.userId,
        board: 'balance',
        fromRank: before === null ? 0 : before + 1,
        toRank: after === null ? 0 : after + 1,
        threshold: crossing.threshold,
        entered: crossing.entered,
      }));
    }
  });
}

async function onSettled(runtime: Runtime, eventId: string, event: { betId: string; userId: string; seasonId: string; outcome: 'WON' | 'LOST' | 'VOID' | 'CASHED_OUT'; stake: number; returned: number }): Promise<void> {
  const row = await tx(runtime.pool, async (client) => {
    const fresh = await client.query('INSERT INTO season.processed_events (consumer, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', ['season', eventId]);
    if (fresh.rowCount === 0) return null;
    const current = await lockStats(client, event.userId, event.seasonId);
    const next = applySettled(toStats(current), event);
    return (await one<StatsRow>(
      client,
      `UPDATE season.user_season_stats SET settled_bets = $3, total_staked = $4, total_returned = $5, biggest_payout = $6,
         biggest_payout_bet = $7, current_streak = $8, best_streak = $9, updated_at = now()
       WHERE user_id = $1 AND season_id = $2 RETURNING *`,
      [event.userId, event.seasonId, next.settledBets, next.totalStaked, next.totalReturned, next.biggestPayout, next.biggestPayoutBet, next.currentStreak, next.bestStreak],
    ))!;
  });
  if (row) await syncBoards(runtime.redis, row);
}

export async function start(): Promise<void> {
  const runtime = await bootstrap('season', { outbox: ['season'] });
  every(30_000, () => maintainSeasons(runtime), runtime, 'season maintenance');
  runtime.consumers.push(await runConsumer({
    kafka: runtime.kafka,
    groupId: 'season',
    topics: [Topics.walletEvents, Topics.betEvents],
    pool: runtime.pool,
    concurrency: 6,
    handler: async (envelope) => {
      const event = envelope.payload;
      if (event?.$case === 'ledgerEntryAppended') {
        await onBalance(runtime, event.value);
      } else if (event?.$case === 'betSettled') {
        const settled = event.value;
        await onSettled(runtime, envelope.eventId, {
          betId: settled.betId, userId: settled.userId, seasonId: settled.seasonId,
          outcome: settled.outcome as 'WON' | 'LOST' | 'VOID', stake: Number(settled.stake), returned: Number(settled.payout),
        });
      } else if (event?.$case === 'betCashedOut') {
        const cashed = event.value;
        await onSettled(runtime, envelope.eventId, {
          betId: cashed.betId, userId: cashed.userId, seasonId: cashed.seasonId,
          outcome: 'CASHED_OUT', stake: Number(cashed.stake), returned: Number(cashed.amount),
        });
      }
    },
  }));
}
