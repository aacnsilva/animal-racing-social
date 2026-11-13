import * as THREE from 'three';
import type { TrackPath } from '../lib/track';
import { loft } from './kit';
import {
  Batch,
  blob,
  fbm3,
  ground,
  instanced,
  panel,
  prep,
  rockPaint,
  deepInfield,
  trackBand,
  trackSkirt,
  trackStrip,
  trackTube,
  xf,
  type PaintFn,
  type Placement,
  type Rect,
} from './water-props';
import { addAnemones, addCorals, addFish, addGrass, addKelp, addRocks, reefMaterials } from './water-reef';
import { glassMaterial } from './water-shaders';
import { Stage, planeSurface, sunFrom, type VenueHints } from './water-stage';
import { gravelTextures, hallWallTexture, posterTexture, sandTextures } from './water-textures';

const HEIGHT = 15;
const LEVEL = 14.2;
const BASE = 1.1;
const HALL = 16;
const HALL_HEIGHT = 8;
const ROOF = 21;
const SUN = sunFrom(60, 150);
const RIG_SPACING = 12;

const lit: PaintFn = (out, _p, n) => {
  const f = 0.1 + 0.9 * Math.max(0, n.z) ** 1.4;
  out.setRGB(0.22 * f, 0.46 * f, 0.58 * f);
};

function visitor(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(
    prep(
      loft(
        [
          { p: [0, 0, 0], rx: 0.15, ry: 0.08 },
          { p: [0, 0.5, 0], rx: 0.16, ry: 0.09 },
          { p: [0, 0.9, 0], rx: 0.19, ry: 0.11 },
          { p: [0, 1.36, 0], rx: 0.24, ry: 0.11 },
          { p: [0, 1.5, 0], rx: 0.09, ry: 0.07 },
        ],
        { segments: 6, sub: 1, ref: [0, 0, 1], capStart: false },
      ),
      lit,
    ),
  );
  b.add(new THREE.SphereGeometry(0.115, 7, 5), lit, xf(0, 1.65, 0.01, 0, 1, 1.12, 1));
  return b.build();
}

