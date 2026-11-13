import * as THREE from 'three';
import type { EntrantState } from '../../lib/types';
import { ball, pixelTexture, tileFbm, type Vec3 } from '../kit';
import {
  AquaticBuilder,
  aquaticSkin,
  chainWeights,
  foil,
  Profile,
  revise,
  type FoilStation,
  type Section,
} from './aquaticKit';
import { addMermaid, mermaidMaterial } from './mermaid';
import { addEffects, atlasCell, BLANK_UV, gearAtlas, laneIndex, smooth, stateTint, type AnimalRig } from './rig';

type Pattern = 'plain' | 'stripes' | 'spots';

type Variant = {
  top: string;
  flank: string;
  belly: string;
  tip?: string;
  pattern: Pattern;
  girth: number;
  fin: number;
  edge: number;
};

const VARIANTS: Variant[] = [
  { top: '#4f5961', flank: '#6f7b85', belly: '#eef0ee', pattern: 'plain', girth: 1.06, fin: 1, edge: -0.12 },
  { top: '#1c3a70', flank: '#3f78bd', belly: '#f1f4f6', pattern: 'plain', girth: 0.9, fin: 0.88, edge: -0.3 },
  { top: '#59625a', flank: '#8d9486', belly: '#ece7d6', pattern: 'stripes', girth: 1.04, fin: 0.95, edge: -0.3 },
  { top: '#223a66', flank: '#4a6da3', belly: '#f3f5f7', pattern: 'plain', girth: 0.97, fin: 1.02, edge: -0.2 },
  {
    top: '#857a67',
    flank: '#a59a81',
    belly: '#f1eee4',
    tip: '#15120e',
    pattern: 'plain',
    girth: 0.98,
    fin: 1,
    edge: -0.25,
  },
  { top: '#5f605d', flank: '#85857f', belly: '#e6e6e0', pattern: 'plain', girth: 1.1, fin: 0.9, edge: -0.35 },
  { top: '#93843f', flank: '#b5a560', belly: '#f0eac8', pattern: 'plain', girth: 1, fin: 0.92, edge: -0.3 },
  { top: '#a9c3d6', flank: '#b9cfde', belly: '#eef2f3', pattern: 'spots', girth: 1.08, fin: 0.9, edge: -0.3 },
  { top: '#775c3c', flank: '#9c7d57', belly: '#efe8da', pattern: 'plain', girth: 1, fin: 1, edge: -0.28 },
  {
    top: '#2b3035',
    flank: '#4a5058',
    belly: '#d9dcdc',
    tip: '#ecebe4',
    pattern: 'plain',
    girth: 1.02,
    fin: 1.05,
    edge: -0.4,
  },
];

const textures = new Map<Pattern, THREE.Texture>();

function skinTexture(pattern: Pattern): THREE.Texture {
  const cached = textures.get(pattern);
  if (cached) return cached;
  const size = 256;
  const fine = tileFbm(size, 20, 3, 5);
  const broad = tileFbm(size, 4, 3, 29);
  const blot = tileFbm(size, 10, 2, 47);
  const texture = pixelTexture(size, (x, _, i) => {
    let value = 0.84 + fine[i] * 0.12 + broad[i] * 0.12;
    if (pattern === 'stripes') {
      const u = (x / size) * 13 + (broad[i] - 0.5) * 1.6;
      const bar = Math.abs(u - Math.floor(u) - 0.5) * 2;
      value *= 0.6 + 0.4 * smooth(0.25, 0.75, bar + (fine[i] - 0.5) * 0.5);
    }
    if (pattern === 'spots') value = 0.36 + 0.06 * fine[i] + 0.62 * smooth(0.63, 0.7, blot[i]);
    return [value, value, value];
  });
  textures.set(pattern, texture);
  return texture;
}

const JOINTS: [number, string][] = [
  [-0.85, 'body'],
  [0.05, 's1'],
  [0.4, 's2'],
  [0.7, 's3'],
  [0.95, 's4'],
  [1.15, 's5'],
  [1.3, 's6'],
];
const wz = (z: number) => chainWeights('head', JOINTS, -z);
const SPINE = ['s1', 's2', 's3', 's4', 's5', 's6'];
const SPINE_Z = [-0.05, -0.4, -0.7, -0.95, -1.15, -1.3];

