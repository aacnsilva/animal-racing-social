import * as THREE from 'three';
import { LANE_WIDTH, TrackPath } from '../lib/track';
import type { Segment } from '../lib/types';

export type TrackId = 'meadow' | 'dunes' | 'reef' | 'aurora';
export type Habitat = 'TERRAIN' | 'AQUATIC';

export type Surface = 'GRASS' | 'SAND' | 'ICE' | 'OPEN_SEA';

export type Card = { top: string; mid: string; bottom: string; accent: string };

export type TrackDef = {
  id: TrackId;
  name: string;
  tagline: string;
  habitat: Habitat;
  grade: string;
  scale: number;
  points: [number, number][];
  pads: [number, number][];
  treats: [number, number][];
  surface: Surface;
  card: Card;
};

export const LANES = 12;
export const ROAD_HALF = (LANES * LANE_WIDTH) / 2;
export const WALL_AT = ROAD_HALF + 0.6;
const SPACING = 1.5;

export const TRACKS: TrackDef[] = [
  {
    id: 'meadow',
    name: 'Clover Meadow',
    tagline: 'Wide, flowing and forgiving. A perfect first gallop.',
    habitat: 'TERRAIN',
    grade: 'Easy',
    scale: 0.9,
    points: [
      [0, 0],
      [90, 0],
      [165, 18],
      [212, 75],
      [205, 150],
      [150, 198],
      [80, 185],
      [28, 150],
      [-35, 158],
      [-88, 205],
      [-165, 212],
      [-225, 165],
      [-238, 85],
      [-200, 22],
      [-130, 0],
      [-60, 0],
    ],
    pads: [
      [0.07, 0],
      [0.33, -3],
      [0.58, 3],
      [0.84, 0],
    ],
    treats: [
      [0.14, 4],
      [0.24, -4],
      [0.42, 0],
      [0.5, 4],
      [0.67, -3],
      [0.76, 3],
      [0.93, -4],
    ],
    surface: 'GRASS',
    card: { top: '#3f86d8', mid: '#bfe1f7', bottom: '#4f9a3f', accent: '#ffd34d' },
  },
  {
    id: 'dunes',
    name: 'Scorpion Dunes',
    tagline: 'Hairpins at sunset. Brake late, boost early.',
    habitat: 'TERRAIN',
    grade: 'Technical',
    scale: 0.8,
    points: [
      [0, 0],
      [40, 0],
      [85, 0],
      [150, 12],
      [188, 58],
      [170, 112],
      [112, 122],
      [62, 100],
      [18, 122],
      [12, 178],
      [62, 212],
      [135, 205],
      [192, 235],
      [200, 300],
      [150, 345],
      [75, 335],
      [20, 290],
      [-45, 262],
      [-120, 285],
      [-185, 250],
      [-200, 180],
      [-150, 135],
      [-95, 100],
      [-112, 48],
      [-170, 55],
      [-226, 30],
      [-232, -22],
      [-180, -40],
      [-125, -12],
      [-65, 0],
    ],
    pads: [
      [0.05, 0],
      [0.3, 0],
      [0.52, -3],
      [0.74, 3],
    ],
    treats: [
      [0.11, 3],
      [0.2, -3],
      [0.37, 0],
      [0.45, 4],
      [0.6, -4],
      [0.68, 0],
      [0.83, 3],
      [0.92, -3],
    ],
    surface: 'SAND',
    card: { top: '#5a6fb0', mid: '#f3b27a', bottom: '#d9a55c', accent: '#ff8a3d' },
  },
  {
    id: 'reef',
    name: 'Coral Deep',
    tagline: 'A sea-floor run beneath the waves. Bubbles provided.',
    habitat: 'AQUATIC',
    grade: 'Flowing',
    scale: 0.76,
    points: [
      [0, 0],
      [40, 0],
      [80, 0],
      [150, -22],
      [215, 5],
      [240, 70],
      [205, 130],
      [140, 140],
      [95, 185],
      [110, 250],
      [60, 300],
      [-10, 290],
      [-45, 235],
      [-20, 175],
      [-60, 125],
      [-125, 130],
      [-165, 185],
      [-230, 195],
      [-275, 145],
      [-262, 75],
      [-205, 35],
      [-140, 15],
      [-70, 0],
    ],
    pads: [
      [0.06, 0],
      [0.27, 3],
      [0.49, -3],
      [0.7, 0],
      [0.9, 0],
    ],
    treats: [
      [0.12, -4],
      [0.19, 4],
      [0.35, 0],
      [0.42, -3],
      [0.57, 3],
      [0.64, -3],
      [0.79, 4],
      [0.85, -4],
    ],
    surface: 'OPEN_SEA',
    card: { top: '#0a3a6a', mid: '#1a86a8', bottom: '#2f7f8a', accent: '#5ff2d6' },
  },
  {
    id: 'aurora',
    name: 'Frostbite Ridge',
    tagline: 'Hard ice under a low winter sun. Flat out and fearless.',
    habitat: 'TERRAIN',
    grade: 'Fast',
    scale: 0.76,
    points: [
      [0, 0],
      [110, 0],
      [215, 0],
      [282, 30],
      [305, 95],
      [270, 155],
      [200, 165],
      [140, 140],
      [80, 165],
      [60, 230],
      [100, 290],
      [70, 350],
      [0, 368],
      [-70, 335],
      [-95, 265],
      [-150, 215],
      [-225, 225],
      [-290, 185],
      [-305, 110],
      [-265, 45],
      [-190, 10],
      [-95, 0],
    ],
    pads: [
      [0.04, 0],
      [0.22, -3],
      [0.41, 3],
      [0.63, 0],
      [0.86, 0],
    ],
    treats: [
      [0.1, 4],
      [0.16, -4],
      [0.3, 0],
      [0.36, 3],
      [0.5, -3],
      [0.56, 3],
      [0.72, -4],
      [0.78, 4],
      [0.94, 0],
    ],
    surface: 'ICE',
    card: { top: '#6f9fd8', mid: '#f3dcc8', bottom: '#e4eef8', accent: '#3df0ff' },
  },
];

