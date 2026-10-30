import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { ServerResponse } from 'node:http';
import { envInt } from '../../lib/config.ts';
import { sha256 } from '../../lib/crypto.ts';
import { many, one, type Pool } from '../../lib/db.ts';
import { ApiError, pathId, Router, serve } from '../../lib/http.ts';
import { runConsumer, Topics } from '../../lib/kafka.ts';
import { errorFields, log } from '../../lib/log.ts';
import type { Redis } from '../../lib/redis.ts';
import { instruments } from '../../lib/instruments.ts';
import { bootstrap } from '../../lib/runtime.ts';
import { gauge } from '../../lib/telemetry.ts';
import { betsOnRace, loadBet } from '../../read/bets.ts';
import { issueQuote, loadLegs } from '../../read/cashout.ts';
import { loadMarket, marketsForRace } from '../../read/markets.ts';
import { liveState, loadRace } from '../../read/races.ts';

type Connection = { id: string; raceId: string; userId: string | null; res: ServerResponse; lastCashout: number };

const LIFECYCLE_STATUS: Record<string, string> = {
  raceOpened: 'OPEN',
  raceLocked: 'LOCKED',
  raceStarted: 'LIVE',
  raceFinished: 'FINISHED',
  raceSettled: 'SETTLED',
  raceCancelled: 'CANCELLED',
};

export class Gateway {
  pool: Pool;
  redis: Redis;
  byRace = new Map<string, Set<Connection>>();
  byUser = new Map<string, Set<Connection>>();

  constructor(pool: Pool, redis: Redis) {
    this.pool = pool;
    this.redis = redis;
  }

  send(connection: Connection, event: string, data: unknown): void {
    connection.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    instruments.sseEvents().add(1, { event });
  }

  broadcast(raceId: string, event: string, data: unknown): void {
    for (const connection of this.byRace.get(raceId) ?? []) this.send(connection, event, data);
  }

  watching(raceId: string): boolean {
    return (this.byRace.get(raceId)?.size ?? 0) > 0;
  }

  add(connection: Connection): void {
    const race = this.byRace.get(connection.raceId) ?? new Set();
    race.add(connection);
    this.byRace.set(connection.raceId, race);
    if (connection.userId) {
      const user = this.byUser.get(connection.userId) ?? new Set();
      user.add(connection);
      this.byUser.set(connection.userId, user);
    }
  }

  remove(connection: Connection): void {
    this.byRace.get(connection.raceId)?.delete(connection);
    if (this.byRace.get(connection.raceId)?.size === 0) this.byRace.delete(connection.raceId);
    if (connection.userId) {
      this.byUser.get(connection.userId)?.delete(connection);
      if (this.byUser.get(connection.userId)?.size === 0) this.byUser.delete(connection.userId);
    }
  }

  async userFromCookie(token: string | undefined): Promise<string | null> {
    if (!token) return null;
    const row = await one(
      this.pool,
      `SELECT t.user_id FROM identity.refresh_tokens t JOIN identity.users u USING (user_id)
       WHERE t.token_hash = $1 AND t.expires_at > now() AND (t.revoked_at IS NULL OR t.revoked_at > now() - interval '30 seconds') AND u.banned_at IS NULL`,
      [sha256(token)],
    );
    return row?.user_id ?? null;
  }

  async snapshot(raceId: string, userId: string | null) {
    const race = await loadRace(this.pool, this.redis, raceId);
    if (!race) return null;
    const live = race.status === 'LIVE' ? await liveState(this.redis, raceId) : null;
    return {
      race,
      tick: live ? { tick: live.tick, lap: live.lap, entrants: live.entrants, events: live.events ?? [] } : null,
      markets: await marketsForRace(this.pool, this.redis, raceId),
      myBets: userId ? await betsOnRace(this.pool, userId, raceId) : [],
    };
  }

  async pushBet(userId: string, betId: string): Promise<void> {
    const connections = this.byUser.get(userId);
    if (!connections?.size) return;
    const bet = await loadBet(this.pool, userId, betId);
    if (!bet) return;
    const races = new Set(bet.legs.map((leg) => leg.raceId));
    for (const connection of connections) if (races.has(connection.raceId)) this.send(connection, 'bet.updated', bet);
  }

  async pushCashouts(raceId: string): Promise<void> {
    const now = Date.now();
    for (const connection of this.byRace.get(raceId) ?? []) {
      if (!connection.userId || now - connection.lastCashout < 1000) continue;
      connection.lastCashout = now;
      const bets = await many(
        this.pool,
        `SELECT DISTINCT b.bet_id, b.stake FROM betting.bets b JOIN betting.bet_legs l USING (user_id, bet_id)
         WHERE b.user_id = $1 AND b.status = 'ACCEPTED' AND l.race_id = $2`,
        [connection.userId, raceId],
      );
      for (const bet of bets) {
        const result = await issueQuote(this.redis, this.pool, { userId: connection.userId, betId: bet.bet_id, stake: Number(bet.stake) }, await loadLegs(this.pool, connection.userId, bet.bet_id));
        if (result.ok) {
          this.send(connection, 'cashout.updated', { betId: bet.bet_id, amount: result.quote.amount, quoteId: result.quote.quoteId, expiresAtTick: result.quote.expiresAtTick });
        }
      }
    }
  }

