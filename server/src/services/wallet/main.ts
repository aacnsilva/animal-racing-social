import { envInt } from '../../lib/config.ts';
import { one, tx } from '../../lib/db.ts';
import { ApiError, Router, serve, v } from '../../lib/http.ts';
import { runConsumer, Topics } from '../../lib/kafka.ts';
import { bootstrap } from '../../lib/runtime.ts';
import { activeSeason } from '../../lib/seasons.ts';
import { addDays, utcDay } from '../../lib/time.ts';
import { applyChange, ensureWallet } from './ledger.ts';

export async function start(): Promise<void> {
  const runtime = await bootstrap('wallet', { outbox: ['wallet'], health: false });
  const { pool } = runtime;

  const router = new Router()
    .get('/healthz', async () => {
      await pool.query('SELECT 1');
      return { ok: true };
    })
    .post('/internal/ensure', async (ctx) => {
      const body = await ctx.body();
      const userId = v.id(body.userId, 'userId');
      const seasonId = v.id(body.seasonId, 'seasonId');
      const state = await tx(pool, (client) => ensureWallet(client, userId, seasonId));
      return { seasonId, balance: state.balance, inOpenBets: state.openStake, rankScore: state.balance + state.openStake };
    })
    .post('/internal/debit', async (ctx) => {
      const body = await ctx.body();
      const change = {
        userId: v.id(body.userId, 'userId'),
        seasonId: v.id(body.seasonId, 'seasonId'),
        type: 'BET_STAKE' as const,
        refId: v.id(body.betId, 'betId'),
        balanceDelta: -v.int(body.amount, 'amount', { min: 1 }),
        openStakeDelta: v.int(body.amount, 'amount', { min: 1 }),
      };
      const result = await tx(pool, (client) => applyChange(client, change));
      return { balance: result.state.balance, duplicate: !result.applied };
    })
    .post('/internal/adjust', async (ctx) => {
      const body = await ctx.body();
      const change = {
        userId: v.id(body.userId, 'userId'),
        seasonId: v.id(body.seasonId, 'seasonId'),
        type: 'ADMIN_ADJUST' as const,
        refId: v.str(body.refId, 'refId'),
        balanceDelta: v.int(body.amount, 'amount'),
        openStakeDelta: 0,
      };
      const result = await tx(pool, (client) => applyChange(client, change));
      return { balance: result.state.balance };
    })
    .post('/internal/daily-claim', async (ctx) => {
      const body = await ctx.body();
      const userId = v.id(body.userId, 'userId');
      return tx(pool, async (client) => {
        const season = await activeSeason(client);
        if (!season) throw new ApiError(409, 'CONFLICT', 'No active season');
        const today = utcDay();
        await client.query('INSERT INTO wallet.daily_rewards (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
        const reward = await one(client, 'SELECT last_claim_day, streak, best_streak FROM wallet.daily_rewards WHERE user_id = $1 FOR UPDATE', [userId]);
        if (reward!.last_claim_day === today) throw new ApiError(409, 'ALREADY_CLAIMED', 'Daily reward already claimed today');
        const streak = reward!.last_claim_day === addDays(today, -1) ? reward!.streak + 1 : 1;
        const amount = Number(season.daily_grant);
        const result = await applyChange(client, {
          userId, seasonId: season.season_id, type: 'DAILY_GRANT', refId: `${userId}:${today}`, balanceDelta: amount, openStakeDelta: 0,
        });
        await client.query(
          'UPDATE wallet.daily_rewards SET last_claim_day = $2, streak = $3, best_streak = GREATEST(best_streak, $3) WHERE user_id = $1',
          [userId, today, streak],
        );
        return { amount, balance: result.state.balance, streak };
      });
    });
  const server = serve(router, envInt('PORT', 3002));
  runtime.onStop(() => void server.close());

  runtime.consumers.push(await runConsumer({
    kafka: runtime.kafka,
    groupId: 'wallet',
    topics: [Topics.betEvents],
    pool,
    concurrency: 6,
    handler: async (envelope) => {
      const event = envelope.payload;
      if (event?.$case === 'betSettled') {
        const settled = event.value;
        const stake = Number(settled.stake);
        const payout = Number(settled.payout);
        const type = settled.outcome === 'WON' ? 'BET_PAYOUT' : settled.outcome === 'VOID' ? 'BET_REFUND' : 'BET_LOST';
        await tx(pool, (client) => applyChange(client, {
          userId: settled.userId, seasonId: settled.seasonId, type, refId: settled.betId, balanceDelta: type === 'BET_LOST' ? 0 : payout, openStakeDelta: -stake,
        }));
      } else if (event?.$case === 'betCashedOut') {
        const cashed = event.value;
        await tx(pool, (client) => applyChange(client, {
          userId: cashed.userId, seasonId: cashed.seasonId, type: 'CASHOUT', refId: cashed.betId, balanceDelta: Number(cashed.amount), openStakeDelta: -Number(cashed.stake),
        }));
      }
    },
  }));
}
