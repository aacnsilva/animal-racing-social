import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Vec3 = [number, number, number];
export type Weights = number | Record<number, number>;

export type Ring = {
  p: Vec3;
  rx: number;
  ry: number;
  down?: number;
  w?: Weights;
  c?: THREE.ColorRepresentation;
  detail?: number;
};

export type Paint = (out: THREE.Color, angle: number, v: number, position: THREE.Vector3) => void;

export type LoftOptions = {
  ref?: Vec3;
  segments?: number;
  sub?: number;
  capStart?: boolean;
  capEnd?: boolean;
  arc?: [number, number];
  color?: THREE.ColorRepresentation;
  paint?: Paint;
  detail?: number;
  uvRect?: [number, number, number, number];
  weights?: Weights;
};

const cr = (a: number, b: number, c: number, d: number, t: number) =>
  0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);

function weightMap(weights: Weights | undefined, fallback: Weights | undefined): Record<number, number> {
  const value = weights ?? fallback ?? 0;
  return typeof value === 'number' ? { [value]: 1 } : value;
}

function mixWeights(a: Record<number, number>, b: Record<number, number>, t: number): [number[], number[]] {
  const merged = new Map<number, number>();
  for (const key of Object.keys(a)) merged.set(Number(key), (merged.get(Number(key)) ?? 0) + a[Number(key)] * (1 - t));
  for (const key of Object.keys(b)) merged.set(Number(key), (merged.get(Number(key)) ?? 0) + b[Number(key)] * t);
  const sorted = [...merged.entries()].filter(([, w]) => w > 1e-4).toSorted((x, y) => y[1] - x[1]);
  const top = sorted.slice(0, 4);
  const total = top.reduce((sum, [, w]) => sum + w, 0) || 1;
  const indices = [0, 0, 0, 0];
  const values = [0, 0, 0, 0];
  top.forEach(([bone, w], i) => {
    indices[i] = bone;
    values[i] = w / total;
  });
  return [indices, values];
}

