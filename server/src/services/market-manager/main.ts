import { zstdCompressSync } from 'node:zlib';
import { settings } from '../../lib/config.ts';
import { many, one, tx, type Client } from '../../lib/db.ts';
import { entrantKey, entrantNumber, newId } from '../../lib/ids.ts';
import { oddsEngine } from '../../lib/internal.ts';
import { payload, runConsumer, Topics, type Payload, type PayloadOf } from '../../lib/kafka.ts';
import { log } from '../../lib/log.ts';
import { enqueue } from '../../lib/outbox.ts';
import { marketTransition } from '../../lib/instruments.ts';
import { bootstrap, type Runtime } from '../../lib/runtime.ts';
import { withSpan } from '../../lib/telemetry.ts';
import { DAY_MS } from '../../lib/time.ts';
import { dbPrice, readPrice, writePrice } from '../../read/prices.ts';
import {
  expandTemplate, shouldCloseInRunning, suspensionFor, winningEntrants, type MarketType, type TemplateEntry,
} from '../../domain/markets.ts';

type MarketState = {
  id: string;
  type: MarketType;
  params: Record<string, number>;
  status: string;
  closesAtLap: number | null;
  ticksBeforeCheckpoint: number | null;
  suspendReason: string | null;
  suspendedUntilTick: number;
};

type RaceState = { raceId: string; laps: number; lapLength: number; tickMs: number; markets: Map<string, MarketState> };

type MarketRow = { market_id: string; type: MarketType; params: Record<string, number>; status: string };

type MarketEventKind = 'marketOpened' | 'marketSuspended' | 'marketResumed' | 'marketClosed' | 'marketResulted' | 'marketVoided';

export class MarketManager {
  runtime: Runtime;
  races = new Map<string, RaceState>();

  constructor(runtime: Runtime) {
    this.runtime = runtime;
  }

  get pool() {
    return this.runtime.pool;
  }

  async raceState(raceId: string): Promise<RaceState | null> {
    const cached = this.races.get(raceId);
    if (cached) return cached;
    const race = await one(
      this.pool,
      `SELECT r.race_id, r.laps, r.tick_ms, v.lap_length FROM racing.races r
       JOIN racing.venues v ON v.venue_id = r.venue_id AND v.version = r.venue_version WHERE r.race_id = $1`,
      [raceId],
    );
    if (!race) return null;
    const markets = await many(this.pool, 'SELECT * FROM market.markets WHERE race_id = $1', [raceId]);
    const state: RaceState = { raceId, laps: race.laps, lapLength: Number(race.lap_length), tickMs: race.tick_ms, markets: new Map() };
    for (const row of markets) {
      state.markets.set(row.market_id, {
        id: row.market_id,
        type: row.type,
        params: row.params,
        status: row.status,
        closesAtLap: row.closes_at_lap,
        ticksBeforeCheckpoint: row.closes_rule?.ticksBeforeCheckpoint ?? null,
        suspendReason: row.suspend_reason,
        suspendedUntilTick: 0,
      });
    }
    this.races.set(raceId, state);
    return state;
  }

  async publishMarket(client: Client, raceId: string, marketId: string, body: Record<string, unknown>, kind: MarketEventKind): Promise<void> {
    await enqueue(client, 'market', Topics.marketEvents, raceId, { $case: kind, value: { marketId, raceId, ...body } } as Payload);
  }

  async snapshot(client: Client, marketId: string, kind: 'OPENING' | 'AT_LOCK' | 'AT_START'): Promise<void> {
    const price = await readPrice(this.runtime.redis, client, marketId);
    if (!price) return;
    const prices = Object.fromEntries(price.selections.map((selection) => [selection.entrantId, selection.price]));
    await client.query(
      'INSERT INTO market.price_snapshots (market_id, kind, prices, taken_at) VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING',
      [marketId, kind, JSON.stringify(prices)],
    );
  }

