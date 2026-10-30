import { many, one, type Queryable } from '../lib/db.ts';
import { entrantKey } from '../lib/ids.ts';
import type { Redis } from '../lib/redis.ts';
import { readPrice } from './prices.ts';

const LIVE_STATUSES = new Set(['PENDING', 'OPEN', 'SUSPENDED', 'CLOSED']);

async function marketJson(db: Queryable, redis: Redis, row: Record<string, any>) {
  let selections: { selectionId: string; entrantId: string; price: number; probability: number }[];
  let priceVersion: number = row.price_version;
  if (LIVE_STATUSES.has(row.status)) {
    const price = await readPrice(redis, db, row.market_id);
    selections = price?.selections ?? [];
    priceVersion = price?.version ?? priceVersion;
  } else {
    const rows = await many(db, 'SELECT selection_id, entrant_id, price, probability FROM market.selections WHERE market_id = $1 ORDER BY entrant_id', [row.market_id]);
    selections = rows.map((s) => ({ selectionId: s.selection_id, entrantId: entrantKey(s.entrant_id), price: s.price, probability: s.probability }));
  }
  return {
    id: row.market_id,
    raceId: row.race_id,
    type: row.type,
    params: row.params,
    status: row.status,
    closesAtLap: row.closes_at_lap,
    priceVersion,
    selections,
    result: row.result ? { winning: row.result.winning ?? [], order: row.result.order ?? [] } : null,
  };
}

export type MarketJson = Awaited<ReturnType<typeof marketJson>>;

export async function marketsForRace(db: Queryable, redis: Redis, raceId: string, status?: string | null): Promise<MarketJson[]> {
  const rows = await many(
    db,
    `SELECT * FROM market.markets WHERE race_id = $1 AND ($2::text IS NULL OR status = $2)
     ORDER BY CASE type WHEN 'FINISH_POSITION' THEN 1 WHEN 'TOP_N' THEN 2 WHEN 'LEADER_AT_LAP' THEN 3 ELSE 4 END,
       coalesce((params->>'position')::int, (params->>'n')::int, (params->>'lap')::int, 0)`,
    [raceId, status ?? null],
  );
  return Promise.all(rows.map((row) => marketJson(db, redis, row)));
}

export async function loadMarket(db: Queryable, redis: Redis, marketId: string): Promise<MarketJson | null> {
  const row = await one(db, 'SELECT * FROM market.markets WHERE market_id = $1', [marketId]);
  return row ? marketJson(db, redis, row) : null;
}