export function loft(rings: Ring[], options: LoftOptions = {}): THREE.BufferGeometry {
  const segments = options.segments ?? 12;
  const sub = options.sub ?? 3;
  const arc = options.arc ?? [0, Math.PI * 2];
  const closed = !options.arc;
  const ref = new THREE.Vector3(...(options.ref ?? [0, 1, 0]));
  const baseColor = new THREE.Color(options.color ?? '#ffffff');
  const uvRect = options.uvRect;

  type Sample = {
    p: THREE.Vector3;
    rx: number;
    ry: number;
    down: number;
    color: THREE.Color;
    detail: number;
    indices: number[];
    weights: number[];
    v: number;
  };
  const samples: Sample[] = [];
  const n = rings.length;
  const ringColor = (ring: Ring) => (ring.c === undefined ? baseColor : new THREE.Color(ring.c));
  for (let i = 0; i < n - 1; i += 1) {
    const r0 = rings[Math.max(0, i - 1)];
    const r1 = rings[i];
    const r2 = rings[i + 1];
    const r3 = rings[Math.min(n - 1, i + 2)];
    const steps = i === n - 2 ? sub + 1 : sub;
    for (let k = 0; k < steps; k += 1) {
      const t = k / sub;
      const [indices, weights] = mixWeights(weightMap(r1.w, options.weights), weightMap(r2.w, options.weights), t);
      const lo1 = Math.min(r1.rx, r2.rx);
      const hi1 = Math.max(r1.rx, r2.rx);
      const lo2 = Math.min(r1.ry, r2.ry);
      const hi2 = Math.max(r1.ry, r2.ry);
      const d0 = r0.down ?? r0.ry;
      const d1 = r1.down ?? r1.ry;
      const d2 = r2.down ?? r2.ry;
      const d3 = r3.down ?? r3.ry;
      const slack = 0.12;
      const bound = (value: number, lo: number, hi: number) =>
        Math.max(lo - (hi - lo) * slack, Math.min(hi + (hi - lo) * slack, value));
      samples.push({
        p: new THREE.Vector3(
          cr(r0.p[0], r1.p[0], r2.p[0], r3.p[0], t),
          cr(r0.p[1], r1.p[1], r2.p[1], r3.p[1], t),
          cr(r0.p[2], r1.p[2], r2.p[2], r3.p[2], t),
        ),
        rx: Math.max(0, bound(cr(r0.rx, r1.rx, r2.rx, r3.rx, t), lo1, hi1)),
        ry: Math.max(0, bound(cr(r0.ry, r1.ry, r2.ry, r3.ry, t), lo2, hi2)),
        down: Math.max(0, bound(cr(d0, d1, d2, d3, t), Math.min(d1, d2), Math.max(d1, d2))),
        color: ringColor(r1).clone().lerp(ringColor(r2), t),
        detail: (r1.detail ?? options.detail ?? 1) * (1 - t) + (r2.detail ?? options.detail ?? 1) * t,
        indices,
        weights,
        v: 0,
      });
    }
  }
  let length = 0;
  samples.forEach((sample, i) => {
    if (i > 0) length += sample.p.distanceTo(samples[i - 1].p);
    sample.v = length;
  });

  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const details: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  const index: number[] = [];
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const point = new THREE.Vector3();
  const color = new THREE.Color();
  const columns = segments + 1;
  let lastSide: THREE.Vector3 | null = null;

  const push = (sample: Sample, position: THREE.Vector3, angle: number, u: number) => {
    positions.push(position.x, position.y, position.z);
    color.copy(sample.color);
    options.paint?.(color, angle, length > 0 ? sample.v / length : 0, position);
    colors.push(color.r, color.g, color.b);
    if (uvRect) {
      uvs.push(
        uvRect[0] + (uvRect[2] - uvRect[0]) * u,
        uvRect[1] + (uvRect[3] - uvRect[1]) * (length > 0 ? sample.v / length : 0),
      );
    } else uvs.push(u, sample.v);
    details.push(sample.detail);
    skinIndex.push(...sample.indices);
    skinWeight.push(...sample.weights);
  };

  samples.forEach((sample, i) => {
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(samples.length - 1, i + 1)];
    tangent.subVectors(next.p, prev.p).normalize();
    side.crossVectors(ref, tangent);
    if (side.lengthSq() < 1e-6) side.copy(lastSide ?? new THREE.Vector3(1, 0, 0));
    side.normalize();
    if (lastSide && side.dot(lastSide) < 0) side.negate();
    lastSide = (lastSide ?? new THREE.Vector3()).copy(side);
    up.crossVectors(tangent, side).normalize();
    for (let j = 0; j < columns; j += 1) {
      const u = j / segments;
      const angle = arc[0] + (arc[1] - arc[0]) * u;
      const sin = Math.sin(angle);
      point
        .copy(sample.p)
        .addScaledVector(side, sample.rx * Math.cos(angle))
        .addScaledVector(up, (sin >= 0 ? sample.ry : sample.down) * sin);
      push(sample, point, angle, u);
    }
    if (i > 0) {
      const a = (i - 1) * columns;
      const b = i * columns;
      for (let j = 0; j < segments; j += 1) {
        index.push(a + j, a + j + 1, b + j, a + j + 1, b + j + 1, b + j);
      }
    }
  });

  if (closed) {
    for (const [end, enabled] of [
      [0, options.capStart ?? true],
      [samples.length - 1, options.capEnd ?? true],
    ] as const) {
      if (!enabled) continue;
      const sample = samples[end];
      const centre = positions.length / 3;
      push(sample, sample.p, 0, 0.5);
      const base = end * columns;
      for (let j = 0; j < segments; j += 1) {
        if (end === 0) index.push(centre, base + j + 1, base + j);
        else index.push(centre, base + j, base + j + 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('detail', new THREE.Float32BufferAttribute(details, 1));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  if (closed) {
    const normal = geometry.getAttribute('normal');
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 0; i < samples.length; i += 1) {
      const first = i * columns;
      const last = first + segments;
      a.fromBufferAttribute(normal, first);
      b.fromBufferAttribute(normal, last);
      a.add(b).normalize();
      normal.setXYZ(first, a.x, a.y, a.z);
      normal.setXYZ(last, a.x, a.y, a.z);
    }
  }
  return geometry;
}

export function ball(
  centre: Vec3,
  radius: Vec3 | number,
  options: LoftOptions & { axis?: Vec3; rings?: number } = {},
): THREE.BufferGeometry {
  const r: Vec3 = typeof radius === 'number' ? [radius, radius, radius] : radius;
  const count = options.rings ?? 6;
  const rings: Ring[] = [];
  for (let i = 0; i <= count; i += 1) {
    const a = (i / count) * Math.PI;
    const s = Math.max(0.02, Math.sin(a));
    rings.push({ p: [centre[0], centre[1], centre[2] - Math.cos(a) * r[2]], rx: r[0] * s, ry: r[1] * s });
  }
  return loft(rings, { sub: 1, segments: 10, ...options });
}

export function mirrorX(geometry: THREE.BufferGeometry, remap?: (bone: number) => number): THREE.BufferGeometry {
  const mirrored = geometry.clone();
  const position = mirrored.getAttribute('position');
  const normal = mirrored.getAttribute('normal');
  for (let i = 0; i < position.count; i += 1) {
    position.setX(i, -position.getX(i));
    normal.setX(i, -normal.getX(i));
  }
  const index = mirrored.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      index.setX(i, index.getX(i + 1));
      index.setX(i + 1, a);
    }
  }
  if (remap) {
    const skin = mirrored.getAttribute('skinIndex');
    for (let i = 0; i < skin.count; i += 1) {
      skin.setXYZW(i, remap(skin.getX(i)), remap(skin.getY(i)), remap(skin.getZ(i)), remap(skin.getW(i)));
    }
  }
  return mirrored;
}

