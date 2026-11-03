import { many, type Queryable } from '../lib/db.ts';
import { iso } from '../lib/time.ts';
import { PODIUM_BOARD, PODIUM_TIERS, podiumTier, type PodiumTier } from '../domain/leaderboard.ts';

export type Frame = { tier: PodiumTier; rank: number; seasonId: string; seasonName: string };

export type Podium = Frame & { score: number; endedAt: string | null };

export async function framesFor(db: Queryable, userIds: string[]): Promise<Map<string, Frame>> {
  if (userIds.length === 0) return new Map();
  const rows = await many(
    db,
    `WITH last AS (SELECT season_id, name FROM season.seasons WHERE status = 'ENDED' ORDER BY ends_at DESC LIMIT 1)
     SELECT r.user_id, r.rank, last.season_id, last.name
     FROM season.season_results r JOIN last USING (season_id)
     WHERE r.board = $1 AND r.rank <= $2 AND r.user_id = ANY($3)`,
    [PODIUM_BOARD, PODIUM_TIERS.length, userIds],
  );
  return new Map(
    rows.map((row) => [
      String(row.user_id),
      { tier: podiumTier(row.rank)!, rank: row.rank, seasonId: String(row.season_id), seasonName: row.name },
    ]),
  );
}

export async function frameFor(db: Queryable, userId: string): Promise<Frame | null> {
  return (await framesFor(db, [userId])).get(userId) ?? null;
}

export async function podiumsFor(db: Queryable, userId: string): Promise<Podium[]> {
  const rows = await many(
    db,
    `SELECT r.rank, r.score, s.season_id, s.name, s.ends_at
     FROM season.season_results r JOIN season.seasons s USING (season_id)
     WHERE r.user_id = $1 AND r.board = $2 AND r.rank <= $3 AND s.status = 'ENDED'
     ORDER BY s.ends_at DESC`,
    [userId, PODIUM_BOARD, PODIUM_TIERS.length],
  );
  return rows.map((row) => ({
    tier: podiumTier(row.rank)!,
    rank: row.rank,
    seasonId: String(row.season_id),
    seasonName: row.name,
    score: Number(row.score),
    endedAt: iso(row.ends_at),
  }));
}
