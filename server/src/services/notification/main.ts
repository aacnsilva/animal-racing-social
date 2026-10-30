import { many, one, tx, type Client } from '../../lib/db.ts';
import { newId, shardOf } from '../../lib/ids.ts';
import { payload, runConsumer, Topics, type PayloadOf } from '../../lib/kafka.ts';
import { log } from '../../lib/log.ts';
import { enqueue } from '../../lib/outbox.ts';
import { instruments } from '../../lib/instruments.ts';
import { bootstrap, every, type Runtime } from '../../lib/runtime.ts';
import { HOUR_MS, MINUTE_MS, utcDay } from '../../lib/time.ts';
import { isEnabled, settledType, type NotificationSettings, type NotificationType } from '../../domain/notifications.ts';

export const unreadKey = (userId: string) => `notif:unread:${userId}`;

async function notify(runtime: Runtime, client: Client, userId: string, type: NotificationType, dedupeKey: string, body: Record<string, unknown>): Promise<boolean> {
  const settings = await one<{ enabled: boolean; types: NotificationSettings['types'] }>(client, 'SELECT enabled, types FROM notification.settings WHERE user_id = $1', [userId]);
  if (!isEnabled(settings, type)) return false;
  const notificationId = newId(shardOf(userId));
  const inserted = await one(
    client,
    `INSERT INTO notification.notifications (user_id, notification_id, type, dedupe_key, payload) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING created_at`,
    [userId, notificationId, type, dedupeKey, JSON.stringify(body)],
  );
  if (!inserted) return false;
  instruments.notificationsCreated().add(1, { type });
  await enqueue(client, 'notification', Topics.notificationEvents, userId, payload('notificationCreated', {
    userId, notificationId, type, payloadJson: JSON.stringify(body), createdAt: inserted.created_at.toISOString(),
  }));
  await runtime.redis.incr(unreadKey(userId));
  return true;
}

async function notifyOne(runtime: Runtime, userId: string, type: NotificationType, dedupeKey: string, body: Record<string, unknown>): Promise<void> {
  await tx(runtime.pool, (client) => notify(runtime, client, userId, type, dedupeKey, body));
}

async function raceLabel(runtime: Runtime, raceId: string): Promise<Record<string, unknown>> {
  const race = await one(
    runtime.pool,
    `SELECT r.race_id, r.start_at, r.race_class, r.species, v.name AS venue_name FROM racing.races r
     JOIN racing.venues v ON v.venue_id = r.venue_id AND v.version = r.venue_version WHERE r.race_id = $1`,
    [raceId],
  );
  return race ? { raceId, venueName: race.venue_name, raceClass: race.race_class, species: race.species, startAt: race.start_at.toISOString() } : { raceId };
}

async function betContext(runtime: Runtime, userId: string, betId: string): Promise<Record<string, unknown>> {
  const leg = await one(runtime.pool, 'SELECT race_id FROM betting.bet_legs WHERE user_id = $1 AND bet_id = $2 ORDER BY leg_no LIMIT 1', [userId, betId]);
  return leg ? raceLabel(runtime, leg.race_id) : {};
}

async function onEvent(runtime: Runtime, envelope: { eventId: string; payload?: { $case: string; value: any } | undefined }): Promise<void> {
  const event = envelope.payload;
  switch (event?.$case) {
    case 'betSettled': {
      const settled = event.value as PayloadOf<'betSettled'>;
      const context = await betContext(runtime, settled.userId, settled.betId);
      await notifyOne(runtime, settled.userId, settledType(settled.outcome), `BET_SETTLED:${settled.betId}`, {
        ...context, betId: settled.betId, outcome: settled.outcome, payout: Number(settled.payout), stake: Number(settled.stake), betType: settled.betType,
      });
      break;
    }
    case 'betRejected': {
      const rejected = event.value as PayloadOf<'betRejected'>;
      const context = await betContext(runtime, rejected.userId, rejected.betId);
      await notifyOne(runtime, rejected.userId, 'BET_REJECTED', `BET_REJECTED:${rejected.betId}`, { ...context, betId: rejected.betId, reason: rejected.reason });
      break;
    }
    case 'betCashedOut': {
      const cashed = event.value as PayloadOf<'betCashedOut'>;
      const context = await betContext(runtime, cashed.userId, cashed.betId);
      await notifyOne(runtime, cashed.userId, 'CASHOUT_DONE', `CASHOUT_DONE:${cashed.betId}`, { ...context, betId: cashed.betId, amount: Number(cashed.amount) });
      break;
    }
    case 'cashOutRejected': {
      const rejected = event.value as PayloadOf<'cashOutRejected'>;
      await notifyOne(runtime, rejected.userId, 'CASHOUT_REJECTED', `CASHOUT_REJECTED:${rejected.cashoutId}`, { betId: rejected.betId, reason: rejected.reason });
      break;
    }
    case 'seasonEnding': {
      const ending = event.value as PayloadOf<'seasonEnding'>;
      const users = await many(runtime.pool, 'SELECT user_id FROM wallet.wallets WHERE season_id = $1', [ending.seasonId]);
      for (const user of users) {
        await notifyOne(runtime, user.user_id, 'SEASON_ENDING', `SEASON_ENDING:${ending.seasonId}`, { seasonId: ending.seasonId, endsAt: ending.endsAt });
      }
      break;
    }
    case 'seasonEnded': {
      const ended = event.value as PayloadOf<'seasonEnded'>;
      const ranks = await many(runtime.pool, `SELECT user_id, rank, score FROM season.season_results WHERE season_id = $1 AND board = 'balance'`, [ended.seasonId]);
      const season = await one(runtime.pool, 'SELECT name FROM season.seasons WHERE season_id = $1', [ended.seasonId]);
      for (const rank of ranks) {
        await notifyOne(runtime, rank.user_id, 'SEASON_RESULT', `SEASON_RESULT:${ended.seasonId}`, {
          seasonId: ended.seasonId, seasonName: season?.name, rank: rank.rank, score: Number(rank.score), participants: ranks.length,
        });
      }
      break;
    }
    case 'leaderboardMoved': {
      const moved = event.value as PayloadOf<'leaderboardMoved'>;
      await notifyOne(runtime, moved.userId, 'LEADERBOARD_MOVE', `LEADERBOARD_MOVE:${envelope.eventId}`, {
        seasonId: moved.seasonId, board: moved.board, fromRank: moved.fromRank, toRank: moved.toRank, threshold: moved.threshold, entered: moved.entered,
      });
      break;
    }
  }
}