  async openMarket(client: Client, raceId: string, marketId: string, reason = 'open'): Promise<void> {
    const row = (await one(client, `UPDATE market.markets SET status = 'OPEN', opened_at = now(), suspend_reason = NULL WHERE market_id = $1 RETURNING *`, [marketId]))!;
    marketTransition(row.type, 'PENDING', 'OPEN', reason);
    const price = (await dbPrice(client, marketId))!;
    await writePrice(this.runtime.redis, marketId, price);
    await this.publishMarket(client, raceId, marketId, {
      type: row.type,
      params: row.params,
      selections: price.selections.map((selection) => ({ ...selection })),
      priceVersion: price.version,
      closesAtLap: row.closes_at_lap ?? undefined,
    }, 'marketOpened');
  }

  async createMarkets(scheduled: PayloadOf<'raceScheduled'>): Promise<void> {
    const race = await one(this.pool, 'SELECT status FROM racing.races WHERE race_id = $1', [scheduled.raceId]);
    if (!race || race.status === 'CANCELLED') return;
    const existing = await one(this.pool, 'SELECT 1 FROM market.markets WHERE race_id = $1 LIMIT 1', [scheduled.raceId]);
    if (existing) return;
    const template = await one(this.pool, 'SELECT version, definition FROM market.market_templates WHERE race_class = $1 AND is_active', [scheduled.raceClass]);
    if (!template) throw new Error(`No active market template for ${scheduled.raceClass}`);
    const specs = expandTemplate(template.definition.markets as TemplateEntry[], scheduled.laps);
    const priced = await oddsEngine.price({
      venueId: scheduled.venueId,
      venueVersion: scheduled.venueVersion,
      species: scheduled.species,
      laps: scheduled.laps,
      engineVersion: scheduled.engineVersion,
      entrants: scheduled.entrants.map((entrant) => ({
        entrantId: entrant.entrantId,
        animalId: entrant.animalId,
        lane: entrant.lane,
        temperament: entrant.temperament,
        stats: entrant.stats ?? { velocity: 0, stamina: 0, acceleration: 0, consistency: 0 },
      })),
      markets: specs.map((spec) => ({ type: spec.type, params: spec.params })),
    });
    await tx(this.pool, async (client) => {
      for (const [index, spec] of specs.entries()) {
        const marketId = newId(0);
        await client.query(
          `INSERT INTO market.markets (market_id, race_id, type, params, status, template_version, opens_rule, closes_rule, closes_at_lap, price_version)
           VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, $8, 1) ON CONFLICT DO NOTHING`,
          [marketId, scheduled.raceId, spec.type, JSON.stringify(spec.params), template.version, JSON.stringify(spec.opensRule), JSON.stringify(spec.closesRule), spec.closesAtLap],
        );
        for (const selection of priced.markets[index]?.selections ?? []) {
          await client.query(
            `INSERT INTO market.selections (selection_id, market_id, race_id, entrant_id, price, probability, price_version) VALUES ($1, $2, $3, $4, $5, $6, 1)`,
            [newId(0), marketId, scheduled.raceId, entrantNumber(selection.entrantId), selection.price, Math.min(1, Math.max(0, selection.probability))],
          );
        }
      }
    });
    log.info('markets created', { raceId: scheduled.raceId, markets: specs.length });
  }

  async onOpened(raceId: string): Promise<void> {
    await tx(this.pool, async (client) => {
      const pending = await many(client, `SELECT market_id FROM market.markets WHERE race_id = $1 AND status = 'PENDING' AND opens_rule->>'at' = 'OPEN' FOR UPDATE`, [raceId]);
      for (const market of pending) {
        await this.openMarket(client, raceId, market.market_id);
        await this.snapshot(client, market.market_id, 'OPENING');
      }
    });
    this.races.delete(raceId);
  }

  async raceStatus(client: Client, raceId: string): Promise<string | null> {
    return (await one(client, 'SELECT status FROM racing.races WHERE race_id = $1', [raceId]))?.status ?? null;
  }

