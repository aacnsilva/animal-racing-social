import * as THREE from 'three';
import { ball, pixelTexture, type Vec3 } from '../kit';
import { aquaticSkin, foil, type AquaticBuilder, type NamedRing } from './aquaticKit';
import { smooth } from './rig';

export type MermaidSpec = {
  parent: string;
  seat: Vec3;
  lean: number;
  hand: Vec3;
  tail: [Vec3, Vec3, Vec3, Vec3, Vec3];
  tailAmp: [number, number, number, number];
  laneIndex: number;
  lane: THREE.Color;
};

export type RiderPose = {
  dt: number;
  time: number;
  speed: number;
  phase: number;
  weary: number;
  wobble: number;
  glory: number;
  limp: number;
};

const SKIN = ['#d49a6a', '#b87445', '#7f4c2f', '#e2b088', '#9a5f38'];
const HAIR = ['#b5341f', '#e8bf55', '#2c1d15', '#6a3fc0', '#1f8f88', '#e77aa6', '#e9e4d0', '#0f0d0e', '#7a4a24'];

let scaleMap: THREE.Texture | null = null;
let scaleBump: THREE.Texture | null = null;

function scaleField(size: number, cells: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * cells;
      const v = (y / size) * cells;
      const a = Math.hypot(u - Math.round(u), v - Math.round(v));
      const b = Math.hypot(u - 0.5 - Math.round(u - 0.5), v - 0.5 - Math.round(v - 0.5));
      out[y * size + x] = Math.min(a, b) * 2;
    }
  }
  return out;
}

export function mermaidMaterial(): THREE.MeshPhysicalMaterial {
  const size = 128;
  if (!scaleMap || !scaleBump) {
    const field = scaleField(size, 8);
    scaleMap = pixelTexture(size, (_, __, i) => {
      const value = 1.04 - 0.3 * smooth(0.4, 0.72, field[i]);
      return [value, value, value];
    });
    scaleBump = pixelTexture(
      size,
      (_, __, i) => {
        const value = 1 - field[i];
        return [value, value, value];
      },
      false,
    );
  }
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.52,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  aquaticSkin(material, { map: scaleMap, scale: 5.5, bump: scaleBump, bumpScale: 5.5, bumpStrength: 0.006 });
  return material;
}

const v3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
const flip = (v: Vec3): Vec3 => [-v[0], v[1], v[2]];

const IDENTITY = new THREE.Quaternion();
const FORWARD = new THREE.Vector3(0, 0, 1);

