export type MarketType = 'FINISH_POSITION' | 'TOP_N' | 'TRICAST' | 'LEADER_AT_LAP';

export type TemplateEntry = {
  type: MarketType;
  params?: Record<string, number>;
  every?: number;
  opens?: { at: 'OPEN' | 'START' };
  closes?: { atLap?: 'last' | number; at?: 'LOCK'; ticksBeforeCheckpoint?: number };
};

export type MarketSpec = {
  type: MarketType;
  params: Record<string, number>;
  opensAt: 'OPEN' | 'START';
  closesAtLap: number | null;
  closesAtLock: boolean;
  ticksBeforeCheckpoint: number | null;
  opensRule: Record<string, unknown>;
  closesRule: Record<string, unknown>;
};

export type TickEntrantLike = { id: string; dist: number; speed: number; pos: number; state: string };

export const MARKET_TYPES: readonly MarketType[] = ['FINISH_POSITION', 'TOP_N', 'TRICAST', 'LEADER_AT_LAP'];

export function leaderLaps(laps: number, every: number): number[] {
  const result: number[] = [];
  for (let lap = Math.max(1, every); lap < laps; lap += Math.max(1, every)) result.push(lap);
  return result;
}

export function expandTemplate(entries: readonly TemplateEntry[], laps: number): MarketSpec[] {
  const specs: MarketSpec[] = [];
  for (const entry of entries) {
    if (entry.type === 'LEADER_AT_LAP') {
      const ticksBefore = entry.closes?.ticksBeforeCheckpoint ?? 6;
      for (const lap of leaderLaps(laps, entry.every ?? 2)) {
        specs.push({
          type: entry.type,
          params: { lap },
          opensAt: 'START',
          closesAtLap: lap,
          closesAtLock: false,
          ticksBeforeCheckpoint: ticksBefore,
          opensRule: { at: 'START' },
          closesRule: { ticksBeforeCheckpoint: ticksBefore, lap },
        });
      }
      continue;
    }
    const atLap = entry.closes?.atLap;
    const closesAtLap = atLap === 'last' ? laps : typeof atLap === 'number' ? Math.min(atLap, laps) : null;
    specs.push({
      type: entry.type,
      params: { ...(entry.params ?? {}) },
      opensAt: entry.opens?.at === 'START' ? 'START' : 'OPEN',
      closesAtLap,
      closesAtLock: entry.closes?.at === 'LOCK',
      ticksBeforeCheckpoint: null,
      opensRule: { at: entry.opens?.at ?? 'OPEN' },
      closesRule: entry.closes ?? {},
    });
  }
  return specs;
}

export function validateTemplate(entries: unknown): TemplateEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('markets must be a non-empty array');
  return entries.map((raw, index) => {
    const entry = raw as TemplateEntry;
    if (!MARKET_TYPES.includes(entry.type)) throw new Error(`markets[${index}].type is invalid`);
    if (entry.type === 'FINISH_POSITION' && ![1, 2, 3].includes(entry.params?.position ?? 0)) throw new Error(`markets[${index}].params.position must be 1, 2 or 3`);
    if (entry.type === 'TOP_N' && !((entry.params?.n ?? 0) >= 2 && (entry.params?.n ?? 0) <= 5)) throw new Error(`markets[${index}].params.n must be 2..5`);
    if (entry.type === 'LEADER_AT_LAP' && !((entry.every ?? 0) >= 1)) throw new Error(`markets[${index}].every must be ≥ 1`);
    return entry;
  });
}

export function leaderOf(entrants: readonly TickEntrantLike[]): TickEntrantLike | undefined {
  return entrants.find((entrant) => entrant.pos === 1) ?? [...entrants].sort((a, b) => b.dist - a.dist)[0];
}

export function shouldCloseInRunning(
  market: { type: MarketType; closesAtLap: number | null; ticksBeforeCheckpoint: number | null },
  tick: { lap: number; entrants: readonly TickEntrantLike[] },
  lapLength: number,
  tickMs: number,
): boolean {
  if (market.closesAtLap === null) return false;
  if (market.type === 'LEADER_AT_LAP') {
    const leader = leaderOf(tick.entrants);
    if (!leader) return false;
    const checkpoint = market.closesAtLap * lapLength;
    if (leader.dist >= checkpoint) return true;
    const metresPerTick = Math.max(leader.speed, 0.1) * (tickMs / 1000);
    return (checkpoint - leader.dist) / metresPerTick <= (market.ticksBeforeCheckpoint ?? 6);
  }
  return tick.lap >= market.closesAtLap;
}

export const INCIDENT_EVENTS = new Set(['STUMBLE', 'PULLED_UP', 'FALSE_START', 'REFUSED_TO_RUN']);

export function suspensionFor(
  events: readonly { type: string; id?: string | undefined; a?: string | undefined }[],
  positions: ReadonlyMap<string, number>,
): { reason: 'INCIDENT'; ticks: number } | null {
  if (events.some((event) => INCIDENT_EVENTS.has(event.type))) return { reason: 'INCIDENT', ticks: 4 };
  const topOvertake = events.some((event) => event.type === 'OVERTAKE' && event.a !== undefined && (positions.get(event.a) ?? 99) <= 3);
  return topOvertake ? { reason: 'INCIDENT', ticks: 2 } : null;
}

export function winningEntrants(type: MarketType, params: Record<string, number>, order: readonly string[], lapLeaders: ReadonlyMap<number, string>): string[] {
  switch (type) {
    case 'FINISH_POSITION': {
      const entrant = order[(params.position ?? 1) - 1];
      return entrant ? [entrant] : [];
    }
    case 'TOP_N':
      return order.slice(0, params.n ?? 3);
    case 'TRICAST':
      return order.slice(0, 3);
    case 'LEADER_AT_LAP': {
      const leader = lapLeaders.get(params.lap ?? 0);
      return leader ? [leader] : [];
    }
  }
}

export type LegSelection = { entrantId?: string | null; order?: readonly string[] | null };

export function legWins(type: MarketType, selection: LegSelection, winning: readonly string[], order: readonly string[]): boolean {
  if (type === 'TRICAST') {
    const picked = selection.order ?? [];
    return picked.length === 3 && picked.every((entrant, index) => order[index] === entrant);
  }
  return selection.entrantId !== undefined && selection.entrantId !== null && winning.includes(selection.entrantId);
}
