import { settings } from '../../lib/config.ts';
import { isUniqueViolation, one, tx } from '../../lib/db.ts';
import { accepted, ApiError, pathId, Reply, v, type Ctx, type Router } from '../../lib/http.ts';
import { entrantKey, entrantNumber, newId, shardOf } from '../../lib/ids.ts';
import { walletApi } from '../../lib/internal.ts';
import { payload, Topics } from '../../lib/kafka.ts';
import { enqueue } from '../../lib/outbox.ts';
import { getJson, setJson } from '../../lib/redis.ts';
import { comboViolation } from '../../domain/combo.ts';
import { combinedPrice, harvilleProbability, priceFromProbability, tricastPrice } from '../../domain/pricing.ts';
import { loadBet } from '../../read/bets.ts';
import { issueQuote, loadLegs, quoteStillValid } from '../../read/cashout.ts';
import { loadMarket } from '../../read/markets.ts';
import { readPrice } from '../../read/prices.ts';
import { liveState } from '../../read/races.ts';
import { rateLimit, requireActiveUser, requireUser, type Deps } from './context.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLICIES = ['NONE', 'BETTER', 'ANY'] as const;

type Selection = { entrantId: string } | { order: [string, string, string] };

type ValidLeg = {
  marketId: string;
  raceId: string;
  seasonId: string;
  type: string;
  live: boolean;
  tick: number | null;
  startAt: Date;
  tickMs: number;
  entrantId: number | null;
  tricastOrder: number[] | null;
  selection: Selection;
};

function parseSelection(raw: unknown, field = 'selection'): Selection {
  const value = v.obj(raw, field);
  if (Array.isArray(value.order)) {
    const order = value.order.map((entrant, index) => v.str(entrant, `${field}.order[${index}]`));
    if (order.length !== 3 || new Set(order).size !== 3) throw new ApiError(422, 'INVALID_SELECTION', 'A tricast needs three different entrants');
    return { order: order as [string, string, string] };
  }
  return { entrantId: v.str(value.entrantId, `${field}.entrantId`) };
}

async function validateLeg(deps: Deps, marketId: string, selection: Selection): Promise<ValidLeg> {
  const market = await one(
    deps.pool,
    `SELECT m.market_id, m.type, m.status, m.race_id, r.status AS race_status, r.season_id, r.betting_closes_at, r.start_at, r.tick_ms, s.status AS season_status
     FROM market.markets m JOIN racing.races r USING (race_id) JOIN season.seasons s ON s.season_id = r.season_id WHERE m.market_id = $1`,
    [marketId],
  );
  if (!market) throw new ApiError(404, 'NOT_FOUND', 'Unknown market');
  if (market.season_status !== 'ACTIVE') throw new ApiError(409, 'BETTING_CLOSED', 'This race belongs to a season that is not active');
  if (market.status === 'SUSPENDED' && market.race_status === 'LIVE') throw new ApiError(409, 'MARKET_SUSPENDED', 'Market is suspended');
  const preRace = market.race_status === 'OPEN' && new Date() < market.betting_closes_at;
  const live = market.race_status === 'LIVE';
  if (market.status !== 'OPEN' || (!preRace && !live)) throw new ApiError(409, 'BETTING_CLOSED', 'Betting is closed for this market');
  const entrants = new Set((await deps.pool.query('SELECT entrant_id FROM racing.race_entrants WHERE race_id = $1', [market.race_id])).rows.map((row) => entrantKey(row.entrant_id)));
  let entrantId: number | null = null;
  let tricastOrder: number[] | null = null;
  if (market.type === 'TRICAST') {
    if (!('order' in selection) || selection.order.some((entrant) => !entrants.has(entrant))) throw new ApiError(422, 'INVALID_SELECTION', 'Tricast needs three entrants of this race');
    tricastOrder = selection.order.map(entrantNumber);
  } else {
    if (!('entrantId' in selection) || !entrants.has(selection.entrantId)) throw new ApiError(422, 'INVALID_SELECTION', 'Unknown entrant for this market');
    entrantId = entrantNumber(selection.entrantId);
  }
  const tick = live ? (await liveState(deps.redis, market.race_id))?.tick ?? Math.max(0, Math.floor((Date.now() - market.start_at.getTime()) / market.tick_ms)) : null;
  return {
    marketId, raceId: market.race_id, seasonId: market.season_id, type: market.type, live, tick, startAt: market.start_at, tickMs: market.tick_ms,
    entrantId, tricastOrder, selection,
  };
}

