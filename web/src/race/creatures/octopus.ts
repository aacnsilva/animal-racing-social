import * as THREE from 'three';
import type { EntrantState } from '../../lib/types';
import { ball, pixelTexture, tileFbm, tileNoise, type Vec3 } from '../kit';
import {
  AquaticBuilder,
  aquaticSkin,
  chainWeights,
  Profile,
  quatAbout,
  type NamedRing,
  type Section,
} from './aquaticKit';
import { addMermaid, mermaidMaterial } from './mermaid';
import {
  addEffects,
  atlasCell,
  BLANK_UV,
  frac,
  gearAtlas,
  laneIndex,
  mix,
  smooth,
  stateTint,
  type AnimalRig,
} from './rig';

let mottle: THREE.Texture | null = null;
let papillae: THREE.Texture | null = null;

function skinTextures(): [THREE.Texture, THREE.Texture] {
  if (mottle && papillae) return [mottle, papillae];
  const size = 256;
  const blotch = tileFbm(size, 5, 3, 3);
  const web = tileFbm(size, 11, 2, 19);
  const fine = tileFbm(size, 28, 2, 31);
  const dots = tileNoise(size, 18, 53);
  const bumps = tileNoise(size, 22, 71);
  mottle = pixelTexture(size, (_, __, i) => {
    const dark = smooth(0.38, 0.62, blotch[i]);
    let value = 0.72 + 0.2 * dark + 0.08 * fine[i];
    value *= 0.86 + 0.14 * smooth(0.3, 0.5, Math.abs(web[i] - 0.5) * 2 + 0.2);
    const spot = smooth(0.74, 0.82, dots[i]);
    return [value + spot * 0.2, value + spot * 0.19, value + spot * 0.16];
  });
  papillae = pixelTexture(
    size,
    (_, __, i) => {
      const value = 0.35 * fine[i] + 0.65 * smooth(0.45, 0.8, bumps[i]);
      return [value, value, value];
    },
    false,
  );
  return [mottle, papillae];
}

const ARMS = 8;
const ARM_BONES = 6;
const BONE_AT = [0, 0.16, 0.34, 0.52, 0.7, 0.86];
const RING_AT = [-0.05, 0.03, 0.12, 0.25, 0.4, 0.55, 0.7, 0.84, 0.94, 1];

const wz = (z: number) => {
  const m = smooth(0.2, 0.44, z);
  return { body: 1 - m, mantle: m };
};

const radius = (s: number) => 0.102 * (1 - Math.max(0, s)) ** 0.9 + 0.007;

function stroke(cycle: number): number {
  const c = frac(cycle);
  if (c < 0.2) return 1 - smooth(0, 0.2, c);
  if (c < 0.46) return 0;
  return smooth(0.46, 1, c);
}

type ArmRig = {
  bones: THREE.Bone[];
  open: THREE.Vector3;
  radial: THREE.Vector3;
  reach: number;
  seed: number;
};

