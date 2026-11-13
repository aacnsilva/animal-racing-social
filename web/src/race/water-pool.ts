import * as THREE from 'three';
import type { TrackPath } from '../lib/track';
import {
  Batch,
  blob,
  fbm3,
  ground,
  instanced,
  noise3,
  orient,
  paint,
  panel,
  prep,
  trackSkirt,
  trackStrip,
  trackTube,
  tube,
  xf,
  type Placement,
  type Rect,
} from './water-props';
import { Stage, planeSurface, sunFrom, type VenueHints } from './water-stage';
import { grassTexture, labelTexture, paverTextures, ropeTexture, tileTextures } from './water-textures';

const DECK = 10.6;
const LEVEL = 10.3;
const DECK_WIDTH = 14;
const SUN = sunFrom(58, 150);

function crossBar(
  track: TrackPath,
  s: number,
  a: number,
  b: number,
  half: number,
  y: number,
  tint: string,
): THREE.BufferGeometry {
  const corners = [
    track.point(s - half, a),
    track.point(s - half, b),
    track.point(s + half, a),
    track.point(s + half, b),
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      corners.flatMap((p) => [p.x, p.y + y, p.z]),
      3,
    ),
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(
      corners.flatMap((p) => [p.x / 4, p.z / 4]),
      2,
    ),
  );
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  return paint(orient(geometry), tint);
}

function lounger(cushion: string): THREE.BufferGeometry {
  const b = new Batch();
  const white = '#f1efe8';
  b.box(0.66, 0.05, 1.25, white, 0, 0.3, 0.3);
  b.add(new THREE.BoxGeometry(0.66, 0.05, 0.8), white, xf(0, 0.526, -0.655, 0, 1, 1, 1, 0.6));
  b.box(0.58, 0.07, 1.2, cushion, 0, 0.36, 0.3);
  b.add(new THREE.BoxGeometry(0.58, 0.07, 0.74), cushion, xf(0, 0.575, -0.625, 0, 1, 1, 1, 0.6));
  for (const x of [-0.29, 0.29]) for (const z of [-0.25, 0.85]) b.box(0.05, 0.3, 0.05, white, x, 0.15, z);
  return b.build();
}

function umbrella(color: string): THREE.BufferGeometry {
  const b = new Batch();
  const main = new THREE.Color(color);
  const trim = new THREE.Color('#f6f3ea');
  const profile = [
    [0.03, 2.78],
    [0.5, 2.68],
    [1.2, 2.45],
    [1.8, 2.16],
    [1.8, 2.04],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  b.add(new THREE.LatheGeometry(profile, 16), (out, p) => {
    const r = Math.hypot(p.x, p.z);
    out.copy(r < 0.35 || p.y < 2.14 ? trim : main);
    out.multiplyScalar(0.85 + r * 0.08);
  });
  b.add(new THREE.CylinderGeometry(0.035, 0.035, 2.75, 6), '#e4e2dc', xf(0, 1.375, 0));
  b.add(new THREE.CylinderGeometry(0.3, 0.34, 0.12, 10), '#8a8f94', xf(0, 0.06, 0));
  return b.build();
}

function startingBlock(top: string): THREE.BufferGeometry {
  const b = new Batch();
  b.box(0.5, 0.42, 0.46, '#d9dde0', 0, 0.21, -0.1);
  b.add(new THREE.BoxGeometry(0.62, 0.07, 0.74), top, xf(0, 0.5, 0, 0, 1, 1, 1, 0.16));
  b.box(0.5, 0.3, 0.04, '#f4f4f0', 0, 0.2, 0.14);
  b.add(new THREE.BoxGeometry(0.62, 0.2, 0.05), '#20262c', xf(0, 0.6, -0.42, 0, 1, 1, 1, 0.5));
  return b.build();
}

function ladder(): THREE.BufferGeometry {
  const b = new Batch();
  const steel = '#d3dade';
  for (const x of [-0.27, 0.27]) {
    b.add(
      tube(
        [
          [x, -1.9, 0.14],
          [x, -0.4, 0.14],
          [x, 0.55, 0.1],
          [x, 0.88, -0.12],
          [x, 0.86, -0.42],
          [x, 0.5, -0.62],
          [x, 0, -0.66],
        ],
        0.026,
        6,
        steel,
        3,
      ),
    );
  }
  for (let i = 0; i < 5; i += 1) b.box(0.54, 0.035, 0.12, steel, 0, -0.45 - i * 0.33, 0.14);
  return b.build();
}

function lifeguardChair(): THREE.BufferGeometry {
  const b = new Batch();
  const white = '#f3f1ea';
  const red = '#c9302c';
  for (const x of [-0.5, 0.5]) {
    b.add(new THREE.BoxGeometry(0.08, 2.5, 0.08), white, xf(x, 1.22, 0.45, 0, 1, 1, 1, -0.18));
    b.add(new THREE.BoxGeometry(0.08, 2.5, 0.08), white, xf(x, 1.22, -0.45, 0, 1, 1, 1, 0.18));
  }
  for (let i = 0; i < 5; i += 1) b.box(0.94, 0.05, 0.08, white, 0, 0.4 + i * 0.42, 0.62 - i * 0.075);
  b.box(1.2, 0.08, 1.1, white, 0, 2.45, 0);
  b.box(1.0, 0.1, 0.9, red, 0, 2.54, 0);
  b.box(1.0, 0.8, 0.08, red, 0, 2.95, -0.5);
  for (const x of [-0.56, 0.56]) b.box(0.06, 0.3, 1.0, white, x, 2.7, 0);
  b.add(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6), white, xf(0, 3.4, -0.5));
  b.add(new THREE.ConeGeometry(1.2, 0.4, 12), red, xf(0, 4.5, -0.5));
  return b.build();
}