  async onLocked(raceId: string): Promise<void> {
    await tx(this.pool, async (client) => {
      const started = (await this.raceStatus(client, raceId)) !== 'LOCKED';
      const open = await many(client, `SELECT * FROM market.markets WHERE race_id = $1 AND status = 'OPEN' FOR UPDATE`, [raceId]);
      for (const market of open) {
        await this.snapshot(client, market.market_id, 'AT_LOCK');
        if (market.closes_rule?.at === 'LOCK') {
          await client.query(`UPDATE market.markets SET status = 'CLOSED', closed_at = now() WHERE market_id = $1`, [market.market_id]);
          marketTransition(market.type, 'OPEN', 'CLOSED', 'lock');
          await this.publishMarket(client, raceId, market.market_id, { tick: 0 }, 'marketClosed');
        } else if (!started) {
          await client.query(`UPDATE market.markets SET status = 'SUSPENDED', suspend_reason = 'LOCK' WHERE market_id = $1`, [market.market_id]);
          marketTransition(market.type, 'OPEN', 'SUSPENDED', 'lock');
          await this.publishMarket(client, raceId, market.market_id, { tick: 0, reason: 'LOCK' }, 'marketSuspended');
        }
      }
    });
    this.races.delete(raceId);
  }

  async onStarted(raceId: string): Promise<void> {
    await tx(this.pool, async (client) => {
      const locked = await many(client, `SELECT * FROM market.markets WHERE race_id = $1 AND status = 'SUSPENDED' AND suspend_reason = 'LOCK' FOR UPDATE`, [raceId]);
      for (const market of locked) {
        await client.query(`UPDATE market.markets SET status = 'OPEN', suspend_reason = NULL WHERE market_id = $1`, [market.market_id]);
        marketTransition(market.type, 'SUSPENDED', 'OPEN', 'start');
        const price = await readPrice(this.runtime.redis, client, market.market_id);
        await this.publishMarket(client, raceId, market.market_id, { tick: 0, priceVersion: price?.version ?? market.price_version }, 'marketResumed');
      }
      const pending = await many(client, `SELECT market_id, type, closes_rule FROM market.markets WHERE race_id = $1 AND status = 'PENDING' FOR UPDATE`, [raceId]);
      for (const market of pending) {
        if (market.closes_rule?.at === 'LOCK') {
          await client.query(`UPDATE market.markets SET status = 'CLOSED', closed_at = now() WHERE market_id = $1`, [market.market_id]);
          marketTransition(market.type, 'PENDING', 'CLOSED', 'late');
        } else {
          await this.openMarket(client, raceId, market.market_id, 'start');
        }
      }
      const open = await many(client, `SELECT market_id FROM market.markets WHERE race_id = $1 AND status = 'OPEN'`, [raceId]);
      for (const market of open) await this.snapshot(client, market.market_id, 'AT_START');
    });
    this.races.delete(raceId);
  }