export function trackDef(id: string): TrackDef {
  return TRACKS.find((track) => track.id === id) ?? TRACKS[0];
}

export type Pose = { x: number; z: number; heading: number; tx: number; tz: number; nx: number; nz: number };

function referenceSegments(def: TrackDef): Segment[] {
  const curve = new THREE.CatmullRomCurve3(
    def.points.map(([x, z]) => new THREE.Vector3(x * def.scale, 0, z * def.scale)),
    true,
    'centripetal',
  );
  curve.arcLengthDivisions = def.points.length * 60;
  const count = Math.round(curve.getLength());
  const spaced = curve.getSpacedPoints(count).slice(0, count);
  const tangent = (i: number): [number, number] => {
    const a = spaced[(i - 1 + count) % count];
    const b = spaced[(i + 1) % count];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return [(b.x - a.x) / len, (b.z - a.z) / len];
  };
  let turned = 0;
  for (let i = 0; i < count; i++) {
    const [ax, az] = tangent(i);
    const [bx, bz] = tangent(i + 1);
    turned += Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
  }
  const winding = turned < 0 ? -1 : 1;
  const shift = ((LANES - 1) * LANE_WIDTH) / 2;
  const line = spaced.map((p, i) => {
    const [tx, tz] = tangent(i);
    return { x: p.x - winding * tz * shift, z: p.z + winding * tx * shift };
  });
  const heading = (i: number): [number, number] => {
    const a = line[(i - 1 + count) % count];
    const b = line[(i + 1) % count];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return [(b.x - a.x) / len, (b.z - a.z) / len];
  };
  const segments: Segment[] = [];
  let straight = 0;
  for (let i = 0; i < count; i++) {
    const a = line[i];
    const b = line[(i + 1) % count];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const [ax, az] = heading(i);
    const [bx, bz] = heading(i + 1);
    const turn = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    if (Math.abs(turn) < 2e-4) {
      straight += length;
      continue;
    }
    if (straight > 0) segments.push({ type: 'STRAIGHT', length: straight });
    straight = 0;
    segments.push({ type: 'CURVE', radius: length / Math.abs(turn), angle: (turn * 180) / Math.PI });
  }
  if (straight > 0) segments.push({ type: 'STRAIGHT', length: straight });
  return segments;
}

export class Track {
  readonly def: TrackDef;
  readonly path: TrackPath;
  readonly n: number;
  readonly length: number;
  readonly spacing: number;
  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;
  readonly k: Float32Array;
  minX = Infinity;
  maxX = -Infinity;
  minZ = Infinity;
  maxZ = -Infinity;

