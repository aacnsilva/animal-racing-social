import { decodeCursor, page, pageLimit } from '../../lib/cursor.ts';
import { many, one } from '../../lib/db.ts';
import { ApiError, v, type Router } from '../../lib/http.ts';
import { walletApi } from '../../lib/internal.ts';
import { activeSeason } from '../../lib/seasons.ts';
import { addDays, iso, utcDay } from '../../lib/time.ts';
import { NOTIFICATION_TYPES } from '../../domain/notifications.ts';
import { betsJson } from '../../read/bets.ts';
import { requireActiveUser, requireUser, type Deps } from './context.ts';

const BET_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'WON', 'LOST', 'VOID', 'CASHED_OUT', 'OPEN', 'SETTLED'] as const;

function notificationJson(row: Record<string, any>) {
  return { id: row.notification_id, type: row.type, payload: row.payload, createdAt: iso(row.created_at), readAt: iso(row.read_at) };
}

async function unreadCount(deps: Deps, userId: string): Promise<number> {
  const row = await one(deps.pool, 'SELECT count(*)::int AS n FROM notification.notifications WHERE user_id = $1 AND read_at IS NULL', [userId]);
  return row!.n;
}

export function meRoutes(router: Router, deps: Deps): void {
  router.get('/v1/me/bets', async (ctx) => {
    const { userId } = requireUser(ctx);
    const limit = pageLimit(ctx.query);
    const cursor = decodeCursor(ctx.query.get('cursor'));
    const statusParam = ctx.query.get('status') ? v.oneOf(ctx.query.get('status'), 'status', BET_STATUSES) : null;
    const statuses = statusParam === 'OPEN' ? ['PENDING', 'ACCEPTED'] : statusParam === 'SETTLED' ? ['WON', 'LOST', 'VOID', 'CASHED_OUT'] : statusParam ? [statusParam] : null;
    const raceId = ctx.query.get('raceId') ? v.id(ctx.query.get('raceId'), 'raceId') : null;
    const rows = await many(
      deps.pool,
      `SELECT * FROM betting.bets b WHERE b.user_id = $1
         AND ($2::text[] IS NULL OR b.status = ANY($2))
         AND ($3::bigint IS NULL OR EXISTS (SELECT 1 FROM betting.bet_legs l WHERE l.user_id = b.user_id AND l.bet_id = b.bet_id AND l.race_id = $3))
         AND ($4::timestamptz IS NULL OR (b.requested_at, b.bet_id) < ($4, $5::bigint))
       ORDER BY b.requested_at DESC, b.bet_id DESC LIMIT $6`,
      [userId, statuses, raceId, cursor?.[0] ?? null, cursor?.[1] ?? '0', limit + 1],
    );
    const result = page(rows, limit, (row) => [row.requested_at.toISOString(), row.bet_id]);
    return { items: await betsJson(deps.pool, result.items), nextCursor: result.nextCursor };
  });

  router.get('/v1/me/wallet', async (ctx) => {
    const { userId } = requireUser(ctx);
    const season = await activeSeason(deps.pool);
    if (!season) throw new ApiError(409, 'CONFLICT', 'No active season');
    return walletApi.ensure(userId, season.season_id);
  });

  router.get('/v1/me/wallet/ledger', async (ctx) => {
    const { userId } = requireUser(ctx);
    const limit = pageLimit(ctx.query);
    const cursor = decodeCursor(ctx.query.get('cursor'));
    const rows = await many(
      deps.pool,
      `SELECT * FROM wallet.ledger_entries WHERE user_id = $1 AND ($2::timestamptz IS NULL OR (created_at, entry_id) < ($2, $3::bigint))
       ORDER BY created_at DESC, entry_id DESC LIMIT $4`,
      [userId, cursor?.[0] ?? null, cursor?.[1] ?? '0', limit + 1],
    );
    const result = page(rows, limit, (row) => [row.created_at.toISOString(), row.entry_id]);
    return {
      items: result.items.map((row) => ({
        entryId: row.entry_id, seasonId: row.season_id, type: row.type, amount: Number(row.amount), refId: row.ref_id,
        balanceAfter: Number(row.balance_after), createdAt: iso(row.created_at),
      })),
      nextCursor: result.nextCursor,
    };
  });

  router.get('/v1/me/rewards/daily', async (ctx) => {
    const { userId } = requireUser(ctx);
    const season = await activeSeason(deps.pool);
    const reward = await one(deps.pool, 'SELECT * FROM wallet.daily_rewards WHERE user_id = $1', [userId]);
    const today = utcDay();
    const claimedToday = reward?.last_claim_day === today;
    const liveStreak = reward && (reward.last_claim_day === today || reward.last_claim_day === addDays(today, -1)) ? reward.streak : 0;
    return {
      claimable: !claimedToday && Boolean(season),
      amount: Number(season?.daily_grant ?? 50),
      nextClaimAt: claimedToday ? `${addDays(today, 1)}T00:00:00.000Z` : new Date().toISOString(),
      streak: liveStreak,
      bestStreak: reward?.best_streak ?? 0,
    };
  });

  router.post('/v1/me/rewards/daily', async (ctx) => {
    const { userId } = await requireActiveUser(ctx, deps);
    const claimed = await walletApi.dailyClaim(userId);
    return { amount: claimed.amount, balance: claimed.balance, streak: claimed.streak };
  });

  router.get('/v1/me/notifications', async (ctx) => {
    const { userId } = requireUser(ctx);
    const limit = pageLimit(ctx.query);
    const cursor = decodeCursor(ctx.query.get('cursor'));
    const unreadOnly = ctx.query.get('unread') === 'true';
    const rows = await many(
      deps.pool,
      `SELECT * FROM notification.notifications WHERE user_id = $1 AND (NOT $2 OR read_at IS NULL)
         AND ($3::timestamptz IS NULL OR (created_at, notification_id) < ($3, $4::bigint))
       ORDER BY created_at DESC, notification_id DESC LIMIT $5`,
      [userId, unreadOnly, cursor?.[0] ?? null, cursor?.[1] ?? '0', limit + 1],
    );
    const result = page(rows, limit, (row) => [row.created_at.toISOString(), row.notification_id]);
    return { items: result.items.map(notificationJson), nextCursor: result.nextCursor, unreadCount: await unreadCount(deps, userId) };
  });

  router.post('/v1/me/notifications/read', async (ctx) => {
    const { userId } = requireUser(ctx);
    const body = await ctx.body();
    if (body.all === true) {
      await deps.pool.query('UPDATE notification.notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
    } else {
      const ids = v.arr(body.ids, 'ids', { min: 1, max: 200 }).map((id, index) => v.id(id, `ids[${index}]`));
      await deps.pool.query('UPDATE notification.notifications SET read_at = now() WHERE user_id = $1 AND notification_id = ANY($2) AND read_at IS NULL', [userId, ids]);
    }
    const count = await unreadCount(deps, userId);
    await deps.redis.set(`notif:unread:${userId}`, String(count));
    return { unreadCount: count };
  });

  router.get('/v1/me/notification-settings', async (ctx) => {
    const { userId } = requireUser(ctx);
    const row = await one(deps.pool, 'SELECT enabled, types FROM notification.settings WHERE user_id = $1', [userId]);
    const types = Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, row?.types?.[type] !== false]));
    return { enabled: row?.enabled ?? true, types };
  });

  router.put('/v1/me/notification-settings', async (ctx) => {
    const { userId } = requireUser(ctx);
    const body = await ctx.body();
    const enabled = v.bool(body.enabled, 'enabled');
    const rawTypes = body.types === undefined ? {} : v.obj(body.types, 'types');
    const types: Record<string, boolean> = {};
    for (const [type, value] of Object.entries(rawTypes)) {
      v.oneOf(type, 'types', NOTIFICATION_TYPES);
      types[type] = v.bool(value, `types.${type}`);
    }
    await deps.pool.query(
      `INSERT INTO notification.settings (user_id, enabled, types, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, types = EXCLUDED.types, updated_at = now()`,
      [userId, enabled, JSON.stringify(types)],
    );
    return { enabled, types: Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, types[type] !== false])) };
  });
}