function hedge(seed: number): THREE.BufferGeometry {
  const geometry = prep(new THREE.BoxGeometry(5.2, 1.5, 1.4, 9, 3, 3));
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const k = y > -0.7 ? 1 : 0;
    const d = (noise3(x * 1.3 + seed, y * 1.3, z * 1.3, seed) - 0.5) * 0.3 * k;
    const round = y > 0.5 ? 1 - Math.abs(z) * 0.25 : 1;
    position.setXYZ(i, x + d * 0.4, (y + 0.75) * round + d, z * (y > 0.5 ? 0.88 : 1) + d);
  }
  geometry.computeVertexNormals();
  return paint(geometry, (out, p) => {
    const v = fbm3(p.x * 2.1, p.y * 2.1, p.z * 2.1, seed, 3);
    out.setRGB(0.03 + v * 0.03, 0.09 + v * 0.07, 0.025 + v * 0.015).multiplyScalar(0.55 + Math.min(1, p.y / 1.5) * 0.6);
  });
}

function roundTree(random: () => number, seed: number): THREE.BufferGeometry {
  const b = new Batch();
  const bark: [number, number, number] = [0.2, 0.13, 0.08];
  b.add(
    tube(
      [
        [0, -0.2, 0],
        [0.05, 1.2, 0.03],
        [-0.04, 2.6, 0.06],
        [0.1, 3.8, -0.05],
      ],
      [0.26, 0.2, 0.16, 0.09],
      7,
      (out, p) => {
        out
          .setRGB(bark[0] * 0.4, bark[1] * 0.4, bark[2] * 0.4)
          .multiplyScalar(0.7 + noise3(p.x * 9, p.y * 3, p.z * 9, seed) * 0.6);
      },
      2,
    ),
  );
  const lobes = 6;
  for (let i = 0; i < lobes; i += 1) {
    const angle = (i / (lobes - 1)) * Math.PI * 2;
    const main = i === 0;
    const r = main ? 2.1 : 1.3 + random() * 0.5;
    const d = main ? 0 : 1.2 + random() * 0.5;
    const cy = main ? 4.6 : 3.7 + random() * 1.1;
    const cx = Math.cos(angle) * d;
    const cz = Math.sin(angle) * d;
    const leaf = blob(main ? 2 : 1, seed + i * 7, 0.22, 0.85, '#ffffff', -2);
    leaf.applyMatrix4(xf(cx, cy, cz, random() * 6, r));
    paint(leaf, (out, p, n) => {
      const v = fbm3(p.x * 1.4, p.y * 1.4, p.z * 1.4, seed, 3);
      const light = 0.5 + Math.max(0, n.y) * 0.45 + Math.min(1, Math.max(0, (p.y - 2.6) / 3.5)) * 0.3;
      out.setRGB(0.035 + v * 0.05, 0.1 + v * 0.1, 0.02 + v * 0.02).multiplyScalar(light);
    });
    b.add(leaf);
  }
  return b.build();
}

