import { publishBet, publishCashoutRejected, refreshWallet, toast, unreadStore } from '../lib/app';
import type { Bet, Market, Notification, Race, RaceTick, Selection, TickEvent } from '../lib/types';
import { notificationText } from '../lib/notifications';

export type CashoutLive = { amount: number; quoteId: string; expiresAtTick: number | null; at: number };
export type FeedItem = { seq: number; tick: number; event: TickEvent };
export type Connection = 'connecting' | 'open' | 'reconnecting';

export type RaceStreamState = {
  race: Race | null;
  tick: RaceTick | null;
  markets: Market[];
  myBets: Bet[];
  cashouts: Record<string, CashoutLive>;
  feed: FeedItem[];
  connection: Connection;
  snapshotSeq: number;
  resultVersion: number;
  lastLap: { lap: number; leaderEntrantId: string; standings: string[] } | null;
};

type TickListener = (tick: RaceTick | null, kind: 'snapshot' | 'tick') => void;

const TYPE_ORDER: Record<string, number> = { FINISH_POSITION: 1, TOP_N: 2, LEADER_AT_LAP: 3, TRICAST: 4 };
const paramKey = (market: Market) => market.params.position ?? market.params.n ?? market.params.lap ?? 0;

export function sortMarkets(markets: Market[]): Market[] {
  return [...markets].sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || paramKey(a) - paramKey(b));
}

const BACKOFF = [500, 1000, 2000, 5000];
const FEED_LIMIT = 80;

export class RaceStream {
  readonly raceId: string;
  state: RaceStreamState;
  private es: EventSource | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private lastEventAt = 0;
  private stopped = false;
  private feedSeq = 0;
  private listeners = new Set<() => void>();
  private tickListeners = new Set<TickListener>();

  constructor(raceId: string) {
    this.raceId = raceId;
    this.state = {
      race: null,
      tick: null,
      markets: [],
      myBets: [],
      cashouts: {},
      feed: [],
      connection: 'connecting',
      snapshotSeq: 0,
      resultVersion: 0,
      lastLap: null,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): RaceStreamState => this.state;

  onTick(listener: TickListener): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  private set(patch: Partial<RaceStreamState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  seed(race: Race, markets: Market[] | null, myBets: Bet[] | null): void {
    if (this.state.snapshotSeq > 0) return;
    this.set({
      race,
      markets: markets ? sortMarkets(markets) : this.state.markets,
      myBets: myBets ?? this.state.myBets,
    });
  }

  mergeRace(race: Race): void {
    const current = this.state.race;
    if (!current || current.id !== race.id) return;
    this.set({ race: { ...race, status: current.status === 'SETTLED' ? current.status : race.status } });
  }

  upsertBet(bet: Bet): void {
    if (!bet.legs.some((leg) => leg.raceId === this.raceId)) return;
    const others = this.state.myBets.filter((b) => b.id !== bet.id);
    const cashouts = { ...this.state.cashouts };
    if (bet.status !== 'ACCEPTED') delete cashouts[bet.id];
    this.set({ myBets: [bet, ...others].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)), cashouts });
  }

