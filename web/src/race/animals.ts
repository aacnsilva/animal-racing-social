import * as THREE from 'three';
import type { EntrantState, Species } from '../lib/types';

export type AnimalRig = {
  root: THREE.Group;
  body: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  legs: { pivot: THREE.Group; phase: number; lower: THREE.Group }[];
  tail: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  baseColors: THREE.Color[];
  ring: THREE.Mesh;
  ringMaterial: THREE.MeshBasicMaterial;
  trail: THREE.Group;
  trailMaterial: THREE.MeshBasicMaterial;
  species: Species;
  swimmer: boolean;
  riderTail: THREE.Group | null;
  baseY: number;
  neckBase: number;
  neckSwing: number;
  height: number;
  gait: number;
  stride: number;
  cycle: number;
  wobble: number;
  lastState: EntrantState | null;
};

const geometryCache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = make();
    geometryCache.set(key, geometry);
  }
  return geometry;
}

const box = (w: number, h: number, d: number) => cached(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (top: number, bottom: number, h: number, seg = 6) =>
  cached(`cyl:${top}:${bottom}:${h}:${seg}`, () => new THREE.CylinderGeometry(top, bottom, h, seg));
const capsule = (r: number, l: number) => cached(`cap:${r}:${l}`, () => new THREE.CapsuleGeometry(r, l, 2, 7));
const cone = (r: number, h: number, seg = 5) =>
  cached(`cone:${r}:${h}:${seg}`, () => new THREE.ConeGeometry(r, h, seg));

function material(
  color: THREE.ColorRepresentation,
  extra: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, metalness: 0.05, ...extra });
}

function mesh(geometry: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function upright(m: THREE.Mesh): THREE.Mesh {
  m.rotation.x = -Math.PI / 2;
  return m;
}

function sideways(m: THREE.Mesh, side: number): THREE.Mesh {
  m.rotation.z = (side * Math.PI) / 2;
  return m;
}

function legGroup(
  x: number,
  y: number,
  z: number,
  upperLength: number,
  lowerLength: number,
  radius: number,
  coat: THREE.Material,
  hoof: THREE.Material,
  phase: number,
) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  pivot.add(mesh(cyl(radius * 1.15, radius, upperLength), coat, 0, -upperLength / 2, 0));
  const lower = new THREE.Group();
  lower.position.set(0, -upperLength, 0);
  lower.add(mesh(cyl(radius, radius * 0.8, lowerLength), coat, 0, -lowerLength / 2, 0));
  lower.add(mesh(box(radius * 2.2, 0.1, radius * 2.6), hoof, 0, -lowerLength - 0.03, radius * 0.3));
  pivot.add(lower);
  return { pivot, phase, lower };
}

function buildJockey(silks: THREE.Material, skin: THREE.Material, y: number, z: number, lean: number): THREE.Group {
  const jockey = new THREE.Group();
  jockey.position.set(0, y, z);
  jockey.rotation.x = lean;
  jockey.add(mesh(box(0.34, 0.42, 0.24), silks, 0, 0.2, 0));
  jockey.add(
    mesh(
      cached('head', () => new THREE.IcosahedronGeometry(0.13, 0)),
      skin,
      0,
      0.5,
      0.03,
    ),
  );
  jockey.add(
    mesh(
      cached('helmet', () => new THREE.SphereGeometry(0.15, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2)),
      silks,
      0,
      0.53,
      0.03,
    ),
  );
  jockey.add(mesh(box(0.1, 0.1, 0.38), silks, -0.2, 0.08, 0.16));
  jockey.add(mesh(box(0.1, 0.1, 0.38), silks, 0.2, 0.08, 0.16));
  return jockey;
}

const TAIL_REST = 1.45;

const HAIR_COLORS = ['#d8452e', '#f2c14e', '#3b2a20', '#7a4fd0', '#2fa7a0', '#f28ab2', '#e9e4d0'];

function laneHash(laneHex: string): number {
  let hash = 0;
  for (const char of laneHex) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return hash;
}