function palmTree(random: () => number, seed: number): THREE.BufferGeometry {
  const b = new Batch();
  const lean = 0.5 + random() * 0.5;
  const height = 6.5;
  const spine = Array.from({ length: 6 }, (_, i): [number, number, number] => {
    const t = i / 5;
    return [lean * t * t * 1.4, -0.2 + t * (height + 0.2), 0];
  });
  b.add(
    tube(spine, [0.24, 0.19, 0.17, 0.15, 0.14, 0.15], 7, (out, p) => {
      const ring = Math.sin(p.y * 14) * 0.12;
      out.setRGB(0.13, 0.1, 0.07).multiplyScalar(0.75 + ring + noise3(p.x * 6, p.y * 2, p.z * 6, seed) * 0.3);
    }),
  );
  const top = spine[5];
  const fronds = 17;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let k = 0; k < fronds; k += 1) {
    const yaw = (k / fronds) * Math.PI * 2 + random() * 0.4;
    const length = 2.6 + random() * 0.9;
    const lift = 0.5 + random() * 0.7;
    const dx = Math.cos(yaw);
    const dz = Math.sin(yaw);
    const segs = 6;
    for (const sideSign of [-1, 1]) {
      const base = positions.length / 3;
      for (let s = 0; s <= segs; s += 1) {
        const f = s / segs;
        const out = f * length;
        const y = top[1] + lift * f * 1.7 - f * f * (lift + 1.4 + random() * 0.2);
        const w = 0.26 * Math.sin(Math.PI * (0.08 + f * 0.9));
        const px = top[0] + dx * out;
        const pz = top[2] + dz * out;
        positions.push(px, y, pz, px - dz * w * sideSign, y - w * 0.7, pz + dx * w * sideSign);
        normals.push(0, 1, 0, -dz * 0.4 * sideSign, 0.9, dx * 0.4 * sideSign);
        uvs.push(0, f, 1, f);
        const g = 0.2 + f * 0.08 + random() * 0.03;
        colors.push(0.035, g * 0.6, 0.02, 0.02, g * 0.45, 0.015);
        if (s > 0) {
          const q = base + (s - 1) * 2;
          indices.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
        }
      }
    }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  leaves.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  leaves.setIndex(indices);
  b.add(leaves);
  b.add(new THREE.IcosahedronGeometry(0.3, 1), '#3b2c1c', xf(top[0], top[1] - 0.1, top[2]));
  return b.build();
}

function poolHouse(length: number): THREE.BufferGeometry {
  const b = new Batch();
  const stucco = '#ece3d2';
  b.box(8, 3.6, length, stucco, 0, 1.8, 0);
  for (const side of [-1, 1]) {
    b.add(
      new THREE.BoxGeometry(5, 0.14, length + 1.2),
      '#a94f3a',
      xf(side * 2.3, 4.35, 0, 0, 1, 1, 1, 0, -side * 0.33),
    );
  }
  b.box(0.3, 0.2, length + 1.2, '#8f4030', 0, 5.12, 0);
  const bays = Math.max(2, Math.floor(length / 5));
  for (let i = 0; i < bays; i += 1) {
    const z = -length / 2 + ((i + 0.5) * length) / bays;
    if (i % 3 === 1) b.box(0.12, 2.3, 1.3, '#2f6f8f', -4.02, 1.15, z);
    else b.box(0.1, 1.2, 2.2, '#22303c', -4.02, 2.0, z);
    b.box(1.6, 0.08, 3.4, i % 2 ? '#e9e4d8' : '#2f6f8f', -4.8, 2.95, z);
  }
  b.box(8.6, 0.25, length + 0.6, '#d8cfbd', 0, 0.12, 0);
  return b.build();
}

