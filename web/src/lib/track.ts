import type { Segment } from './types';

export const LANE_WIDTH = 1.4;

export type SegmentRange = { index: number; type: Segment['type']; start: number; end: number; radius: number; angle: number; grade: number };

export type TrackFrame = { x: number; y: number; z: number; tx: number; tz: number; nx: number; nz: number };

const segmentLength = (segment: Segment) =>
  segment.type === 'CURVE' ? (segment.radius ?? 0) * Math.abs(((segment.angle ?? 0) * Math.PI) / 180) : segment.length ?? 0;

export class TrackPath {
  lapLength: number;
  lanes: number;
  winding: number;
  ranges: SegmentRange[];
  private s: Float64Array;
  private x: Float64Array;
  private y: Float64Array;
  private z: Float64Array;
  private tx: Float64Array;
  private tz: Float64Array;
  private count: number;
  minX = Infinity;
  maxX = -Infinity;
  minZ = Infinity;
  maxZ = -Infinity;
  minY = Infinity;
  maxY = -Infinity;

  constructor(segments: Segment[], lapLength?: number, lanes = 10, step = 0.5) {
    this.lanes = lanes;
    const totalAngle = segments.reduce((sum, seg) => sum + (seg.type === 'CURVE' ? seg.angle ?? 0 : 0), 0);
    this.winding = totalAngle < 0 ? -1 : 1;
    const walked = segments.reduce((sum, seg) => sum + segmentLength(seg), 0) || 1;
    this.lapLength = lapLength && lapLength > 0 ? lapLength : walked;
    const scale = this.lapLength / walked;

    const xs: number[] = [0];
    const ys: number[] = [0];
    const zs: number[] = [0];
    const ss: number[] = [0];
    this.ranges = [];
    let x = 0;
    let y = 0;
    let z = 0;
    let heading = 0;
    let s = 0;
    segments.forEach((segment, index) => {
      const length = segmentLength(segment);
      const steps = Math.max(1, Math.ceil(length / step));
      const ds = length / steps;
      const radius = segment.radius ?? 0;
      const turn = segment.type === 'CURVE' ? Math.sign(segment.angle ?? 0) / Math.max(radius, 1e-6) : 0;
      const climb = segment.type === 'UPHILL' ? segment.grade ?? 0 : segment.type === 'DOWNHILL' ? -(segment.grade ?? 0) : 0;
      const start = s * scale;
      for (let i = 0; i < steps; i += 1) {
        const dTheta = turn * ds;
        const mid = heading + dTheta / 2;
        x += Math.cos(mid) * ds;
        z += Math.sin(mid) * ds;
        y += climb * ds;
        heading += dTheta;
        s += ds;
        xs.push(x);
        ys.push(y);
        zs.push(z);
        ss.push(s * scale);
      }
      this.ranges.push({ index, type: segment.type, start, end: s * scale, radius, angle: segment.angle ?? 0, grade: segment.grade ?? 0 });
    });

    const n = xs.length - 1;
    const errX = xs[n]!;
    const errY = ys[n]!;
    const errZ = zs[n]!;
    this.count = n;
    this.s = new Float64Array(n + 1);
    this.x = new Float64Array(n + 1);
    this.y = new Float64Array(n + 1);
    this.z = new Float64Array(n + 1);
    for (let i = 0; i <= n; i += 1) {
      const f = ss[i]! / this.lapLength;
      this.s[i] = ss[i]!;
      this.x[i] = xs[i]! - errX * f;
      this.y[i] = ys[i]! - errY * f;
      this.z[i] = zs[i]! - errZ * f;
    }
    this.x[n] = this.x[0]!;
    this.y[n] = this.y[0]!;
    this.z[n] = this.z[0]!;
    this.s[n] = this.lapLength;

    this.tx = new Float64Array(n + 1);
    this.tz = new Float64Array(n + 1);
    for (let i = 0; i <= n; i += 1) {
      const prev = i === 0 ? n - 1 : i - 1;
      const next = i === n ? 1 : i + 1;
      const dx = this.x[next]! - this.x[prev]!;
      const dz = this.z[next]! - this.z[prev]!;
      const len = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / len;
      this.tz[i] = dz / len;
    }

    const minY = Math.min(...this.y);
    for (let i = 0; i <= n; i += 1) {
      this.y[i] = this.y[i]! - minY;
      this.minX = Math.min(this.minX, this.x[i]!);
      this.maxX = Math.max(this.maxX, this.x[i]!);
      this.minZ = Math.min(this.minZ, this.z[i]!);
      this.maxZ = Math.max(this.maxZ, this.z[i]!);
      this.minY = Math.min(this.minY, this.y[i]!);
      this.maxY = Math.max(this.maxY, this.y[i]!);
    }
    const outer = this.outerOffset() + 1;
    this.minX -= outer;
    this.maxX += outer;
    this.minZ -= outer;
    this.maxZ += outer;
  }