async function currentLegPrice(deps: Deps, leg: ValidLeg): Promise<{ price: number; priceVersion: number; probability: number }> {
  const price = await readPrice(deps.redis, deps.pool, leg.marketId);
  if (!price) throw new ApiError(409, 'BETTING_CLOSED', 'No price available');
  if (leg.tricastOrder) {
    const win = new Map(price.selections.map((selection) => [selection.entrantId, selection.probability]));
    const order = leg.tricastOrder.map(entrantKey);
    const probability = harvilleProbability(win, order);
    return { price: priceFromProbability(probability, settings.oddsMargin), priceVersion: price.version, probability };
  }
  const selection = price.selections.find((s) => s.entrantId === entrantKey(leg.entrantId ?? 0));
  if (!selection) throw new ApiError(422, 'INVALID_SELECTION', 'Unknown entrant for this market');
  return { price: selection.price, priceVersion: price.version, probability: selection.probability };
}

async function ensureFunds(deps: Deps, userId: string, seasonId: string, stake: number): Promise<void> {
  const wallet = await one(deps.pool, 'SELECT balance FROM wallet.wallets WHERE user_id = $1 AND season_id = $2', [userId, seasonId]);
  const balance = wallet ? Number(wallet.balance) : (await walletApi.ensure(userId, seasonId)).balance;
  if (balance < stake) throw new ApiError(422, 'INSUFFICIENT_FUNDS', 'Not enough points for this stake', { balance });
}

async function idempotent(ctx: Ctx, deps: Deps, userId: string, handler: (key: string) => Promise<Reply>): Promise<Reply> {
  const key = String(ctx.req.headers['idempotency-key'] ?? '');
  if (!UUID.test(key)) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (UUID) is required');
  const cacheKey = `idem:${userId}:${key}`;
  const cached = await getJson<{ status: number; body: unknown }>(deps.redis, cacheKey);
  if (cached) return new Reply(cached.status, cached.body, { 'idempotent-replay': 'true' });
  const reply = await handler(key);
  await setJson(deps.redis, cacheKey, { status: reply.status, body: reply.body }, 7200);
  return reply;
}

async function existingByKey(deps: Deps, userId: string, key: string) {
  const row = await one(deps.pool, 'SELECT bet_id FROM betting.bets WHERE user_id = $1 AND idempotency_key = $2', [userId, key]);
  return row ? loadBet(deps.pool, userId, row.bet_id) : null;
}

function stakeOf(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) throw new ApiError(422, 'STAKE_OUT_OF_RANGE', 'Stake must be a whole number of points, at least 1');
  return raw;
}