  async onTick(tick: PayloadOf<'raceTick'>): Promise<void> {
    const race = await this.raceState(tick.raceId);
    if (!race) return;
    const positions = new Map(tick.entrants.map((entrant) => [entrant.id, entrant.pos]));
    const suspension = suspensionFor(tick.events.map((event) => ({ type: event.type, id: event.id, a: event.a })), positions);
    const changes: { market: MarketState; to: 'CLOSED' | 'SUSPENDED' | 'OPEN' }[] = [];
    for (const market of race.markets.values()) {
      const active = market.status === 'OPEN' || (market.status === 'SUSPENDED' && market.suspendReason !== 'LOCK');
      if (!active || market.type === 'TRICAST') continue;
      if (shouldCloseInRunning(market, tick, race.lapLength, race.tickMs)) {
        changes.push({ market, to: 'CLOSED' });
      } else if (suspension && (market.status === 'OPEN' || market.suspendReason === 'INCIDENT')) {
        market.suspendedUntilTick = Math.max(market.suspendedUntilTick, tick.tick + suspension.ticks);
        if (market.status === 'OPEN') changes.push({ market, to: 'SUSPENDED' });
      } else if (market.status === 'SUSPENDED' && market.suspendReason === 'INCIDENT' && tick.tick >= market.suspendedUntilTick) {
        changes.push({ market, to: 'OPEN' });
      }
    }
    if (changes.length === 0) return;
    await withSpan('market.tick_transition', { root: true, attributes: { 'ars.race_id': tick.raceId, 'ars.tick': tick.tick, 'ars.changes': changes.length } }, () => tx(this.pool, async (client) => {
      for (const change of changes) {
        const { market } = change;
        const reason = change.to === 'CLOSED' ? (market.type === 'LEADER_AT_LAP' ? 'checkpoint' : 'final_lap') : change.to === 'SUSPENDED' ? 'incident' : 'incident_cleared';
        marketTransition(market.type, market.status, change.to, reason);
        if (change.to === 'CLOSED') {
          await client.query(`UPDATE market.markets SET status = 'CLOSED', closed_at = now(), suspend_reason = NULL WHERE market_id = $1 AND status IN ('OPEN', 'SUSPENDED')`, [market.id]);
          await this.publishMarket(client, tick.raceId, market.id, { tick: tick.tick }, 'marketClosed');
          market.status = 'CLOSED';
        } else if (change.to === 'SUSPENDED') {
          await client.query(`UPDATE market.markets SET status = 'SUSPENDED', suspend_reason = 'INCIDENT' WHERE market_id = $1 AND status = 'OPEN'`, [market.id]);
          await this.publishMarket(client, tick.raceId, market.id, { tick: tick.tick, reason: 'INCIDENT' }, 'marketSuspended');
          market.status = 'SUSPENDED';
          market.suspendReason = 'INCIDENT';
        } else {
          await client.query(`UPDATE market.markets SET status = 'OPEN', suspend_reason = NULL WHERE market_id = $1 AND status = 'SUSPENDED'`, [market.id]);
          const price = await readPrice(this.runtime.redis, client, market.id);
          await this.publishMarket(client, tick.raceId, market.id, { tick: tick.tick, priceVersion: price?.version ?? 1 }, 'marketResumed');
          market.status = 'OPEN';
          market.suspendReason = null;
        }
      }
    }));
  }

  async resultMarket(client: Client, raceId: string, market: MarketRow, order: readonly string[], lapLeaders: ReadonlyMap<number, string>): Promise<void> {
    const winners = winningEntrants(market.type, market.params, order, lapLeaders);
    if (winners.length === 0) {
      await this.voidMarket(client, raceId, market.market_id, 'NO_RESULT');
      return;
    }
    const selections = await many(client, 'SELECT selection_id, entrant_id FROM market.selections WHERE market_id = $1', [market.market_id]);
    const byEntrant = new Map(selections.map((row) => [entrantKey(row.entrant_id), row.selection_id as string]));
    const winning = market.type === 'TRICAST' ? [] : winners.map((entrant) => byEntrant.get(entrant)).filter((id): id is string => Boolean(id));
    const resultOrder = market.type === 'TRICAST' ? winners : [];
    await client.query(
      `UPDATE market.markets SET status = 'RESULTED', result = $2, closed_at = coalesce(closed_at, now()), resulted_at = now(), suspend_reason = NULL WHERE market_id = $1`,
      [market.market_id, JSON.stringify({ winning, order: resultOrder, winningEntrants: winners })],
    );
    marketTransition(market.type, market.status, 'RESULTED', 'result');
    await this.publishMarket(client, raceId, market.market_id, { winning, order: resultOrder }, 'marketResulted');
    await this.writeHistory(client, raceId, market.market_id);
  }