  innerOffset(): number {
    return -LANE_WIDTH / 2;
  }

  outerOffset(): number {
    return (this.lanes - 0.5) * LANE_WIDTH;
  }

  laneOffset(lane: number): number {
    return (lane - 1) * LANE_WIDTH;
  }

  get centerX(): number {
    return (this.minX + this.maxX) / 2;
  }

  get centerZ(): number {
    return (this.minZ + this.maxZ) / 2;
  }

  get size(): number {
    return Math.max(this.maxX - this.minX, this.maxZ - this.minZ);
  }

  private locate(sRaw: number): [number, number] {
    const L = this.lapLength;
    let s = sRaw % L;
    if (s < 0) s += L;
    let lo = 0;
    let hi = this.count;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.s[mid]! <= s) lo = mid;
      else hi = mid;
    }
    const span = this.s[hi]! - this.s[lo]! || 1;
    return [lo, (s - this.s[lo]!) / span];
  }

  frame(sRaw: number, out: TrackFrame = { x: 0, y: 0, z: 0, tx: 1, tz: 0, nx: 0, nz: 1 }): TrackFrame {
    const [i, f] = this.locate(sRaw);
    const j = i + 1;
    out.x = this.x[i]! + (this.x[j]! - this.x[i]!) * f;
    out.y = this.y[i]! + (this.y[j]! - this.y[i]!) * f;
    out.z = this.z[i]! + (this.z[j]! - this.z[i]!) * f;
    let tx = this.tx[i]! + (this.tx[j]! - this.tx[i]!) * f;
    let tz = this.tz[i]! + (this.tz[j]! - this.tz[i]!) * f;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    out.tx = tx;
    out.tz = tz;
    out.nx = this.winding * tz;
    out.nz = -this.winding * tx;
    return out;
  }

  point(s: number, lateral: number, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }) {
    const f = this.frame(s);
    out.x = f.x + f.nx * lateral;
    out.y = f.y;
    out.z = f.z + f.nz * lateral;
    return out;
  }

  segmentAt(sRaw: number): SegmentRange | undefined {
    let s = sRaw % this.lapLength;
    if (s < 0) s += this.lapLength;
    return this.ranges.find((range) => s >= range.start && s < range.end) ?? this.ranges[this.ranges.length - 1];
  }

  samples(step: number): number[] {
    const out: number[] = [];
    const n = Math.max(8, Math.ceil(this.lapLength / step));
    for (let i = 0; i <= n; i += 1) out.push((i / n) * this.lapLength);
    return out;
  }
}

export const SURFACE_COLORS: Record<string, { track: string; ground: string; infield: string; accent: string; sky: string; fog: string }> = {
  GRASS: { track: '#5f9e45', ground: '#3d7434', infield: '#4b8a3c', accent: '#2f5e29', sky: '#8fc6ee', fog: '#cfe3ef' },
  SAND: { track: '#c4935a', ground: '#e6cc93', infield: '#dcbc7c', accent: '#b98d4a', sky: '#8ec3ea', fog: '#e9dcc0' },
  DIRT: { track: '#9a5a36', ground: '#8a7a52', infield: '#7d8a4a', accent: '#5e4a2c', sky: '#9cc4e4', fog: '#ddd2bd' },
  MUD: { track: '#5e4030', ground: '#4f6233', infield: '#56703a', accent: '#3a4326', sky: '#9fb3b6', fog: '#b9c4bb' },
  ICE: { track: '#a9d3ea', ground: '#f4f8fa', infield: '#e6eff3', accent: '#a7cde0', sky: '#a9cfea', fog: '#e4f1f8' },
};

export const surfaceColors = (surface: string) => SURFACE_COLORS[surface] ?? SURFACE_COLORS.GRASS!;

export const LANE_COLORS = ['#d62828', '#f4f4f0', '#1d4ed8', '#facc15', '#16a34a', '#1f2937', '#f97316', '#f472b6', '#14b8a6', '#7c3aed'];
export const LANE_TEXT = ['#fff', '#111', '#fff', '#111', '#fff', '#fff', '#111', '#111', '#111', '#fff'];

export const laneColor = (lane: number) => LANE_COLORS[(Math.max(1, Math.round(lane)) - 1) % LANE_COLORS.length]!;
export const laneText = (lane: number) => LANE_TEXT[(Math.max(1, Math.round(lane)) - 1) % LANE_TEXT.length]!;