function buildMermaid(
  lane: THREE.Color,
  laneHex: string,
  y: number,
  z: number,
  lean: number,
): { rider: THREE.Group; tail: THREE.Group; materials: THREE.MeshStandardMaterial[] } {
  const hash = laneHash(laneHex);
  const skin = material(['#e7c19b', '#c68a5e', '#8d5a3b', '#f1d2b6'][hash % 4]);
  const hair = material(HAIR_COLORS[hash % HAIR_COLORS.length], { roughness: 0.6 });
  const scales = material(lane.clone().lerp(new THREE.Color('#2fb8a6'), 0.45), { roughness: 0.35, metalness: 0.25 });
  const fin = material(lane.clone().lerp(new THREE.Color('#9ff0e0'), 0.55), { roughness: 0.35, metalness: 0.2 });
  const top = material(lane.clone().lerp(new THREE.Color('#ffffff'), 0.15), { roughness: 0.5 });

  const rider = new THREE.Group();
  rider.position.set(0, y, z);
  rider.rotation.x = lean;
  rider.scale.setScalar(1.15);
  rider.add(mesh(box(0.3, 0.4, 0.2), skin, 0, 0.22, 0));
  rider.add(mesh(box(0.33, 0.16, 0.23), top, 0, 0.3, 0.005));
  rider.add(mesh(box(0.32, 0.12, 0.22), scales, 0, 0.03, 0));
  rider.add(
    mesh(
      cached('head', () => new THREE.IcosahedronGeometry(0.13, 0)),
      skin,
      0,
      0.52,
      0.03,
    ),
  );
  rider.add(
    mesh(
      cached('hair-cap', () => new THREE.SphereGeometry(0.15, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2)),
      hair,
      0,
      0.55,
      0.01,
    ),
  );
  rider.add(mesh(box(0.28, 0.5, 0.08), hair, 0, 0.36, -0.13));
  rider.add(mesh(box(0.08, 0.08, 0.36), skin, -0.18, 0.18, 0.15));
  rider.add(mesh(box(0.08, 0.08, 0.36), skin, 0.18, 0.18, 0.15));

  const tail = new THREE.Group();
  tail.position.set(0, 0.06, -0.08);
  tail.rotation.x = TAIL_REST;
  const upper = mesh(cyl(0.16, 0.12, 0.6, 6), scales, 0, -0.3, 0);
  tail.add(upper);
  const lower = new THREE.Group();
  lower.position.set(0, -0.6, 0);
  lower.rotation.x = -0.45;
  lower.add(mesh(cyl(0.12, 0.05, 0.55, 6), scales, 0, -0.27, 0));
  for (const side of [-1, 1]) {
    const fluke = mesh(cone(0.16, 0.5, 3), fin, side * 0.17, -0.66, 0);
    fluke.rotation.z = side * -0.75;
    fluke.scale.set(1, 1, 0.25);
    lower.add(fluke);
  }
  tail.add(lower);
  rider.add(tail);
  return { rider, tail, materials: [scales, top] };
}

function speedLineGeometry(length: number, width: number): THREE.BufferGeometry {
  return cached(`speedline:${length}:${width}`, () => {
    const geometry = new THREE.PlaneGeometry(1, length, 1, 10);
    const position = geometry.getAttribute('position');
    const alpha = new Float32Array(position.count * 4);
    for (let i = 0; i < position.count; i += 1) {
      const along = 0.5 - position.getY(i) / length;
      position.setX(i, Math.sign(position.getX(i)) * width * (1 - along * 0.8) * 0.5);
      position.setY(i, position.getY(i) - length / 2);
      alpha.set([1, 1, 1, (1 - along) ** 2], i * 4);
    }
    position.needsUpdate = true;
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(alpha, 4));
    geometry.rotateX(Math.PI / 2);
    geometry.rotateZ(Math.PI / 2);
    return geometry;
  });
}