async function insertBet(deps: Deps, userId: string, key: string, stake: number, policy: string, legs: (ValidLeg & { acceptedPrice: number; priceVersion: number })[]): Promise<Reply> {
  const betId = newId(shardOf(userId));
  const type = legs.length === 1 ? 'SINGLE' : 'COMBO';
  const anyLive = legs.some((leg) => leg.live);
  const delayMs = settings.acceptDelayTicks * (legs[0]?.tickMs ?? settings.tickMs);
  try {
    await tx(deps.pool, async (client) => {
      await client.query(
        `INSERT INTO betting.bets (user_id, bet_id, season_id, type, status, stake, leg_count, accept_price_changes, idempotency_key)
         VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, $8)`,
        [userId, betId, legs[0]!.seasonId, type, stake, legs.length, policy, key],
      );
      for (const [index, leg] of legs.entries()) {
        await client.query(
          `INSERT INTO betting.bet_legs (user_id, bet_id, leg_no, market_id, race_id, entrant_id, tricast_order, accepted_price, price_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [userId, betId, index + 1, leg.marketId, leg.raceId, leg.entrantId, leg.tricastOrder, leg.acceptedPrice, leg.priceVersion],
        );
      }
      const selectionOf = (leg: ValidLeg) => ('order' in leg.selection ? { order: leg.selection.order } : { entrantId: leg.selection.entrantId, order: [] });
      if (type === 'SINGLE') {
        const leg = legs[0]!;
        const acceptAtTick = leg.live && leg.tick !== null ? leg.tick + settings.acceptDelayTicks : undefined;
        await enqueue(client, 'betting', Topics.betCommands, leg.raceId, payload('betRequested', {
          betId, userId, marketId: leg.marketId, raceId: leg.raceId, seasonId: leg.seasonId,
          selection: selectionOf(leg), stake: String(stake), acceptedPrice: leg.acceptedPrice, priceVersion: leg.priceVersion, acceptPriceChanges: policy,
          requestedAtTick: leg.tick ?? undefined, acceptAtTick,
          acceptAtMs: String(acceptAtTick === undefined ? 0 : leg.startAt.getTime() + acceptAtTick * leg.tickMs),
        }));
      } else {
        await enqueue(client, 'betting', Topics.betCommands, betId, payload('comboRequested', {
          betId, userId, seasonId: legs[0]!.seasonId, stake: String(stake), acceptPriceChanges: policy,
          legs: legs.map((leg, index) => ({
            legNo: index + 1, marketId: leg.marketId, raceId: leg.raceId, selection: selectionOf(leg), acceptedPrice: leg.acceptedPrice, priceVersion: leg.priceVersion,
          })),
          acceptAtMs: String(anyLive ? Date.now() + delayMs : 0),
        }));
      }
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await existingByKey(deps, userId, key);
    if (existing) return accepted(existing);
    throw error;
  }
  return accepted(await loadBet(deps.pool, userId, betId));
}

export function bettingRoutes(router: Router, deps: Deps): void {
  router.get('/v1/markets/:marketId', async (ctx) => {
    const market = await loadMarket(deps.pool, deps.redis, pathId(ctx, 'marketId'));
    if (!market) throw new ApiError(404, 'NOT_FOUND', 'Unknown market');
    return market;
  });

  router.post('/v1/markets/:marketId/quotes', async (ctx) => {
    const marketId = pathId(ctx, 'marketId');
    const body = await ctx.body();
    const selection = parseSelection(body);
    if (!('order' in selection)) throw new ApiError(422, 'INVALID_SELECTION', 'Quotes are for tricast orders');
    const market = await one(deps.pool, 'SELECT type FROM market.markets WHERE market_id = $1', [marketId]);
    if (!market) throw new ApiError(404, 'NOT_FOUND', 'Unknown market');
    if (market.type !== 'TRICAST') throw new ApiError(422, 'INVALID_SELECTION', 'Only tricast markets are quoted');
    const price = await readPrice(deps.redis, deps.pool, marketId);
    if (!price) throw new ApiError(409, 'BETTING_CLOSED', 'No price available');
    const win = new Map(price.selections.map((s) => [s.entrantId, s.probability]));
    const quote = tricastPrice(win, selection.order, settings.oddsMargin);
    return { price: quote.price, probability: quote.probability, priceVersion: price.version };
  });

  router.post('/v1/markets/:marketId/bets', async (ctx) => {
    const user = await requireActiveUser(ctx, deps);
    await rateLimit(ctx, deps, 'bet');
    return idempotent(ctx, deps, user.userId, async (key) => {
      const existing = await existingByKey(deps, user.userId, key);
      if (existing) return accepted(existing);
      const body = await ctx.body();
      const stake = stakeOf(body.stake);
      const leg = await validateLeg(deps, pathId(ctx, 'marketId'), parseSelection(body.selection));
      const acceptedPrice = v.num(body.acceptedPrice, 'acceptedPrice', { min: 1 });
      const priceVersion = v.int(body.priceVersion, 'priceVersion', { min: 0 });
      const policy = v.oneOf(body.acceptPriceChanges ?? 'NONE', 'acceptPriceChanges', POLICIES);
      await ensureFunds(deps, user.userId, leg.seasonId, stake);
      return insertBet(deps, user.userId, key, stake, policy, [{ ...leg, acceptedPrice, priceVersion }]);
    });
  });

  router.post('/v1/bets/combos/quote', async (ctx) => {
    const body = await ctx.body();
    const rawLegs = v.arr(body.legs, 'legs', { min: 1, max: 20 });
    const legs = [];
    for (const [index, raw] of rawLegs.entries()) {
      const legBody = v.obj(raw, `legs[${index}]`);
      const leg = await validateLeg(deps, v.id(legBody.marketId, `legs[${index}].marketId`), parseSelection(legBody.selection, `legs[${index}].selection`));
      legs.push({ leg, ...(await currentLegPrice(deps, leg)) });
    }
    const violation = comboViolation(legs.map(({ leg }) => leg), settings.comboMaxLegs);
    if (violation && violation !== 'INVALID_SELECTION') throw new ApiError(422, violation, 'Combo rules violated');
    return {
      combinedPrice: combinedPrice(legs.map((leg) => leg.price)),
      legs: legs.map(({ leg, price, priceVersion }) => ({ marketId: leg.marketId, price, priceVersion })),
    };
  });

  router.post('/v1/bets/combos', async (ctx) => {
    const user = await requireActiveUser(ctx, deps);
    await rateLimit(ctx, deps, 'bet');
    return idempotent(ctx, deps, user.userId, async (key) => {
      const existing = await existingByKey(deps, user.userId, key);
      if (existing) return accepted(existing);
      const body = await ctx.body();
      const stake = stakeOf(body.stake);
      const rawLegs = v.arr(body.legs, 'legs', { min: 2 });
      if (rawLegs.length > settings.comboMaxLegs) throw new ApiError(422, 'COMBO_TOO_MANY_LEGS', `A combo can have at most ${settings.comboMaxLegs} legs`);
      const legs = [];
      for (const [index, raw] of rawLegs.entries()) {
        const legBody = v.obj(raw, `legs[${index}]`);
        const leg = await validateLeg(deps, v.id(legBody.marketId, `legs[${index}].marketId`), parseSelection(legBody.selection, `legs[${index}].selection`));
        legs.push({
          ...leg,
          acceptedPrice: v.num(legBody.acceptedPrice, `legs[${index}].acceptedPrice`, { min: 1 }),
          priceVersion: v.int(legBody.priceVersion, `legs[${index}].priceVersion`, { min: 0 }),
        });
      }
      const violation = comboViolation(legs, settings.comboMaxLegs);
      if (violation) throw new ApiError(422, violation, 'Combo rules violated');
      const policy = v.oneOf(body.acceptPriceChanges ?? 'NONE', 'acceptPriceChanges', POLICIES);
      await ensureFunds(deps, user.userId, legs[0]!.seasonId, stake);
      return insertBet(deps, user.userId, key, stake, policy, legs);
    });
  });

  router.get('/v1/bets/:betId', async (ctx) => {
    const bet = await loadBet(deps.pool, requireUser(ctx).userId, pathId(ctx, 'betId'));
    if (!bet) throw new ApiError(404, 'NOT_FOUND', 'Unknown bet');
    return bet;
  });

  router.get('/v1/bets/:betId/cashout', async (ctx) => {
    const { userId } = requireUser(ctx);
    const betId = pathId(ctx, 'betId');
    const bet = await one(deps.pool, 'SELECT stake, status FROM betting.bets WHERE user_id = $1 AND bet_id = $2', [userId, betId]);
    if (!bet) throw new ApiError(404, 'NOT_FOUND', 'Unknown bet');
    if (bet.status !== 'ACCEPTED') throw new ApiError(409, 'NOT_CASHABLE', 'Only open accepted bets can be cashed out');
    const result = await issueQuote(deps.redis, deps.pool, { userId, betId, stake: Number(bet.stake) }, await loadLegs(deps.pool, userId, betId));
    if (!result.ok) throw new ApiError(409, result.reason, result.reason === 'MARKET_SUSPENDED' ? 'Market is suspended' : 'This bet cannot be cashed out right now');
    return result.quote;
  });

  router.post('/v1/bets/:betId/cashout', async (ctx) => {
    const user = await requireActiveUser(ctx, deps);
    await rateLimit(ctx, deps, 'bet');
    const betId = pathId(ctx, 'betId');
    return idempotent(ctx, deps, user.userId, async (key) => {
      const body = await ctx.body();
      const quoteId = v.str(body.quoteId, 'quoteId');
      const minAmount = v.int(body.minAmount, 'minAmount', { min: 0 });
      const bet = await one(deps.pool, 'SELECT status FROM betting.bets WHERE user_id = $1 AND bet_id = $2', [user.userId, betId]);
      if (!bet) throw new ApiError(404, 'NOT_FOUND', 'Unknown bet');
      if (bet.status !== 'ACCEPTED') throw new ApiError(409, 'NOT_CASHABLE', 'Only open accepted bets can be cashed out');
      const pending = await one(deps.pool, `SELECT 1 FROM betting.cashouts WHERE user_id = $1 AND bet_id = $2 AND status = 'PENDING'`, [user.userId, betId]);
      if (pending) throw new ApiError(409, 'CONFLICT', 'A cash-out is already pending for this bet');
      const quote = await quoteStillValid(deps.redis, deps.pool, quoteId, betId, user.userId);
      if (!quote) throw new ApiError(409, 'QUOTE_EXPIRED', 'Prices moved; request a new cash-out quote');
      const legs = await loadLegs(deps.pool, user.userId, betId);
      const cashoutId = newId(shardOf(user.userId));
      const acceptAtTick = quote.live && quote.tick !== null ? quote.tick + settings.acceptDelayTicks : undefined;
      await tx(deps.pool, async (client) => {
        await client.query(
          `INSERT INTO betting.cashouts (user_id, bet_id, cashout_id, quote_id, quoted_amount, min_amount, status, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)`,
          [user.userId, betId, cashoutId, quoteId, quote.amount, minAmount, key],
        );
        await enqueue(client, 'betting', Topics.betCommands, legs[0]?.race_id ?? betId, payload('cashOutRequested', {
          betId, userId: user.userId, cashoutId, quoteId, minAmount: String(minAmount),
          requestedAtTick: quote.tick ?? undefined, acceptAtTick,
          acceptAtMs: String(quote.live ? Date.now() + settings.acceptDelayTicks * quote.tickMs : 0),
        }));
      });
      return accepted(await loadBet(deps.pool, user.userId, betId));
    });
  });
}