export function buildShark(laneHex: string): AnimalRig {
  const lane = new THREE.Color(laneHex);
  const index = laneIndex(laneHex);
  const variant = VARIANTS[index % VARIANTS.length];
  const top = new THREE.Color(variant.top);
  const flank = new THREE.Color(variant.flank);
  const belly = new THREE.Color(variant.belly);
  const tipColor = variant.tip ? new THREE.Color(variant.tip) : top.clone().multiplyScalar(0.7);
  const g = variant.girth;
  const seed = index * 2.39 + 0.7;

  const sections: Section[] = [
    { z: -1.36, y: 1.12, rx: 0.012, ry: 0.05 },
    { z: -1.28, y: 1.115, rx: 0.04, ry: 0.062 },
    { z: -1.18, y: 1.11, rx: 0.066, ry: 0.056 },
    { z: -1.02, y: 1.105, rx: 0.085 * g, ry: 0.1 * g },
    { z: -0.8, y: 1.1, rx: 0.135 * g, ry: 0.155 * g, down: 0.15 * g },
    { z: -0.5, y: 1.1, rx: 0.2 * g, ry: 0.215 * g, down: 0.2 * g },
    { z: -0.15, y: 1.1, rx: 0.26 * g, ry: 0.27 * g, down: 0.255 * g },
    { z: 0.2, y: 1.1, rx: 0.295 * g, ry: 0.295 * g, down: 0.285 * g },
    { z: 0.5, y: 1.1, rx: 0.295 * g, ry: 0.285 * g, down: 0.285 * g },
    { z: 0.78, y: 1.1, rx: 0.265 * g, ry: 0.245 * g, down: 0.26 * g },
    { z: 1.0, y: 1.095, rx: 0.215 * g, ry: 0.19 * g, down: 0.21 * g },
    { z: 1.18, y: 1.085, rx: 0.16 * g, ry: 0.135 * g, down: 0.14 * g },
    { z: 1.33, y: 1.07, rx: 0.1 * g, ry: 0.085, down: 0.07 },
    { z: 1.44, y: 1.055, rx: 0.05, ry: 0.042, down: 0.03 },
    { z: 1.5, y: 1.045, rx: 0.008, ry: 0.008 },
  ];
  const profile = new Profile(sections);

  const b = new AquaticBuilder();
  b.addBone('body', '', [0, 1.1, 0.3]);
  b.addBone('head', 'body', [0, 1.1, 0.85]);
  SPINE.forEach((name, i) => b.addBone(name, i ? SPINE[i - 1] : 'body', [0, 1.1, SPINE_Z[i]]));
  b.addBone('tip', 's6', [0, 1.42, -1.5]);
  b.addBone('pecL', 'body', [0.22 * g, 0.95, 0.7]);
  b.addBone('pecR', 'body', [-0.22 * g, 0.95, 0.7]);
  b.pair('pecL', 'pecR');

  const shade = (out: THREE.Color, position: THREE.Vector3): number => {
    const s = profile.at(position.z);
    const rel = (position.y - s.y) / (position.y >= s.y ? s.ry : s.down);
    const edge =
      variant.edge + 0.08 * Math.sin(position.z * 7.3 + seed) + 0.05 * Math.sin(position.z * 17.1 + seed * 2);
    const t = smooth(edge - 0.07, edge + 0.07, rel);
    out.copy(flank).lerp(top, smooth(0.05, 0.8, rel));
    out.lerpColors(belly, out.clone(), t);
    return t;
  };

  const body = b.loft(
    sections.map((s) => ({ p: [0, s.y, s.z] as Vec3, rx: s.rx, ry: s.ry, down: s.down, w: wz(s.z) })),
    { segments: 24, sub: 4 },
  );
  const scratch = new THREE.Color();
  revise(body, (position, color) => {
    const t = shade(scratch, position);
    color.copy(scratch);
    return variant.pattern === 'plain' ? 0.25 + 0.75 * t : t;
  });
  b.skin.push(body);

  const finDetail = variant.pattern === 'plain' ? 1 : 0.3;
  const finPaint = (base: THREE.Color, tipFrom: number) => (color: THREE.Color, _: number, v: number) => {
    color.copy(base).lerp(tipColor, smooth(tipFrom, tipFrom + 0.12, v) * (variant.tip ? 1 : 0.5));
  };
  const withWeights = (stations: Omit<FoilStation, 'w'>[], fixed?: string): FoilStation[] =>
    stations.map((s) => ({ ...s, w: fixed ?? wz(s.p[2]) }));
  const f = variant.fin;
  const backY = (z: number) => {
    const s = profile.at(z);
    return s.y + s.ry;
  };
  const d0 = backY(-0.2) - 0.07;
  b.skin.push(
    foil(
      b,
      withWeights([
        { p: [0, d0, -0.2], chord: 0.54, thick: 0.07 },
        { p: [0, d0 + 0.17 * f, -0.28], chord: 0.42, thick: 0.048 },
        { p: [0, d0 + 0.32 * f, -0.37], chord: 0.3, thick: 0.032 },
        { p: [0, d0 + 0.45 * f, -0.46], chord: 0.19, thick: 0.02 },
        { p: [0, d0 + 0.55 * f, -0.56], chord: 0.085, thick: 0.012 },
        { p: [0, d0 + 0.6 * f, -0.63], chord: 0.012, thick: 0.005 },
      ]),
      { ref: [1, 0, 0], detail: finDetail, paint: finPaint(top, 0.7) },
    ),
    foil(
      b,
      withWeights([
        { p: [0, backY(-0.84) - 0.03, -0.84], chord: 0.15, thick: 0.03 },
        { p: [0, backY(-0.84) + 0.05, -0.91], chord: 0.09, thick: 0.016 },
        { p: [0, backY(-0.84) + 0.1, -0.985], chord: 0.012, thick: 0.005 },
      ]),
      { ref: [1, 0, 0], detail: finDetail, sub: 2, paint: finPaint(top, 0.7) },
    ),
    foil(
      b,
      withWeights([
        { p: [0, 0.975, -0.86], chord: 0.13, thick: 0.03 },
        { p: [0, 0.9, -0.93], chord: 0.08, thick: 0.014 },
        { p: [0, 0.855, -0.99], chord: 0.012, thick: 0.005 },
      ]),
      { ref: [1, 0, 0], detail: finDetail, sub: 2, color: flank.clone().lerp(belly, 0.5) },
    ),
    foil(
      b,
      [
        { p: [0, 1.115, -1.27], chord: 0.13, thick: 0.05, w: 's6' },
        { p: [0, 1.28, -1.39], chord: 0.21, thick: 0.03, w: 's6' },
        { p: [0, 1.46, -1.52], chord: 0.18, thick: 0.022, w: { s6: 0.5, tip: 0.5 } },
        { p: [0, 1.63, -1.64], chord: 0.115, thick: 0.014, w: 'tip' },
        { p: [0, 1.77, -1.75], chord: 0.012, thick: 0.005, w: 'tip' },
      ],
      { ref: [1, 0, 0], detail: finDetail, paint: finPaint(flank.clone().lerp(top, 0.6), 0.75) },
    ),
    foil(
      b,
      [
        { p: [0, 1.105, -1.27], chord: 0.13, thick: 0.05, w: 's6' },
        { p: [0, 0.98, -1.37], chord: 0.17, thick: 0.028, w: 's6' },
        { p: [0, 0.86, -1.46], chord: 0.115, thick: 0.016, w: 's6' },
        { p: [0, 0.76, -1.53], chord: 0.012, thick: 0.005, w: 's6' },
      ],
      { ref: [1, 0, 0], detail: finDetail, paint: finPaint(flank.clone().lerp(top, 0.3), 0.75) },
    ),
  );
  const pectoral = foil(
    b,
    [
      { p: [0.17 * g, 0.97, 0.72], chord: 0.36, thick: 0.06, w: { body: 0.6, pecL: 0.4 } },
      { p: [0.36, 0.87, 0.6], chord: 0.31, thick: 0.036, w: 'pecL' },
      { p: [0.53, 0.79, 0.44], chord: 0.23, thick: 0.024, w: 'pecL' },
      { p: [0.66, 0.73, 0.27], chord: 0.13, thick: 0.014, w: 'pecL' },
      { p: [0.73, 0.7, 0.14], chord: 0.012, thick: 0.005, w: 'pecL' },
    ],
    {
      detail: finDetail,
      paint: (color, angle, v) => {
        color.copy(Math.sin(angle) < -0.15 ? belly : flank.clone().lerp(top, 0.5));
        color.lerp(tipColor, smooth(0.72, 0.84, v) * (variant.tip ? 1 : 0.4));
      },
    },
  );
  b.both(b.skin, pectoral);
  const pelvic = foil(
    b,
    withWeights([
      { p: [0.08, 0.93, -0.46], chord: 0.17, thick: 0.035 },
      { p: [0.19, 0.83, -0.56], chord: 0.1, thick: 0.016 },
      { p: [0.25, 0.77, -0.64], chord: 0.012, thick: 0.005 },
    ]),
    { detail: finDetail, sub: 2, color: flank.clone().lerp(belly, 0.6) },
  );
  b.both(b.skin, pelvic);

  const dark = { color: '#060607', detail: 0 };
  const eye = ball(profile.point(1.2, 0.28, -0.006), [0.012, 0.024, 0.027], {
    ...dark,
    weights: b.index('head'),
    segments: 10,
    rings: 5,
  });
  b.both(b.skin, eye);
  const slitColor = flank.clone().multiplyScalar(0.3);
  for (let k = 0; k < 5; k += 1) {
    const z = 0.84 + k * 0.047;
    const reachUp = 0.42 - k * 0.03;
    const slit = b.loft(
      [-0.42, -0.14, 0.14, reachUp].map((angle, i) => ({
        p: profile.point(z + angle * 0.05, angle, 0.001),
        rx: i === 0 || i === 3 ? 0.002 : 0.008,
        ry: 0.004,
        w: wz(z),
      })),
      { color: slitColor, ref: [0, 0, 1], segments: 5, sub: 2, detail: 0 },
    );
    b.both(b.skin, slit);
  }
  const jaw = [-0.95, -0.7, -0.4, 0, 0.4, 0.7, 0.95];
  b.skin.push(
    b.loft(
      jaw.map((a, i) => ({
        p: profile.point(1.25 - Math.abs(a) * 0.3, -Math.PI / 2 + a, -0.003),
        rx: i === 0 || i === jaw.length - 1 ? 0.003 : 0.011,
        ry: 0.008,
        w: 'head',
      })),
      { color: '#1a0f11', ref: [0, 1, 0], segments: 5, sub: 3, detail: 0 },
    ),
  );

  const blank = { uvRect: BLANK_UV };
  const leather = '#2a1a12';
  b.gear.push(
    b.loft(
      [0.1, 0.27, 0.44, 0.62].map((z) => profile.ring(z, 0.012, wz(z))),
      { color: '#ffffff', uvRect: atlasCell(index), segments: 18, sub: 3, arc: [-0.22, Math.PI + 0.22] },
    ),
  );
  for (const [z0, z1] of [
    [0.565, 0.635],
    [0.09, 0.14],
  ]) {
    b.gear.push(
      b.loft([profile.ring(z0, 0.018, wz(z0)), profile.ring(z1, 0.018, wz(z1))], {
        color: leather,
        ...blank,
        segments: 20,
        sub: 1,
        capStart: false,
        capEnd: false,
      }),
    );
  }
  const handleZ = 0.6;
  const handleY = backY(handleZ) + 0.012;
  b.gear.push(
    b.loft(
      [
        { p: [-0.085, handleY - 0.02, handleZ], rx: 0.013, ry: 0.013 },
        { p: [-0.075, handleY + 0.06, handleZ], rx: 0.013, ry: 0.013 },
        { p: [0, handleY + 0.085, handleZ], rx: 0.013, ry: 0.013 },
        { p: [0.075, handleY + 0.06, handleZ], rx: 0.013, ry: 0.013 },
        { p: [0.085, handleY - 0.02, handleZ], rx: 0.013, ry: 0.013 },
      ],
      { color: '#d6d9dd', ...blank, ref: [0, 0, 1], segments: 6, sub: 3, weights: wz(handleZ) },
    ),
  );

  const seatZ = 0.3;
  const seatY = backY(seatZ) + 0.085;
  const ride = (x: number, z: number, lift: number): Vec3 => {
    const s = profile.at(z);
    const inside = Math.max(0, 1 - (x / s.rx) ** 2);
    return [x, s.y + s.ry * Math.sqrt(inside) + lift, z];
  };
  const pose = addMermaid(b, {
    parent: 'body',
    seat: [0, seatY, seatZ],
    lean: 0.62,
    hand: [0.07, handleY + 0.07, handleZ - 0.005],
    tail: [
      ride(0.1, 0.04, 0.09),
      ride(0.15, -0.2, 0.11),
      ride(0.15, -0.42, 0.15),
      ride(0.13, -0.62, 0.21),
      ride(0.12, -0.8, 0.28),
    ],
    tailAmp: [0.1, 0.4, 0.8, 1],
    laneIndex: index,
    lane,
  });

  const skinMaterial = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.4,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.35,
  });
  aquaticSkin(skinMaterial, {
    map: skinTexture(variant.pattern),
    scale: variant.pattern === 'stripes' ? 0.5 : variant.pattern === 'spots' ? 1.1 : 1.7,
  });
  const gearMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: gearAtlas(),
    roughness: 0.62,
    side: THREE.DoubleSide,
  });
  const riderMaterial = mermaidMaterial();
  const mesh = b.build([skinMaterial, gearMaterial, riderMaterial]);
  const root = new THREE.Group();
  root.add(mesh);

  const bodyBone = b.bone('body');
  const headBone = b.bone('head');
  const spine = SPINE.map((name) => b.bone(name));
  const tip = b.bone('tip');
  const pecL = b.bone('pecL');
  const pecR = b.bone('pecR');
  const restY = bodyBone.position.y;
  const effects = addEffects(root, bodyBone, lane, 2.8, 1.05);
  const tint = stateTint([skinMaterial, gearMaterial, riderMaterial]);
  let phase = seed;
  let pace = 0;
  let wobble = 0;
  let weary = 0;
  let glory = 0;
  let limp = 0;
  const angles = [0, 0, 0, 0, 0, 0];

  const update = (state: EntrantState, speed: number, dt: number, time: number) => {
    const target = state === 'DNF' ? 0 : speed;
    pace += (target - pace) * Math.min(1, dt * 6);
    const v = pace;
    wobble += ((state === 'STUMBLED' ? 1 : 0) - wobble) * Math.min(1, dt * (state === 'STUMBLED' ? 6 : 2.5));
    weary += ((state === 'TIRED' ? 1 : 0) - weary) * Math.min(1, dt * 2);
    glory += ((state === 'FINISHED' ? 1 : 0) - glory) * Math.min(1, dt * 1.5);
    limp += ((state === 'DNF' ? 1 : 0) - limp) * Math.min(1, dt * 1.2);
    const effort = smooth(0, 12, v);
    const idle = 1 - smooth(0.1, 2, v);
    const beat = (0.45 + 0.17 * v) * (1 - 0.22 * weary) + wobble * 2.2;
    phase += dt * Math.PI * 2 * beat * (1 - limp);
    const amp = ((0.34 + 0.66 * effort) * (1 - 0.25 * weary) + wobble * 0.5) * (1 - limp);

    const sway = Math.sin(phase + 0.5);
    bodyBone.position.x = amp * 0.03 * Math.sin(phase + 1.3);
    bodyBone.position.y =
      restY +
      Math.sin(time * 1.3 + seed) * 0.035 * (0.35 + 0.65 * idle) * (1 - limp) -
      0.05 * weary -
      0.3 * limp +
      wobble * 0.05 * Math.sin(time * 9);
    bodyBone.rotation.y = amp * 0.04 * sway;
    bodyBone.rotation.z = amp * 0.05 * Math.sin(phase - 0.4) + wobble * 0.3 * Math.sin(time * 12) + limp * 0.55;
    bodyBone.rotation.x =
      wobble * 0.14 * Math.sin(time * 8.3) + limp * 0.16 + weary * 0.04 + Math.sin(time * 0.9 + seed) * 0.02 * idle;
    headBone.rotation.y = -amp * 0.075 * Math.sin(phase + 0.1);

    let previous = 0;
    for (let i = 0; i < spine.length; i += 1) {
      const u = (i + 1) / spine.length;
      angles[i] = amp * (0.03 + 0.4 * u ** 1.6) * Math.sin(phase - 2.3 * u);
      spine[i].rotation.y = angles[i] - previous;
      spine[i].rotation.x = -0.07 * limp - 0.015 * weary;
      previous = angles[i];
    }
    tip.rotation.y = amp * 0.3 * Math.sin(phase - 2.3 * 1.15 - 0.7);

    const trim = Math.sin(time * 0.8 + seed) * 0.05 * (0.4 + 0.6 * idle) + effort * 0.07 - weary * 0.14 - limp * 0.4;
    const sweep = effort * 0.14 + (state === 'SPRINTING' ? 0.08 : 0);
    const flutter = wobble * 0.3 * Math.sin(time * 15);
    pecL.rotation.set(0, sweep, trim + flutter + amp * 0.03 * sway);
    pecR.rotation.set(0, -sweep, -trim + flutter + amp * 0.03 * sway);

    pose({ dt, time, speed: v, phase, weary, wobble, glory, limp });
    tint(state, dt);
    effects.update(state, dt, time);
  };

  return { root, height: 2.3, update };
}
