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
  trail: THREE.Mesh;
  trailMaterial: THREE.MeshBasicMaterial;
  species: Species;
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
const cone = (r: number, h: number, seg = 5) => cached(`cone:${r}:${h}:${seg}`, () => new THREE.ConeGeometry(r, h, seg));

function material(color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
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

function addRingAndTrail(root: THREE.Group, color: THREE.Color, length: number) {
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0, depthWrite: false });
  const ring = new THREE.Mesh(cached('ring', () => new THREE.RingGeometry(0.9, 1.25, 24)), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  root.add(ring);
  const trailMaterial = new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color('#ffffff'), 0.5), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const trail = new THREE.Mesh(cached(`trail:${length}`, () => new THREE.PlaneGeometry(0.9, length * 1.6)), trailMaterial);
  trail.rotation.x = -Math.PI / 2;
  trail.position.set(0, 0.08, -length * 1.1);
  root.add(trail);
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

  const jockey = new THREE.Group();
  jockey.position.set(0, 0.48, 0.12);
  jockey.rotation.x = 0.55;
  jockey.add(mesh(box(0.34, 0.42, 0.24), silks, 0, 0.2, 0));
  jockey.add(mesh(cached('head', () => new THREE.IcosahedronGeometry(0.13, 0)), skin, 0, 0.5, 0.03));
  jockey.add(mesh(cached('helmet', () => new THREE.SphereGeometry(0.15, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2)), silks, 0, 0.53, 0.03));
  jockey.add(mesh(box(0.1, 0.1, 0.38), silks, -0.2, 0.08, 0.16));
  jockey.add(mesh(box(0.1, 0.1, 0.38), silks, 0.2, 0.08, 0.16));
  body.add(jockey);

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

  const extras = addRingAndTrail(root, lane, 2.4);
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
  legs[1]!.pivot.position.y = -0.1;
  legs[3]!.pivot.position.y = -0.1;
  for (const leg of legs) body.add(leg.pivot);

  const extras = addRingAndTrail(root, lane, 2.6);
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
    height: 5.0,
    gait: 0.45,
    stride: 4.8,
    cycle: Math.random(),
    wobble: 0,
    lastState: null,
  };
}

export function buildAnimal(species: Species, laneHex: string): AnimalRig {
  return species === 'GIRAFFE' ? buildGiraffe(laneHex) : buildHorse(laneHex);
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
  const baseY = rig.species === 'GIRAFFE' ? 2.2 : 1.32;
  const bob = Math.abs(Math.sin(rig.cycle * Math.PI * 2)) * 0.09 * effort;
  const breathe = moving < 0.5 ? Math.sin(time * 2.2) * 0.015 : 0;
  rig.body.position.y = baseY + bob + breathe - (state === 'TIRED' ? 0.08 : 0) - (state === 'DNF' ? 0.12 : 0);
  const neckBase = rig.species === 'GIRAFFE' ? 0.42 : 0.7;
  const neckSwing = Math.sin(rig.cycle * Math.PI * 2 + 0.6) * (rig.species === 'GIRAFFE' ? 0.12 : 0.08) * effort;
  const droop = state === 'TIRED' ? 0.25 : state === 'DNF' ? 0.45 : 0;
  rig.neck.rotation.x = neckBase + neckSwing + droop;
  rig.tail.rotation.z = Math.sin(time * 3 + rig.cycle * 6) * 0.15;

  if (state === 'STUMBLED') rig.wobble = Math.min(1, rig.wobble + dt * 4);
  else rig.wobble = Math.max(0, rig.wobble - dt * 2);
  rig.body.rotation.z = Math.sin(time * 18) * 0.22 * rig.wobble;
  rig.body.rotation.x = 0.18 * rig.wobble + Math.sin(rig.cycle * Math.PI * 4) * 0.03 * effort;

  if (rig.lastState !== state) {
    rig.lastState = state;
    rig.materials.forEach((m, index) => {
      const base = rig.baseColors[index]!;
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
  const trailTarget = state === 'SPRINTING' ? 0.45 : 0;
  rig.trailMaterial.opacity += (trailTarget - rig.trailMaterial.opacity) * Math.min(1, dt * 5);
}
