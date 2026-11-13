import * as THREE from 'three';

export type TrackId = 'meadow' | 'dunes' | 'reef' | 'aurora';
export type Habitat = 'TERRAIN' | 'AQUATIC';

export type Theme = {
  skyTop: string;
  skyHorizon: string;
  skyBottom: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  sun: string;
  sunIntensity: number;
  sunDir: [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  ground: string;
  groundAlt: string;
  road: string;
  roadAlt: string;
  line: string;
  shoulder: string;
  kerbA: string;
  kerbB: string;
  wall: string;
  wallAlt: string;
  accent: string;
  exposure: number;
};

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
  theme: Theme;
};

export const ROAD_HALF = 8;
export const WALL_AT = 13.5;
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
    theme: {
      skyTop: '#2f7fe0',
      skyHorizon: '#bfe6ff',
      skyBottom: '#e8f6ff',
      fog: '#c4e6fb',
      fogNear: 180,
      fogFar: 720,
      sun: '#fff1d6',
      sunIntensity: 2.6,
      sunDir: [0.45, 0.8, 0.35],
      hemiSky: '#cfe9ff',
      hemiGround: '#4c7a3a',
      hemiIntensity: 1.15,
      ground: '#58a646',
      groundAlt: '#4a9440',
      road: '#b98a57',
      roadAlt: '#a87a4a',
      line: '#fff6de',
      shoulder: '#6cb552',
      kerbA: '#e8483f',
      kerbB: '#f7f3ea',
      wall: '#f4f1e8',
      wallAlt: '#3f8fd8',
      accent: '#ffd34d',
      exposure: 1.05,
    },
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
    theme: {
      skyTop: '#3b3f8f',
      skyHorizon: '#ff9e5e',
      skyBottom: '#ffd08a',
      fog: '#f5a873',
      fogNear: 150,
      fogFar: 640,
      sun: '#ffb070',
      sunIntensity: 2.7,
      sunDir: [-0.7, 0.42, 0.3],
      hemiSky: '#ffc9a0',
      hemiGround: '#8a5a34',
      hemiIntensity: 1.05,
      ground: '#dba55c',
      groundAlt: '#cf9550',
      road: '#6f5a50',
      roadAlt: '#645046',
      line: '#ffe9c2',
      shoulder: '#e6b66e',
      kerbA: '#2a2a36',
      kerbB: '#ffcf4a',
      wall: '#7a4a2e',
      wallAlt: '#f0c060',
      accent: '#ff7a3d',
      exposure: 1.0,
    },
  },
  {
    id: 'reef',
    name: 'Coral Deep',
    tagline: 'A glowing reef run on the sea floor. Bubbles provided.',
    habitat: 'AQUATIC',
    grade: 'Flowing',
    scale: 0.76,
    points: [
      [0, 0],
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
    theme: {
      skyTop: '#0a3a6a',
      skyHorizon: '#1a86a8',
      skyBottom: '#0c5c7c',
      fog: '#1585a2',
      fogNear: 40,
      fogFar: 330,
      sun: '#c8fff2',
      sunIntensity: 1.9,
      sunDir: [0.2, 0.95, 0.15],
      hemiSky: '#8fe6ff',
      hemiGround: '#1c5a6a',
      hemiIntensity: 1.5,
      ground: '#86b3a2',
      groundAlt: '#74a092',
      road: '#f1e4b9',
      roadAlt: '#e2d2a0',
      line: '#22b8a0',
      shoulder: '#b5cda9',
      kerbA: '#ff6f91',
      kerbB: '#fff3d6',
      wall: '#ff8a5c',
      wallAlt: '#3fd0c0',
      accent: '#5ff2d6',
      exposure: 1.1,
    },
  },
  {
    id: 'aurora',
    name: 'Aurora Ridge',
    tagline: 'Neon ice under the northern lights. Flat out and fearless.',
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
    theme: {
      skyTop: '#050a24',
      skyHorizon: '#1b2f6b',
      skyBottom: '#2a4a8a',
      fog: '#16255a',
      fogNear: 120,
      fogFar: 620,
      sun: '#b8ccff',
      sunIntensity: 1.5,
      sunDir: [-0.35, 0.8, -0.4],
      hemiSky: '#8fb0ff',
      hemiGround: '#2a3560',
      hemiIntensity: 1.7,
      ground: '#dfe9ff',
      groundAlt: '#c8d6f5',
      road: '#2c3a66',
      roadAlt: '#263359',
      line: '#5ff2ff',
      shoulder: '#b9c9ee',
      kerbA: '#ff4fd8',
      kerbB: '#3df0ff',
      wall: '#1a2350',
      wallAlt: '#3df0ff',
      accent: '#7dffb0',
      exposure: 1.15,
    },
  },
];

export function trackDef(id: string): TrackDef {
  return TRACKS.find((track) => track.id === id) ?? TRACKS[0];
}

export type Pose = { x: number; z: number; heading: number; tx: number; tz: number; nx: number; nz: number };

export class Track {
  readonly def: TrackDef;
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
    const curve = new THREE.CatmullRomCurve3(
      def.points.map(([x, z]) => new THREE.Vector3(x * def.scale, 0, z * def.scale)),
      true,
      'centripetal',
    );
    curve.arcLengthDivisions = def.points.length * 60;
    const total = curve.getLength();
    const n = Math.round(total / SPACING);
    const points = curve.getSpacedPoints(n);
    this.n = n;
    this.length = total;
    this.spacing = total / n;
    this.px = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.k = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.px[i] = points[i].x;
      this.pz[i] = points[i].z;
      this.minX = Math.min(this.minX, points[i].x);
      this.maxX = Math.max(this.maxX, points[i].x);
      this.minZ = Math.min(this.minZ, points[i].z);
      this.maxZ = Math.max(this.maxZ, points[i].z);
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