async function raceStartingAlerts(runtime: Runtime): Promise<void> {
  const races = await many(
    runtime.pool,
    `SELECT race_id FROM racing.races WHERE status IN ('OPEN', 'LOCKED') AND start_at <= now() + interval '2 minutes' AND start_at > now()`,
  );
  for (const race of races) {
    const users = await many(
      runtime.pool,
      `SELECT DISTINCT l.user_id FROM betting.bet_legs l JOIN betting.bets b USING (user_id, bet_id)
       WHERE l.race_id = $1 AND b.status IN ('PENDING', 'ACCEPTED')
         AND NOT EXISTS (SELECT 1 FROM notification.notifications n WHERE n.user_id = l.user_id AND n.dedupe_key = 'RACE_STARTING:' || l.race_id)`,
      [race.race_id],
    );
    if (users.length === 0) continue;
    const context = await raceLabel(runtime, race.race_id);
    await tx(runtime.pool, async (client) => {
      for (const user of users) await notify(runtime, client, user.user_id, 'RACE_STARTING', `RACE_STARTING:${race.race_id}`, context);
    });
    log.info('race starting alerts', { raceId: race.race_id, users: users.length });
  }
}

async function dailyRewardAlerts(runtime: Runtime): Promise<void> {
  const today = utcDay();
  await tx(runtime.pool, async (client) => {
    const claimed = await client.query('INSERT INTO notification.daily_ready_runs (day) VALUES ($1) ON CONFLICT DO NOTHING', [today]);
    if (claimed.rowCount === 0) return;
    const users = await many(
      client,
      `SELECT u.user_id FROM identity.users u LEFT JOIN wallet.daily_rewards d ON d.user_id = u.user_id
       WHERE u.banned_at IS NULL AND (d.last_claim_day IS NULL OR d.last_claim_day < $1)
         AND EXISTS (SELECT 1 FROM identity.refresh_tokens t WHERE t.user_id = u.user_id AND t.created_at > now() - interval '30 days')`,
      [today],
    );
    for (const user of users) await notify(runtime, client, user.user_id, 'DAILY_REWARD_READY', `DAILY_REWARD_READY:${today}`, { day: today, amount: 50 });
    log.info('daily reward alerts', { day: today, users: users.length });
  });
}

async function retention(runtime: Runtime): Promise<void> {
  const deleted = await runtime.pool.query(`DELETE FROM notification.notifications WHERE created_at < now() - interval '30 days'`);
  if (deleted.rowCount) log.info('notifications purged', { rows: deleted.rowCount });
}

export async function start(): Promise<void> {
  const runtime = await bootstrap('notification', { outbox: ['notification'] });
  every(15_000, () => raceStartingAlerts(runtime), runtime, 'race starting alerts');
  every(5 * MINUTE_MS, () => dailyRewardAlerts(runtime), runtime, 'daily reward alerts');
  every(6 * HOUR_MS, () => retention(runtime), runtime, 'notification retention');
  runtime.consumers.push(await runConsumer({
    kafka: runtime.kafka,
    groupId: 'notification',
    topics: [Topics.betEvents, Topics.seasonEvents],
    pool: runtime.pool,
    concurrency: 6,
    handler: (envelope) => onEvent(runtime, envelope),
  }));
}
