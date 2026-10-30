import type { EntrantState, RaceTick, TickEntrant } from '../lib/types';

export type FrameEntrant = {
  id: string;
  dist: number;
  lane: number;
  speed: number;
  staminaPct: number;
  state: EntrantState;
  pos: number;
  finishedForMs: number | null;
  finishSpeed: number;
};

export type Frame = { tick: number; lap: number; timeMs: number; entrants: FrameEntrant[] };

export interface FrameSource {
  frame(now: number): Frame | null;
}

type FinishInfo = { tick: number; speed: number };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function blend(
  from: Map<string, TickEntrant> | null,
  to: RaceTick,
  alpha: number,
  tickMs: number,
  finishes: Map<string, FinishInfo>,
): Frame {
  const tickFloat = to.tick - 1 + alpha;
  const timeMs = Math.max(0, tickFloat * tickMs);
  const entrants = to.entrants.map((target) => {
    const source = from?.get(target.id) ?? target;
    const finish = finishes.get(target.id);
    return {
      id: target.id,
      dist: lerp(source.dist, target.dist, alpha),
      lane: lerp(source.lane, target.lane, alpha),
      speed: lerp(source.speed, target.speed, alpha),
      staminaPct: lerp(source.staminaPct, target.staminaPct, alpha),
      state: target.state,
      pos: target.pos,
      finishedForMs: finish ? Math.max(0, timeMs - finish.tick * tickMs) : null,
      finishSpeed: finish?.speed ?? 0,
    };
  });
  return { tick: to.tick, lap: to.lap, timeMs, entrants };
}

const byId = (tick: RaceTick) => new Map(tick.entrants.map((entrant) => [entrant.id, entrant]));

function recordFinishes(finishes: Map<string, FinishInfo>, previous: RaceTick | null, tick: RaceTick): void {
  const prev = previous ? byId(previous) : null;
  for (const entrant of tick.entrants) {
    if (entrant.state !== 'FINISHED' || finishes.has(entrant.id)) continue;
    const before = prev?.get(entrant.id);
    finishes.set(entrant.id, { tick: before && before.state !== 'FINISHED' ? tick.tick : Math.max(0, tick.tick - 12), speed: Math.max(before?.speed ?? 0, entrant.speed, 8) });
  }
}

export class LivePlayback implements FrameSource {
  private tickMs: number;
  private queue: RaceTick[] = [];
  private from: Map<string, TickEntrant> | null = null;
  private to: RaceTick | null = null;
  private last: RaceTick | null = null;
  private segmentStart = 0;
  private finishes = new Map<string, FinishInfo>();

  constructor(tickMs: number) {
    this.tickMs = tickMs || 500;
  }

  reset(tick: RaceTick | null): void {
    this.queue = [];
    this.from = null;
    this.to = tick;
    this.last = tick;
    this.finishes.clear();
    if (tick) recordFinishes(this.finishes, null, tick);
    this.segmentStart = performance.now() - this.tickMs;
  }

  push(tick: RaceTick): void {
    const newest = this.queue[this.queue.length - 1] ?? this.to;
    if (newest && tick.tick <= newest.tick) return;
    recordFinishes(this.finishes, this.last, tick);
    this.last = tick;
    if (!this.to) {
      this.to = tick;
      this.segmentStart = performance.now() - this.tickMs;
      return;
    }
    this.queue.push(tick);
  }

  frame(now: number): Frame | null {
    if (!this.to) return null;
    if (this.queue.length > 3) {
      const keep = this.queue.slice(-2);
      this.from = byId(keep[0]!);
      this.to = keep[1]!;
      this.queue = [];
      this.segmentStart = now;
    }
    let alpha = (now - this.segmentStart) / this.tickMs;
    while (alpha >= 1 && this.queue.length) {
      this.from = byId(this.to);
      this.to = this.queue.shift()!;
      this.segmentStart = now - this.segmentStart - this.tickMs > this.tickMs * 0.5 ? now : this.segmentStart + this.tickMs;
      alpha = (now - this.segmentStart) / this.tickMs;
    }
    return blend(this.from, this.to, Math.max(0, Math.min(1, alpha)), this.tickMs, this.finishes);
  }
}

export class StaticPlayback implements FrameSource {
  private value: Frame;

  constructor(entrants: { id: string; lane: number; dist?: number; state?: EntrantState; pos?: number }[]) {
    this.value = {
      tick: 0,
      lap: 1,
      timeMs: 0,
      entrants: entrants.map((entrant, index) => ({
        id: entrant.id,
        dist: entrant.dist ?? 0,
        lane: entrant.lane,
        speed: 0,
        staminaPct: 100,
        state: entrant.state ?? 'RUNNING',
        pos: entrant.pos ?? index + 1,
        finishedForMs: entrant.state === 'FINISHED' ? 60_000 : null,
        finishSpeed: 10,
      })),
    };
  }

  frame(): Frame {
    return this.value;
  }
}

export class ReplayPlayback implements FrameSource {
  readonly ticks: RaceTick[];
  readonly tickMs: number;
  readonly durationMs: number;
  private finishes = new Map<string, FinishInfo>();
  private clockMs = 0;
  private playing = false;
  private lastNow = 0;
  speed = 1;
  private listeners = new Set<() => void>();
  private lastNotifiedTick = -1;

  constructor(ticks: RaceTick[], tickMs: number) {
    this.ticks = [...ticks].sort((a, b) => a.tick - b.tick);
    this.tickMs = tickMs || 500;
    const first = this.ticks[0]?.tick ?? 0;
    const lastTick = this.ticks[this.ticks.length - 1]?.tick ?? 0;
    this.durationMs = (lastTick - first) * this.tickMs;
    let previous: RaceTick | null = null;
    for (const tick of this.ticks) {
      recordFinishes(this.finishes, previous, tick);
      previous = tick;
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get positionMs(): number {
    return this.clockMs;
  }

  play(): void {
    if (this.clockMs >= this.durationMs) this.clockMs = 0;
    this.playing = true;
    this.lastNow = performance.now();
    this.notify();
  }

  pause(): void {
    this.playing = false;
    this.notify();
  }

  seek(ms: number): void {
    this.clockMs = Math.max(0, Math.min(this.durationMs, ms));
    this.lastNow = performance.now();
    this.notify();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.notify();
  }

  tickAt(ms: number): RaceTick | null {
    if (!this.ticks.length) return null;
    const index = Math.min(this.ticks.length - 1, Math.max(0, Math.floor(ms / this.tickMs)));
    return this.ticks[index]!;
  }

  frame(now: number): Frame | null {
    if (!this.ticks.length) return null;
    if (this.playing) {
      this.clockMs += (now - this.lastNow) * this.speed;
      if (this.clockMs >= this.durationMs) {
        this.clockMs = this.durationMs;
        this.playing = false;
        this.notify();
      }
    }
    this.lastNow = now;
    const exact = this.clockMs / this.tickMs;
    const index = Math.min(this.ticks.length - 1, Math.floor(exact));
    const next = this.ticks[Math.min(this.ticks.length - 1, index + 1)]!;
    const current = this.ticks[index]!;
    const alpha = index + 1 >= this.ticks.length ? 1 : exact - index;
    if (index !== this.lastNotifiedTick) {
      this.lastNotifiedTick = index;
      this.notify();
    }
    const frame = blend(byId(current), next, alpha, this.tickMs, this.finishes);
    return frame;
  }
}
