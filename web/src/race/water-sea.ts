import * as THREE from 'three';
import type { TrackPath } from '../lib/track';
import { loft } from './kit';
import {
  Batch,
  blob,
  deepInfield,
  fbm3,
  instanced,
  nearestTrack,
  noise3,
  paint,
  rockPaint,
  school,
  scatter,
  trackBand,
  trackStrip,
  trackTube,
  tube,
  xf,
  type PaintFn,
  type Placement,
} from './water-props';
import { addAnemones, addCorals, addFish, addGrass, addKelp, addRocks, reefMaterials } from './water-reef';
import { backdropMaterial } from './water-shaders';
import { Stage, sunFrom, warpedGrid, type VenueHints } from './water-stage';
import { ropeTexture, sandTextures } from './water-textures';

const SUN = sunFrom(55, 150);
const DEPTH = 22;
const BUOY_HEIGHT = 1.7;

function buoy(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(new THREE.SphereGeometry(0.42, 12, 8), (out, p) => {
    out.setScalar(Math.abs(p.y) < 0.07 ? 1.5 : 0.92 + p.y * 0.2);
  });
  b.add(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 6), '#2a2a2a', xf(0, -0.46, 0));
  b.add(new THREE.TorusGeometry(0.09, 0.025, 4, 8), '#3a3a3a', xf(0, 0.47, 0));
  return b.build();
}