  start(): void {
    this.stopped = false;
    this.connect();
    this.watchdog = setInterval(() => {
      if (this.es && Date.now() - this.lastEventAt > 35_000) {
        this.es.close();
        this.es = null;
        this.scheduleReconnect();
      }
    }, 5000);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.watchdog);
    this.es?.close();
    this.es = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)]!;
    this.attempt += 1;
    this.set({ connection: 'reconnecting' });
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private connect(): void {
    if (this.stopped) return;
    if (this.state.connection !== 'reconnecting') this.set({ connection: 'connecting' });
    const es = new EventSource(`/v1/races/${encodeURIComponent(this.raceId)}/stream`);
    this.es = es;
    this.lastEventAt = Date.now();
    const on = <T,>(name: string, handler: (data: T) => void) => {
      es.addEventListener(name, (event) => {
        if (this.es !== es) return;
        this.lastEventAt = Date.now();
        let data: T;
        try {
          data = JSON.parse((event as MessageEvent<string>).data) as T;
        } catch {
          return;
        }
        handler(data);
      });
    };
    on('snapshot', (data: { race: Race; tick: RaceTick | null; markets: Market[]; myBets: Bet[] }) => this.onSnapshot(data));
    on('race.lifecycle', (data: { status: Race['status']; at: string; order?: string[]; reason?: string }) => this.onLifecycle(data));
    on('race.tick', (data: RaceTick) => this.onRaceTick(data));
    on('race.lap', (data: { lap: number; leaderEntrantId: string; standings: string[] }) => this.set({ lastLap: data }));
    on('market.opened', (data: Market) => this.onMarketOpened(data));
    on('market.price', (data: { marketId: string; priceVersion: number; tick: number; selections: Selection[] }) => this.onPrice(data));
    on('market.suspended', (data: { marketId: string }) => this.patchMarket(data.marketId, { status: 'SUSPENDED' }));
    on('market.resumed', (data: { marketId: string; priceVersion?: number }) =>
      this.patchMarket(data.marketId, data.priceVersion ? { status: 'OPEN', priceVersion: Math.max(data.priceVersion, this.marketById(data.marketId)?.priceVersion ?? 0) } : { status: 'OPEN' }),
    );
    on('market.closed', (data: { marketId: string }) => this.patchMarket(data.marketId, { status: 'CLOSED' }));
    on('market.resulted', (data: { marketId: string; winning: string[]; order: string[] }) => {
      this.patchMarket(data.marketId, { status: 'RESULTED', result: { winning: data.winning ?? [], order: data.order ?? [] } });
      this.set({ resultVersion: this.state.resultVersion + 1 });
    });
    on('market.voided', (data: { marketId: string }) => this.patchMarket(data.marketId, { status: 'VOID' }));
    on('bet.updated', (bet: Bet) => {
      this.upsertBet(bet);
      publishBet(bet);
    });
    on('cashout.updated', (data: { betId: string; amount: number; quoteId: string; expiresAtTick: number | null }) => {
      this.set({ cashouts: { ...this.state.cashouts, [data.betId]: { ...data, at: Date.now() } } });
    });
    on('notification', (data: { notification: Notification; unreadCount: number | null }) => {
      if (typeof data.unreadCount === 'number') unreadStore.set(data.unreadCount);
      else unreadStore.set((n) => n + 1);
      toast(notificationText(data.notification), data.notification.type === 'BET_WON' || data.notification.type === 'CASHOUT_DONE' ? 'success' : 'info');
      if (/^(BET_|CASHOUT_)/.test(data.notification.type)) refreshWallet(200);
      if (data.notification.type === 'CASHOUT_REJECTED') publishCashoutRejected(String(data.notification.payload?.betId ?? ''), String(data.notification.payload?.reason ?? ''));
    });
    es.onerror = () => {
      if (this.es !== es) return;
      es.close();
      this.es = null;
      this.scheduleReconnect();
    };
  }

  private marketById(id: string): Market | undefined {
    return this.state.markets.find((market) => market.id === id);
  }

  private onSnapshot(data: { race: Race; tick: RaceTick | null; markets: Market[]; myBets: Bet[] }): void {
    this.attempt = 0;
    const feed: FeedItem[] = (data.tick?.events ?? []).map((event) => ({ seq: ++this.feedSeq, tick: data.tick!.tick, event }));
    this.set({
      race: data.race,
      tick: data.tick,
      markets: sortMarkets(data.markets ?? []),
      myBets: data.myBets ?? [],
      cashouts: {},
      feed,
      connection: 'open',
      snapshotSeq: this.state.snapshotSeq + 1,
      resultVersion: this.state.resultVersion + 1,
      lastLap: null,
    });
    for (const listener of this.tickListeners) listener(data.tick, 'snapshot');
  }

  private onLifecycle(data: { status: Race['status']; at: string; order?: string[]; reason?: string }): void {
    const race = this.state.race;
    if (!race) return;
    const next: Race = { ...race, status: data.status };
    if (data.status === 'LIVE') next.startedAt = race.startedAt ?? data.at;
    if (data.status === 'FINISHED') {
      next.finishedAt = data.at;
      if (data.order?.length) next.result = data.order;
    }
    if (data.status === 'CANCELLED') next.cancelledReason = data.reason ?? race.cancelledReason ?? 'CANCELLED';
    this.set({ race: next, resultVersion: this.state.resultVersion + 1 });
  }

  private onRaceTick(tick: RaceTick): void {
    if (this.state.tick && tick.tick <= this.state.tick.tick) return;
    const race = this.state.race;
    const nextRace = race ? { ...race, status: race.status === 'LOCKED' || race.status === 'OPEN' || race.status === 'SCHEDULED' ? 'LIVE' as const : race.status, currentTick: tick.tick, currentLap: tick.lap } : race;
    const added = (tick.events ?? []).map((event) => ({ seq: ++this.feedSeq, tick: tick.tick, event }));
    const feed = added.length ? [...this.state.feed, ...added].slice(-FEED_LIMIT) : this.state.feed;
    this.set({ tick, race: nextRace, feed });
    for (const listener of this.tickListeners) listener(tick, 'tick');
  }

  private onMarketOpened(market: Market): void {
    if (!market) return;
    const others = this.state.markets.filter((m) => m.id !== market.id);
    this.set({ markets: sortMarkets([...others, market]) });
  }

  private onPrice(data: { marketId: string; priceVersion: number; selections: Selection[] }): void {
    const market = this.marketById(data.marketId);
    if (!market || data.priceVersion < market.priceVersion) return;
    this.patchMarket(data.marketId, { priceVersion: data.priceVersion, selections: data.selections ?? market.selections });
  }

  private patchMarket(marketId: string, patch: Partial<Market>): void {
    if (!this.marketById(marketId)) return;
    this.set({ markets: this.state.markets.map((market) => (market.id === marketId ? { ...market, ...patch } : market)) });
  }
}