  async onEvent(envelope: { occurredAt: string; payload?: { $case: string; value: any } | undefined }): Promise<void> {
    const event = envelope.payload;
    if (!event) return;
    const value = event.value;
    if (event.$case in LIFECYCLE_STATUS) {
      if (!this.watching(value.raceId)) return;
      this.broadcast(value.raceId, 'race.lifecycle', {
        status: LIFECYCLE_STATUS[event.$case],
        at: envelope.occurredAt,
        ...(event.$case === 'raceFinished' ? { order: value.order } : {}),
        ...(event.$case === 'raceCancelled' ? { reason: value.reason } : {}),
      });
      return;
    }
    switch (event.$case) {
      case 'raceTick':
        if (this.watching(value.raceId)) this.broadcast(value.raceId, 'race.tick', { tick: value.tick, lap: value.lap, entrants: value.entrants, events: value.events });
        return;
      case 'lapCompleted':
        if (this.watching(value.raceId)) this.broadcast(value.raceId, 'race.lap', { lap: value.lap, leaderEntrantId: value.leaderEntrantId, standings: value.standings });
        return;
      case 'marketOpened':
        if (this.watching(value.raceId)) this.broadcast(value.raceId, 'market.opened', await loadMarket(this.pool, this.redis, value.marketId));
        return;
      case 'priceUpdated':
        if (!this.watching(value.raceId)) return;
        this.broadcast(value.raceId, 'market.price', { marketId: value.marketId, priceVersion: value.priceVersion, tick: value.tick, selections: value.selections });
        await this.pushCashouts(value.raceId);
        return;
      case 'marketSuspended':
        if (this.watching(value.raceId)) this.broadcast(value.raceId, 'market.suspended', { marketId: value.marketId, tick: value.tick, reason: value.reason });
        return;
      case 'marketResumed':
        if (this.watching(value.raceId)) this.broadcast(value.raceId, 'market.resumed', { marketId: value.marketId, tick: value.tick, priceVersion: value.priceVersion });
        return;
      case 'marketClosed':
        if (this.watching(value.raceId)) this.broadcast(value.raceId, 'market.closed', { marketId: value.marketId, tick: value.tick });
        return;
      case 'marketResulted':
        if (this.watching(value.raceId)) this.broadcast(value.raceId, 'market.resulted', { marketId: value.marketId, winning: value.winning, order: value.order });
        return;
      case 'marketVoided':
        if (this.watching(value.raceId)) this.broadcast(value.raceId, 'market.voided', { marketId: value.marketId, reason: value.reason });
        return;
      case 'betAccepted':
      case 'betRejected':
      case 'betSettled':
      case 'betCashedOut':
      case 'cashOutRejected':
      case 'legSettled':
        await this.pushBet(value.userId, value.betId);
        return;
      case 'notificationCreated': {
        const connections = this.byUser.get(value.userId);
        if (!connections?.size) return;
        const unread = await one(this.pool, 'SELECT count(*)::int AS n FROM notification.notifications WHERE user_id = $1 AND read_at IS NULL', [value.userId]).catch(() => null);
        const notification = { id: value.notificationId, type: value.type, payload: JSON.parse(value.payloadJson || '{}'), createdAt: value.createdAt, readAt: null };
        for (const connection of connections) this.send(connection, 'notification', { notification, unreadCount: unread?.n ?? null });
        return;
      }
    }
  }
}

export async function start(): Promise<void> {
  const runtime = await bootstrap('sse', { health: false });
  const gateway = new Gateway(runtime.pool, runtime.redis);
  gauge('ars.sse.connections', 'Open race streams', '', async () => {
    let users = 0;
    let anonymous = 0;
    for (const connections of gateway.byRace.values()) for (const connection of connections) connection.userId ? users++ : anonymous++;
    return [{ value: users, attributes: { auth: 'user' } }, { value: anonymous, attributes: { auth: 'anonymous' } }];
  });
  const router = new Router()
    .get('/healthz', async () => ({ ok: true, connections: [...gateway.byRace.values()].reduce((n, set) => n + set.size, 0) }))
    .get('/v1/races/:raceId/stream', async (ctx) => {
      const raceId = pathId(ctx, 'raceId');
      const userId = await gateway.userFromCookie(ctx.cookies.ars_refresh);
      const snapshot = await gateway.snapshot(raceId, userId);
      if (!snapshot) throw new ApiError(404, 'NOT_FOUND', 'Unknown race');
      ctx.res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      ctx.res.flushHeaders();
      const connection: Connection = { id: randomUUID(), raceId, userId, res: ctx.res, lastCashout: 0 };
      gateway.send(connection, 'snapshot', snapshot);
      gateway.add(connection);
      ctx.req.on('close', () => gateway.remove(connection));
      return undefined;
    });
  const server = serve(router, envInt('PORT', 3001));
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  const ping = setInterval(() => {
    for (const connections of gateway.byRace.values()) for (const connection of connections) gateway.send(connection, 'ping', {});
  }, 15_000);
  runtime.onStop(() => {
    clearInterval(ping);
    for (const connections of gateway.byRace.values()) for (const connection of connections) connection.res.end();
    server.close();
  });
  runtime.consumers.push(await runConsumer({
    kafka: runtime.kafka,
    groupId: `sse-${hostname()}-${randomUUID().slice(0, 8)}`,
    topics: [Topics.raceLifecycle, Topics.raceTicks, Topics.marketEvents, Topics.betEvents, Topics.notificationEvents],
    fromBeginning: false,
    concurrency: 6,
    attempts: 1,
    traced: false,
    handler: async (envelope) => {
      try {
        await gateway.onEvent(envelope);
      } catch (error) {
        log.warn('sse fan-out failed', { type: envelope.type, ...errorFields(error) });
      }
    },
  }));
}