export function mergeGroups(groups: THREE.BufferGeometry[][]): THREE.BufferGeometry {
  const merged = groups.map((list) => mergeGeometries(list, false));
  const geometry = mergeGeometries(merged, true);
  for (const list of groups) for (const item of list) item.dispose();
  for (const item of merged) item.dispose();
  return geometry;
}

export class Skeleton {
  readonly bones: THREE.Bone[] = [];
  readonly rest: THREE.Vector3[] = [];
  readonly parents: number[] = [];

  add(parent: number, position: Vec3): number {
    const bone = new THREE.Bone();
    const world = new THREE.Vector3(...position);
    if (parent >= 0) {
      bone.position.copy(world).sub(this.rest[parent]);
      this.bones[parent].add(bone);
    } else bone.position.copy(world);
    this.bones.push(bone);
    this.rest.push(world);
    this.parents.push(parent);
    return this.bones.length - 1;
  }

  chain(parent: number, points: Vec3[]): number[] {
    let last = parent;
    return points.map((point) => {
      last = this.add(last, point);
      return last;
    });
  }

  skin(geometry: THREE.BufferGeometry, materials: THREE.Material | THREE.Material[]): THREE.SkinnedMesh {
    const mesh = new THREE.SkinnedMesh(geometry, materials);
    for (let i = 0; i < this.bones.length; i += 1) if (this.parents[i] < 0) mesh.add(this.bones[i]);
    mesh.bind(new THREE.Skeleton(this.bones));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);

export function tileNoise(size: number, cells: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const fy = (y / size) * cells;
    const y0 = Math.floor(fy);
    const ty = fade(fy - y0);
    for (let x = 0; x < size; x += 1) {
      const fx = (x / size) * cells;
      const x0 = Math.floor(fx);
      const tx = fade(fx - x0);
      const a = hash2(x0 % cells, y0 % cells, seed);
      const b = hash2((x0 + 1) % cells, y0 % cells, seed);
      const c = hash2(x0 % cells, (y0 + 1) % cells, seed);
      const d = hash2((x0 + 1) % cells, (y0 + 1) % cells, seed);
      out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return out;
}

export function tileFbm(size: number, cells: number, octaves: number, seed: number, gain = 0.5): Float32Array {
  const out = new Float32Array(size * size);
  let amplitude = 1;
  let total = 0;
  for (let o = 0; o < octaves; o += 1) {
    const layer = tileNoise(size, cells * 2 ** o, seed + o * 17);
    for (let i = 0; i < out.length; i += 1) out[i] += layer[i] * amplitude;
    total += amplitude;
    amplitude *= gain;
  }
  for (let i = 0; i < out.length; i += 1) out[i] /= total;
  return out;
}

export type Texel = (x: number, y: number, i: number) => [number, number, number];

export function pixelTexture(size: number, texel: Texel, srgb = true): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const [r, g, b] = texel(x, y, i);
      image.data[i * 4] = Math.max(0, Math.min(255, r * 255));
      image.data[i * 4 + 1] = Math.max(0, Math.min(255, g * 255));
      image.data[i * 4 + 2] = Math.max(0, Math.min(255, b * 255));
      image.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function normalTexture(height: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  return pixelTexture(
    size,
    (x, y) => {
      const l = height[y * size + ((x + size - 1) % size)];
      const r = height[y * size + ((x + 1) % size)];
      const u = height[((y + size - 1) % size) * size + x];
      const d = height[((y + 1) % size) * size + x];
      const nx = (l - r) * strength;
      const ny = (u - d) * strength;
      const inv = 1 / Math.hypot(nx, ny, 1);
      return [nx * inv * 0.5 + 0.5, -ny * inv * 0.5 + 0.5, inv * 0.5 + 0.5];
    },
    false,
  );
}

export type DetailOptions = {
  map: THREE.Texture;
  scale: number;
  strength?: number;
};

export function triplanarDetail(material: THREE.MeshStandardMaterial, options: DetailOptions): void {
  const uniforms = {
    uDetailMap: { value: options.map },
    uDetailScale: { value: options.scale },
    uDetailStrength: { value: options.strength ?? 1 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float detail;\nvarying vec3 vRestPosition;\nvarying vec3 vRestNormal;\nvarying float vDetail;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRestPosition = position;\nvRestNormal = normal;\nvDetail = detail;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uDetailMap;\nuniform float uDetailScale;\nuniform float uDetailStrength;\nvarying vec3 vRestPosition;\nvarying vec3 vRestNormal;\nvarying float vDetail;',
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'vec3 triWeight = pow(abs(normalize(vRestNormal)), vec3(4.0));',
          'triWeight /= triWeight.x + triWeight.y + triWeight.z;',
          'vec3 triPos = vRestPosition * uDetailScale;',
          'vec3 triColor = texture2D(uDetailMap, triPos.zy).rgb * triWeight.x + texture2D(uDetailMap, triPos.xz).rgb * triWeight.y + texture2D(uDetailMap, triPos.xy).rgb * triWeight.z;',
          'diffuseColor.rgb *= mix(vec3(1.0), triColor, clamp(vDetail * uDetailStrength, 0.0, 1.0));',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => `detail:${options.map.uuid}`;
}

export function rotate2(z: number, y: number, angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [z * c - y * s, z * s + y * c];
}

export type LimbSolution = { upper: number; middle: number; lower: number };

export function solveLimb(
  rootZ: number,
  rootY: number,
  targetZ: number,
  targetY: number,
  upperLength: number,
  middleLength: number,
  lowerLength: number,
  flex: number,
  bend: number,
  out: LimbSolution,
): LimbSolution {
  const vz = middleLength + lowerLength * Math.cos(flex);
  const vy = lowerLength * Math.sin(flex);
  const virtual = Math.hypot(vz, vy);
  const offset = Math.atan2(vy, vz);
  const dz = targetZ - rootZ;
  const dy = targetY - rootY;
  const reach = Math.max(
    Math.abs(upperLength - virtual) + 1e-3,
    Math.min(upperLength + virtual - 1e-3, Math.hypot(dz, dy)),
  );
  const direction = Math.atan2(dy, dz);
  const cos = (upperLength * upperLength + reach * reach - virtual * virtual) / (2 * upperLength * reach);
  out.upper = direction + bend * Math.acos(Math.max(-1, Math.min(1, cos)));
  const kz = rootZ + Math.cos(out.upper) * upperLength;
  const ky = rootY + Math.sin(out.upper) * upperLength;
  const tz = rootZ + Math.cos(direction) * reach;
  const ty = rootY + Math.sin(direction) * reach;
  out.middle = Math.atan2(ty - ky, tz - kz) - offset;
  out.lower = out.middle + flex;
  return out;
}

export function noise2(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const tx = fx * fx * (3 - 2 * fx);
  const ty = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

export function fbm2(x: number, y: number, octaves: number, seed: number): number {
  let amplitude = 1;
  let total = 0;
  let sum = 0;
  let frequency = 1;
  for (let o = 0; o < octaves; o += 1) {
    sum += noise2(x * frequency, y * frequency, seed + o * 31) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / total;
}