  async voidMarket(client: Client, raceId: string, marketId: string, reason: string): Promise<void> {
    const before = await one(client, 'SELECT type, status FROM market.markets WHERE market_id = $1', [marketId]);
    await client.query(`UPDATE market.markets SET status = 'VOID', closed_at = coalesce(closed_at, now()), suspend_reason = NULL WHERE market_id = $1`, [marketId]);
    if (before) marketTransition(before.type, before.status, 'VOID', reason.toLowerCase());
    await this.publishMarket(client, raceId, marketId, { reason }, 'marketVoided');
  }

  async onLapCompleted(lap: PayloadOf<'lapCompleted'>): Promise<void> {
    await tx(this.pool, async (client) => {
      const markets = await many<MarketRow>(
        client,
        `SELECT * FROM market.markets WHERE race_id = $1 AND type = 'LEADER_AT_LAP' AND (params->>'lap')::int = $2 AND status NOT IN ('RESULTED', 'VOID') FOR UPDATE`,
        [lap.raceId, lap.lap],
      );
      for (const market of markets) {
        await this.resultMarket(client, lap.raceId, market, [], new Map([[lap.lap, lap.leaderEntrantId]]));
      }
    });
    this.races.delete(lap.raceId);
  }

  async onFinished(finished: PayloadOf<'raceFinished'>): Promise<void> {
    const lapLeaders = new Map(finished.lapLeaders.map((leader) => [leader.lap, leader.entrantId]));
    await tx(this.pool, async (client) => {
      const markets = await many<MarketRow>(client, `SELECT * FROM market.markets WHERE race_id = $1 AND status NOT IN ('RESULTED', 'VOID') FOR UPDATE`, [finished.raceId]);
      for (const market of markets) await this.resultMarket(client, finished.raceId, market, finished.order, lapLeaders);
      await this.settleIfDone(client, finished.raceId);
    });
    this.races.delete(finished.raceId);
  }

  async settleIfDone(client: Client, raceId: string): Promise<void> {
    const open = await one(client, `SELECT count(*)::int AS n FROM market.markets WHERE race_id = $1 AND status NOT IN ('RESULTED', 'VOID')`, [raceId]);
    if (open!.n === 0) await enqueue(client, 'market', Topics.raceLifecycle, raceId, payload('raceSettled', { raceId }));
  }

  async onCancelled(raceId: string): Promise<void> {
    await tx(this.pool, async (client) => {
      const markets = await many(client, `SELECT market_id FROM market.markets WHERE race_id = $1 AND status NOT IN ('RESULTED', 'VOID') FOR UPDATE`, [raceId]);
      for (const market of markets) await this.voidMarket(client, raceId, market.market_id, 'RACE_CANCELLED');
    });
    this.races.delete(raceId);
  }

  async onPrice(update: PayloadOf<'priceUpdated'>): Promise<void> {
    const ids = update.selections.map((selection) => selection.selectionId);
    await tx(this.pool, async (client) => {
      const bumped = await client.query('UPDATE market.markets SET price_version = $2 WHERE market_id = $1 AND price_version < $2', [update.marketId, update.priceVersion]);
      if (bumped.rowCount === 0) return;
      await client.query(
        `UPDATE market.selections s SET price = v.price, probability = v.probability, price_version = $2
         FROM (SELECT unnest($3::bigint[]) AS id, unnest($4::numeric[]) AS price, unnest($5::numeric[]) AS probability) v
         WHERE s.selection_id = v.id AND s.market_id = $1`,
        [update.marketId, update.priceVersion, ids, update.selections.map((s) => s.price), update.selections.map((s) => Math.min(1, Math.max(0, s.probability)))],
      );
    });
    const key = `ph:${update.marketId}`;
    await this.runtime.redis.rPush(key, JSON.stringify([update.tick, Object.fromEntries(update.selections.map((s) => [s.entrantId, s.price]))]));
    await this.runtime.redis.expire(key, 2 * 86400);
  }