export function buildPool(track: TrackPath, random: () => number): { stage: Stage; hints: VenueHints } {
  const margin = 3;
  const rect: Rect = {
    minX: track.minX - margin,
    maxX: track.maxX + margin,
    minZ: track.minZ - margin,
    maxZ: track.maxZ + margin,
  };
  const width = rect.maxX - rect.minX;
  const depth = rect.maxZ - rect.minZ;
  const cx = (rect.minX + rect.maxX) / 2;
  const cz = (rect.minZ + rect.maxZ) / 2;
  const stage = new Stage(track, random, {
    level: LEVEL,
    boxMin: new THREE.Vector3(rect.minX, -2, rect.minZ),
    boxMax: new THREE.Vector3(rect.maxX, LEVEL, rect.maxZ),
    scatter: '#3fa9d2',
    deep: '#2a86bd',
    shallow: '#8ed5ec',
    extinction: [0.042, 0.013, 0.0095],
    sun: SUN,
    causticScale: 1 / 6.5,
    causticStrength: 0.9,
    skyZenith: '#3f82d4',
    skyHorizon: '#c4e6f8',
    sunColor: '#fff2d2',
    sunPower: 5,
    ceiling: [0, 0, 0, 0],
  });
  const tiles = tileTextures('#e6f3f6', '#9fc4cf', 7);
  stage.keep(tiles.map);
  stage.keep(tiles.normalMap);
  const tileMaterial = stage.standard({
    map: tiles.map,
    normalMap: tiles.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.22,
    vertexColors: true,
  });
  const shell = new Batch();
  shell.copy(ground(rect, 0, 1 / 4));
  const walls = [
    { length: width, x: cx, z: rect.minZ, ry: 0, nx: 0, nz: 1 },
    { length: width, x: cx, z: rect.maxZ, ry: Math.PI, nx: 0, nz: -1 },
    { length: depth, x: rect.minX, z: cz, ry: Math.PI / 2, nx: 1, nz: 0 },
    { length: depth, x: rect.maxX, z: cz, ry: -Math.PI / 2, nx: -1, nz: 0 },
  ];
  const labels = new Batch();
  const lamps = new Batch();
  for (const wall of walls) {
    shell.copy(panel(wall.length, DECK, wall.length / 4, DECK / 4, xf(wall.x, DECK / 2, wall.z, wall.ry)));
    shell.copy(
      panel(
        wall.length,
        1.0,
        wall.length / 4,
        0.25,
        xf(wall.x + wall.nx * 0.015, DECK - 0.5, wall.z + wall.nz * 0.015, wall.ry),
        '#1c5fa3',
      ),
      new THREE.Matrix4(),
    );
    shell.copy(
      panel(
        wall.length,
        0.5,
        wall.length / 4,
        0.125,
        xf(wall.x + wall.nx * 0.015, 0.25, wall.z + wall.nz * 0.015, wall.ry),
        '#2a6fb0',
      ),
      new THREE.Matrix4(),
    );
    const count = Math.max(2, Math.round(wall.length / 16));
    for (let i = 0; i < count; i += 1) {
      const t = -wall.length / 2 + ((i + 0.5) * wall.length) / count;
      const x = wall.x + Math.cos(wall.ry) * t + wall.nx * 0.03;
      const z = wall.z - Math.sin(wall.ry) * t + wall.nz * 0.03;
      lamps.add(new THREE.CircleGeometry(0.24, 18), '#ffffff', xf(x, LEVEL - 2.4, z, wall.ry));
      if (i % 2 === 0) {
        const lx = x + Math.cos(wall.ry) * 4;
        const lz = z - Math.sin(wall.ry) * 4;
        labels.copy(panel(1.5, 0.75, 1, 1, xf(lx, LEVEL - 1.35, lz, wall.ry)));
      }
    }
  }
  if (track.maxY > 0.05) {
    const inside = track.innerOffset() - 1.4;
    const outside = track.outerOffset() + 1.4;
    shell.copy(trackStrip(track, inside, outside, 0.004, 0.004, 1.5, 1 / 4));
    shell.copy(trackSkirt(track, inside, 0.004, -1, 1.5, 1 / 4, '#cfe4ea'));
    shell.copy(trackSkirt(track, outside, 0.004, 1, 1.5, 1 / 4, '#cfe4ea'));
  }
  const navy = '#0f1c36';
  for (let lane = 1; lane <= track.lanes; lane += 1) {
    const offset = track.laneOffset(lane);
    shell.copy(trackStrip(track, offset - 0.13, offset + 0.13, 0.02, 0.02, 1.5, 1 / 4, navy));
    for (let s = 0; s < track.lapLength - 12; s += 25) {
      shell.copy(crossBar(track, s + 4, offset - 0.5, offset + 0.5, 0.13, 0.021, navy));
    }
  }
  for (const lateral of [track.innerOffset() - 0.3, track.outerOffset() + 0.3]) {
    shell.copy(trackStrip(track, lateral - 0.22, lateral + 0.22, 0.02, 0.02, 1.5, 1 / 4, '#1c5fa3'));
  }
  stage.mesh(shell.build(), tileMaterial, 'receive');

  const labelMap = stage.keep(labelTexture(['10 m'], '#f4f6f6', '#12305e'));
  stage.mesh(labels.build(), stage.standard({ map: labelMap, roughness: 0.3 }), 'none');
  stage.mesh(lamps.build(), stage.basic({ color: new THREE.Color(2.6, 2.9, 2.7) }), 'none');

  const ropeMap = stage.keep(ropeTexture(['#d62828', '#f4f4f0', '#1d4ed8', '#f4f4f0'], 5));
  const ropes = new Batch();
  for (let k = 0; k <= track.lanes; k += 1) {
    const lateral = track.innerOffset() + k * 1.4;
    ropes.copy(
      trackTube(track, lateral, (s) => LEVEL - 0.02 - track.frame(s).y, 0.085, 4, 1.5, 1 / 3),
      new THREE.Matrix4(),
    );
  }
  const metal = new Batch();
  const steel = '#cfd6da';
  const post = prep(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 5), steel);
  const foot = prep(new THREE.CylinderGeometry(0.16, 0.2, 0.08, 8), '#8f989e');
  for (const lateral of [track.innerOffset() - 0.3, track.outerOffset() + 0.3]) {
    ropes.copy(trackTube(track, lateral, () => 0.75, 0.11, 6, 1.5, 1 / 3));
    for (const s of track.samples(10).slice(1)) {
      const p = track.point(s, lateral);
      metal.copy(post, xf(p.x, p.y + 0.375, p.z));
      metal.copy(foot, xf(p.x, p.y + 0.04, p.z));
    }
  }
  post.dispose();
  foot.dispose();
  stage.mesh(ropes.build(), stage.standard({ map: ropeMap, roughness: 0.5 }), 'cast');

  const matte = new Batch();
  const outer: Rect = {
    minX: rect.minX - DECK_WIDTH,
    maxX: rect.maxX + DECK_WIDTH,
    minZ: rect.minZ - DECK_WIDTH,
    maxZ: rect.maxZ + DECK_WIDTH,
  };
  const deck = new Batch();
  const coping = '#f2efe6';
  const grate = '#3d444a';
  for (const area of [
    { minX: outer.minX, maxX: outer.maxX, minZ: rect.maxZ, maxZ: outer.maxZ },
    { minX: outer.minX, maxX: outer.maxX, minZ: outer.minZ, maxZ: rect.minZ },
    { minX: outer.minX, maxX: rect.minX, minZ: rect.minZ, maxZ: rect.maxZ },
    { minX: rect.maxX, maxX: outer.maxX, minZ: rect.minZ, maxZ: rect.maxZ },
  ]) {
    deck.copy(ground(area, DECK, 1 / 3));
  }
  for (const wall of walls) {
    const along = wall.length + 1.3;
    matte.add(
      new THREE.BoxGeometry(along, 0.16, 0.62),
      coping,
      xf(wall.x - wall.nx * 0.26, DECK - 0.02, wall.z - wall.nz * 0.26, wall.ry),
    );
    matte.add(
      new THREE.BoxGeometry(along + 1.2, 0.03, 0.3),
      grate,
      xf(wall.x - wall.nx * 0.75, DECK, wall.z - wall.nz * 0.75, wall.ry),
    );
  }
  const pavers = paverTextures(19);
  stage.keep(pavers.map);
  stage.keep(pavers.normalMap);
  stage.mesh(
    deck.build(),
    stage.standard(
      { map: pavers.map, normalMap: pavers.normalMap, roughness: 0.85 },
      { caustics: -1, detail: 0.3, detailScale: 0.05 },
    ),
    'receive',
  );

  const far = Math.max(width, depth) * 4;
  const lawn = new Batch();
  for (const area of [
    { minX: cx - far, maxX: cx + far, minZ: outer.maxZ, maxZ: cz + far },
    { minX: cx - far, maxX: cx + far, minZ: cz - far, maxZ: outer.minZ },
    { minX: cx - far, maxX: outer.minX, minZ: outer.minZ, maxZ: outer.maxZ },
    { minX: outer.maxX, maxX: cx + far, minZ: outer.minZ, maxZ: outer.maxZ },
  ]) {
    lawn.copy(ground(area, DECK - 0.03, 1 / 5));
  }
  const grass = stage.keep(grassTexture(5));
  stage.mesh(
    lawn.build(),
    stage.standard({ map: grass, roughness: 1 }, { caustics: -1, detail: 0.4, detailScale: 0.017 }),
    'receive',
  );

  const cushions = ['#e4572e', '#17bebb', '#ffc914', '#f4f1e8', '#3a7ca5'];
  const loungers = cushions.map((c) => lounger(c));
  const umbrellas = cushions.map((c) => umbrella(c));
  for (const side of [-1, 1]) {
    const z = side < 0 ? rect.minZ - DECK_WIDTH * 0.55 : rect.maxZ + DECK_WIDTH * 0.55;
    const ry = side < 0 ? 0 : Math.PI;
    for (let x = rect.minX + 4; x < rect.maxX - 4; x += 6.5) {
      if (random() < 0.12) continue;
      const pick = Math.floor(random() * cushions.length);
      matte.copy(loungers[pick], xf(x - 0.75, DECK, z + (random() - 0.5) * 0.4, ry + (random() - 0.5) * 0.15));
      matte.copy(loungers[pick], xf(x + 0.75, DECK, z + (random() - 0.5) * 0.4, ry + (random() - 0.5) * 0.15));
      if (random() < 0.75) matte.copy(umbrellas[pick], xf(x, DECK, z - side * 0.2, random() * 6));
    }
  }
  const chair = lifeguardChair();
  matte.copy(chair, xf(cx, DECK, rect.minZ - 2.6, 0));
  matte.copy(chair, xf(cx + width * 0.25, DECK, rect.maxZ + 2.6, Math.PI));
  matte.copy(chair, xf(cx - width * 0.25, DECK, rect.maxZ + 2.6, Math.PI));
  const block = startingBlock('#1d4ed8');
  for (let i = 0; i < track.lanes; i += 1) {
    matte.copy(block, xf(rect.minX - 0.6, DECK, cz + (i - (track.lanes - 1) / 2) * 2.5, Math.PI / 2));
  }
  const steps = ladder();
  for (const t of [0.15, 0.4, 0.65, 0.9]) {
    metal.copy(steps, xf(rect.minX + width * t, DECK, rect.minZ, 0));
    metal.copy(steps, xf(rect.minX + width * (1 - t) + 6, DECK, rect.maxZ, Math.PI));
  }
  const hedges = [hedge(3), hedge(11), hedge(23)];
  let hedgeIndex = 0;
  const hedgeRun = (x0: number, z0: number, x1: number, z1: number) => {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const count = Math.floor(length / 5.1);
    const ry = Math.atan2(-(z1 - z0), x1 - x0);
    for (let i = 0; i < count; i += 1) {
      if (i % 9 === 4) continue;
      const t = (i + 0.5) / count;
      hedgeIndex += 1;
      matte.copy(
        hedges[hedgeIndex % hedges.length],
        xf(x0 + (x1 - x0) * t, DECK - 0.05, z0 + (z1 - z0) * t, ry, 1, 0.9 + random() * 0.25, 1),
      );
    }
  };
  hedgeRun(outer.minX, outer.minZ - 1, outer.maxX, outer.minZ - 1);
  hedgeRun(outer.minX, outer.maxZ + 1, outer.maxX, outer.maxZ + 1);
  hedgeRun(outer.minX - 1, outer.minZ, outer.minX - 1, outer.maxZ);
  const house = poolHouse(Math.min(60, depth * 0.7));
  matte.copy(house, xf(outer.maxX + 6, DECK - 0.03, cz, 0));

  const pennants = { positions: [] as number[], colors: [] as number[], normals: [] as number[], uvs: [] as number[] };
  const flagColors = ['#d62828', '#f4f4f0', '#1d4ed8', '#ffc914'].map((c) => new THREE.Color(c));
  for (const x of [rect.minX + 5, rect.maxX - 5]) {
    for (const z of [rect.minZ - 1, rect.maxZ + 1]) {
      metal.add(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 6), steel, xf(x, DECK + 1.1, z));
    }
    matte.box(0.02, 0.02, depth + 2, '#e9e9e4', x, DECK + 2.1, cz);
    const count = Math.floor((depth + 1) / 0.55);
    for (let i = 0; i < count; i += 1) {
      const z = rect.minZ - 0.5 + (i + 0.5) * 0.55;
      const c = flagColors[i % flagColors.length];
      pennants.positions.push(x, DECK + 2.09, z - 0.2, x, DECK + 2.09, z + 0.2, x, DECK + 1.62, z);
      pennants.normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0);
      pennants.uvs.push(0, 0, 1, 0, 0.5, 1);
      pennants.colors.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
    }
  }
  const pennantGeometry = new THREE.BufferGeometry();
  pennantGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pennants.positions, 3));
  pennantGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(pennants.normals, 3));
  pennantGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(pennants.uvs, 2));
  pennantGeometry.setAttribute('color', new THREE.Float32BufferAttribute(pennants.colors, 3));
  pennantGeometry.setIndex(Array.from({ length: pennants.positions.length / 3 }, (_, i) => i));
  matte.add(pennantGeometry);

  stage.mesh(
    matte.build(),
    stage.standard({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }, { caustics: -1 }),
    'receive',
  );
  stage.mesh(metal.build(), stage.standard({ vertexColors: true, roughness: 0.3, metalness: 0.65 }), 'both');
  for (const g of [...loungers, ...umbrellas, chair, block, steps, ...hedges, house]) g.dispose();

  const treeMaterial = stage.standard({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }, { caustics: -1 });
  const spots: Placement[] = [];
  let guard = 0;
  while (spots.length < 46 && guard < 2000) {
    guard += 1;
    const x = outer.minX - 60 + random() * (outer.maxX - outer.minX + 120);
    const z = outer.minZ - 60 + random() * (outer.maxZ - outer.minZ + 120);
    const inside = x > outer.minX - 5 && x < outer.maxX + 16 && z > outer.minZ - 5 && z < outer.maxZ + 5;
    if (inside) continue;
    spots.push({ x, y: DECK - 0.05, z, scale: 0.85 + random() * 0.7, rot: random() * 6.28 });
  }
  const jitter = (_i: number, out: THREE.Color) => {
    out.setRGB(0.8 + random() * 0.4, 0.8 + random() * 0.4, 0.75 + random() * 0.4);
  };
  stage.add(stage.shade(instanced(roundTree(random, 41), treeMaterial, spots, jitter), 'receive'));
  const palms: Placement[] = [];
  for (const z of [outer.minZ + 1.2, outer.maxZ - 1.2]) {
    for (let x = outer.minX + 3; x < outer.maxX; x += 17) {
      palms.push({ x: x + random() * 3, y: DECK, z, scale: 0.9 + random() * 0.35, rot: random() * 6.28 });
    }
  }
  stage.add(stage.shade(instanced(palmTree(random, 9), treeMaterial, palms, jitter), 'cast'));

  stage.surface(planeSurface(rect, LEVEL, 6), {
    floorMap: tiles.map,
    floorScale: 1 / 4,
    floorTint: '#ffffff',
    floorY: 0,
    swell: 0.035,
    chop: 0.085,
    ripple: [0.33, 0.83],
    body: 0,
    bodyRange: 1e5,
  });
  stage.shafts({ count: 28, wrap: 110, length: 12, width: 2.4, color: '#c9eeff', strength: 0.075 });
  stage.particles({ count: 600, wrap: [34, 10, 34], size: 0.03, color: '#eafcff', alpha: 0.5 });
  const jets = Array.from({ length: 8 }, (_, i) => {
    const wall = walls[i % 2];
    const t = (random() - 0.5) * wall.length * 0.9;
    return { x: wall.x + t, y: 0.1, z: wall.z + wall.nz * 0.6 };
  });
  stage.bubbles(jets, 14);

  return {
    stage,
    hints: {
      fog: {
        water: { color: '#3fa9d2', near: 1, far: 120 },
        air: { color: '#cfe6f4', near: track.size * 1.5, far: track.size * 6 },
      },
      background: { water: '#3fa9d2', air: null },
      sun: { direction: SUN.clone(), color: '#fff4e0', intensity: 3.4 },
      ambient: { sky: '#bfe3f7', ground: '#6fb7d6', intensity: 1.1 },
      environmentIntensity: 0.35,
      indoor: false,
    },
  };
}