function addRingAndTrail(root: THREE.Group, body: THREE.Group, color: THREE.Color, length: number) {
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd34d,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(
    cached('ring', () => new THREE.RingGeometry(0.9, 1.25, 24)),
    ringMaterial,
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  root.add(ring);
  const trailMaterial = new THREE.MeshBasicMaterial({
    color: color.clone().lerp(new THREE.Color('#ffffff'), 0.6),
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const trail = new THREE.Group();
  const lines: [number, number, number, number][] = [
    [0.3, 0.32, 1.0, 0.07],
    [-0.3, 0.05, 1.4, 0.08],
    [0.3, -0.22, 0.8, 0.06],
    [-0.3, 0.38, 0.7, 0.05],
  ];
  for (const [side, y, scale, width] of lines) {
    const line = new THREE.Mesh(speedLineGeometry(length * scale, width), trailMaterial);
    line.position.set(side, y, -length * 0.42);
    trail.add(line);
  }
  body.add(trail);
  return { ring, ringMaterial, trail, trailMaterial };
}

export function buildHorse(laneHex: string): AnimalRig {
  const lane = new THREE.Color(laneHex);
  const coatColor = lane.clone().lerp(new THREE.Color('#6b4426'), 0.22);
  const dark = coatColor.clone().multiplyScalar(0.35);
  const coat = material(coatColor);
  const maneMat = material(dark);
  const hoof = material('#1d1a17');
  const cloth = material('#f5f2ea');
  const silks = material(lane.clone().lerp(new THREE.Color('#ffffff'), 0.15), { roughness: 0.5 });
  const skin = material('#e7c19b');

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.32;
  root.add(body);
  const torso = mesh(capsule(0.36, 1.25), coat);
  torso.rotation.x = Math.PI / 2;
  body.add(torso);
  body.add(mesh(box(0.74, 0.06, 0.7), cloth, 0, 0.36, -0.05));
  body.add(mesh(box(0.76, 0.05, 0.3), silks, 0, 0.37, -0.05));

  body.add(buildJockey(silks, skin, 0.48, 0.12, 0.55));

  const neck = new THREE.Group();
  neck.position.set(0, 0.2, 0.78);
  neck.rotation.x = 0.7;
  neck.add(mesh(box(0.3, 0.95, 0.42), coat, 0, 0.42, 0));
  neck.add(mesh(box(0.08, 0.85, 0.2), maneMat, 0, 0.45, -0.2));
  body.add(neck);

  const head = new THREE.Group();
  head.position.set(0, 0.88, 0.05);
  head.rotation.x = 1.25;
  head.add(mesh(box(0.27, 0.66, 0.32), coat, 0, 0.26, 0.04));
  head.add(mesh(box(0.22, 0.2, 0.26), coat, 0, 0.58, 0.02));
  head.add(upright(mesh(cone(0.06, 0.18, 4), coat, -0.09, -0.06, -0.14)));
  head.add(upright(mesh(cone(0.06, 0.18, 4), coat, 0.09, -0.06, -0.14)));
  neck.add(head);

  const tail = new THREE.Group();
  tail.position.set(0, 0.22, -0.95);
  tail.rotation.x = -2.5;
  tail.add(mesh(box(0.12, 0.75, 0.12), maneMat, 0, 0.36, 0));
  body.add(tail);

  const legs = [
    legGroup(-0.2, -0.15, 0.62, 0.55, 0.62, 0.085, coat, hoof, 0),
    legGroup(0.2, -0.15, 0.62, 0.55, 0.62, 0.085, coat, hoof, 0.12),
    legGroup(-0.2, -0.12, -0.62, 0.55, 0.62, 0.095, coat, hoof, 0.55),
    legGroup(0.2, -0.12, -0.62, 0.55, 0.62, 0.095, coat, hoof, 0.67),
  ];
  for (const leg of legs) body.add(leg.pivot);

  const extras = addRingAndTrail(root, body, lane, 2.4);
  const materials = [coat, maneMat, silks, cloth];
  return {
    root,
    body,
    neck,
    head,
    legs,
    tail,
    materials,
    baseColors: materials.map((m) => m.color.clone()),
    ...extras,
    species: 'HORSE',
    swimmer: false,
    riderTail: null,
    baseY: 1.32,
    neckBase: 0.7,
    neckSwing: 0.08,
    height: 2.75,
    gait: 0.62,
    stride: 6.2,
    cycle: Math.random(),
    wobble: 0,
    lastState: null,
  };
}

export function buildGiraffe(laneHex: string): AnimalRig {
  const lane = new THREE.Color(laneHex);
  const coatColor = lane.clone().lerp(new THREE.Color('#e0a95a'), 0.25);
  const spotColor = coatColor.clone().multiplyScalar(0.45);
  const coat = material(coatColor);
  const spots = material(spotColor);
  const hoof = material('#2a2119');
  const cloth = material('#f5f2ea');
  const silks = material(lane, { roughness: 0.5 });
  const skin = material('#e7c19b');

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.2;
  root.add(body);
  const torso = mesh(capsule(0.46, 1.05), coat);
  torso.rotation.x = Math.PI / 2 - 0.22;
  body.add(torso);
  const spotGeometry = box(0.28, 0.05, 0.24);
  const spotSpots: [number, number, number, number][] = [
    [0.36, 0.12, 0.3, 0.3],
    [-0.36, 0.05, -0.2, -0.2],
    [0.37, -0.12, -0.45, 0.6],
    [-0.38, -0.1, 0.45, -0.5],
    [0.3, 0.3, -0.2, 0.2],
    [-0.28, 0.32, 0.25, -0.1],
  ];
  for (const [x, y, z, r] of spotSpots) {
    const spot = mesh(spotGeometry, spots, x, y, z);
    spot.rotation.z = Math.PI / 2;
    spot.rotation.x = r;
    body.add(spot);
  }
  body.add(mesh(box(0.86, 0.06, 0.6), cloth, 0, 0.47, 0));
  body.add(mesh(box(0.88, 0.05, 0.26), silks, 0, 0.48, 0));
  body.add(buildJockey(silks, skin, 0.5, -0.12, 0.35));

  const neck = new THREE.Group();
  neck.position.set(0, 0.28, 0.62);
  neck.rotation.x = 0.42;
  neck.add(mesh(box(0.28, 2.05, 0.34), coat, 0, 1.0, 0));
  neck.add(mesh(box(0.06, 1.9, 0.12), spots, 0, 1.0, -0.2));
  for (let i = 0; i < 4; i += 1) {
    neck.add(mesh(box(0.3, 0.2, 0.18), spots, 0, 0.35 + i * 0.45, 0.06 * (i % 2 ? 1 : -1)));
  }
  body.add(neck);

  const head = new THREE.Group();
  head.position.set(0, 2.0, 0.02);
  head.rotation.x = 1.35;
  head.add(mesh(box(0.24, 0.62, 0.3), coat, 0, 0.24, 0.02));
  head.add(mesh(box(0.2, 0.2, 0.26), coat, 0, 0.55, 0.0));
  head.add(upright(mesh(cyl(0.03, 0.035, 0.26, 5), spots, -0.07, -0.08, -0.26)));
  head.add(upright(mesh(cyl(0.03, 0.035, 0.26, 5), spots, 0.07, -0.08, -0.26)));
  head.add(sideways(mesh(cone(0.05, 0.16, 4), coat, -0.17, 0.02, -0.08), 1));
  head.add(sideways(mesh(cone(0.05, 0.16, 4), coat, 0.17, 0.02, -0.08), -1));
  neck.add(head);

  const tail = new THREE.Group();
  tail.position.set(0, 0.1, -0.95);
  tail.rotation.x = -2.75;
  tail.add(mesh(box(0.06, 0.9, 0.06), coat, 0, 0.42, 0));
  tail.add(mesh(box(0.12, 0.22, 0.12), spots, 0, 0.92, 0));
  body.add(tail);

  const legs = [
    legGroup(-0.24, -0.25, 0.55, 0.95, 1.05, 0.075, coat, hoof, 0),
    legGroup(-0.24, -0.25, -0.55, 0.85, 1.0, 0.08, coat, hoof, 0.06),
    legGroup(0.24, -0.25, 0.55, 0.95, 1.05, 0.075, coat, hoof, 0.5),
    legGroup(0.24, -0.25, -0.55, 0.85, 1.0, 0.08, coat, hoof, 0.56),
  ];
  legs[1].pivot.position.y = -0.1;
  legs[3].pivot.position.y = -0.1;
  for (const leg of legs) body.add(leg.pivot);

  const extras = addRingAndTrail(root, body, lane, 2.6);
  const materials = [coat, spots, silks, cloth];
  return {
    root,
    body,
    neck,
    head,
    legs,
    tail,
    materials,
    baseColors: materials.map((m) => m.color.clone()),
    ...extras,
    species: 'GIRAFFE',
    swimmer: false,
    riderTail: null,
    baseY: 2.2,
    neckBase: 0.42,
    neckSwing: 0.12,
    height: 5.0,
    gait: 0.45,
    stride: 4.8,
    cycle: Math.random(),
    wobble: 0,
    lastState: null,
  };
}

export function buildShark(laneHex: string): AnimalRig {
  const lane = new THREE.Color(laneHex);
  const skinColor = lane.clone().lerp(new THREE.Color('#5d6f80'), 0.55);
  const coat = material(skinColor, { roughness: 0.45 });
  const belly = material('#e9eef2', { roughness: 0.5 });
  const fins = material(skinColor.clone().multiplyScalar(0.7), { roughness: 0.45 });
  const eye = material('#111418');
  const saddle = material(lane.clone().lerp(new THREE.Color('#ffffff'), 0.15), { roughness: 0.5 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.05;
  root.add(body);
  const torso = mesh(capsule(0.42, 1.6), coat);
  torso.rotation.x = Math.PI / 2;
  torso.scale.set(0.9, 1, 1);
  body.add(torso);
  const underside = mesh(capsule(0.34, 1.4), belly, 0, -0.14, 0.05);
  underside.rotation.x = Math.PI / 2;
  underside.scale.set(0.9, 1, 0.85);
  body.add(underside);

  const dorsal = mesh(cone(0.28, 0.75, 3), fins, 0, 0.62, -0.1);
  dorsal.rotation.x = -0.35;
  dorsal.scale.set(0.3, 1, 1);
  body.add(dorsal);
  body.add(mesh(box(0.7, 0.05, 0.36), saddle, 0, 0.4, 0.42));
  const mermaid = buildMermaid(lane, laneHex, 0.44, 0.45, 0.45);
  body.add(mermaid.rider);

  const neck = new THREE.Group();
  neck.position.set(0, 0, 1.0);
  neck.rotation.x = Math.PI / 2;
  body.add(neck);
  const head = new THREE.Group();
  const snout = mesh(cone(0.38, 0.75, 7), coat, 0, 0.32, 0);
  snout.scale.set(0.9, 1, 0.8);
  head.add(snout);
  head.add(mesh(box(0.06, 0.06, 0.06), eye, -0.26, 0.12, 0.12));
  head.add(mesh(box(0.06, 0.06, 0.06), eye, 0.26, 0.12, 0.12));
  head.add(mesh(box(0.42, 0.04, 0.05), eye, 0, 0.22, -0.28));
  neck.add(head);

  const tail = new THREE.Group();
  tail.position.set(0, 0.02, -1.15);
  const stalk = mesh(cyl(0.2, 0.08, 0.6, 6), coat, 0, 0, -0.25);
  stalk.rotation.x = Math.PI / 2;
  tail.add(stalk);
  const upperLobe = mesh(cone(0.18, 0.8, 3), fins, 0, 0.32, -0.6);
  upperLobe.rotation.x = -0.75;
  upperLobe.scale.set(0.25, 1, 1);
  tail.add(upperLobe);
  const lowerLobe = mesh(cone(0.14, 0.5, 3), fins, 0, -0.18, -0.55);
  lowerLobe.rotation.x = Math.PI + 0.85;
  lowerLobe.scale.set(0.25, 1, 1);
  tail.add(lowerLobe);
  body.add(tail);

  const pectoral = (side: number, phase: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.34, -0.18, 0.45);
    pivot.rotation.z = side * 1.15;
    const fin = mesh(cone(0.2, 0.75, 3), fins, 0, -0.36, -0.12);
    fin.scale.set(0.25, 1, 1);
    pivot.add(fin);
    const lower = new THREE.Group();
    pivot.add(lower);
    return { pivot, phase, lower };
  };
  const legs = [pectoral(-1, 0), pectoral(1, 0.5)];
  for (const leg of legs) body.add(leg.pivot);

  const extras = addRingAndTrail(root, body, lane, 3.0);
  const materials = [coat, fins, saddle, belly, ...mermaid.materials];
  return {
    root,
    body,
    neck,
    head,
    legs,
    tail,
    materials,
    baseColors: materials.map((m) => m.color.clone()),
    ...extras,
    species: 'SHARK',
    swimmer: true,
    riderTail: mermaid.tail,
    baseY: 1.05,
    neckBase: Math.PI / 2,
    neckSwing: 0.03,
    height: 2.4,
    gait: 0.12,
    stride: 5.5,
    cycle: Math.random(),
    wobble: 0,
    lastState: null,
  };
}

export function buildOctopus(laneHex: string): AnimalRig {
  const lane = new THREE.Color(laneHex);
  const skinColor = lane.clone().lerp(new THREE.Color('#c4553d'), 0.35);
  const coat = material(skinColor, { roughness: 0.6 });
  const suckers = material(skinColor.clone().lerp(new THREE.Color('#ffe2cf'), 0.6));
  const eyeWhite = material('#f7f3e8');
  const pupil = material('#15110f');
  const saddle = material(lane.clone().lerp(new THREE.Color('#ffffff'), 0.15), { roughness: 0.5 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.2;
  root.add(body);

  const neck = new THREE.Group();
  neck.position.set(0, 0.1, 0.1);
  body.add(neck);
  const head = new THREE.Group();
  const mantle = mesh(
    cached('octo-mantle', () => new THREE.SphereGeometry(0.6, 9, 7)),
    coat,
    0,
    0.45,
    -0.35,
  );
  mantle.scale.set(0.95, 1.05, 1.45);
  mantle.rotation.x = -0.55;
  head.add(mantle);
  for (const side of [-1, 1]) {
    head.add(
      mesh(
        cached('octo-eye', () => new THREE.SphereGeometry(0.13, 7, 5)),
        eyeWhite,
        side * 0.3,
        0.2,
        0.32,
      ),
    );
    head.add(mesh(box(0.06, 0.12, 0.05), pupil, side * 0.32, 0.2, 0.44));
  }
  head.add(mesh(box(0.8, 0.05, 0.4), saddle, 0, 0.98, -0.45));
  const mermaid = buildMermaid(lane, laneHex, 0.98, -0.35, 0.3);
  head.add(mermaid.rider);
  neck.add(head);

  const tail = new THREE.Group();
  tail.position.set(0, 0.35, -1.05);
  const siphon = mesh(cyl(0.08, 0.14, 0.3, 6), coat);
  siphon.rotation.x = Math.PI / 2;
  tail.add(siphon);
  body.add(tail);

  const legs: AnimalRig['legs'] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = ((i + 0.5) / 8) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(angle) * 0.32, -0.05, Math.sin(angle) * 0.22 + 0.05);
    pivot.rotation.y = -angle + Math.PI / 2;
    pivot.rotation.z = 0.2;
    pivot.add(mesh(cyl(0.11, 0.08, 0.55, 5), coat, 0, -0.27, 0));
    pivot.add(mesh(box(0.06, 0.06, 0.06), suckers, 0, -0.35, 0.09));
    const lower = new THREE.Group();
    lower.position.set(0, -0.55, 0);
    lower.add(mesh(cyl(0.08, 0.03, 0.6, 5), coat, 0, -0.3, 0));
    lower.add(mesh(box(0.05, 0.05, 0.05), suckers, 0, -0.25, 0.07));
    pivot.add(lower);
    legs.push({ pivot, phase: (i % 2) * 0.5 + i * 0.04, lower });
    body.add(pivot);
  }

  const extras = addRingAndTrail(root, body, lane, 2.6);
  const materials = [coat, suckers, saddle, eyeWhite, ...mermaid.materials];
  return {
    root,
    body,
    neck,
    head,
    legs,
    tail,
    materials,
    baseColors: materials.map((m) => m.color.clone()),
    ...extras,
    species: 'OCTOPUS',
    swimmer: true,
    riderTail: mermaid.tail,
    baseY: 1.2,
    neckBase: 0,
    neckSwing: 0.06,
    height: 3.0,
    gait: 0.5,
    stride: 4.2,
    cycle: Math.random(),
    wobble: 0,
    lastState: null,
  };
}

const BUILDERS: Record<Species, (laneHex: string) => AnimalRig> = {
  HORSE: buildHorse,
  GIRAFFE: buildGiraffe,
  SHARK: buildShark,
  OCTOPUS: buildOctopus,
};

export function buildAnimal(species: Species, laneHex: string): AnimalRig {
  return (BUILDERS[species] ?? buildHorse)(laneHex);
}

const GREY = new THREE.Color('#7d8580');
const TIRED_TINT = new THREE.Color('#5c5f66');

export function animateRig(rig: AnimalRig, state: EntrantState, speed: number, dt: number, time: number): void {
  const moving = state === 'DNF' ? 0 : speed;
  const strideRate = moving / rig.stride;
  rig.cycle = (rig.cycle + dt * strideRate * (state === 'TIRED' ? 0.85 : 1)) % 1;
  const effort = Math.min(1, moving / 13);
  const amplitude = (state === 'TIRED' ? 0.75 : 1) * rig.gait * effort;
  for (const leg of rig.legs) {
    const angle = Math.sin((rig.cycle + leg.phase) * Math.PI * 2);
    leg.pivot.rotation.x = angle * amplitude;
    leg.lower.rotation.x = Math.max(0, -Math.cos((rig.cycle + leg.phase) * Math.PI * 2)) * amplitude * 1.1;
  }
  const swim = rig.swimmer ? Math.sin(rig.cycle * Math.PI * 2) : 0;
  const bob = rig.swimmer ? swim * 0.08 * effort : Math.abs(Math.sin(rig.cycle * Math.PI * 2)) * 0.09 * effort;
  const breathe = moving < 0.5 ? Math.sin(time * 2.2) * 0.015 : 0;
  rig.body.position.y = rig.baseY + bob + breathe - (state === 'TIRED' ? 0.08 : 0) - (state === 'DNF' ? 0.12 : 0);
  const neckSwing = Math.sin(rig.cycle * Math.PI * 2 + 0.6) * rig.neckSwing * effort;
  const droop = state === 'TIRED' ? 0.25 : state === 'DNF' ? 0.45 : 0;
  rig.neck.rotation.x = rig.neckBase + neckSwing + (rig.swimmer ? droop * 0.3 : droop);
  if (rig.swimmer) {
    rig.tail.rotation.y = Math.sin(rig.cycle * Math.PI * 2) * (0.25 + 0.35 * effort) * (state === 'DNF' ? 0 : 1);
    rig.body.rotation.y = -Math.sin(rig.cycle * Math.PI * 2) * 0.06 * effort;
  } else {
    rig.tail.rotation.z = Math.sin(time * 3 + rig.cycle * 6) * 0.15;
  }
  if (rig.riderTail) rig.riderTail.rotation.x = TAIL_REST + Math.sin(time * 4 + rig.cycle * Math.PI * 2) * 0.18;

  if (state === 'STUMBLED') rig.wobble = Math.min(1, rig.wobble + dt * 4);
  else rig.wobble = Math.max(0, rig.wobble - dt * 2);
  rig.body.rotation.z = Math.sin(time * 18) * 0.22 * rig.wobble;
  rig.body.rotation.x = 0.18 * rig.wobble + Math.sin(rig.cycle * Math.PI * 4) * 0.03 * effort;

  if (rig.lastState !== state) {
    rig.lastState = state;
    rig.materials.forEach((m, index) => {
      const base = rig.baseColors[index];
      if (state === 'DNF') m.color.copy(base).lerp(GREY, 0.75);
      else if (state === 'TIRED' && index === 0) m.color.copy(base).lerp(TIRED_TINT, 0.35);
      else m.color.copy(base);
      m.emissive.set(state === 'SPRINTING' && index !== 1 ? base : '#000000');
      m.emissiveIntensity = state === 'SPRINTING' ? 0.28 : 0;
    });
  }

  const ringTarget = state === 'FINISHED' ? 0.85 : state === 'STUMBLED' ? 0.9 : 0;
  rig.ringMaterial.color.set(state === 'STUMBLED' ? '#ff4d4d' : '#ffd34d');
  rig.ringMaterial.opacity += (ringTarget - rig.ringMaterial.opacity) * Math.min(1, dt * 6);
  rig.ring.scale.setScalar(state === 'STUMBLED' ? 1 + Math.sin(time * 10) * 0.15 : 1);
  const trailTarget = state === 'SPRINTING' ? 0.7 : 0;
  rig.trailMaterial.opacity += (trailTarget - rig.trailMaterial.opacity) * Math.min(1, dt * 5);
}