function castle(seed: number): THREE.BufferGeometry {
  const b = new Batch();
  const stone = rockPaint('#b9b2a2', '#4f6b3a', seed);
  const roofTint: PaintFn = (out, p) => {
    out.set('#a8553f').multiplyScalar(0.7 + fbm3(p.x * 2, p.y * 2, p.z * 2, seed, 2) * 0.6);
  };
  const dark = '#141210';
  const towerProfile = [
    [1.25, 0],
    [1.15, 0.5],
    [1.05, 5.2],
    [1.3, 5.5],
    [1.3, 6.3],
    [1.02, 6.3],
    [1.02, 5.9],
    [0.02, 5.9],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const roofProfile = [
    [1.35, 0],
    [0.7, 1.3],
    [0.25, 2.3],
    [0.02, 2.9],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const corners: [number, number, number][] = [
    [-3.4, -3.4, 1.15],
    [3.4, -3.4, 1],
    [-3.4, 3.4, 1],
    [3.4, 3.4, 0.9],
  ];
  for (const [x, z, s] of corners) {
    b.add(new THREE.LatheGeometry(towerProfile, 14), stone, xf(x, -0.2, z, 0, 1, s, 1));
    if (s > 0.95) b.add(new THREE.LatheGeometry(roofProfile, 14), roofTint, xf(x, 6.2 * s - 0.2, z));
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      if (s <= 0.95)
        b.box(0.42, 0.42, 0.3, stone, x + Math.cos(a) * 1.16, 6.5 * s - 0.2, z + Math.sin(a) * 1.16, -a + Math.PI / 2);
    }
    b.box(
      0.3,
      0.7,
      0.12,
      dark,
      x + (x > 0 ? 1.06 : -1.06) * 0.72,
      3.6,
      z + (z > 0 ? 1.06 : -1.06) * 0.72,
      Math.atan2(x, z),
    );
  }
  const walls: [number, number, number][] = [
    [0, -3.4, 0],
    [0, 3.4, 0],
    [-3.4, 0, Math.PI / 2],
    [3.4, 0, Math.PI / 2],
  ];
  for (const [x, z, ry] of walls) {
    b.add(new THREE.BoxGeometry(5.2, 3.8, 0.8, 6, 4, 1), stone, xf(x, 1.7, z, ry));
    for (let k = -2; k <= 2; k += 1) {
      b.box(0.5, 0.5, 0.8, stone, x + Math.cos(ry) * k * 1.0, 3.85, z - Math.sin(ry) * k * 1.0, ry);
    }
  }
  b.add(new THREE.BoxGeometry(4.2, 5.4, 4.2, 4, 5, 4), stone, xf(0, 2.5, 0));
  b.add(new THREE.ConeGeometry(3.4, 2.6, 4, 1), roofTint, xf(0, 6.5, 0, Math.PI / 4));
  b.box(1.5, 1.7, 0.2, dark, 0, 0.75, 3.82);
  b.add(
    new THREE.CylinderGeometry(0.75, 0.75, 0.2, 12, 1, false, 0, Math.PI),
    dark,
    xf(0, 1.6, 3.82, 0, 1, 1, 1, Math.PI / 2, Math.PI / 2),
  );
  for (const x of [-1.2, 1.2]) b.box(0.4, 0.8, 0.1, dark, x, 3.6, 2.12);
  return b.build();
}

function chest(): THREE.BufferGeometry {
  const b = new Batch();
  const wood = '#6a4426';
  const band = '#c59a3a';
  b.box(1.7, 0.9, 1.05, wood, 0, 0.45, 0);
  b.add(
    new THREE.CylinderGeometry(0.53, 0.53, 1.7, 12, 1, false, 0, Math.PI),
    wood,
    xf(0, 1.15, -0.62, 0, 1, 1, 1, -0.9, Math.PI / 2),
  );
  for (const x of [-0.6, 0, 0.6]) b.box(0.12, 0.94, 1.09, band, x, 0.45, 0);
  b.add(
    new THREE.SphereGeometry(0.72, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    '#f0c040',
    xf(0, 0.72, 0, 0, 1, 0.45, 0.62),
  );
  return b.build();
}

export function buildAquarium(track: TrackPath, random: () => number): { stage: Stage; hints: VenueHints } {
  const margin = 7;
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
  const alongX = width >= depth;
  const stage = new Stage(track, random, {
    level: LEVEL,
    boxMin: new THREE.Vector3(rect.minX, -2, rect.minZ),
    boxMax: new THREE.Vector3(rect.maxX, LEVEL, rect.maxZ),
    scatter: '#1c80a0',
    deep: '#0f4f6e',
    shallow: '#55bfd0',
    extinction: [0.034, 0.016, 0.0145],
    sun: SUN,
    causticScale: 1 / 5,
    causticStrength: 1,
    skyZenith: '#1b4a5c',
    skyHorizon: '#05131b',
    sunColor: '#e6fbff',
    sunPower: 5,
    ceiling: [HEIGHT + 2.4 - LEVEL, RIG_SPACING, alongX ? 0 : 1, 1],
  });
  stage.envIntensity = 0.18;

  const gravel = gravelTextures(3);
  stage.keep(gravel.map);
  stage.keep(gravel.normalMap);
  stage.mesh(
    ground(rect, 0, 1 / 3.2),
    stage.standard({ map: gravel.map, normalMap: gravel.normalMap, roughness: 1 }, { detail: 0.45, detailScale: 0.06 }),
    'receive',
  );

  const sand = sandTextures(11, 5);
  stage.keep(sand.map);
  stage.keep(sand.normalMap);
  const course = new Batch();
  course.copy(
    trackStrip(track, track.innerOffset() - 0.9, track.outerOffset() + 0.9, 0.03, 0.03, 1.5, 1 / 5, '#e9dfc6'),
  );
  course.copy(
    trackStrip(track, track.innerOffset() - 1.6, track.innerOffset() - 0.9, 0.0, 0.03, 1.5, 1 / 5, '#d9cdb0'),
  );
  course.copy(
    trackStrip(track, track.outerOffset() + 0.9, track.outerOffset() + 1.6, 0.03, 0.0, 1.5, 1 / 5, '#d9cdb0'),
  );
  if (track.maxY > 0.05) {
    course.copy(trackSkirt(track, track.innerOffset() - 1.6, 0, -1, 1.5, 1 / 5, '#cbbf9f'));
    course.copy(trackSkirt(track, track.outerOffset() + 1.6, 0, 1, 1.5, 1 / 5, '#cbbf9f'));
  }
  for (let lane = 1; lane < track.lanes; lane += 1) {
    const offset = track.laneOffset(lane) + 0.7;
    course.copy(trackStrip(track, offset - 0.06, offset + 0.06, 0.045, 0.045, 1.5, 1 / 5, '#ffffff'));
  }
  stage.mesh(
    course.build(),
    stage.standard({ map: sand.map, normalMap: sand.normalMap, vertexColors: true, roughness: 1 }),
    'receive',
  );

  const glow = new Batch();
  const led = new THREE.Color(0.35, 2.3, 2.7);
  for (const lateral of [track.innerOffset() - 0.45, track.outerOffset() + 0.45]) {
    glow.copy(trackTube(track, lateral, () => 0.12, 0.06, 5, 1.5, 1, led));
  }

  const frame = new Batch();
  const steel = '#2a343b';
  const glass = new Batch();
  const hallWalls = new Batch();
  const hallFloor = new Batch();
  const posters = new Batch();
  const sides = [
    { length: width, x: cx, z: rect.minZ, ry: 0, nx: 0, nz: 1 },
    { length: width, x: cx, z: rect.maxZ, ry: Math.PI, nx: 0, nz: -1 },
    { length: depth, x: rect.minX, z: cz, ry: Math.PI / 2, nx: 1, nz: 0 },
    { length: depth, x: rect.maxX, z: cz, ry: -Math.PI / 2, nx: -1, nz: 0 },
  ];
  const people: Placement[] = [];
  for (const side of sides) {
    const ux = Math.cos(side.ry);
    const uz = -Math.sin(side.ry);
    glass.copy(panel(side.length, HEIGHT - BASE, side.length, 1, xf(side.x, (HEIGHT + BASE) / 2, side.z, side.ry)));
    frame.box(
      side.length + 1,
      BASE + 0.1,
      1.1,
      '#1c2228',
      side.x - side.nx * 0.35,
      BASE / 2 - 0.05,
      side.z - side.nz * 0.35,
      side.ry,
    );
    frame.box(side.length + 1, 0.45, 0.6, steel, side.x - side.nx * 0.2, HEIGHT + 0.1, side.z - side.nz * 0.2, side.ry);
    frame.copy(
      panel(
        side.length,
        BASE,
        side.length / 3,
        BASE / 3,
        xf(side.x + side.nx * 0.02, BASE / 2, side.z + side.nz * 0.02, side.ry),
        '#39424a',
      ),
    );
    const columns = Math.max(2, Math.round(side.length / 16));
    for (let i = 0; i <= columns; i += 1) {
      const t = -side.length / 2 + (i * side.length) / columns;
      frame.box(
        0.4,
        HEIGHT - BASE,
        0.5,
        steel,
        side.x + ux * t - side.nx * 0.3,
        (HEIGHT + BASE) / 2,
        side.z + uz * t - side.nz * 0.3,
        side.ry,
      );
    }
    const hallLength = side.length + HALL * 2;
    const bays = Math.round(hallLength / 7);
    hallWalls.copy(
      panel(
        hallLength,
        HALL_HEIGHT,
        bays,
        1,
        xf(side.x - side.nx * HALL, HALL_HEIGHT / 2, side.z - side.nz * HALL, side.ry),
      ),
    );
    hallFloor.copy(
      panel(
        hallLength,
        ROOF - HALL_HEIGHT,
        1,
        1,
        xf(side.x - side.nx * HALL, (ROOF + HALL_HEIGHT) / 2, side.z - side.nz * HALL, side.ry),
        '#06090c',
      ),
    );
    const strip = new THREE.PlaneGeometry(hallLength, HALL, 1, 6);
    strip.rotateX(-Math.PI / 2);
    const floorPiece = prep(strip, (out, p) => {
      const near = 1 - (p.z + HALL / 2) / HALL;
      out.setRGB(0.012 + near * near * 0.05, 0.016 + near * near * 0.15, 0.022 + near * near * 0.2);
    });
    floorPiece.applyMatrix4(xf(side.x - side.nx * (HALL / 2), 0, side.z - side.nz * (HALL / 2), side.ry + Math.PI));
    hallFloor.copy(floorPiece);
    for (let i = 0; i < bays; i += 1) {
      if (i % 2) continue;
      const t = -hallLength / 2 + ((i + 0.5) * hallLength) / bays;
      const pick = Math.floor(random() * 4);
      const poster = new THREE.PlaneGeometry(1.5, 3);
      const uv = poster.getAttribute('uv');
      for (let k = 0; k < uv.count; k += 1) uv.setX(k, (pick + uv.getX(k)) / 4);
      posters.add(
        poster,
        '#ffffff',
        xf(side.x - side.nx * (HALL - 0.05) + ux * t, 2.6, side.z - side.nz * (HALL - 0.05) + uz * t, side.ry),
      );
    }
    for (let t = -side.length / 2 + 1; t < side.length / 2 - 1; t += 1.05) {
      if (random() < 0.5) continue;
      const back = 0.9 + random() * random() * 7;
      people.push({
        x: side.x + ux * t - side.nx * back,
        y: 0,
        z: side.z + uz * t - side.nz * back,
        scale: random() < 0.15 ? 0.62 + random() * 0.15 : 0.92 + random() * 0.18,
        rot: side.ry + (random() - 0.5) * 0.7,
      });
    }
  }
  const far = Math.max(width, depth) * 4;
  hallFloor.copy(ground({ minX: cx - far, maxX: cx + far, minZ: cz - far, maxZ: cz + far }, -0.12, 1, '#030405'));
  const roof = ground(
    { minX: rect.minX - HALL, maxX: rect.maxX + HALL, minZ: rect.minZ - HALL, maxZ: rect.maxZ + HALL },
    ROOF,
    1,
    '#04070a',
  );
  roof.getIndex()?.set([0, 1, 2, 1, 3, 2]);
  hallFloor.copy(roof);

  const spacing = RIG_SPACING;
  const span = alongX ? depth : width;
  const from = alongX ? rect.minX : rect.minZ;
  const to = alongX ? rect.maxX : rect.maxZ;
  const lamp = new THREE.Color(4.2, 4.8, 4.6);
  for (let a = Math.ceil(from / spacing) * spacing; a <= to; a += spacing) {
    const x = alongX ? a : cx;
    const z = alongX ? cz : a;
    const ry = alongX ? Math.PI / 2 : 0;
    frame.box(span + 1.5, 0.3, 0.3, steel, x, HEIGHT + 2.9, z, ry);
    glow.add(new THREE.BoxGeometry(span - 2, 0.1, 0.55), lamp, xf(x, HEIGHT + 2.4, z, ry));
    frame.box(span - 2, 0.2, 0.75, '#11161a', x, HEIGHT + 2.56, z, ry);
  }
  for (const offset of [-0.5, 0.5]) {
    const x = alongX ? cx : cx + offset * (width + 1);
    const z = alongX ? cz + offset * (depth + 1) : cz;
    frame.box((alongX ? width : depth) + 1.5, 0.3, 0.3, steel, x, HEIGHT + 3.15, z, alongX ? 0 : Math.PI / 2);
    for (let a = from; a <= to + 0.1; a += (to - from) / Math.max(2, Math.round((to - from) / 24))) {
      frame.box(0.3, HEIGHT + 3.3, 0.3, steel, alongX ? a : x, (HEIGHT + 3.3) / 2, alongX ? z : a);
    }
  }

  stage.mesh(
    frame.build(),
    stage.standard({ vertexColors: true, roughness: 0.55, metalness: 0.4 }, { caustics: 0.4 }),
    'none',
  );
  stage.mesh(glow.build(), stage.basic({ vertexColors: true }), 'none');
  stage.mesh(hallFloor.build(), stage.basic({ vertexColors: true }), 'none');
  const wallMap = stage.keep(hallWallTexture(5));
  stage.mesh(hallWalls.build(), stage.basic({ map: wallMap, color: new THREE.Color(1.25, 1.2, 1.15) }), 'none');
  const posterMap = stage.keep(posterTexture());
  stage.mesh(posters.build(), stage.basic({ map: posterMap, color: new THREE.Color(1.5, 1.5, 1.5) }), 'none');
  const shirts = ['#e63946', '#f1faee', '#457b9d', '#ffb703', '#2a9d8f', '#e76f51', '#8338ec', '#fb8500', '#cfd8dc'];
  const crowd = instanced(visitor(), stage.basic({ vertexColors: true }), people, (_i, out) => {
    out.set(shirts[Math.floor(random() * shirts.length)]).lerp(new THREE.Color('#ffffff'), 0.35);
  });
  stage.add(crowd);

  const pane = new THREE.Mesh(glass.build(), glassMaterial(stage.uniforms, 8));
  pane.renderOrder = 2;
  stage.add(pane);

  const materials = reefMaterials(stage);
  const hero = new Batch();
  const moss = '#3f6b3c';
  const centreX = track.centerX;
  const centreZ = track.centerZ;
  hero.copy(castle(5), xf(centreX, 0, centreZ, random() * Math.PI, 1.25));
  hero.copy(chest(), xf(centreX + 9, 0, centreZ + 6, 0.6, 1.3));
  deepInfield(track, random, 12, 32).forEach((spot, i) => {
    if (Math.hypot(spot.x - centreX, spot.z - centreZ) < 9) return;
    const size = 2.6 + random() * 2.8;
    const rock = blob(3, 300 + i * 17, 0.34, 0.75 + random() * 0.5, rockPaint('#8d8f88', moss, 40 + i));
    hero.copy(rock, xf(spot.x, -0.3, spot.z, random() * 6, size, size * (0.8 + random() * 0.5), size));
    rock.dispose();
  });
  const corners: [number, number][] = [
    [rect.minX + 5, rect.minZ + 5],
    [rect.maxX - 5, rect.minZ + 5],
    [rect.minX + 5, rect.maxZ - 5],
    [rect.maxX - 5, rect.maxZ - 5],
  ];
  corners.forEach(([x, z], i) => {
    for (let k = 0; k < 3; k += 1) {
      const size = 3.5 + random() * 3 - k * 0.6;
      const rock = blob(3, 500 + i * 13 + k, 0.36, 1 + random() * 0.6, rockPaint('#84877f', moss, 60 + i + k));
      hero.copy(
        rock,
        xf(x + (random() - 0.5) * 6, -0.4, z + (random() - 0.5) * 6, random() * 6, size, size * 1.2, size),
      );
      rock.dispose();
    }
  });
  stage.mesh(hero.build(), materials.rock, 'both');

  const density = track.lapLength / 520;
  addRocks(
    stage,
    materials,
    [
      ...trackBand(track, random, Math.round(46 * density), true, 2.2, 6.2),
      ...trackBand(track, random, Math.round(46 * density), false, 3, 13, true),
    ],
    0.75,
    moss,
  );
  addCorals(
    stage,
    materials,
    [
      ...trackBand(track, random, Math.round(70 * density), true, 2, 6.4),
      ...trackBand(track, random, Math.round(80 * density), false, 2.6, 12, true),
    ],
    1.25,
  );
  addAnemones(stage, materials, [
    ...trackBand(track, random, Math.round(26 * density), true, 1.9, 5),
    ...trackBand(track, random, Math.round(26 * density), false, 2.2, 8),
  ]);
  addGrass(
    stage,
    materials,
    [
      ...trackBand(track, random, Math.round(90 * density), true, 1.9, 6.4),
      ...trackBand(track, random, Math.round(110 * density), false, 2.2, 15),
    ],
    1.5,
  );
  const tall = deepInfield(track, random, Math.round(40 * density), 32);
  for (const side of sides) {
    for (let t = -side.length / 2 + 3; t < side.length / 2 - 3; t += 4 + random() * 9) {
      tall.push({
        x: side.x + Math.cos(side.ry) * t + side.nx * 1.2,
        y: 0,
        z: side.z - Math.sin(side.ry) * t + side.nz * 1.2,
        scale: 0.5 + random() * 0.35,
        rot: random() * 6,
      });
    }
  }
  addKelp(stage, materials, tall, 8);

  const schoolCentres = trackBand(track, random, 5, false, 6, 16).map((p) => ({ x: p.x, z: p.z }));
  addFish(
    stage,
    materials,
    { back: '#f07a1c', belly: '#ffd9a0', stripe: '#fdfdf8' },
    {
      centres: schoolCentres,
      perSchool: 18,
      minY: 4,
      maxY: LEVEL - 3,
      radius: [7, 15],
      size: [0.7, 1.2],
      speed: [1.4, 2.6],
      colors: ['#ffffff', '#ffe9c9', '#ffd0d0'],
    },
  );
  addFish(
    stage,
    materials,
    { back: '#1f55c9', belly: '#ffe45c', stripe: null },
    {
      centres: trackBand(track, random, 4, true, 1, 5).map((p) => ({ x: p.x, z: p.z })),
      perSchool: 16,
      minY: 6,
      maxY: LEVEL - 2.5,
      radius: [9, 20],
      size: [0.8, 1.5],
      speed: [1.2, 2.2],
      colors: ['#ffffff', '#d8ecff', '#fff3c0'],
    },
  );

  stage.surface(planeSurface(rect, LEVEL, 6), {
    floorMap: gravel.map,
    floorScale: 1 / 3.2,
    floorTint: '#b9c9c2',
    floorY: 0,
    swell: 0.03,
    chop: 0.075,
    ripple: [0.31, 0.77],
    body: 0.3,
    bodyRange: 1e5,
  });
  stage.shafts({ count: 34, wrap: 100, length: 15, width: 2.1, color: '#b8f2ff', strength: 0.11 });
  stage.particles({ count: 1100, wrap: [34, 13, 34], size: 0.034, color: '#dffcff', alpha: 0.55 });
  const sources = [
    { x: centreX + 9, y: 1.2, z: centreZ + 6 },
    ...trackBand(track, random, 9, false, 3, 9).map((p) => ({ x: p.x, y: 0.3, z: p.z })),
    ...trackBand(track, random, 5, true, 2.5, 5).map((p) => ({ x: p.x, y: 0.3, z: p.z })),
  ];
  stage.bubbles(sources, 14);

  return {
    stage,
    hints: {
      fog: {
        water: { color: '#1d7f93', near: 1, far: 95 },
        air: { color: '#05080b', near: track.size * 2, far: track.size * 8 },
      },
      background: { water: '#1d7f93', air: '#04070a' },
      sun: { direction: SUN.clone(), color: '#e6fbff', intensity: 1.6 },
      ambient: { sky: '#3a8fa3', ground: '#3d3a30', intensity: 0.5 },
      environmentIntensity: 0.18,
      indoor: true,
    },
  };
}