  constructor(def: TrackDef) {
    this.def = def;
    this.path = new TrackPath(referenceSegments(def), undefined, LANES);
    const centre = (this.path.innerOffset() + this.path.outerOffset()) / 2;
    const dense = Math.ceil(this.path.lapLength / 0.5);
    const xs = new Float64Array(dense + 1);
    const zs = new Float64Array(dense + 1);
    const along = new Float64Array(dense + 1);
    const point = { x: 0, y: 0, z: 0 };
    for (let i = 0; i <= dense; i++) {
      this.path.point((i / dense) * this.path.lapLength, centre, point);
      xs[i] = point.x;
      zs[i] = point.z;
      if (i > 0) along[i] = along[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
    }
    const total = along[dense];
    const n = Math.round(total / SPACING);
    this.n = n;
    this.length = total;
    this.spacing = total / n;
    this.px = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.k = new Float32Array(n);
    let cursor = 0;
    for (let i = 0; i < n; i++) {
      const target = i * this.spacing;
      while (cursor < dense - 1 && along[cursor + 1] < target) cursor += 1;
      const u = (target - along[cursor]) / Math.max(1e-6, along[cursor + 1] - along[cursor]);
      this.px[i] = xs[cursor] + (xs[cursor + 1] - xs[cursor]) * u;
      this.pz[i] = zs[cursor] + (zs[cursor + 1] - zs[cursor]) * u;
      this.minX = Math.min(this.minX, this.px[i]);
      this.maxX = Math.max(this.maxX, this.px[i]);
      this.minZ = Math.min(this.minZ, this.pz[i]);
      this.maxZ = Math.max(this.maxZ, this.pz[i]);
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      const dx = this.px[b] - this.px[a];
      const dz = this.pz[b] - this.pz[a];
      const len = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / len;
      this.tz[i] = dz / len;
    }
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n;
      const b = (i + 2) % n;
      const cross = this.tx[a] * this.tz[b] - this.tz[a] * this.tx[b];
      const dot = this.tx[a] * this.tx[b] + this.tz[a] * this.tz[b];
      raw[i] = Math.atan2(cross, dot) / (this.spacing * 4);
    }
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = -4; j <= 4; j++) sum += raw[(i + j + n) % n];
      this.k[i] = sum / 9;
    }
  }

  wrap(index: number): number {
    return ((index % this.n) + this.n) % this.n;
  }

  pose(s: number, lat: number, out: Pose): Pose {
    const f = (((s % this.length) + this.length) % this.length) / this.spacing;
    const i = Math.floor(f) % this.n;
    const j = (i + 1) % this.n;
    const u = f - Math.floor(f);
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * u;
    const tz = this.tz[i] + (this.tz[j] - this.tz[i]) * u;
    const len = Math.hypot(tx, tz) || 1;
    out.tx = tx / len;
    out.tz = tz / len;
    out.nx = out.tz;
    out.nz = -out.tx;
    out.x = this.px[i] + (this.px[j] - this.px[i]) * u + out.nx * lat;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * u + out.nz * lat;
    out.heading = Math.atan2(out.tx, out.tz);
    return out;
  }

  nearest(x: number, z: number, hint: number, window = 24): number {
    let best = hint;
    let bestDist = Infinity;
    for (let o = -window; o <= window; o++) {
      const i = this.wrap(hint + o);
      const dx = x - this.px[i];
      const dz = z - this.pz[i];
      const dist = dx * dx + dz * dz;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  lateral(x: number, z: number, index: number): number {
    return (x - this.px[index]) * this.tz[index] - (z - this.pz[index]) * this.tx[index];
  }

  along(x: number, z: number, index: number): number {
    return (x - this.px[index]) * this.tx[index] + (z - this.pz[index]) * this.tz[index];
  }

  curvatureAt(s: number): number {
    return this.k[this.wrap(Math.round(s / this.spacing))];
  }

  distance(x: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i < this.n; i += 3) {
      const dx = x - this.px[i];
      const dz = z - this.pz[i];
      const dist = dx * dx + dz * dz;
      if (dist < best) best = dist;
    }
    return Math.sqrt(best);
  }

  outline(size: number, padding = 6): { d: string; start: [number, number] } {
    const w = this.maxX - this.minX;
    const h = this.maxZ - this.minZ;
    const scale = (size - padding * 2) / Math.max(w, h);
    const ox = (size - w * scale) / 2;
    const oz = (size - h * scale) / 2;
    const at = (i: number): [number, number] => [
      ox + (this.px[i] - this.minX) * scale,
      size - (oz + (this.pz[i] - this.minZ) * scale),
    ];
    let d = '';
    for (let i = 0; i < this.n; i += 4) {
      const [x, y] = at(i);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return { d: `${d}Z`, start: at(0) };
  }
}

const cache = new Map<string, Track>();

export function loadTrack(id: string): Track {
  const def = trackDef(id);
  let track = cache.get(def.id);
  if (!track) {
    track = new Track(def);
    cache.set(def.id, track);
  }
  return track;
}
