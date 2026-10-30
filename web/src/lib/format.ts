import type { BetLeg, BetSelection, Entrant, Market, MarketType, RaceClass, RaceStatus, Stats } from './types';

const pointsFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const fmtPoints = (value: number | null | undefined) => (value === null || value === undefined ? '—' : pointsFormat.format(Math.round(value)));

export const fmtPrice = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(2));

export function fmtSigned(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${fmtPoints(Math.abs(value))}`;
}

export function fmtCountdown(ms: number): string {
  if (ms <= 0) return '0s';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtRaceTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const minutes = Math.floor(ms / 60000);
  const seconds = (ms % 60000) / 1000;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

export function fmtRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diff = now - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const unit = abs < 60_000 ? `${Math.max(1, Math.round(abs / 1000))}s` : abs < 3_600_000 ? `${Math.round(abs / 60_000)}m` : abs < 86_400_000 ? `${Math.round(abs / 3_600_000)}h` : `${Math.round(abs / 86_400_000)}d`;
  return future ? `in ${unit}` : `${unit} ago`;
}

export function shortHash(hash: string | null | undefined, size = 8): string {
  if (!hash) return '—';
  return hash.length <= size * 2 ? hash : `${hash.slice(0, size)}…${hash.slice(-size / 2)}`;
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

export const titleCase = (value: string) => value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const CLASS_LABEL: Record<RaceClass, string> = { SPRINT: 'Sprint', STANDARD: 'Standard', ENDURANCE: 'Endurance' };

export const STATUS_LABEL: Record<RaceStatus, string> = {
  SCHEDULED: 'Scheduled',
  OPEN: 'Open',
  LOCKED: 'Locked',
  LIVE: 'Live',
  FINISHED: 'Finished',
  SETTLED: 'Settled',
  CANCELLED: 'Cancelled',
};

export const SPECIES_ICON: Record<string, string> = { HORSE: '🐎', GIRAFFE: '🦒' };

export const TEMPERAMENT_LABEL: Record<string, string> = {
  FRONT_RUNNER: 'Front-runner',
  STALKER: 'Stalker',
  CLOSER: 'Closer',
  STEADY: 'Steady',
};

export function marketLabel(type: MarketType | string, params: Record<string, number> | undefined): string {
  const p = params ?? {};
  switch (type) {
    case 'FINISH_POSITION':
      return p.position === 1 ? 'Win' : `Finish ${ordinal(p.position ?? 1)}`;
    case 'TOP_N':
      return `Top ${p.n ?? 3}`;
    case 'TRICAST':
      return 'Tricast';
    case 'LEADER_AT_LAP':
      return `Leader after lap ${p.lap ?? '?'}`;
    default:
      return titleCase(String(type));
  }
}

export function marketLabelOf(market: Pick<Market, 'type' | 'params'>): string {
  return marketLabel(market.type, market.params);
}

export function entrantName(entrants: Entrant[] | undefined, entrantId: string): string {
  const entrant = entrants?.find((e) => e.entrantId === entrantId);
  return entrant ? entrant.animal.name : entrantId;
}

export function laneOf(entrants: Entrant[] | undefined, entrantId: string): number | null {
  return entrants?.find((e) => e.entrantId === entrantId)?.lane ?? null;
}

export function selectionLabel(selection: BetSelection, entrants?: Entrant[]): string {
  if ('order' in selection) return selection.order.map((id) => entrantName(entrants, id)).join(' → ');
  return entrantName(entrants, selection.entrantId);
}

export function legPrice(leg: BetLeg): number {
  return leg.lockedPrice ?? leg.acceptedPrice;
}

export function statPct(key: keyof Stats, value: number): number {
  const ranges: Record<keyof Stats, [number, number]> = {
    velocity: [11, 18],
    stamina: [40, 100],
    acceleration: [1.5, 5],
    consistency: [0.4, 1],
  };
  const [min, max] = ranges[key];
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function fmtStat(key: keyof Stats, value: number): string {
  if (key === 'velocity') return `${value.toFixed(1)} m/s`;
  if (key === 'acceleration') return `${value.toFixed(2)} m/s²`;
  if (key === 'consistency') return value.toFixed(2);
  return value.toFixed(0);
}

export const STAT_LABEL: Record<keyof Stats, string> = { velocity: 'Speed', stamina: 'Stamina', acceleration: 'Accel', consistency: 'Consistency' };

export function formClass(entry: string): string {
  if (entry === '1') return 'form-win';
  if (entry === '2' || entry === '3') return 'form-place';
  if (/^\d+$/.test(entry)) return 'form-other';
  return 'form-bad';
}