export function addMermaid(b: AquaticBuilder, spec: MermaidSpec): (pose: RiderPose) => void {
  const [, sy, sz] = spec.seat;
  const cl = Math.cos(spec.lean);
  const sl = Math.sin(spec.lean);
  const tor = (x: number, y: number, z: number): Vec3 => [x, sy + y * cl - z * sl, sz + y * sl + z * cl];
  const neck = tor(0, 0.5, 0);
  const headLean = spec.lean * 0.2;
  const ch = Math.cos(headLean);
  const sh = Math.sin(headLean);
  const hd = (x: number, y: number, z: number): Vec3 => [x, neck[1] + y * ch - z * sh, neck[2] + y * sh + z * ch];

  const index = spec.laneIndex;
  const skin = new THREE.Color(SKIN[index % SKIN.length]);
  const hair = new THREE.Color(HAIR[(index * 4 + 1) % HAIR.length]);
  const white = new THREE.Color('#ffffff');
  const tailColor = spec.lane.clone().lerp(new THREE.Color('#1c8f86'), 0.12);
  const tailPale = tailColor.clone().lerp(white, 0.4);
  const flukeColor = spec.lane.clone().lerp(new THREE.Color('#bff3ea'), 0.3);
  const top = spec.lane.clone().lerp(white, 0.08);

  b.addBone('m_seat', spec.parent, spec.seat);
  b.addBone('m_torso', 'm_seat', tor(0, 0.12, 0));
  b.addBone('m_head', 'm_torso', tor(0, 0.48, 0));
  const hairPath: Vec3[] = [
    hd(0, 0.2, -0.05),
    hd(0, 0.1, -0.12),
    tor(0, 0.38, -0.17),
    tor(0, 0.24, -0.15),
    tor(0, 0.11, -0.18),
    tor(0, 0.0, -0.23),
  ];
  b.addBone('m_hair0', 'm_head', hairPath[1]);
  b.addBone('m_hair1', 'm_hair0', hairPath[2]);
  b.addBone('m_hair2', 'm_hair1', hairPath[3]);

  const shoulder = new THREE.Vector3(...tor(0.165, 0.395, 0));
  const hand = new THREE.Vector3(...spec.hand);
  const reach = hand.clone().sub(shoulder);
  const span = reach.length();
  const upper = Math.max(0.27, span / 2 + 0.01);
  const dir = reach.clone().normalize();
  const out = new THREE.Vector3(0.75, -0.45, -0.5);
  out.addScaledVector(dir, -out.dot(dir)).normalize();
  const elbow = shoulder
    .clone()
    .addScaledVector(reach, 0.5)
    .addScaledVector(out, Math.sqrt(Math.max(0, upper * upper - (span * span) / 4)));
  b.addBone('m_armL0', 'm_torso', v3(shoulder));
  b.addBone('m_armL1', 'm_armL0', v3(elbow));
  b.addBone('m_armR0', 'm_torso', flip(v3(shoulder)));
  b.addBone('m_armR1', 'm_armR0', flip(v3(elbow)));
  b.pair('m_armL0', 'm_armR0');
  b.pair('m_armL1', 'm_armR1');

  spec.tail.forEach((point, i) => b.addBone(i < 4 ? `m_tail${i}` : 'm_fluke', i ? `m_tail${i - 1}` : 'm_seat', point));

  const list = b.rider;
  list.push(
    b.loft(
      [
        { p: tor(0, -0.05, 0.02), rx: 0.1, ry: 0.07, w: 'm_seat', detail: 1 },
        { p: tor(0, 0.03, 0.01), rx: 0.15, ry: 0.105, w: 'm_seat', detail: 1 },
        { p: tor(0, 0.1, 0), rx: 0.135, ry: 0.092, w: { m_seat: 0.5, m_torso: 0.5 }, detail: 1 },
        { p: tor(0, 0.17, 0), rx: 0.112, ry: 0.08, w: 'm_torso', detail: 0 },
        { p: tor(0, 0.26, 0.005), rx: 0.132, ry: 0.098, down: 0.085, w: 'm_torso', detail: 0 },
        { p: tor(0, 0.33, 0.005), rx: 0.148, ry: 0.108, down: 0.088, w: 'm_torso', detail: 0 },
        { p: tor(0, 0.395, 0), rx: 0.16, ry: 0.082, w: 'm_torso', detail: 0 },
        { p: tor(0, 0.435, 0), rx: 0.085, ry: 0.06, w: 'm_torso', detail: 0 },
        { p: tor(0, 0.47, 0.005), rx: 0.044, ry: 0.044, w: { m_torso: 0.5, m_head: 0.5 }, detail: 0 },
        { p: tor(0, 0.53, 0.012), rx: 0.04, ry: 0.04, w: 'm_head', detail: 0 },
      ],
      {
        color: skin,
        ref: [0, 0, 1],
        segments: 12,
        sub: 3,
        paint: (color, angle, v) => {
          const y = v * 0.58 - 0.05;
          if (y < 0.105 + 0.03 * Math.abs(Math.cos(angle)) - 0.025 * Math.max(0, Math.sin(angle)))
            color.copy(tailColor);
          else if (y > 0.25 && y < 0.35) color.copy(top);
          else color.copy(skin);
        },
      },
    ),
  );

  const headRings: NamedRing[] = [];
  for (let i = 0; i <= 7; i += 1) {
    const a = (i / 7) * Math.PI;
    const s = Math.max(0.05, Math.sin(a));
    const jaw = a < Math.PI / 2 ? 0.8 + 0.2 * Math.sin(a) : 1;
    headRings.push({
      p: hd(0, 0.112 - Math.cos(a) * 0.106, 0.012),
      rx: 0.079 * s * jaw,
      ry: 0.093 * s * jaw,
      down: 0.088 * s,
      w: 'm_head',
    });
  }
  list.push(b.loft(headRings, { color: skin, ref: [0, 0, 1], segments: 12, sub: 2, detail: 0 }));
  const headBone = b.index('m_head');
  for (const side of [-1, 1]) {
    list.push(
      ball(hd(side * 0.029, 0.11, 0.088), [0.0095, 0.0105, 0.007], {
        color: '#1b1412',
        weights: headBone,
        detail: 0,
        segments: 6,
        rings: 3,
      }),
    );
  }
  list.push(
    ball(hd(0, 0.086, 0.1), [0.009, 0.013, 0.011], {
      color: skin.clone().multiplyScalar(0.94),
      weights: headBone,
      detail: 0,
      segments: 6,
      rings: 3,
    }),
    ball(hd(0, 0.054, 0.083), [0.017, 0.006, 0.007], {
      color: '#9c3f3c',
      weights: headBone,
      detail: 0,
      segments: 6,
      rings: 3,
    }),
    ball(hd(0, 0.152, -0.012), [0.097, 0.1, 0.106], {
      color: hair,
      weights: headBone,
      detail: 0,
      segments: 12,
      rings: 6,
    }),
    b.loft(
      [
        { p: hairPath[0], rx: 0.06, ry: 0.045, w: 'm_head' },
        { p: hairPath[1], rx: 0.095, ry: 0.062, w: { m_head: 0.5, m_hair0: 0.5 } },
        { p: hairPath[2], rx: 0.105, ry: 0.066, w: { m_hair0: 0.5, m_hair1: 0.5 } },
        { p: hairPath[3], rx: 0.098, ry: 0.058, w: { m_hair1: 0.5, m_hair2: 0.5 } },
        { p: hairPath[4], rx: 0.07, ry: 0.042, w: 'm_hair2' },
        { p: hairPath[5], rx: 0.015, ry: 0.01, w: 'm_hair2' },
      ],
      {
        color: hair,
        ref: [0, 0, 1],
        segments: 10,
        sub: 3,
        detail: 0,
        paint: (color, angle, v) => {
          color.multiplyScalar(0.8 + 0.2 * Math.sin(angle * 7 + v * 4));
        },
      },
    ),
  );

  const mid = (a: THREE.Vector3, c: THREE.Vector3, t: number): Vec3 => v3(a.clone().lerp(c, t));
  const arm = b.loft(
    [
      { p: v3(shoulder), rx: 0.05, ry: 0.05, w: { m_torso: 0.5, m_armL0: 0.5 } },
      { p: mid(shoulder, elbow, 0.5), rx: 0.04, ry: 0.04, w: 'm_armL0' },
      { p: v3(elbow), rx: 0.034, ry: 0.034, w: { m_armL0: 0.5, m_armL1: 0.5 } },
      { p: mid(elbow, hand, 0.5), rx: 0.03, ry: 0.03, w: 'm_armL1' },
      { p: mid(elbow, hand, 0.86), rx: 0.024, ry: 0.024, w: 'm_armL1' },
      { p: v3(hand), rx: 0.033, ry: 0.03, w: 'm_armL1' },
      { p: mid(elbow, hand, 1.1), rx: 0.014, ry: 0.014, w: 'm_armL1' },
    ],
    { color: skin, ref: [0, 0, 1], segments: 7, sub: 2, detail: 0 },
  );
  b.both(list, arm);

  const tailRings: NamedRing[] = [
    { p: tor(0, 0.0, 0.07), rx: 0.09, ry: 0.07, w: 'm_seat' },
    { p: spec.seat, rx: 0.15, ry: 0.1, w: 'm_seat' },
    { p: spec.tail[0], rx: 0.14, ry: 0.1, w: { m_seat: 0.5, m_tail0: 0.5 } },
    { p: spec.tail[1], rx: 0.112, ry: 0.088, w: { m_tail0: 0.5, m_tail1: 0.5 } },
    { p: spec.tail[2], rx: 0.082, ry: 0.066, w: { m_tail1: 0.5, m_tail2: 0.5 } },
    { p: spec.tail[3], rx: 0.052, ry: 0.044, w: { m_tail2: 0.5, m_tail3: 0.5 } },
    { p: spec.tail[4], rx: 0.026, ry: 0.02, w: { m_tail3: 0.5, m_fluke: 0.5 } },
  ];
  list.push(
    b.loft(tailRings, {
      color: tailColor,
      segments: 12,
      sub: 3,
      detail: 1,
      paint: (color, angle, v) => {
        const under = Math.max(0, -Math.sin(angle));
        color.copy(tailColor).lerp(tailPale, under * 0.6);
        if (v > 0.82) color.lerp(flukeColor, (v - 0.82) / 0.18);
      },
    }),
  );
  const tip = new THREE.Vector3(...spec.tail[4]);
  const along = tip
    .clone()
    .sub(new THREE.Vector3(...spec.tail[3]))
    .normalize();
  const lateral = new THREE.Vector3(0, 1, 0).cross(along).normalize();
  const station = (forward: number, sideways: number): Vec3 =>
    v3(tip.clone().addScaledVector(along, forward).addScaledVector(lateral, sideways));
  for (const side of [-1, 1]) {
    list.push(
      foil(
        b,
        [
          { p: station(-0.04, 0), chord: 0.06, thick: 0.034 },
          { p: station(0.06, side * 0.09), chord: 0.16, thick: 0.02 },
          { p: station(0.17, side * 0.2), chord: 0.14, thick: 0.014 },
          { p: station(0.29, side * 0.29), chord: 0.075, thick: 0.009 },
          { p: station(0.37, side * 0.33), chord: 0.012, thick: 0.004 },
        ],
        {
          color: flukeColor,
          weights: 'm_fluke',
          detail: 0.15,
          segments: 8,
          sub: 2,
          paint: (color, angle, v) => {
            color.copy(tailColor).lerp(flukeColor, smooth(0, 0.35, v));
            color.lerp(white, 0.16 * v + 0.1 * Math.abs(Math.cos(angle)) * Math.sin(v * 40) ** 2);
          },
        },
      ),
    );
  }

  const seat = b.bone('m_seat');
  const torso = b.bone('m_torso');
  const head = b.bone('m_head');
  const hairBones = [b.bone('m_hair0'), b.bone('m_hair1'), b.bone('m_hair2')];
  const armR0 = b.bone('m_armR0');
  const armR1 = b.bone('m_armR1');
  const armL0 = b.bone('m_armL0');
  const tailBones = [0, 1, 2, 3].map((i) => b.bone(`m_tail${i}`));
  const fluke = b.bone('m_fluke');
  const restUpper = new THREE.Vector3(-(elbow.x - shoulder.x), elbow.y - shoulder.y, elbow.z - shoulder.z).normalize();
  const restFore = new THREE.Vector3(-(hand.x - elbow.x), hand.y - elbow.y, hand.z - elbow.z).normalize();
  const raise = new THREE.Quaternion().setFromUnitVectors(restUpper, new THREE.Vector3(-0.32, 1, -0.05).normalize());
  const straighten = new THREE.Quaternion().setFromUnitVectors(restFore, restUpper);
  const wave = new THREE.Quaternion();
  const seed = index * 1.7 + 0.4;
  const streamShare = [0.62, 0.3, 0.16];
  const floatShare = [0.26, 0.2, 0.22];
  let kick = seed;

  return (pose) => {
    const { time, speed, dt } = pose;
    const move = smooth(0.2, 6, speed);
    const fast = smooth(4, 14, speed);
    const stream = smooth(0.4, 9, speed) * (1 - pose.limp);
    const calm = 1 - move;
    seat.rotation.x = pose.wobble * 0.18 * Math.sin(time * 11 + seed);
    seat.rotation.z = pose.wobble * 0.22 * Math.sin(time * 13 + seed * 2);
    const leanIn =
      0.14 * fast -
      0.3 * pose.glory +
      0.42 * pose.limp +
      0.12 * pose.weary +
      Math.sin(pose.phase) * 0.03 * move +
      Math.sin(time * 1.1 + seed) * 0.025 * calm;
    torso.rotation.x = leanIn;
    torso.rotation.z = Math.sin(time * 0.7 + seed) * 0.03 * calm + pose.limp * 0.12;
    head.rotation.x = -leanIn * 0.7 + 0.75 * pose.limp + 0.12 * pose.weary - 0.1 * pose.glory;
    head.rotation.y = Math.sin(time * 0.43 + seed) * 0.4 * calm * (1 - pose.limp);
    head.rotation.z = pose.limp * 0.2;
    hairBones.forEach((bone, i) => {
      const ripple = Math.sin(time * (1.5 + 6 * stream) - i * 1.2 + seed);
      const base = streamShare[i] * stream + floatShare[i] * (1 - stream) * (1 - pose.limp * 0.7);
      bone.rotation.x =
        base + ripple * (0.12 + 0.02 * stream) * (0.6 + 0.4 * i) - (i === 0 ? leanIn * 0.3 + head.rotation.x : 0);
      bone.rotation.z = Math.sin(time * (1.1 + 3 * stream) - i * 0.9 + seed * 2) * (0.12 * (1 - stream) + 0.04);
    });
    const g = pose.glory;
    armR0.quaternion.slerpQuaternions(IDENTITY, raise, g);
    wave.setFromAxisAngle(FORWARD, Math.sin(time * 5 + seed) * 0.22 * g);
    armR0.quaternion.premultiply(wave);
    armR1.quaternion.slerpQuaternions(IDENTITY, straighten, g);
    armL0.rotation.x = pose.limp * 0.1;
    kick += dt * (1.6 + speed * 0.6) * (1 - 0.3 * pose.weary);
    const power = (0.1 + 0.15 * move) * (1 - pose.limp) * (1 - 0.3 * pose.weary) + pose.wobble * 0.1;
    tailBones.forEach((bone, i) => {
      bone.rotation.x = power * spec.tailAmp[i] * (Math.sin(kick - i * 0.95) + 0.4);
      bone.rotation.y = power * spec.tailAmp[i] * 0.3 * Math.sin(kick * 0.5 - i * 0.6);
    });
    fluke.rotation.x = power * 1.7 * Math.sin(kick - 4.2);
  };
}