function markerBuoy(): THREE.BufferGeometry {
  const b = new Batch();
  const red = '#d8362a';
  b.add(new THREE.CylinderGeometry(0.7, 0.8, 1.3, 14), red, xf(0, 0, 0));
  b.add(new THREE.ConeGeometry(0.7, 1.1, 14), '#f4f1e8', xf(0, 1.2, 0));
  b.add(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), '#3a3a3a', xf(0, 2.3, 0));
  b.add(new THREE.SphereGeometry(0.16, 8, 6), '#ffd23f', xf(0, 3.05, 0));
  b.add(new THREE.SphereGeometry(0.8, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#7a2a22', xf(0, -0.65, 0));
  return b.build();
}

function wreck(seed: number): THREE.BufferGeometry {
  const b = new Batch();
  const wood = new THREE.Color('#4a3524');
  const algae = new THREE.Color('#2f5a48');
  const pale = new THREE.Color('#7d6a4f');
  const hole = new THREE.Color('#0b0a09');
  const timber: PaintFn = (out, p, n) => {
    const plank = 0.78 + 0.22 * Math.sin(p.y * 14 + noise3(p.x * 0.6, p.y * 0.6, p.z * 0.6, seed) * 3);
    const grain = fbm3(p.x * 0.9, p.y * 0.9, p.z * 0.9, seed, 3);
    out
      .copy(wood)
      .lerp(pale, grain * 0.5)
      .multiplyScalar(plank);
    const growth = fbm3(p.x * 0.35 + 3, p.y * 0.35, p.z * 0.35, seed + 9, 3) + Math.max(0, n.y) * 0.25;
    out.lerp(algae, Math.min(1, Math.max(0, growth * 2.4 - 0.95)));
    if (fbm3(p.x * 0.28, p.y * 0.5, p.z * 0.28, seed + 20, 2) > 0.68 && Math.abs(n.y) < 0.6) out.lerp(hole, 0.92);
  };
  const stern = loft(
    [
      { p: [0, 3.4, -13], rx: 2.3, ry: 1.6, down: 2.2 },
      { p: [0, 3.0, -11.5], rx: 3.0, ry: 1.9, down: 3.2 },
      { p: [0, 2.2, -8], rx: 3.5, ry: 1.3, down: 3.4 },
      { p: [0, 2.0, -4.5], rx: 3.7, ry: 1.0, down: 3.5 },
      { p: [0, 2.0, -1.5], rx: 3.6, ry: 0.9, down: 3.4 },
    ],
    { segments: 14, sub: 3 },
  );
  b.add(stern, timber);
  const bow = loft(
    [
      { p: [0, 2.0, 1.2], rx: 3.5, ry: 0.9, down: 3.3 },
      { p: [0, 2.0, 5], rx: 3.2, ry: 1.0, down: 3.2 },
      { p: [0, 2.3, 9], rx: 2.1, ry: 1.2, down: 2.8 },
      { p: [0, 2.9, 12], rx: 0.8, ry: 1.3, down: 2.0 },
      { p: [0, 3.5, 13.6], rx: 0.12, ry: 0.5, down: 0.9 },
    ],
    { segments: 14, sub: 3 },
  );
  bow.applyMatrix4(xf(0.6, -0.4, 0.4, 0.09, 1, 1, 1, 0.05, -0.12));
  b.add(bow, timber);
  for (let i = 0; i < 6; i += 1) {
    const z = -1.3 + i * 0.5;
    const rib = new THREE.TorusGeometry(3.4 - Math.abs(i - 2.5) * 0.08, 0.13, 5, 14, Math.PI);
    b.add(rib, timber, xf(0.1 * i, 1.9 - i * 0.06, z, 0, 1, 1, 1, 0, Math.PI));
  }
  b.add(new THREE.BoxGeometry(0.5, 0.6, 27, 1, 1, 18), timber, xf(0.2, -1.2, 0));
  b.add(new THREE.BoxGeometry(5.6, 2.6, 4.4, 4, 3, 4), timber, xf(0, 4.4, -11));
  b.add(new THREE.BoxGeometry(6.4, 0.25, 5.2, 4, 1, 4), timber, xf(0, 5.8, -11));
  for (const x of [-1.6, 0, 1.6]) b.box(0.9, 1.0, 0.1, '#0b0a09', x, 4.5, -13.22);
  const masts: [number, number, number, number, number][] = [
    [0, -6.5, 15, 0.12, 0.3],
    [0.5, 5.5, 11, -0.5, -0.2],
  ];
  for (const [x, z, h, rx, rz] of masts) {
    const mast = tube(
      [
        [0, 0, 0],
        [0, h * 0.5, 0],
        [0, h, 0],
      ],
      [0.34, 0.27, 0.16],
      8,
      timber,
      2,
    );
    mast.applyMatrix4(xf(x, 2.2, z, 0, 1, 1, 1, rx, rz));
    b.add(mast);
    const yard = tube(
      [
        [-4, h * 0.72, 0],
        [0, h * 0.74, 0],
        [4, h * 0.7, 0],
      ],
      [0.1, 0.15, 0.1],
      6,
      timber,
      2,
    );
    yard.applyMatrix4(xf(x, 2.2, z, 0.3, 1, 1, 1, rx, rz));
    b.add(yard);
    const nest = new THREE.CylinderGeometry(0.9, 0.7, 0.7, 10, 1, true);
    nest.applyMatrix4(xf(0, h * 0.86, 0));
    nest.applyMatrix4(xf(x, 2.2, z, 0, 1, 1, 1, rx, rz));
    b.add(nest, timber);
  }
  const sprit = tube(
    [
      [0.7, 3.2, 12.6],
      [0.9, 4.3, 16],
      [1.1, 5.2, 19],
    ],
    [0.22, 0.16, 0.08],
    6,
    timber,
    2,
  );
  b.add(sprit);
  const mastStump = tube(
    [
      [3.5, 0.2, 2],
      [8, 0.5, 4],
      [13, 0.3, 5],
    ],
    [0.3, 0.26, 0.2],
    8,
    timber,
    2,
  );
  b.add(mastStump);
  return b.build();
}

function whale(): THREE.BufferGeometry {
  const b = new Batch();
  const back = new THREE.Color('#2b4152');
  const belly = new THREE.Color('#a9bcc4');
  const skin: PaintFn = (out, p) => {
    out.copy(belly).lerp(back, Math.min(1, Math.max(0, p.y * 1.1 + 0.75)));
  };
  b.add(
    loft(
      [
        { p: [0, 0, 6], rx: 0.3, ry: 0.3, down: 0.4 },
        { p: [0, 0.1, 5], rx: 1.0, ry: 0.85, down: 1.1 },
        { p: [0, 0.2, 3], rx: 1.45, ry: 1.25, down: 1.5 },
        { p: [0, 0.2, 0], rx: 1.5, ry: 1.4, down: 1.45 },
        { p: [0, 0.1, -3], rx: 1.0, ry: 1.0, down: 0.9 },
        { p: [0, 0, -5], rx: 0.45, ry: 0.5, down: 0.45 },
        { p: [0, 0, -6.2], rx: 0.2, ry: 0.2 },
      ],
      { segments: 12, sub: 2 },
    ),
    skin,
  );
  b.add(
    loft(
      [
        { p: [0, 0, -5.9], rx: 0.25, ry: 0.12 },
        { p: [0, 0, -6.6], rx: 1.7, ry: 0.1 },
        { p: [0, 0, -7.3], rx: 2.1, ry: 0.06 },
        { p: [0, 0, -7.6], rx: 1.2, ry: 0.03 },
      ],
      { segments: 8, sub: 1 },
    ),
    skin,
  );
  for (const side of [-1, 1]) {
    b.add(
      loft(
        [
          { p: [side * 1.2, -0.7, 2.6], rx: 0.6, ry: 0.1 },
          { p: [side * 2.4, -1.2, 1.8], rx: 0.5, ry: 0.07 },
          { p: [side * 3.5, -1.6, 0.6], rx: 0.2, ry: 0.04 },
        ],
        { segments: 6, sub: 1 },
      ),
      skin,
    );
  }
  b.add(
    loft(
      [
        { p: [0, 1.0, -2.2], rx: 0.06, ry: 0.1 },
        { p: [0, 1.5, -2.9], rx: 0.05, ry: 0.3 },
        { p: [0, 1.1, -3.6], rx: 0.03, ry: 0.06 },
      ],
      { segments: 4, sub: 1 },
    ),
    skin,
  );
  const geometry = b.build();
  geometry.scale(1 / 13.6, 1 / 13.6, 1 / 13.6);
  return geometry;
}

const MANTA_BELLY = new THREE.Color('#c9d3d6');
const mantaSkin: PaintFn = (out, p) => {
  out.setRGB(0.05, 0.07, 0.1).lerp(MANTA_BELLY, p.y < -0.01 ? 0.9 : 0);
};

function manta(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(
    loft(
      [
        { p: [0, 0, 0.5], rx: 0.14, ry: 0.03 },
        { p: [0, 0.01, 0.36], rx: 0.3, ry: 0.06 },
        { p: [0, 0.02, 0.12], rx: 0.7, ry: 0.07 },
        { p: [0, 0.02, -0.05], rx: 1.0, ry: 0.05 },
        { p: [0, 0.01, -0.25], rx: 0.55, ry: 0.05 },
        { p: [0, 0, -0.45], rx: 0.1, ry: 0.03 },
        { p: [0, 0, -1.3], rx: 0.008, ry: 0.008 },
      ],
      { segments: 10, sub: 2 },
    ),
    mantaSkin,
  );
  for (const side of [-1, 1]) {
    b.add(new THREE.ConeGeometry(0.035, 0.2, 5), mantaSkin, xf(side * 0.11, 0, 0.56, 0, 1, 1, 1, Math.PI / 2, 0));
  }
  return b.build();
}

function boat(): THREE.BufferGeometry {
  const b = new Batch();
  b.add(
    loft(
      [
        { p: [0, 0.5, -5], rx: 1.6, ry: 0.5, down: 0.9 },
        { p: [0, 0.4, -2], rx: 1.9, ry: 0.5, down: 1.2 },
        { p: [0, 0.4, 2], rx: 1.7, ry: 0.55, down: 1.2 },
        { p: [0, 0.7, 4.6], rx: 0.8, ry: 0.5, down: 0.9 },
        { p: [0, 1.0, 5.8], rx: 0.06, ry: 0.25, down: 0.4 },
      ],
      { segments: 12, sub: 3 },
    ),
    (out, p) => {
      out.set(p.y < 0.05 ? '#7a2a22' : p.y > 0.78 ? '#c9b48c' : '#f2f0ea');
    },
  );
  b.box(2.2, 1.5, 3, '#f6f4ee', 0, 1.6, -1.2);
  b.box(2.5, 0.12, 3.4, '#2f5f8a', 0, 2.4, -1.2);
  b.box(2.24, 0.6, 2.2, '#1b2a36', 0, 1.85, -1.0);
  b.add(new THREE.CylinderGeometry(0.04, 0.05, 3.6, 6), '#d8d8d8', xf(0, 4.2, -1.2));
  return b.build();
}

export function buildOpenSea(track: TrackPath, random: () => number): { stage: Stage; hints: VenueHints } {
  const size = track.size;
  const cx = track.centerX;
  const cz = track.centerZ;
  const level = track.maxY + DEPTH;
  const reach = 420;
  const stage = new Stage(track, random, {
    level,
    boxMin: new THREE.Vector3(cx - 4000, -60, cz - 4000),
    boxMax: new THREE.Vector3(cx + 4000, level, cz + 4000),
    scatter: '#1a6fa3',
    deep: '#062c4a',
    shallow: '#5cc0e4',
    extinction: [0.085, 0.03, 0.021],
    sun: SUN,
    causticScale: 1 / 9,
    causticStrength: 0.95,
    skyZenith: '#3d7fd0',
    skyHorizon: '#cfeaf8',
    sunColor: '#fff1cf',
    sunPower: 7,
    ceiling: [0, 0, 0, 0],
  });
  const inner = track.innerOffset();
  const outer = track.outerOffset();
  const apron = 1.2;
  const near = nearestTrack(track, 3);
  const heightAt = (x: number, z: number): number => {
    const hit = near(x, z);
    const beyond = hit.side > 0 ? hit.dist - outer - apron : hit.dist + inner - apron;
    const t = Math.min(1, Math.max(0, beyond / 30));
    const blend = t * t * (3 - 2 * t);
    const dune =
      1.5 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.027) +
      (fbm3(x * 0.03, 0, z * 0.03, 77, 3) - 0.5) * 3.2 +
      Math.max(0, beyond - 140) * 0.03;
    return (hit.y - 0.25) * (1 - blend * 0.7) + dune * blend;
  };

  const sand = sandTextures(23, 7);
  stage.keep(sand.map);
  stage.keep(sand.normalMap);
  const sandMaterial = stage.standard(
    { map: sand.map, normalMap: sand.normalMap, vertexColors: true, roughness: 1 },
    { detail: 0.4, detailScale: 0.045 },
  );
  const bed = warpedGrid(cx, cz, size * 0.42, reach, 120);
  const bedPosition = bed.getAttribute('position');
  const bedUv = bed.getAttribute('uv');
  for (let i = 0; i < bedPosition.count; i += 1) {
    const x = bedPosition.getX(i);
    const z = bedPosition.getZ(i);
    bedPosition.setY(i, heightAt(x, z));
    bedUv.setXY(i, x / 6, z / 6);
  }
  bed.computeVertexNormals();
  paint(bed, '#ffffff');
  stage.mesh(bed, sandMaterial, 'receive');

  const course = new Batch();
  const raked = new THREE.Color(1.22, 1.18, 1.06);
  course.copy(trackStrip(track, inner - apron, outer + apron, 0.02, 0.02, 1.5, 1 / 6, raked));
  course.copy(trackStrip(track, inner - apron - 4.5, inner - apron, -0.75, 0.02, 1.5, 1 / 6, '#ffffff'));
  course.copy(trackStrip(track, outer + apron, outer + apron + 4.5, 0.02, -0.75, 1.5, 1 / 6, '#ffffff'));
  const chalk = new THREE.Color(1.9, 1.9, 1.85);
  for (let lane = 1; lane < track.lanes; lane += 1) {
    const offset = track.laneOffset(lane) + 0.7;
    course.copy(trackStrip(track, offset - 0.05, offset + 0.05, 0.04, 0.04, 1.5, 1 / 6, chalk));
  }
  for (const lateral of [inner - 0.35, outer + 0.35]) {
    course.copy(trackStrip(track, lateral - 0.16, lateral + 0.16, 0.04, 0.04, 1.5, 1 / 6, chalk));
  }
  stage.mesh(course.build(), sandMaterial, 'receive');

  const ropeMap = stage.keep(ropeTexture(['#f1e6cd', '#f1e6cd', '#f1e6cd', '#e8632b'], 2));
  const ropes = new Batch();
  const buoys: Placement[] = [];
  const samples = track.samples(9).slice(1);
  const spacing = track.lapLength / samples.length;
  const p = { x: 0, y: 0, z: 0 };
  for (const lateral of [inner - 0.6, outer + 0.6]) {
    ropes.copy(
      trackTube(
        track,
        lateral,
        (s) => BUOY_HEIGHT - 0.42 - 0.3 * Math.sin(Math.PI * ((s / spacing) % 1)) ** 2,
        0.045,
        4,
        1.5,
        1 / 1.28,
      ),
    );
    for (const s of samples) {
      track.point(s, lateral, p);
      buoys.push({ x: p.x, y: p.y + BUOY_HEIGHT, z: p.z, scale: 1, rot: random() * 6 });
      const tether = new THREE.CylinderGeometry(0.02, 0.02, BUOY_HEIGHT, 4, 1, true);
      const uv = tether.getAttribute('uv');
      for (let i = 0; i < uv.count; i += 1) uv.setXY(i, 0.05, 0.5);
      ropes.add(tether, '#3a3a3a', xf(p.x, p.y + BUOY_HEIGHT / 2 - 0.2, p.z));
    }
  }
  stage.mesh(ropes.build(), stage.standard({ map: ropeMap, vertexColors: true, roughness: 0.7 }), 'none');
  const buoyColors = [new THREE.Color(2.1, 0.42, 0.04), new THREE.Color(1.7, 0.95, 0.06)];
  stage.add(
    stage.shade(
      instanced(buoy(), stage.standard({ vertexColors: true, roughness: 0.4 }), buoys, (i, out) => {
        out.copy(buoyColors[i % 2]);
      }),
      'cast',
    ),
  );

  const materials = reefMaterials(stage);
  const props = new Batch();
  const moss = '#3d6a55';
  const marker = markerBuoy();
  const markers = track.samples(track.lapLength / 8).slice(1);
  for (const s of markers) {
    track.point(s + 20, outer + 4.5, p);
    const drift = { x: p.x + (random() - 0.5) * 3, z: p.z + (random() - 0.5) * 3 };
    props.copy(marker, xf(drift.x, level + 0.1, drift.z, random() * 6));
    props.add(
      tube(
        [
          [p.x, heightAt(p.x, p.z) + 0.4, p.z],
          [(p.x * 2 + drift.x) / 3, level * 0.4, (p.z * 2 + drift.z) / 3],
          [drift.x, level - 0.6, drift.z],
        ],
        0.04,
        4,
        '#2b2b2b',
        4,
        false,
      ),
    );
    props.box(1.1, 0.8, 1.1, '#6f7475', p.x, heightAt(p.x, p.z) + 0.25, p.z, random() * 3);
  }
  marker.dispose();
  track.point(8, outer + 11, p);
  props.copy(boat(), xf(p.x, level - 0.15, p.z, random() * 6, 1.3));
  stage.mesh(props.build(), stage.standard({ vertexColors: true, roughness: 0.6 }), 'cast');

  const hero = new Batch();
  const wreckS = track.lapLength * 0.62;
  const wreckFrame = track.frame(wreckS);
  track.point(wreckS, outer + 19, p);
  hero.copy(
    wreck(9),
    xf(p.x, heightAt(p.x, p.z) - 0.9, p.z, Math.atan2(wreckFrame.tx, wreckFrame.tz) + 0.25, 1, 1, 1, 0.04, 0.3),
  );
  const boulders = [
    ...scatter(track, random, 26, stage.rect(70), 12, 32, heightAt),
    ...trackBand(track, random, 10, true, 10, 26),
  ];
  boulders.forEach((spot, i) => {
    const s = 2.2 + random() * 3.4;
    const rock = blob(2, 700 + i * 11, 0.36, 0.7 + random() * 0.5, rockPaint('#8c8f8a', moss, 20 + i));
    hero.copy(rock, xf(spot.x, heightAt(spot.x, spot.z) - 0.3, spot.z, random() * 6, s, s * (0.7 + random() * 0.5), s));
    rock.dispose();
  });
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + random();
    const r = size * 0.5 + 150 + random() * 120;
    const w = 45 + random() * 40;
    const islet = blob(3, 900 + i * 7, 0.55, 1.2, rockPaint('#6f6b60', '#4a6a33', 90 + i), -0.9);
    hero.copy(
      islet,
      xf(
        cx + Math.cos(angle) * r,
        level - 12 + random() * 10,
        cz + Math.sin(angle) * r,
        random() * 6,
        w,
        24 + random() * 16,
        w * (0.6 + random() * 0.5),
      ),
    );
    islet.dispose();
  }
  stage.mesh(hero.build(), materials.rock, 'both');

  const grounded = (list: Placement[]): Placement[] => {
    for (const spot of list) spot.y = heightAt(spot.x, spot.z) - 0.05;
    return list;
  };
  const density = track.lapLength / 550;
  addRocks(
    stage,
    materials,
    grounded([
      ...trackBand(track, random, Math.round(50 * density), true, 2.6, 9),
      ...trackBand(track, random, Math.round(50 * density), false, 3, 14, true),
    ]),
    0.8,
    moss,
  );
  addCorals(
    stage,
    materials,
    grounded([
      ...trackBand(track, random, Math.round(70 * density), true, 2.4, 9),
      ...trackBand(track, random, Math.round(70 * density), false, 2.8, 13, true),
    ]),
    1.2,
  );
  addAnemones(
    stage,
    materials,
    grounded([
      ...trackBand(track, random, Math.round(18 * density), true, 2.2, 6),
      ...trackBand(track, random, Math.round(18 * density), false, 2.4, 8),
    ]),
  );
  addGrass(
    stage,
    materials,
    grounded([
      ...trackBand(track, random, Math.round(120 * density), true, 2.2, 16),
      ...trackBand(track, random, Math.round(120 * density), false, 2.4, 16),
    ]),
    1.7,
  );
  addKelp(
    stage,
    materials,
    grounded([
      ...trackBand(track, random, Math.round(90 * density), true, 10, 46),
      ...deepInfield(track, random, Math.round(34 * density), 32),
    ]),
    12,
  );

  addFish(
    stage,
    materials,
    { back: '#5e7f95', belly: '#eef4f6', stripe: null },
    {
      centres: trackBand(track, random, 6, true, 2, 14).map((spot) => ({ x: spot.x, z: spot.z })),
      perSchool: 22,
      minY: track.maxY + 6,
      maxY: track.maxY + 14,
      radius: [10, 22],
      size: [0.7, 1.1],
      speed: [2, 3.4],
      colors: ['#ffffff', '#e6f0f5', '#dfe7ec'],
    },
  );
  addFish(
    stage,
    materials,
    { back: '#e8b53a', belly: '#fbf3d0', stripe: '#2c4a66' },
    {
      centres: trackBand(track, random, 4, false, 4, 14).map((spot) => ({ x: spot.x, z: spot.z })),
      perSchool: 16,
      minY: track.maxY + 3,
      maxY: track.maxY + 9,
      radius: [7, 14],
      size: [0.6, 1.0],
      speed: [1.4, 2.4],
      colors: ['#ffffff', '#fff0c9'],
    },
  );
  const giantCentres = trackBand(track, random, 3, true, 34, 52).map((spot) => ({ x: spot.x, z: spot.z }));
  stage.add(
    school(whale(), materials.giant, random, {
      centres: giantCentres,
      perSchool: 1,
      minY: track.maxY + 11,
      maxY: track.maxY + 16,
      radius: [30, 42],
      size: [12, 15],
      speed: [1.8, 2.6],
      colors: ['#ffffff'],
    }),
  );
  stage.add(
    school(manta(), materials.giant, random, {
      centres: trackBand(track, random, 3, false, 20, 30).map((spot) => ({ x: spot.x, z: spot.z })),
      perSchool: 2,
      minY: track.maxY + 12,
      maxY: track.maxY + 17,
      radius: [16, 26],
      size: [4.5, 6],
      speed: [1.6, 2.4],
      colors: ['#ffffff'],
    }),
  );

  const skirt = new THREE.CylinderGeometry(reach - 30, reach - 30, level + 80, 40, 1, true);
  skirt.translate(cx, (level - 80) / 2, cz);
  stage.add(new THREE.Mesh(skirt, backdropMaterial(stage.uniforms)));

  const surface = warpedGrid(cx, cz, size * 0.42, 1700, 110);
  surface.translate(0, level, 0);
  stage.surface(surface, {
    floorMap: sand.map,
    floorScale: 1 / 6,
    floorTint: '#8fb0b8',
    floorY: 0,
    swell: 0.55,
    chop: 0.16,
    ripple: [0.09, 0.31],
    body: 0.9,
    bodyRange: 260,
  });
  stage.shafts({ count: 44, wrap: 130, length: 30, width: 3.6, color: '#bfe9ff', strength: 0.17 });
  stage.particles({ count: 1400, wrap: [40, 16, 40], size: 0.04, color: '#dff6ff', alpha: 0.6 });
  stage.bubbles(
    grounded(trackBand(track, random, 10, true, 3, 12)).map((spot) => ({ x: spot.x, y: spot.y + 0.3, z: spot.z })),
    16,
  );

  return {
    stage,
    hints: {
      fog: {
        water: { color: '#1a6fa3', near: 1, far: 85 },
        air: { color: '#cfe6f4', near: size * 1.5, far: size * 6 },
      },
      background: { water: '#1a6fa3', air: null },
      sun: { direction: SUN.clone(), color: '#fff1cf', intensity: 3 },
      ambient: { sky: '#8fd0f0', ground: '#2a6f93', intensity: 1 },
      environmentIntensity: 0.35,
      indoor: false,
    },
  };
}
