import { many, one, tx } from '../../lib/db.ts';
import { entrantKey } from '../../lib/ids.ts';
import { payload, runConsumer, Topics } from '../../lib/kafka.ts';
import { log } from '../../lib/log.ts';
import { enqueue } from '../../lib/outbox.ts';
import { bootstrap, type Runtime } from '../../lib/runtime.ts';
import { legWins, type MarketType } from '../../domain/markets.ts';
import { singleOutcome } from '../../domain/settlement.ts';

type OpenLeg = {
  user_id: string;
  bet_id: string;
  leg_no: number;
  market_id: string;
  entrant_id: number | null;
  tricast_order: number[] | null;
  locked_price: number | null;
  accepted_price: number;
  bet_type: 'SINGLE' | 'COMBO';
  bet_status: string;
  stake: string;
  season_id: string;
};

async function settleMarket(runtime: Runtime, marketId: string, decide: (leg: OpenLeg) => 'WON' | 'LOST' | 'VOID'): Promise<void> {
  const legs = await many<OpenLeg>(
    runtime.pool,
    `SELECT l.*, b.type AS bet_type, b.status AS bet_status, b.stake, b.season_id
     FROM betting.bet_legs l JOIN betting.bets b USING (user_id, bet_id)
     WHERE l.market_id = $1 AND l.status = 'OPEN' AND b.status IN ('ACCEPTED', 'CASHED_OUT')`,
    [marketId],
  );
  let settled = 0;
  for (const leg of legs) {
    const outcome = decide(leg);
    await tx(runtime.pool, async (client) => {
      const updated = await client.query(
        `UPDATE betting.bet_legs SET status = $4, settled_at = now() WHERE user_id = $1 AND bet_id = $2 AND leg_no = $3 AND status = 'OPEN'`,
        [leg.user_id, leg.bet_id, leg.leg_no, outcome],
      );
      if (updated.rowCount === 0 || leg.bet_status !== 'ACCEPTED') return;
      if (leg.bet_type === 'COMBO') {
        await enqueue(client, 'betting', Topics.betEvents, leg.bet_id, payload('legSettled', {
          betId: leg.bet_id, legNo: leg.leg_no, marketId, outcome, userId: leg.user_id,
        }));
        return;
      }
      const result = singleOutcome(Number(leg.stake), leg.locked_price ?? leg.accepted_price, outcome);
      const bet = await client.query(
        `UPDATE betting.bets SET status = $3, payout = $4, settled_at = now() WHERE user_id = $1 AND bet_id = $2 AND status = 'ACCEPTED'`,
        [leg.user_id, leg.bet_id, result.status, result.payout],
      );
      if (bet.rowCount === 0) return;
      await enqueue(client, 'betting', Topics.betEvents, leg.user_id, payload('betSettled', {
        betId: leg.bet_id, userId: leg.user_id, outcome: result.status, payout: String(result.payout), stake: leg.stake, seasonId: leg.season_id, betType: 'SINGLE',
      }));
      settled++;
    });
  }
  if (legs.length > 0) log.info('market settled', { marketId, legs: legs.length, singles: settled });
}

export async function start(): Promise<void> {
  const runtime = await bootstrap('settlement', { outbox: ['betting'] });
  runtime.consumers.push(await runConsumer({
    kafka: runtime.kafka,
    groupId: 'settlement',
    topics: [Topics.marketEvents],
    pool: runtime.pool,
    concurrency: 6,
    handler: async (envelope) => {
      const event = envelope.payload;
      if (event?.$case === 'marketResulted') {
        const market = await one(runtime.pool, 'SELECT type, params, result FROM market.markets WHERE market_id = $1', [event.value.marketId]);
        if (!market) return;
        const winning: string[] = market.result?.winningEntrants ?? [];
        const order: string[] = event.value.order.length ? event.value.order : winning;
        await settleMarket(runtime, event.value.marketId, (leg) => (legWins(
          market.type as MarketType,
          { entrantId: leg.entrant_id === null ? null : entrantKey(leg.entrant_id), order: (leg.tricast_order ?? []).map(entrantKey) },
          winning,
          order,
        ) ? 'WON' : 'LOST'));
      } else if (event?.$case === 'marketVoided') {
        await settleMarket(runtime, event.value.marketId, () => 'VOID');
      }
    },
  }));
}
