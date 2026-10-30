import { many, one, type Queryable } from '../lib/db.ts';
import { entrantKey } from '../lib/ids.ts';
import { iso } from '../lib/time.ts';

export type BetRow = Record<string, any>;

export async function betsJson(db: Queryable, bets: BetRow[]) {
  if (bets.length === 0) return [];
  const legs = await many(
    db,
    `SELECT l.*, m.type AS market_type, m.params AS market_params FROM betting.bet_legs l
     LEFT JOIN market.markets m ON m.market_id = l.market_id
     WHERE (l.user_id, l.bet_id) IN (SELECT * FROM unnest($1::bigint[], $2::bigint[])) ORDER BY l.leg_no`,
    [bets.map((bet) => bet.user_id), bets.map((bet) => bet.bet_id)],
  );
  const legsByBet = new Map<string, BetRow[]>();
  for (const leg of legs) {
    const list = legsByBet.get(leg.bet_id) ?? [];
    list.push(leg);
    legsByBet.set(leg.bet_id, list);
  }
  return bets.map((bet) => {
    const betLegs = legsByBet.get(bet.bet_id) ?? [];
    return {
      id: bet.bet_id,
      type: bet.type,
      legs: betLegs.map((leg) => ({
        legId: String(leg.leg_no),
        marketId: leg.market_id,
        raceId: leg.race_id,
        marketType: leg.market_type,
        marketParams: leg.market_params ?? {},
        selection: leg.tricast_order ? { order: leg.tricast_order.map(entrantKey) } : { entrantId: entrantKey(leg.entrant_id) },
        acceptedPrice: leg.accepted_price,
        priceVersion: leg.price_version,
        lockedPrice: leg.locked_price,
        status: leg.status,
        placedAtTick: leg.placed_at_tick,
      })),
      stake: Number(bet.stake),
      lockedPrice: bet.locked_price,
      status: bet.status,
      rejectReason: bet.reject_reason,
      payout: bet.payout === null ? null : Number(bet.payout),
      cashOutAmount: bet.cashout_amount === null ? null : Number(bet.cashout_amount),
      placedAtTick: betLegs[0]?.placed_at_tick ?? null,
      acceptPriceChanges: bet.accept_price_changes,
      requestedAt: iso(bet.requested_at),
      acceptedAt: iso(bet.accepted_at),
      settledAt: iso(bet.settled_at),
    };
  });
}

export type BetJson = Awaited<ReturnType<typeof betsJson>>[number];

export async function loadBet(db: Queryable, userId: string, betId: string): Promise<BetJson | null> {
  const row = await one(db, 'SELECT * FROM betting.bets WHERE user_id = $1 AND bet_id = $2', [userId, betId]);
  if (!row) return null;
  return (await betsJson(db, [row]))[0]!;
}

export async function betsOnRace(db: Queryable, userId: string, raceId: string): Promise<BetJson[]> {
  const rows = await many(
    db,
    `SELECT * FROM betting.bets b WHERE b.user_id = $1 AND EXISTS (
       SELECT 1 FROM betting.bet_legs l WHERE l.user_id = b.user_id AND l.bet_id = b.bet_id AND l.race_id = $2)
     ORDER BY b.requested_at DESC`,
    [userId, raceId],
  );
  return betsJson(db, rows);
}
