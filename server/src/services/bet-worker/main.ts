import { settings } from '../../lib/config.ts';
import { one, tx, type Queryable } from '../../lib/db.ts';
import { ApiError } from '../../lib/http.ts';
import { entrantKey } from '../../lib/ids.ts';
import { walletApi } from '../../lib/internal.ts';
import { payload, runConsumer, Topics } from '../../lib/kafka.ts';
import { log } from '../../lib/log.ts';
import { enqueue } from '../../lib/outbox.ts';
import { getJson } from '../../lib/redis.ts';
import { bootstrap, type Runtime } from '../../lib/runtime.ts';
import { sleep } from '../../lib/time.ts';
import { decidePrice, type PricePolicy } from '../../domain/acceptance.ts';
import { combinedPrice, harvilleProbability, priceFromProbability } from '../../domain/pricing.ts';
import { cashOutValue, loadLegs, type LegRow } from '../../read/cashout.ts';
import { readPrice } from '../../read/prices.ts';

type Rejection = 'PRICE_CHANGED' | 'MARKET_SUSPENDED' | 'MARKET_CLOSED' | 'INSUFFICIENT_FUNDS';

async function waitUntil(epochMs: number): Promise<void> {
  const delay = epochMs - Date.now();
  if (delay > 0) await sleep(Math.min(delay, 15_000));
}

async function currentTick(runtime: Runtime, raceId: string): Promise<number | null> {
  const state = await getJson<{ tick: number; status: string }>(runtime.redis, `race:${raceId}:state`);
  return state?.status === 'LIVE' ? state.tick : null;
}

async function legDecision(runtime: Runtime, db: Queryable, leg: LegRow, requestedAt: Date, policy: PricePolicy): Promise<{ ok: true; lockedPrice: number; tick: number | null } | { ok: false; reason: Rejection }> {
  const market = await one(
    db,
    `SELECT m.type, m.status, m.suspend_reason, r.status AS race_status, r.betting_closes_at
     FROM market.markets m JOIN racing.races r USING (race_id) WHERE m.market_id = $1`,
    [leg.market_id],
  );
  if (!market) return { ok: false, reason: 'MARKET_CLOSED' };
  const preRace = requestedAt < market.betting_closes_at;
  const lockSuspended = market.status === 'SUSPENDED' && market.suspend_reason === 'LOCK';
  const tricastAtLock = market.type === 'TRICAST' && market.status === 'CLOSED' && preRace && market.race_status === 'LOCKED';
  const acceptablePreRace = preRace && (market.status === 'OPEN' || lockSuspended || tricastAtLock) && ['OPEN', 'LOCKED'].includes(market.race_status);
  const acceptableLive = market.race_status === 'LIVE' && market.status === 'OPEN';
  if (!acceptablePreRace && !acceptableLive) return { ok: false, reason: market.status === 'SUSPENDED' ? 'MARKET_SUSPENDED' : 'MARKET_CLOSED' };
  const price = await readPrice(runtime.redis, db, leg.market_id);
  if (!price) return { ok: false, reason: 'MARKET_CLOSED' };
  let current: number;
  if (market.type === 'TRICAST') {
    const win = new Map(price.selections.map((selection) => [selection.entrantId, selection.probability]));
    current = priceFromProbability(harvilleProbability(win, (leg.tricast_order ?? []).map(entrantKey)), settings.oddsMargin);
  } else {
    const selection = price.selections.find((s) => s.entrantId === entrantKey(leg.entrant_id ?? 0));
    if (!selection) return { ok: false, reason: 'MARKET_CLOSED' };
    current = selection.price;
  }
  const decision = decidePrice(policy, leg.accepted_price, current, acceptableLive ? settings.livePriceTolerance : 0);
  if (!decision.ok) return decision;
  return { ok: true, lockedPrice: decision.lockedPrice, tick: market.race_status === 'LIVE' ? await currentTick(runtime, leg.race_id) : null };
}

async function reject(runtime: Runtime, userId: string, betId: string, reason: Rejection): Promise<void> {
  await tx(runtime.pool, async (client) => {
    const updated = await client.query(`UPDATE betting.bets SET status = 'REJECTED', reject_reason = $3 WHERE user_id = $1 AND bet_id = $2 AND status = 'PENDING'`, [userId, betId, reason]);
    if (updated.rowCount === 0) return;
    await enqueue(client, 'betting', Topics.betEvents, userId, payload('betRejected', { betId, userId, reason }));
  });
  log.info('bet rejected', { betId, reason });
}

