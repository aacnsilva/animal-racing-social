import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrackPath } from '../lib/track';
import { loft, type Ring } from './kit';

export type PaintFn = (out: THREE.Color, p: THREE.Vector3, n: THREE.Vector3) => void;
export type Tint = THREE.ColorRepresentation | PaintFn;
export type Placement = { x: number; y: number; z: number; scale: number; rot: number; sy?: number; tilt?: number };
export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

const KEEP = new Set(['position', 'normal', 'uv', 'color']);

export function paint(geometry: THREE.BufferGeometry, tint: Tint): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const base = typeof tint === 'function' ? null : new THREE.Color(tint);
  for (let i = 0; i < position.count; i += 1) {
    if (base) color.copy(base);
    else if (typeof tint === 'function') {
      color.set('#ffffff');
      p.fromBufferAttribute(position, i);
      n.fromBufferAttribute(normal, i);
      tint(color, p, n);
    }
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

export function prep(source: THREE.BufferGeometry, tint?: Tint): THREE.BufferGeometry {
  let geometry = source;
  for (const name of Object.keys(geometry.attributes)) if (!KEEP.has(name)) geometry.deleteAttribute(name);
  if (!geometry.index) {
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    geometry = mergeVertices(geometry, 1e-4);
    geometry.computeVertexNormals();
  }
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  if (!geometry.getAttribute('uv')) {
    geometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2),
    );
  }
  if (tint !== undefined || !geometry.getAttribute('color')) paint(geometry, tint ?? '#ffffff');
  return geometry;
}

export function xf(x: number, y: number, z: number, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(sx, sy, sz),
  );
}

export class Batch {
  private parts: THREE.BufferGeometry[] = [];

  add(geometry: THREE.BufferGeometry, tint?: Tint, matrix?: THREE.Matrix4): this {
    const part = prep(geometry, tint);
    if (matrix) part.applyMatrix4(matrix);
    this.parts.push(part);
    return this;
  }

  copy(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4): this {
    if (!matrix) {
      this.parts.push(geometry);
      return this;
    }
    const part = geometry.clone();
    part.applyMatrix4(matrix);
    this.parts.push(part);
    return this;
  }

  box(w: number, h: number, d: number, tint: Tint, x: number, y: number, z: number, ry = 0): this {
    return this.add(new THREE.BoxGeometry(w, h, d), tint, xf(x, y, z, ry));
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const merged = mergeGeometries(this.parts, false);
    for (const part of this.parts) part.dispose();
    this.parts = [];
    return merged;
  }
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function noise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const tz = smooth(z - z0);
  const c = (dx: number, dy: number, dz: number) => hash3(x0 + dx, y0 + dy, z0 + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), tx), lerp(c(0, 1, 0), c(1, 1, 0), tx), ty),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), tx), lerp(c(0, 1, 1), c(1, 1, 1), tx), ty),
    tz,
  );
}

export function fbm3(x: number, y: number, z: number, seed: number, octaves = 4): number {
  let total = 0;
  let amplitude = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o += 1) {
    total += noise3(x * f, y * f, z * f, seed + o * 13) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    f *= 2.03;
  }
  return total / norm;
}

export function blob(
  detail: number,
  seed: number,
  rough: number,
  squash: number,
  tint: PaintFn | THREE.ColorRepresentation,
  floor = -0.35,
): THREE.BufferGeometry {
  const geometry = prep(new THREE.IcosahedronGeometry(1, detail));
  const position = geometry.getAttribute('position');
  const p = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    p.fromBufferAttribute(position, i);
    const r =
      1 +
      (fbm3(p.x * 1.2 + 9, p.y * 1.2 + 4, p.z * 1.2 + 7, seed, 3) - 0.5) * rough * 2 +
      (noise3(p.x * 4.1, p.y * 4.1, p.z * 4.1, seed + 50) - 0.5) * rough * 0.5;
    p.multiplyScalar(r);
    p.y *= squash;
    if (p.y < floor) p.y = floor + (p.y - floor) * 0.15;
    position.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  return paint(geometry, tint);
}

