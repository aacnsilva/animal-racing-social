import { many, one, type Queryable } from '../lib/db.ts';
import { entrantKey } from '../lib/ids.ts';
import type { Redis } from '../lib/redis.ts';

export type PriceSelection = { selectionId: string; entrantId: string; price: number; probability: number };
export type CachedPrice = { version: number; tick: number; selections: PriceSelection[] };

export const priceKey = (marketId: string) => `price:${marketId}`;

export async function writePrice(redis: Redis, marketId: string, price: CachedPrice): Promise<void> {
  await redis.hSet(priceKey(marketId), { version: String(price.version), tick: String(price.tick), selections: JSON.stringify(price.selections) });
  await redis.expire(priceKey(marketId), 172800);
}

export async function dbPrice(db: Queryable, marketId: string): Promise<CachedPrice | null> {
  const market = await one(db, 'SELECT price_version FROM market.markets WHERE market_id = $1', [marketId]);
  if (!market) return null;
  const rows = await many(db, 'SELECT selection_id, entrant_id, price, probability FROM market.selections WHERE market_id = $1 ORDER BY entrant_id', [marketId]);
  return {
    version: market.price_version,
    tick: 0,
    selections: rows.map((row) => ({ selectionId: row.selection_id, entrantId: entrantKey(row.entrant_id), price: row.price, probability: row.probability })),
  };
}

export async function readPrice(redis: Redis, db: Queryable, marketId: string): Promise<CachedPrice | null> {
  const cached = await redis.hGetAll(priceKey(marketId));
  const fromDb = await dbPrice(db, marketId);
  if (cached.version === undefined || cached.selections === undefined) return fromDb;
  const fromRedis: CachedPrice = { version: Number(cached.version), tick: Number(cached.tick ?? 0), selections: JSON.parse(cached.selections) };
  if (fromDb && fromDb.version > fromRedis.version) return fromDb;
  return fromRedis;
}

export async function readPrices(redis: Redis, db: Queryable, marketIds: readonly string[]): Promise<Map<string, CachedPrice>> {
  const result = new Map<string, CachedPrice>();
  await Promise.all(marketIds.map(async (id) => {
    const price = await readPrice(redis, db, id);
    if (price) result.set(id, price);
  }));
  return result;
}