export async function processBet(runtime: Runtime, userId: string, betId: string, acceptAtMs: number): Promise<void> {
  const bet = await one(runtime.pool, 'SELECT * FROM betting.bets WHERE user_id = $1 AND bet_id = $2', [userId, betId]);
  if (!bet || bet.status !== 'PENDING') return;
  await waitUntil(acceptAtMs);
  let legs = await loadLegs(runtime.pool, userId, betId);
  if (legs.some((leg) => leg.locked_price === null)) {
    const decisions: { leg: LegRow; lockedPrice: number; tick: number | null }[] = [];
    for (const leg of legs) {
      const decision = await legDecision(runtime, runtime.pool, leg, bet.requested_at, bet.accept_price_changes);
      if (!decision.ok) return reject(runtime, userId, betId, decision.reason);
      decisions.push({ leg, lockedPrice: decision.lockedPrice, tick: decision.tick });
    }
    await tx(runtime.pool, async (client) => {
      for (const decision of decisions) {
        await client.query(
          'UPDATE betting.bet_legs SET locked_price = $4, placed_at_tick = $5 WHERE user_id = $1 AND bet_id = $2 AND leg_no = $3',
          [userId, betId, decision.leg.leg_no, decision.lockedPrice, decision.tick],
        );
      }
    });
    legs = await loadLegs(runtime.pool, userId, betId);
  }
  try {
    await walletApi.debit(userId, bet.season_id, betId, Number(bet.stake));
  } catch (error) {
    if (error instanceof ApiError && error.code === 'INSUFFICIENT_FUNDS') return reject(runtime, userId, betId, 'INSUFFICIENT_FUNDS');
    throw error;
  }
  const lockedPrice = combinedPrice(legs.map((leg) => leg.locked_price ?? leg.accepted_price));
  await tx(runtime.pool, async (client) => {
    const updated = await client.query(
      `UPDATE betting.bets SET status = 'ACCEPTED', locked_price = $3, accepted_at = now() WHERE user_id = $1 AND bet_id = $2 AND status = 'PENDING'`,
      [userId, betId, lockedPrice],
    );
    if (updated.rowCount === 0) return;
    const first = legs[0]!;
    await enqueue(client, 'betting', Topics.betEvents, userId, payload('betAccepted', {
      betId,
      userId,
      marketId: first.market_id,
      raceId: first.race_id,
      selection: { entrantId: first.entrant_id === null ? undefined : entrantKey(first.entrant_id), order: (first.tricast_order ?? []).map(entrantKey) },
      stake: String(bet.stake),
      lockedPrice,
      betType: bet.type,
      raceIds: legs.map((leg) => leg.race_id),
      seasonId: bet.season_id,
    }));
  });
  log.info('bet accepted', { betId, lockedPrice });
}

async function rejectCashout(runtime: Runtime, userId: string, betId: string, cashoutId: string, reason: string): Promise<void> {
  await tx(runtime.pool, async (client) => {
    const updated = await client.query(
      `UPDATE betting.cashouts SET status = 'REJECTED', reject_reason = $3, decided_at = now() WHERE user_id = $1 AND cashout_id = $2 AND status = 'PENDING'`,
      [userId, cashoutId, reason],
    );
    if (updated.rowCount === 0) return;
    await enqueue(client, 'betting', Topics.betEvents, userId, payload('cashOutRejected', { betId, userId, reason, cashoutId }));
  });
  log.info('cash-out rejected', { betId, reason });
}

export async function processCashout(runtime: Runtime, userId: string, betId: string, cashoutId: string, acceptAtMs: number): Promise<void> {
  const cashout = await one(runtime.pool, 'SELECT * FROM betting.cashouts WHERE user_id = $1 AND cashout_id = $2', [userId, cashoutId]);
  if (!cashout || cashout.status !== 'PENDING') return;
  await waitUntil(acceptAtMs);
  const bet = await one(runtime.pool, 'SELECT * FROM betting.bets WHERE user_id = $1 AND bet_id = $2', [userId, betId]);
  if (!bet || bet.status !== 'ACCEPTED') return rejectCashout(runtime, userId, betId, cashoutId, 'ALREADY_SETTLED');
  const legs = await loadLegs(runtime.pool, userId, betId);
  const value = await cashOutValue(runtime.redis, runtime.pool, Number(bet.stake), legs);
  if (!value.ok) return rejectCashout(runtime, userId, betId, cashoutId, value.reason === 'MARKET_SUSPENDED' ? 'MARKET_SUSPENDED' : 'ALREADY_SETTLED');
  if (value.amount < Number(cashout.min_amount)) return rejectCashout(runtime, userId, betId, cashoutId, 'BELOW_MIN');
  const accepted = await tx(runtime.pool, async (client) => {
    const updated = await client.query(
      `UPDATE betting.bets SET status = 'CASHED_OUT', cashout_amount = $3, settled_at = now() WHERE user_id = $1 AND bet_id = $2 AND status = 'ACCEPTED'`,
      [userId, betId, value.amount],
    );
    if (updated.rowCount === 0) return false;
    await client.query(
      `UPDATE betting.cashouts SET status = 'ACCEPTED', final_amount = $3, decided_at = now() WHERE user_id = $1 AND cashout_id = $2`,
      [userId, cashoutId, value.amount],
    );
    await enqueue(client, 'betting', Topics.betEvents, userId, payload('betCashedOut', {
      betId, userId, amount: String(value.amount), tick: value.tick ?? undefined, stake: String(bet.stake), seasonId: bet.season_id,
    }));
    return true;
  });
  if (!accepted) return rejectCashout(runtime, userId, betId, cashoutId, 'ALREADY_SETTLED');
  log.info('cash-out accepted', { betId, amount: value.amount });
}

export async function start(): Promise<void> {
  const runtime = await bootstrap('bet-worker', { outbox: ['betting'] });
  runtime.consumers.push(await runConsumer({
    kafka: runtime.kafka,
    groupId: 'bet-worker',
    topics: [Topics.betCommands],
    pool: runtime.pool,
    concurrency: 6,
    handler: async (envelope) => {
      const event = envelope.payload;
      if (event?.$case === 'betRequested') {
        await processBet(runtime, event.value.userId, event.value.betId, Number(event.value.acceptAtMs));
      } else if (event?.$case === 'comboRequested') {
        await processBet(runtime, event.value.userId, event.value.betId, Number(event.value.acceptAtMs));
      } else if (event?.$case === 'cashOutRequested') {
        await processCashout(runtime, event.value.userId, event.value.betId, event.value.cashoutId, Number(event.value.acceptAtMs));
      }
    },
  }));
}