export function rockPaint(base: string, moss: string, seed: number): PaintFn {
  const a = new THREE.Color(base);
  const b = new THREE.Color(moss);
  return (out, p, n) => {
    const grain = fbm3(p.x * 2.3, p.y * 2.3, p.z * 2.3, seed, 3);
    out.copy(a).multiplyScalar(0.62 + grain * 0.75);
    const top = Math.max(0, n.y) * fbm3(p.x * 1.1 + 5, p.y, p.z * 1.1, seed + 3, 2);
    out.lerp(b, Math.min(1, Math.max(0, top * 1.9 - 0.45)));
    out.multiplyScalar(0.7 + Math.min(1, Math.max(0, p.y + 0.5)) * 0.4);
  };
}

export function tube(
  points: [number, number, number][],
  radius: number | number[],
  sides: number,
  tint: Tint,
  sub = 2,
  caps = true,
): THREE.BufferGeometry {
  const rings: Ring[] = points.map((p, i) => {
    const r = typeof radius === 'number' ? radius : radius[Math.min(i, radius.length - 1)];
    return { p, rx: r, ry: r };
  });
  const first = points[0];
  const last = points[points.length - 1];
  const vertical = Math.abs(last[1] - first[1]) > Math.hypot(last[0] - first[0], last[2] - first[2]);
  return prep(
    loft(rings, { segments: sides, sub, ref: vertical ? [0, 0, 1] : [0, 1, 0], capStart: caps, capEnd: caps }),
    tint,
  );
}

export function orient(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (!index || index.count < 3) return geometry;
  const a = new THREE.Vector3().fromBufferAttribute(position, index.getX(0));
  const b = new THREE.Vector3().fromBufferAttribute(position, index.getX(1));
  const c = new THREE.Vector3().fromBufferAttribute(position, index.getX(2));
  const face = b.sub(a).cross(c.sub(a));
  const n = new THREE.Vector3().fromBufferAttribute(normal, index.getX(0));
  if (face.dot(n) < 0) {
    for (let i = 0; i < index.count; i += 3) {
      const t = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, t);
    }
  }
  return geometry;
}