export function buildOctopus(laneHex: string): AnimalRig {
  const lane = new THREE.Color(laneHex);
  const index = laneIndex(laneHex);
  const seed = index * 1.93 + 0.3;
  const hsl = { h: 0, s: 0, l: 0 };
  lane.getHSL(hsl);
  const base = new THREE.Color().setHSL(
    hsl.h,
    Math.min(0.85, hsl.s * 0.9 + 0.05),
    Math.max(0.2, Math.min(0.72, hsl.l)),
  );
  base.lerp(new THREE.Color('#b9683f'), 0.12 + 0.3 * (1 - Math.min(1, hsl.s * 2.5)));
  const back = base.clone().multiplyScalar(0.62);
  const pale = base.clone().lerp(new THREE.Color('#f2dccb'), 0.45);
  const sucker = new THREE.Color('#f7ebe2');

  const sections: Section[] = [
    { z: -0.2, y: 1.2, rx: 0.07, ry: 0.07 },
    { z: -0.12, y: 1.2, rx: 0.165, ry: 0.155 },
    { z: 0.0, y: 1.2, rx: 0.225, ry: 0.2 },
    { z: 0.14, y: 1.21, rx: 0.232, ry: 0.21 },
    { z: 0.28, y: 1.22, rx: 0.225, ry: 0.21 },
    { z: 0.42, y: 1.24, rx: 0.3, ry: 0.29 },
    { z: 0.62, y: 1.25, rx: 0.385, ry: 0.37 },
    { z: 0.85, y: 1.25, rx: 0.4, ry: 0.385 },
    { z: 1.05, y: 1.245, rx: 0.34, ry: 0.33 },
    { z: 1.22, y: 1.24, rx: 0.22, ry: 0.215 },
    { z: 1.32, y: 1.235, rx: 0.1, ry: 0.1 },
    { z: 1.36, y: 1.23, rx: 0.012, ry: 0.012 },
  ];
  const profile = new Profile(sections);
  const b = new AquaticBuilder();
  b.addBone('body', '', [0, 1.2, 0.1]);
  b.addBone('mantle', 'body', [0, 1.23, 0.3]);

  const countershade = (color: THREE.Color, angle: number) => {
    const s = Math.sin(angle);
    color.copy(base).lerp(back, smooth(0.1, 0.95, s));
    color.lerp(pale, smooth(0.45, 0.98, -s));
  };
  b.skin.push(
    b.loft(
      sections.map((s) => ({ p: [0, s.y, s.z] as Vec3, rx: s.rx, ry: s.ry, w: wz(s.z) })),
      { segments: 24, sub: 4, paint: countershade },
    ),
  );

  const eyeAngle = Math.PI / 2 - 0.98;
  const eyeAt = profile.point(0.12, eyeAngle, -0.03);
  const outward: Vec3 = [Math.cos(eyeAngle), Math.sin(eyeAngle), 0];
  const bodyIndex = b.index('body');
  const mound = ball(eyeAt, [0.082, 0.085, 0.1], { color: back, weights: bodyIndex, segments: 12, rings: 6 });
  b.both(b.skin, mound);
  const eyeCentre: Vec3 = [eyeAt[0] + outward[0] * 0.05, eyeAt[1] + outward[1] * 0.05 - 0.008, eyeAt[2]];
  const eyeball = ball(eyeCentre, [0.052, 0.052, 0.062], {
    color: '#d8b45e',
    weights: bodyIndex,
    segments: 12,
    rings: 6,
    detail: 0,
    paint: (color, _, v) => {
      color.multiplyScalar(0.75 + 0.35 * Math.sin(v * Math.PI));
    },
  });
  b.both(b.skin, eyeball);
  const pupilRings: NamedRing[] = [-1, -0.6, 0, 0.6, 1].map((t) => {
    const s = Math.max(0.12, Math.sqrt(1 - t * t));
    return {
      p: [eyeCentre[0] + outward[0] * 0.047, eyeCentre[1] + outward[1] * 0.047, eyeCentre[2] + t * 0.04],
      rx: 0.012 * s,
      ry: 0.012 * s,
      w: 'body',
    };
  });
  b.both(b.skin, b.loft(pupilRings, { color: '#080607', ref: outward, segments: 6, sub: 2, detail: 0 }));

  b.skin.push(
    b.loft(
      [
        { p: [0.13, 1.1, 0.34], rx: 0.03, ry: 0.03, w: 'mantle' },
        { p: [0.17, 1.07, 0.24], rx: 0.062, ry: 0.058, w: 'body' },
        { p: [0.215, 1.045, 0.1], rx: 0.055, ry: 0.052, w: 'body' },
        { p: [0.245, 1.03, -0.02], rx: 0.045, ry: 0.043, w: 'body', c: '#2a1614' },
        { p: [0.24, 1.035, 0.02], rx: 0.02, ry: 0.02, w: 'body', c: '#1a0d0c' },
      ],
      { color: pale.clone().lerp(base, 0.35), segments: 8, sub: 3 },
    ),
  );

  const arms: ArmRig[] = [];
  const crownZ = -0.1;
  const crownRadius = 0.105;
  for (let k = 0; k < ARMS; k += 1) {
    const phi = ((k + 0.5) / ARMS) * Math.PI * 2;
    const radial = new THREE.Vector3(Math.cos(phi), Math.sin(phi), 0);
    const side = new THREE.Vector3(-Math.sin(phi), Math.cos(phi), 0);
    const reach = 1.5 + 0.14 * Math.sin(k * 2.4 + seed);
    const origin = new THREE.Vector3(radial.x * crownRadius, 1.2 + radial.y * crownRadius, crownZ);
    const direction = new THREE.Vector3(radial.x * 0.14, radial.y * 0.14, -1).normalize();
    const at = (s: number, inward = 0, across = 0): Vec3 => {
      const p = origin
        .clone()
        .addScaledVector(direction, s * reach)
        .addScaledVector(radial, -inward)
        .addScaledVector(side, across);
      return [p.x, p.y, p.z];
    };
    const names = BONE_AT.map((_, i) => `a${k}_${i}`);
    names.forEach((name, i) => b.addBone(name, i ? names[i - 1] : 'body', at(BONE_AT[i])));
    const joints: [number, string][] = names.slice(1).map((name, i) => [BONE_AT[i + 1], name]);
    const weights = (s: number) => (s < 0 ? { body: 0.7, [names[0]]: 0.3 } : chainWeights(names[0], joints, s));
    b.skin.push(
      b.loft(
        RING_AT.map((s) => ({ p: at(s), rx: radius(s), ry: radius(s), down: radius(s) * 0.78, w: weights(s) })),
        {
          ref: [radial.x, radial.y, 0],
          segments: 8,
          sub: 3,
          capStart: false,
          paint: (color, angle, v) => {
            const s = Math.sin(angle);
            color.copy(base).lerp(back, smooth(0.2, 1, s) * (1 - 0.5 * v));
            color.lerp(pale, smooth(0.15, 0.7, -s));
          },
        },
      ),
    );
    const count = 13;
    for (let j = 0; j < count; j += 1) {
      const s = 0.1 + (j / (count - 1)) * 0.8;
      const r = radius(s);
      const size = r * 0.4;
      const across = (j % 2 ? 1 : -1) * r * 0.36;
      const depth = r * 0.72;
      b.skin.push(
        b.loft(
          [
            { p: at(s, depth - size * 0.2, across), rx: size, ry: size, c: pale },
            { p: at(s, depth + size * 0.45, across), rx: size * 0.85, ry: size * 0.85 },
            { p: at(s, depth + size * 0.62, across), rx: size * 0.35, ry: size * 0.35, c: '#c9a093' },
          ],
          { color: sucker, ref: [0, 0, 1], segments: 6, sub: 1, capStart: false, detail: 0, weights: weights(s) },
        ),
      );
    }
    arms.push({
      bones: names.map((name) => b.bone(name)),
      open: new THREE.Vector3(Math.sin(phi), -Math.cos(phi), 0),
      radial,
      reach: radial.y > 0.5 ? 0.55 : 1,
      seed: k * 2.17 + seed,
    });
  }

  const blank = { uvRect: BLANK_UV };
  const leather = '#2a1a12';
  b.gear.push(
    b.loft(
      [0.6, 0.74, 0.88, 1.02].map((z) => profile.ring(z, 0.012, 'mantle')),
      { color: '#ffffff', uvRect: atlasCell(index), segments: 18, sub: 3, arc: [-0.25, Math.PI + 0.25] },
    ),
  );
  for (const [z0, z1] of [
    [0.56, 0.62],
    [1.0, 1.045],
  ]) {
    b.gear.push(
      b.loft([profile.ring(z0, 0.018, 'mantle'), profile.ring(z1, 0.018, 'mantle')], {
        color: leather,
        ...blank,
        segments: 20,
        sub: 1,
        capStart: false,
        capEnd: false,
      }),
    );
  }
  const handleZ = 0.59;
  const crest = profile.at(handleZ);
  const handleY = crest.y + crest.ry + 0.012;
  b.gear.push(
    b.loft(
      [
        { p: [-0.085, handleY - 0.02, handleZ], rx: 0.013, ry: 0.013 },
        { p: [-0.075, handleY + 0.06, handleZ], rx: 0.013, ry: 0.013 },
        { p: [0, handleY + 0.085, handleZ], rx: 0.013, ry: 0.013 },
        { p: [0.075, handleY + 0.06, handleZ], rx: 0.013, ry: 0.013 },
        { p: [0.085, handleY - 0.02, handleZ], rx: 0.013, ry: 0.013 },
      ],
      { color: '#d6d9dd', ...blank, ref: [0, 0, 1], segments: 6, sub: 3, weights: 'mantle' },
    ),
  );

  const seatZ = 0.25;
  const seatAt = profile.at(seatZ);
  const seatY = seatAt.y + seatAt.ry + 0.085;
  const pose = addMermaid(b, {
    parent: 'body',
    seat: [0, seatY, seatZ],
    lean: 0.38,
    hand: [0.07, handleY + 0.07, handleZ - 0.005],
    tail: [
      [0, seatY + 0.0, 0.02],
      [0, seatY + 0.02, -0.2],
      [0, seatY + 0.06, -0.42],
      [0, seatY + 0.11, -0.62],
      [0, seatY + 0.17, -0.8],
    ],
    tailAmp: [0.15, 0.45, 0.8, 1],
    laneIndex: index,
    lane,
  });

  const [map, bump] = skinTextures();
  const skinMaterial = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.38,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.22,
  });
  aquaticSkin(skinMaterial, { map, scale: 1.5, bump, bumpScale: 2.6, bumpStrength: 0.006 });
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
  const mantle = b.bone('mantle');
  const restY = bodyBone.position.y;
  const restZ = bodyBone.position.z;
  const effects = addEffects(root, bodyBone, lane, 2.8, 1.05);
  const tint = stateTint([skinMaterial, gearMaterial, riderMaterial]);
  const q = new THREE.Quaternion();
  let cycle = frac(seed);
  let pace = 0;
  let wobble = 0;
  let weary = 0;
  let glory = 0;
  let limp = 0;

  const update = (state: EntrantState, speed: number, dt: number, time: number) => {
    const target = state === 'DNF' ? 0 : speed;
    pace += (target - pace) * Math.min(1, dt * 6);
    const v = pace;
    wobble += ((state === 'STUMBLED' ? 1 : 0) - wobble) * Math.min(1, dt * (state === 'STUMBLED' ? 6 : 2.5));
    weary += ((state === 'TIRED' ? 1 : 0) - weary) * Math.min(1, dt * 2);
    glory += ((state === 'FINISHED' ? 1 : 0) - glory) * Math.min(1, dt * 1.5);
    limp += ((state === 'DNF' ? 1 : 0) - limp) * Math.min(1, dt * 1.2);
    const hover = Math.max(1 - smooth(0.2, 2.6, v), limp);
    const jet = (1 - hover) * (1 - 0.2 * weary);
    const rate = (0.5 + 0.105 * v) * (1 - 0.22 * weary) * (1 - limp);
    cycle = frac(cycle + dt * rate);
    const tau = Math.PI * 2;
    const fill = stroke(cycle + 0.06);
    const breath = Math.sin(time * 1.7 + seed) * 0.5 + 0.5;
    const swell = mix((fill - 0.45) * 0.2, (breath - 0.5) * 0.09, hover) * (1 - 0.6 * limp);
    mantle.scale.set(1 + swell, 1 + swell, 1 - swell * 0.7);

    bodyBone.position.z = restZ + 0.08 * jet * Math.sin(tau * (cycle - 0.06));
    bodyBone.position.y =
      restY +
      Math.sin(time * 1.2 + seed) * 0.05 * hover * (1 - limp) +
      0.02 * jet * Math.sin(tau * (cycle - 0.2)) -
      0.05 * weary -
      0.32 * limp +
      wobble * 0.05 * Math.sin(time * 9);
    bodyBone.rotation.x =
      -0.16 * hover * (1 - limp) +
      0.03 * jet * Math.sin(tau * (cycle - 0.1)) +
      wobble * 0.2 * Math.sin(time * 8.3) +
      limp * 0.3 +
      weary * 0.05;
    bodyBone.rotation.z = wobble * 0.35 * Math.sin(time * 11) + limp * 0.4 + Math.sin(time * 0.8 + seed) * 0.04 * hover;
    bodyBone.rotation.y = wobble * 0.2 * Math.sin(time * 6.1);

    const live = 1 - limp;
    for (const arm of arms) {
      for (let i = 0; i < ARM_BONES; i += 1) {
        const lagged = stroke(cycle - i * 0.055 - Math.sin(arm.seed) * 0.02);
        const ripple = Math.sin(tau * cycle * 2 - i * 1.2 + arm.seed) * (i < 2 ? 0.03 : 0.1) + (i > 3 ? 0.22 : 0);
        const jetBend = (i === 0 ? 0.25 : 0.09) * lagged * arm.reach * (1 - 0.25 * weary) + ripple * (1 - lagged);
        const drift = Math.sin(time * 0.8 - i * 0.7 + arm.seed);
        const hoverBend =
          (i === 0 ? 0.55 + 0.1 * drift : i > 3 ? -0.3 + 0.2 * drift * live : 0.04 + 0.13 * drift * live) * arm.reach;
        const thrash = wobble * 0.3 * Math.sin(time * 14 + arm.seed * 3 + i * 1.3);
        const bend = mix(jetBend, hoverBend, hover) + thrash + weary * 0.03;
        quatAbout(arm.bones[i].quaternion, arm.open.x, arm.open.y, 0, bend);
        const sway =
          Math.sin(time * (1.1 + 5 * jet) - i * 0.9 + arm.seed * 1.7) * (0.05 * hover * live + 0.03 * jet) +
          thrash * 0.5;
        arm.bones[i].quaternion.multiply(quatAbout(q, arm.radial.x, arm.radial.y, 0, sway));
        const droop = (i === 0 ? -0.2 : i < 3 ? -0.1 : -0.03) * hover * (0.6 + 0.4 * limp) - weary * 0.02;
        arm.bones[i].quaternion.premultiply(quatAbout(q, 1, 0, 0, droop));
      }
    }

    pose({ dt, time, speed: v, phase: cycle * tau, weary, wobble, glory, limp });
    tint(state, dt);
    effects.update(state, dt, time);
  };

  return { root, height: 2.55, update };
}