  async writeHistory(client: Client, raceId: string, marketId: string): Promise<void> {
    const key = `ph:${marketId}`;
    const points = (await this.runtime.redis.lRange(key, 0, -1)).map((raw) => JSON.parse(raw) as [number, Record<string, number>]);
    if (points.length === 0) return;
    const ticks = points.map(([tick]) => tick);
    const entrants = [...new Set(points.flatMap(([, prices]) => Object.keys(prices)))];
    const prices = Object.fromEntries(entrants.map((entrant) => [entrant, points.map(([, p]) => p[entrant] ?? null)]));
    const series = zstdCompressSync(Buffer.from(JSON.stringify({ ticks, prices })));
    await client.query(
      `INSERT INTO market.price_history (market_id, race_id, first_tick, step_ticks, points, series, expires_at)
       VALUES ($1, $2, $3, 2, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [marketId, raceId, ticks[0], points.length, series, new Date(Date.now() + settings.priceHistoryRetentionDays * DAY_MS)],
    );
    await this.runtime.redis.del(key);
  }

  async onCommand(command: PayloadOf<'marketCommand'>): Promise<void> {
    await tx(this.pool, async (client) => {
      const market = await one(client, 'SELECT * FROM market.markets WHERE market_id = $1 FOR UPDATE', [command.marketId]);
      if (!market) return;
      if (command.action === 'SUSPEND' && market.status === 'OPEN') {
        await client.query(`UPDATE market.markets SET status = 'SUSPENDED', suspend_reason = 'MANUAL' WHERE market_id = $1`, [market.market_id]);
        marketTransition(market.type, 'OPEN', 'SUSPENDED', 'manual');
        await this.publishMarket(client, market.race_id, market.market_id, { tick: 0, reason: 'MANUAL' }, 'marketSuspended');
      } else if (command.action === 'RESUME' && market.status === 'SUSPENDED') {
        await client.query(`UPDATE market.markets SET status = 'OPEN', suspend_reason = NULL WHERE market_id = $1`, [market.market_id]);
        marketTransition(market.type, 'SUSPENDED', 'OPEN', 'manual');
        const price = await readPrice(this.runtime.redis, client, market.market_id);
        await this.publishMarket(client, market.race_id, market.market_id, { tick: 0, priceVersion: price?.version ?? market.price_version }, 'marketResumed');
      } else if (command.action === 'VOID' && !['RESULTED', 'VOID'].includes(market.status)) {
        await this.voidMarket(client, market.race_id, market.market_id, command.reason || 'MANUAL');
      }
    });
    this.races.delete(command.raceId);
  }
}

export async function start(): Promise<void> {
  const runtime = await bootstrap('market-manager', { outbox: ['market'] });
  const manager = new MarketManager(runtime);
  runtime.consumers.push(await runConsumer({
    kafka: runtime.kafka,
    groupId: 'market-manager',
    topics: [Topics.raceLifecycle, Topics.raceTicks, Topics.raceCommands],
    pool: runtime.pool,
    concurrency: 6,
    attempts: 8,
    handler: async (envelope) => {
      const event = envelope.payload;
      switch (event?.$case) {
        case 'raceScheduled': return manager.createMarkets(event.value);
        case 'raceOpened': return manager.onOpened(event.value.raceId);
        case 'raceLocked': return manager.onLocked(event.value.raceId);
        case 'raceStarted': return manager.onStarted(event.value.raceId);
        case 'raceTick': return manager.onTick(event.value);
        case 'lapCompleted': return manager.onLapCompleted(event.value);
        case 'raceFinished': return manager.onFinished(event.value);
        case 'raceCancelled': return manager.onCancelled(event.value.raceId);
        case 'marketCommand': return manager.onCommand(event.value);
        default: return;
      }
    },
  }));
  runtime.consumers.push(await runConsumer({
    kafka: runtime.kafka,
    groupId: 'market-manager-prices',
    topics: [Topics.marketEvents],
    pool: runtime.pool,
    concurrency: 6,
    handler: async (envelope) => {
      if (envelope.payload?.$case === 'priceUpdated') await manager.onPrice(envelope.payload.value);
    },
  }));
}

