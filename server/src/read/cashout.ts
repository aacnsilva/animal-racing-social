import { randomUUID } from 'node:crypto';
import { settings } from '../lib/config.ts';
import { many, one, type Queryable } from '../lib/db.ts';
import { entrantKey } from '../lib/ids.ts';
import { getJson, setJson, type Redis } from '../lib/redis.ts';
import { cashOutAmount, harvilleProbability } from '../domain/pricing.ts';
import { readPrice } from './prices.ts';

export type LegRow = {
  leg_no: number;
  market_id: string;
  race_id: string;
  entrant_id: number | null;
  tricast_order: number[] | null;
  locked_price: number | null;
  accepted_price: number;
  status: 'OPEN' | 'WON' | 'LOST' | 'VOID';
};

export type CashOutValue =
  | { ok: true; amount: number; versions: Record<string, number>; live: boolean; tick: number | null; tickMs: number }
  | { ok: false; reason: 'MARKET_SUSPENDED' | 'NOT_CASHABLE' };

async function raceTick(redis: Redis, raceId: string): Promise<number | null> {
  const state = await getJson<{ tick: number; status: string }>(redis, `race:${raceId}:state`);
  return state && state.status === 'LIVE' ? state.tick : null;
}

export async function cashOutValue(redis: Redis, db: Queryable, stake: number, legs: readonly LegRow[]): Promise<CashOutValue> {
  const lockedPrices: number[] = [];
  const probabilities: number[] = [];
  const versions: Record<string, number> = {};
  let live = false;
  let tick: number | null = null;
  let tickMs = settings.tickMs;
  for (const leg of legs) {
    if (leg.status === 'LOST') return { ok: false, reason: 'NOT_CASHABLE' };
    if (leg.status === 'VOID') continue;
    lockedPrices.push(leg.locked_price ?? leg.accepted_price);
    if (leg.status === 'WON') continue;
    const market = await one(
      db,
      `SELECT m.market_id, m.type, m.status, r.status AS race_status, r.tick_ms FROM market.markets m JOIN racing.races r USING (race_id) WHERE m.market_id = $1`,
      [leg.market_id],
    );
    if (!market) return { ok: false, reason: 'NOT_CASHABLE' };
    tickMs = market.tick_ms;
    if (market.race_status === 'LOCKED') return { ok: false, reason: 'MARKET_SUSPENDED' };
    if (!['OPEN', 'LIVE'].includes(market.race_status)) return { ok: false, reason: 'NOT_CASHABLE' };
    let pricedMarketId = leg.market_id;
    if (market.type === 'TRICAST') {
      const win = await one(db, `SELECT market_id FROM market.markets WHERE race_id = $1 AND type = 'FINISH_POSITION' AND (params->>'position')::int = 1`, [leg.race_id]);
      if (!win) return { ok: false, reason: 'NOT_CASHABLE' };
      pricedMarketId = win.market_id;
    }
    const priced = await one(db, 'SELECT status FROM market.markets WHERE market_id = $1', [pricedMarketId]);
    if (priced?.status === 'SUSPENDED') return { ok: false, reason: 'MARKET_SUSPENDED' };
    if (priced?.status !== 'OPEN') return { ok: false, reason: 'NOT_CASHABLE' };
    const price = await readPrice(redis, db, pricedMarketId);
    if (!price) return { ok: false, reason: 'NOT_CASHABLE' };
    versions[pricedMarketId] = price.version;
    if (market.type === 'TRICAST') {
      const win = new Map(price.selections.map((selection) => [selection.entrantId, selection.probability]));
      probabilities.push(harvilleProbability(win, (leg.tricast_order ?? []).map(entrantKey)));
    } else {
      probabilities.push(price.selections.find((selection) => selection.entrantId === entrantKey(leg.entrant_id ?? 0))?.probability ?? 0);
    }
    if (market.race_status === 'LIVE') {
      live = true;
      tick = (await raceTick(redis, leg.race_id)) ?? tick;
    }
  }
  return { ok: true, amount: cashOutAmount(stake, lockedPrices, probabilities, settings.cashOutMargin), versions, live, tick, tickMs };
}

export type StoredQuote = { betId: string; userId: string; amount: number; versions: Record<string, number>; live: boolean; tick: number | null; tickMs: number };

export async function issueQuote(redis: Redis, db: Queryable, bet: { userId: string; betId: string; stake: number }, legs: readonly LegRow[]) {
  const value = await cashOutValue(redis, db, bet.stake, legs);
  if (!value.ok) return value;
  const quoteId = randomUUID();
  await setJson(redis, `cashout:quote:${quoteId}`, { betId: bet.betId, userId: bet.userId, amount: value.amount, versions: value.versions, live: value.live, tick: value.tick, tickMs: value.tickMs } satisfies StoredQuote, 60);
  const priceVersion = Math.max(0, ...Object.values(value.versions));
  return {
    ok: true as const,
    quote: {
      quoteId,
      amount: value.amount,
      priceVersion,
      expiresAtTick: value.live && value.tick !== null ? value.tick + 2 : null,
      expiresAt: new Date(Date.now() + (value.live ? 2 * value.tickMs : 30_000)).toISOString(),
    },
    live: value.live,
    tick: value.tick,
    tickMs: value.tickMs,
  };
}

// Live prices bump their version every tick, so requiring an unchanged version
// expired nearly every in-running quote. The bet worker re-values the cash-out at
// acceptance and enforces the user's minAmount, which is the real price guard.
export async function quoteStillValid(redis: Redis, quoteId: string, betId: string, userId: string): Promise<StoredQuote | null> {
  const stored = await getJson<StoredQuote>(redis, `cashout:quote:${quoteId}`);
  if (!stored || stored.betId !== betId || stored.userId !== userId) return null;
  return stored;
}

export async function loadLegs(db: Queryable, userId: string, betId: string): Promise<LegRow[]> {
  return many<LegRow>(db, 'SELECT * FROM betting.bet_legs WHERE user_id = $1 AND bet_id = $2 ORDER BY leg_no', [userId, betId]);
}
