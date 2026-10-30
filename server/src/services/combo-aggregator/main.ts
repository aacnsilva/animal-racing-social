import { many, one, tx } from '../../lib/db.ts';
import { payload, runConsumer, Topics, type PayloadOf } from '../../lib/kafka.ts';
import { log } from '../../lib/log.ts';
import { enqueue } from '../../lib/outbox.ts';
import { bootstrap, type Runtime } from '../../lib/runtime.ts';
import { foldCombo } from '../../domain/settlement.ts';

async function onLegSettled(runtime: Runtime, leg: PayloadOf<'legSettled'>): Promise<void> {
  await tx(runtime.pool, async (client) => {
    const bet = await one(client, 'SELECT * FROM betting.bets WHERE user_id = $1 AND bet_id = $2 FOR UPDATE', [leg.userId, leg.betId]);
    if (!bet || bet.status !== 'ACCEPTED' || bet.type !== 'COMBO') return;
    const legs = await many(client, 'SELECT status, locked_price, accepted_price FROM betting.bet_legs WHERE user_id = $1 AND bet_id = $2', [leg.userId, leg.betId]);
    const outcome = foldCombo(Number(bet.stake), legs.map((row) => ({ status: row.status, lockedPrice: row.locked_price ?? row.accepted_price })));
    if (outcome.status === 'OPEN') return;
    await client.query(
      `UPDATE betting.bets SET status = $3, payout = $4, settled_at = now() WHERE user_id = $1 AND bet_id = $2`,
      [leg.userId, leg.betId, outcome.status, outcome.payout],
    );
    await enqueue(client, 'betting', Topics.betEvents, leg.userId, payload('betSettled', {
      betId: leg.betId, userId: leg.userId, outcome: outcome.status, payout: String(outcome.payout), stake: String(bet.stake), seasonId: bet.season_id, betType: 'COMBO',
    }));
    log.info('combo settled', { betId: leg.betId, outcome: outcome.status, payout: outcome.payout });
  });
}

export async function start(): Promise<void> {
  const runtime = await bootstrap('combo-aggregator', { outbox: ['betting'] });
  runtime.consumers.push(await runConsumer({
    kafka: runtime.kafka,
    groupId: 'combo-aggregator',
    topics: [Topics.betEvents],
    pool: runtime.pool,
    concurrency: 6,
    handler: async (envelope) => {
      if (envelope.payload?.$case === 'legSettled') await onLegSettled(runtime, envelope.payload.value);
    },
  }));
}