export function trackStrip(
  track: TrackPath,
  a: number,
  b: number,
  yA: number,
  yB: number,
  step: number,
  uvScale: number,
  tint: Tint = '#ffffff',
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const samples = track.samples(step);
  const p = { x: 0, y: 0, z: 0 };
  samples.forEach((s, i) => {
    track.point(s, a, p);
    positions.push(p.x, p.y + yA, p.z);
    uvs.push(p.x * uvScale, p.z * uvScale);
    track.point(s, b, p);
    positions.push(p.x, p.y + yB, p.z);
    uvs.push(p.x * uvScale, p.z * uvScale);
    normals.push(0, 1, 0, 0, 1, 0);
    if (i > 0) {
      const base = (i - 1) * 2;
      if (track.winding > 0) indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      else indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if (Math.abs(yA - yB) > 1e-3 || track.maxY > 0.05) geometry.computeVertexNormals();
  return paint(geometry, tint);
}

export function trackTube(
  track: TrackPath,
  lateral: number,
  height: (s: number) => number,
  radius: number,
  sides: number,
  step: number,
  uPerMetre: number,
  tint: Tint = '#ffffff',
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const samples = track.samples(step);
  const columns = sides + 1;
  samples.forEach((s, i) => {
    const f = track.frame(s);
    const cx = f.x + f.nx * lateral;
    const cy = f.y + height(s);
    const cz = f.z + f.nz * lateral;
    for (let j = 0; j < columns; j += 1) {
      const angle = (j / sides) * Math.PI * 2;
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      positions.push(cx + f.nx * c * radius, cy + sn * radius, cz + f.nz * c * radius);
      normals.push(f.nx * c, sn, f.nz * c);
      uvs.push(s * uPerMetre, j / sides);
    }
    if (i > 0) {
      const p0 = (i - 1) * columns;
      const p1 = i * columns;
      for (let j = 0; j < sides; j += 1) indices.push(p0 + j, p0 + j + 1, p1 + j, p0 + j + 1, p1 + j + 1, p1 + j);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return paint(orient(geometry), tint);
}

export function trackSkirt(
  track: TrackPath,
  lateral: number,
  top: number,
  outward: number,
  step: number,
  uvScale: number,
  tint: Tint = '#ffffff',
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  track.samples(step).forEach((s, i) => {
    const f = track.frame(s);
    const x = f.x + f.nx * lateral;
    const z = f.z + f.nz * lateral;
    positions.push(x, -0.05, z, x, f.y + top, z);
    normals.push(f.nx * outward, 0, f.nz * outward, f.nx * outward, 0, f.nz * outward);
    uvs.push(s * uvScale, 0, s * uvScale, (f.y + top) * uvScale);
    if (i > 0) {
      const base = (i - 1) * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return paint(orient(geometry), tint);
}

export function panel(
  width: number,
  height: number,
  uvWidth: number,
  uvHeight: number,
  matrix: THREE.Matrix4,
  tint: Tint = '#ffffff',
  segments = 1,
): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(width, height, segments, 1);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * uvWidth, uv.getY(i) * uvHeight);
  const out = prep(geometry, tint);
  out.applyMatrix4(matrix);
  return out;
}

export function ground(rect: Rect, y: number, uvScale: number, tint: Tint = '#ffffff'): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [rect.minX, y, rect.minZ, rect.maxX, y, rect.minZ, rect.minX, y, rect.maxZ, rect.maxX, y, rect.maxZ],
      3,
    ),
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      [rect.minX, rect.minZ, rect.maxX, rect.minZ, rect.minX, rect.maxZ, rect.maxX, rect.maxZ].map((v) => v * uvScale),
      2,
    ),
  );
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  return paint(geometry, tint);
}

export function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: Placement[],
  colors?: (i: number, out: THREE.Color) => void,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  placements.forEach((placement, i) => {
    euler.set(placement.tilt ?? 0, placement.rot, 0);
    quaternion.setFromEuler(euler);
    position.set(placement.x, placement.y, placement.z);
    scale.set(placement.scale, placement.scale * (placement.sy ?? 1), placement.scale);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
    if (colors) {
      color.set('#ffffff');
      colors(i, color);
      mesh.setColorAt(i, color);
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

export function scatter(
  track: TrackPath,
  random: () => number,
  count: number,
  area: Rect,
  outerClearance: number,
  innerClearance: number,
  heightAt?: (x: number, z: number) => number,
): Placement[] {
  const reference = track.samples(3).map((s) => track.frame(s));
  const placements: Placement[] = [];
  let guard = 0;
  while (placements.length < count && guard < count * 40) {
    guard += 1;
    const x = area.minX + random() * (area.maxX - area.minX);
    const z = area.minZ + random() * (area.maxZ - area.minZ);
    let best = Infinity;
    let side = 0;
    for (const f of reference) {
      const dx = x - f.x;
      const dz = z - f.z;
      const dist = dx * dx + dz * dz;
      if (dist < best) {
        best = dist;
        side = dx * f.nx + dz * f.nz;
      }
    }
    const clearance = side > 0 ? track.outerOffset() + outerClearance : -track.innerOffset() + innerClearance;
    if (Math.sqrt(best) < clearance) continue;
    placements.push({
      x,
      y: heightAt ? heightAt(x, z) : 0,
      z,
      scale: 0.7 + random() * 0.8,
      rot: random() * Math.PI * 2,
    });
  }
  return placements;
}

export function trackBand(
  track: TrackPath,
  random: () => number,
  count: number,
  outside: boolean,
  minDistance: number,
  maxDistance: number,
  taper = false,
): Placement[] {
  const placements: Placement[] = [];
  const p = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < count; i += 1) {
    const s = random() * track.lapLength;
    const t = random();
    const d = minDistance + t * (maxDistance - minDistance);
    track.point(s, outside ? track.outerOffset() + d : track.innerOffset() - d, p);
    const scale = (0.7 + random() * 0.8) * (taper ? 0.4 + 0.6 * t : 1);
    placements.push({ x: p.x, y: p.y, z: p.z, scale, rot: random() * Math.PI * 2 });
  }
  return placements;
}

export function deepInfield(track: TrackPath, random: () => number, count: number, clearance: number): Placement[] {
  const near = nearestTrack(track, 4);
  const placements: Placement[] = [];
  let guard = 0;
  while (placements.length < count && guard < count * 60) {
    guard += 1;
    const x = track.minX + random() * (track.maxX - track.minX);
    const z = track.minZ + random() * (track.maxZ - track.minZ);
    const hit = near(x, z);
    if (hit.side > 0 || hit.dist < clearance) continue;
    placements.push({ x, y: 0, z, scale: 0.7 + random() * 0.8, rot: random() * Math.PI * 2 });
  }
  return placements;
}

export function fishGeometry(back: string, belly: string, stripe: string | null): THREE.BufferGeometry {
  const top = new THREE.Color(back);
  const low = new THREE.Color(belly);
  const band = stripe ? new THREE.Color(stripe) : null;
  const tint: PaintFn = (out, p) => {
    out.copy(low).lerp(top, Math.min(1, Math.max(0, p.y * 7 + 0.45)));
    if (band && Math.abs(Math.sin(p.z * 11 + 0.6)) > 0.8) out.lerp(band, 0.85);
  };
  const body = loft(
    [
      { p: [0, 0, 0.5], rx: 0.012, ry: 0.02 },
      { p: [0, 0, 0.36], rx: 0.055, ry: 0.095 },
      { p: [0, 0.01, 0.08], rx: 0.075, ry: 0.15 },
      { p: [0, 0, -0.22], rx: 0.045, ry: 0.1 },
      { p: [0, 0, -0.42], rx: 0.014, ry: 0.035 },
    ],
    { segments: 6, sub: 2 },
  );
  const tail = loft(
    [
      { p: [0, 0, -0.4], rx: 0.01, ry: 0.03 },
      { p: [0, 0, -0.52], rx: 0.006, ry: 0.11 },
      { p: [0, 0, -0.64], rx: 0.003, ry: 0.17 },
    ],
    { segments: 4, sub: 1 },
  );
  const fin = loft(
    [
      { p: [0, 0.12, 0.16], rx: 0.006, ry: 0.01 },
      { p: [0, 0.17, 0.02], rx: 0.006, ry: 0.05 },
      { p: [0, 0.14, -0.16], rx: 0.004, ry: 0.01 },
    ],
    { segments: 4, sub: 1 },
  );
  return new Batch().add(body, tint).add(tail, tint).add(fin, tint).build();
}

export type SchoolSpec = {
  centres: { x: number; z: number }[];
  perSchool: number;
  minY: number;
  maxY: number;
  radius: [number, number];
  size: [number, number];
  speed: [number, number];
  colors: string[];
};

export function school(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  random: () => number,
  spec: SchoolSpec,
): THREE.InstancedMesh {
  const total = spec.centres.length * spec.perSchool;
  const mesh = new THREE.InstancedMesh(geometry, material, total);
  const orbit = new Float32Array(total * 4);
  const swim = new Float32Array(total * 4);
  const color = new THREE.Color();
  spec.centres.forEach((centre, c) => {
    const radius = spec.radius[0] + random() * (spec.radius[1] - spec.radius[0]);
    const y = spec.minY + random() * (spec.maxY - spec.minY);
    const linear = spec.speed[0] + random() * (spec.speed[1] - spec.speed[0]);
    const direction = c % 2 ? 1 : -1;
    const start = random() * Math.PI * 2;
    const arc = Math.min(1.6, (spec.perSchool * 0.5) / radius);
    const tintBase = spec.colors[c % spec.colors.length];
    for (let k = 0; k < spec.perSchool; k += 1) {
      const i = c * spec.perSchool + k;
      const r = radius + (random() - 0.5) * Math.min(4, radius * 0.35);
      orbit[i * 4] = centre.x;
      orbit[i * 4 + 1] = y + (random() - 0.5) * 2.2;
      orbit[i * 4 + 2] = centre.z;
      orbit[i * 4 + 3] = r;
      swim[i * 4] = (direction * linear) / radius;
      swim[i * 4 + 1] = start + (random() - 0.5) * arc;
      swim[i * 4 + 2] = spec.size[0] + random() * (spec.size[1] - spec.size[0]);
      swim[i * 4 + 3] = random() * Math.PI * 2;
      color.set(tintBase).multiplyScalar(0.8 + random() * 0.4);
      mesh.setColorAt(i, color);
    }
  });
  geometry.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(orbit, 4));
  geometry.setAttribute('aSwim', new THREE.InstancedBufferAttribute(swim, 4));
  mesh.frustumCulled = false;
  return mesh;
}

export function kelpGeometry(random: () => number, height: number): THREE.BufferGeometry {
  const batch = new Batch();
  const bendX = (random() - 0.5) * 1.2;
  const bendZ = (random() - 0.5) * 1.2;
  const spine = (t: number): [number, number, number] => [
    Math.sin(t * 2.2) * 0.25 + bendX * t * t,
    t * height,
    Math.cos(t * 1.7) * 0.2 - 0.2 + bendZ * t * t,
  ];
  const points = Array.from({ length: 7 }, (_, i) => spine(i / 6));
  const stem = new THREE.Color('#5a5a1e');
  const leafA = new THREE.Color('#6f7a22');
  const leafB = new THREE.Color('#c2a63a');
  batch.add(tube(points, [0.07, 0.06, 0.05, 0.045, 0.04, 0.03, 0.02], 4, stem, 2, false));
  const blades = Math.round(height * 3);
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const c = new THREE.Color();
  for (let k = 0; k < blades; k += 1) {
    const t = 0.12 + (k / blades) * 0.88;
    const [bx, by, bz] = spine(t);
    const yaw = k * 2.4 + random() * 0.6;
    const length = 1.7 + random() * 1.2;
    const width = 0.15 + random() * 0.09;
    const dx = Math.cos(yaw);
    const dz = Math.sin(yaw);
    const base = positions.length / 3;
    const segs = 4;
    const wave = random() * 6;
    for (let s = 0; s <= segs; s += 1) {
      const f = s / segs;
      const out = f * length * 0.62;
      const rise = (f * 0.5 - f * f * 1.15) * length;
      const w = width * Math.sin(Math.PI * (0.1 + f * 0.88)) ** 0.7;
      const curl = Math.sin(f * 5 + wave) * 0.12 * f;
      const px = bx + dx * out - dz * curl;
      const py = by + rise;
      const pz = bz + dz * out + dx * curl;
      positions.push(px - dz * w, py, pz + dx * w, px + dz * w, py, pz - dx * w);
      normals.push(-dx * 0.3, 0.95, -dz * 0.3, -dx * 0.3, 0.95, -dz * 0.3);
      uvs.push(0, f, 1, f);
      c.copy(leafA).lerp(leafB, f * 0.8 + random() * 0.2);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (s > 0) {
        const q = base + (s - 1) * 2;
        indices.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      }
    }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  leaves.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  leaves.setIndex(indices);
  batch.add(leaves);
  return batch.build();
}

export function grassGeometry(
  random: () => number,
  blades: number,
  height: number,
  low: string,
  high: string,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const a = new THREE.Color(low);
  const b = new THREE.Color(high);
  const c = new THREE.Color();
  for (let k = 0; k < blades; k += 1) {
    const yaw = random() * Math.PI * 2;
    const dx = Math.cos(yaw);
    const dz = Math.sin(yaw);
    const ox = (random() - 0.5) * 0.9;
    const oz = (random() - 0.5) * 0.9;
    const h = height * (0.55 + random() * 0.6);
    const lean = 0.15 + random() * 0.45;
    const width = 0.05 + random() * 0.05;
    const base = positions.length / 3;
    const segs = 4;
    for (let s = 0; s <= segs; s += 1) {
      const f = s / segs;
      const w = width * (1 - f * 0.85);
      const px = ox + dx * lean * f * f * h;
      const pz = oz + dz * lean * f * f * h;
      positions.push(px - dz * w, f * h, pz + dx * w, px + dz * w, f * h, pz - dx * w);
      normals.push(dx * 0.7, 0.7, dz * 0.7, dx * 0.7, 0.7, dz * 0.7);
      uvs.push(0, f, 1, f);
      c.copy(a).lerp(b, f);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (s > 0) {
        const q = base + (s - 1) * 2;
        indices.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

const branchTint: PaintFn = (out, p) => {
  out.setScalar(0.55 + Math.min(1, p.y / 1.8) * 0.55);
};

const fanTint: PaintFn = (out, p) => {
  out.setScalar(0.6 + Math.min(1, p.y / 2.4) * 0.5);
};

export function branchCoral(random: () => number): THREE.BufferGeometry {
  const batch = new Batch();
  const grow = (from: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, depth: number) => {
    const mid = from
      .clone()
      .addScaledVector(dir, length * 0.5)
      .add(new THREE.Vector3((random() - 0.5) * 0.12, 0, (random() - 0.5) * 0.12));
    const end = from.clone().addScaledVector(dir, length);
    batch.add(
      tube(
        [
          [from.x, from.y, from.z],
          [mid.x, mid.y, mid.z],
          [end.x, end.y, end.z],
        ],
        [radius, radius * 0.8, radius * 0.6],
        5,
        branchTint,
        1,
        depth <= 0,
      ),
    );
    if (depth <= 0) return;
    const children = depth > 2 ? 3 : 2;
    for (let i = 0; i < children; i += 1) {
      const yaw = random() * Math.PI * 2;
      const spread = 0.5 + random() * 0.4;
      const next = new THREE.Vector3(Math.cos(yaw) * spread, 1, Math.sin(yaw) * spread).add(dir).normalize();
      grow(end, next, length * (0.62 + random() * 0.2), radius * 0.62, depth - 1);
    }
  };
  grow(new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0, 1, 0), 0.55, 0.16, 3);
  return batch.build();
}

export function fanCoral(random: () => number): THREE.BufferGeometry {
  const batch = new Batch();
  const grow = (x: number, y: number, angle: number, length: number, radius: number, depth: number) => {
    const ex = x + Math.sin(angle) * length;
    const ey = y + Math.cos(angle) * length;
    batch.add(
      tube(
        [
          [x, y, 0],
          [(x + ex) / 2 + (random() - 0.5) * 0.05, (y + ey) / 2, (random() - 0.5) * 0.04],
          [ex, ey, 0],
        ],
        [radius, radius * 0.8, radius * 0.6],
        4,
        fanTint,
        1,
        false,
      ),
    );
    if (depth <= 0) return;
    const spread = 0.28 + random() * 0.2;
    grow(ex, ey, angle - spread, length * 0.78, radius * 0.66, depth - 1);
    grow(ex, ey, angle + spread, length * 0.78, radius * 0.66, depth - 1);
    if (depth > 3 && random() < 0.6)
      grow(ex, ey, angle + (random() - 0.5) * 0.2, length * 0.7, radius * 0.6, depth - 2);
  };
  grow(0, -0.1, 0, 0.72, 0.09, 4);
  return batch.build();
}

export function domeCoral(seed: number): THREE.BufferGeometry {
  return blob(2, seed, 0.12, 0.7, (out, p) => {
    const groove = Math.sin(fbm3(p.x * 2.4, p.y * 2.4, p.z * 2.4, seed, 3) * 46);
    out.setScalar(0.62 + groove * 0.2 + Math.max(0, p.y) * 0.25);
  });
}

export function tableCoral(): THREE.BufferGeometry {
  const profile = [
    [0.02, 0],
    [0.22, 0],
    [0.16, 0.25],
    [0.14, 0.6],
    [0.3, 0.78],
    [0.9, 0.9],
    [1.25, 0.96],
    [1.3, 1.02],
    [1.1, 1.06],
    [0.5, 1.04],
    [0.02, 1.02],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return prep(new THREE.LatheGeometry(profile, 14), (out, p) => {
    const r = Math.hypot(p.x, p.z);
    out.setScalar(0.55 + r * 0.3 + (Math.sin(Math.atan2(p.z, p.x) * 9 + r * 6) > 0.6 ? 0.12 : 0));
  });
}

export function tubeSponge(random: () => number): THREE.BufferGeometry {
  const batch = new Batch();
  const count = 4 + Math.floor(random() * 3);
  for (let i = 0; i < count; i += 1) {
    const h = 0.7 + random() * 1.1;
    const r = 0.14 + random() * 0.1;
    const profile = [
      [r * 0.7, 0],
      [r * 0.9, h * 0.4],
      [r * 1.15, h],
      [r * 0.85, h],
      [r * 0.6, h * 0.5],
      [0.01, h * 0.3],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const angle = (i / count) * Math.PI * 2 + random();
    const d = i === 0 ? 0 : 0.22 + random() * 0.2;
    batch.add(
      new THREE.LatheGeometry(profile, 8),
      (out, p) => {
        out.setScalar(Math.hypot(p.x, p.z) < r * 0.8 && p.y > h * 0.45 ? 0.25 : 0.6 + (p.y / h) * 0.45);
      },
      xf(
        Math.cos(angle) * d,
        -0.05,
        Math.sin(angle) * d,
        random() * 6,
        1,
        1,
        1,
        (random() - 0.5) * 0.3,
        (random() - 0.5) * 0.3,
      ),
    );
  }
  return batch.build();
}

export function anemone(random: () => number): THREE.BufferGeometry {
  const batch = new Batch();
  batch.add(
    new THREE.CylinderGeometry(0.34, 0.42, 0.5, 10, 1),
    (out, p) => {
      out.setScalar(0.4 + (p.y + 0.25) * 0.5);
    },
    xf(0, 0.25, 0),
  );
  const tentacles = 20;
  for (let i = 0; i < tentacles; i += 1) {
    const ring = i % 3;
    const angle = (i / tentacles) * Math.PI * 2 + ring * 0.3;
    const r = 0.1 + ring * 0.11;
    const lean = 0.15 + ring * 0.22;
    const length = 0.7 + random() * 0.45 - ring * 0.08;
    const bx = Math.cos(angle) * r;
    const bz = Math.sin(angle) * r;
    batch.add(
      tube(
        [
          [bx, 0.48, bz],
          [bx + Math.cos(angle) * lean * 0.4, 0.48 + length * 0.55, bz + Math.sin(angle) * lean * 0.4],
          [bx + Math.cos(angle) * lean, 0.48 + length, bz + Math.sin(angle) * lean],
        ],
        [0.05, 0.04, 0.026],
        4,
        (out, p) => {
          out.setScalar(0.7 + Math.min(1, (p.y - 0.48) / length) * 0.6);
        },
        1,
        false,
      ),
    );
  }
  return batch.build();
}

export function nearestTrack(
  track: TrackPath,
  step: number,
): (x: number, z: number) => { dist: number; side: number; y: number } {
  const reference = track.samples(step).map((s) => track.frame(s));
  const out = { dist: 0, side: 0, y: 0 };
  return (x, z) => {
    let best = Infinity;
    let side = 0;
    let y = 0;
    for (const f of reference) {
      const dx = x - f.x;
      const dz = z - f.z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        side = dx * f.nx + dz * f.nz;
        y = f.y;
      }
    }
    out.dist = Math.sqrt(best);
    out.side = side;
    out.y = y;
    return out;
  };
}
