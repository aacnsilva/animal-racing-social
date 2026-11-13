import { ANIMALS, gridPosition, mulberry, type GridEntry } from './roster';
import { ROAD_HALF, type Track } from './tracks';

const DT = 0.1;
const CORNER_GRIP = 34;
const BRAKE = 20;

export type BotPlan = {
  s: Float32Array;
  steps: number;
  finishMs: number;
  startLat: number;
  baseLat: number;
  amp: number;
  freq: number;
  phase: number;
  surges: [number, number][];
};

export type BotState = { s: number; lat: number; speed: number; boosting: boolean };

function lapProfile(track: Track, top: number, accel: number): Float32Array {
  const n = track.n;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.min(top, Math.sqrt(CORNER_GRIP / Math.max(1e-4, Math.abs(track.k[i]))));
  const ds = track.spacing;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n * 2 - 1; i >= 0; i--) {
      const a = i % n;
      const b = (i + 1) % n;
      v[a] = Math.min(v[a], Math.sqrt(v[b] * v[b] + 2 * BRAKE * ds));
    }
    for (let i = 0; i < n * 2; i++) {
      const a = (i + 1) % n;
      const b = i % n;
      v[a] = Math.min(v[a], Math.sqrt(v[b] * v[b] + 2 * accel * 0.6 * ds));
    }
  }
  return v;
}

export function planBot(track: Track, laps: number, seed: number, entry: GridEntry): BotPlan {
  const random = mulberry(seed ^ Math.imul(entry.slot + 1, 0x9e3779b1));
  const stats = ANIMALS[entry.species];
  const top = stats.top * entry.skill;
  const profile = lapProfile(track, top, stats.accel);
  const grid = gridPosition(entry.slot);
  const distance = laps * track.length;
  const surges: [number, number][] = [];
  const surgeCount = 1 + Math.floor(random() * (laps + 1));
  for (let i = 0; i < surgeCount; i++) {
    const from = (0.08 + random() * 0.84) * distance;
    surges.push([from, from + 60 + random() * 50]);
  }
  const wobbleFreq = 0.011 + random() * 0.012;
  const wobblePhase = random() * Math.PI * 2;
  const reaction = 0.1 + random() * 0.3 + (1 - entry.skill) * 0.8;
  const out: number[] = [];
  let s = grid.s;
  let speed = 0;
  let time = 0;
  let finish = -1;
  const limit = (distance / (top * 0.45) + 30) / DT;
  while (out.length < limit) {
    out.push(s);
    if (finish >= 0 && time > finish + 9) break;
    if (time >= reaction) {
      const index = track.wrap(Math.round(s / track.spacing));
      let target = profile[index] * (1 + 0.025 * Math.sin(s * wobbleFreq + wobblePhase));
      let surging = false;
      for (const [from, to] of surges) if (s >= from && s <= to) surging = true;
      if (surging) target *= 1.13;
      if (finish >= 0) target = Math.min(target, top * 0.55);
      if (speed < target) speed = Math.min(target, speed + stats.accel * 1.3 * (1.15 - speed / (top * 1.2)) * DT);
      else speed = Math.max(target, speed - BRAKE * DT);
      const next = s + speed * DT;
      if (finish < 0 && next >= distance) finish = time + ((distance - s) / Math.max(0.01, speed)) * 1;
      s = next;
    }
    time += DT;
  }
  return {
    s: Float32Array.from(out),
    steps: out.length,
    finishMs: finish >= 0 ? Math.round(finish * 1000) : Number.POSITIVE_INFINITY,
    startLat: grid.lat,
    baseLat: (random() * 2 - 1) * (ROAD_HALF - 3.2),
    amp: 0.8 + random() * 1.6,
    freq: 0.006 + random() * 0.008,
    phase: random() * Math.PI * 2,
    surges,
  };
}

export function botAt(plan: BotPlan, track: Track, time: number, out: BotState): BotState {
  const f = Math.max(0, Math.min(plan.steps - 1.001, time / DT));
  const i = Math.floor(f);
  const u = f - i;
  const a = plan.s[i];
  const b = plan.s[Math.min(plan.steps - 1, i + 1)];
  const s = a + (b - a) * u;
  out.s = s;
  out.speed = (b - a) / DT;
  const blend = Math.min(1, Math.max(0, (s + 8) / 90));
  const ease = blend * blend * (3 - 2 * blend);
  const corner = Math.max(-2.2, Math.min(2.2, track.curvatureAt(s + 14) * 90));
  const line = plan.baseLat + plan.amp * Math.sin(s * plan.freq + plan.phase) + corner;
  const racing = Math.max(-(ROAD_HALF - 1.6), Math.min(ROAD_HALF - 1.6, line));
  out.lat = plan.startLat + (racing - plan.startLat) * ease;
  out.boosting = false;
  for (const [from, to] of plan.surges) if (s >= from && s <= to) out.boosting = true;
  return out;
}
