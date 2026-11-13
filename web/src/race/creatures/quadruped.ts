import * as THREE from 'three';
import type { EntrantState } from '../../lib/types';
import {
  loft,
  mergeGroups,
  mirrorX,
  rotate2,
  Skeleton,
  solveLimb,
  type LoftOptions,
  type Ring,
  type Vec3,
  type Weights,
} from '../kit';
import { addEffects, frac, gearAtlas, mix, smooth, stateTint, type AnimalRig } from './rig';

export type NamedWeights = string | Record<string, number>;
export type NamedRing = Omit<Ring, 'w'> & { w?: NamedWeights };
export type NamedLoftOptions = Omit<LoftOptions, 'weights'> & { weights?: NamedWeights };

export type LegSpec = {
  x: number;
  pivot: [number, number];
  joints: [[number, number], [number, number], [number, number]];
  hoof: [number, number];
  rings: [number, number, number, number, number][];
  bend: number;
  flexSign: number;
  attach: 'chest' | 'pelvis';
  bodyBlend: number;
  centreShift: number;
  lift: [number, number];
  flex: [number, number];
  splay?: number;
};

export type GaitSpec = {
  stride: number;
  walkStride: number;
  topSpeed: number;
  trotSpeed: number;
  gallopSpeed: number;
  duty: number;
  maxReach: number;
  phases: { walk: [number, number, number, number]; gallop: [number, number, number, number] };
  bob: number;
  crouch: number;
  pitch: number;
  spine: number;
  neckNod: number;
  neckLower: number;
  tailStream: number;
};

export type BuildContext = {
  coat: THREE.BufferGeometry[];
  gear: THREE.BufferGeometry[];
  loft: (rings: NamedRing[], options?: NamedLoftOptions) => THREE.BufferGeometry;
  mirror: (geometry: THREE.BufferGeometry) => THREE.BufferGeometry;
  both: (list: THREE.BufferGeometry[], geometry: THREE.BufferGeometry) => void;
  bone: (name: string) => number;
  addBone: (name: string, parent: string, position: Vec3) => number;
};

export type QuadSpec = {
  joints: { body: Vec3; chest: Vec3; pelvis: Vec3; neck: Vec3[]; head: Vec3; tail: Vec3[] };
  fore: LegSpec;
  hind: LegSpec;
  legPaint: (kind: 'fore' | 'hind', side: number) => LoftOptions['paint'];
  legDetail?: (y: number) => number;
  build: (ctx: BuildContext) => void;
  coatMaterial: () => THREE.MeshStandardMaterial;
  gait: GaitSpec;
  height: number;
  trailLength: number;
  lane: THREE.Color;
  seed: number;
};

type LegRig = {
  spec: LegSpec;
  bones: THREE.Bone[];
  attach: 'chest' | 'pelvis';
  upper: number;
  middle: number;
  lower: number;
  restUpper: number;
  restMiddle: number;
  restLower: number;
  restFlex: number;
  pastern: [number, number];
  fore: boolean;
  index: number;
};

const SEGMENT_WEIGHTS: Record<string, (attach: string, prefix: string, blend: number) => Record<string, number>> = {
  '-1': (attach, prefix, blend) => ({ [attach]: blend, [`${prefix}0`]: 1 - blend }),
  '0': (_, prefix) => ({ [`${prefix}0`]: 1 }),
  '0.5': (_, prefix) => ({ [`${prefix}0`]: 0.5, [`${prefix}1`]: 0.5 }),
  '1': (_, prefix) => ({ [`${prefix}1`]: 1 }),
  '1.5': (_, prefix) => ({ [`${prefix}1`]: 0.5, [`${prefix}2`]: 0.5 }),
  '2': (_, prefix) => ({ [`${prefix}2`]: 1 }),
  '2.5': (_, prefix) => ({ [`${prefix}2`]: 0.5, [`${prefix}3`]: 0.5 }),
  '3': (_, prefix) => ({ [`${prefix}3`]: 1 }),
};

const angleOf = (from: [number, number], to: [number, number]) => Math.atan2(to[1] - from[1], to[0] - from[0]);
const distance = (from: [number, number], to: [number, number]) => Math.hypot(to[0] - from[0], to[1] - from[1]);

export function buildQuadruped(spec: QuadSpec): AnimalRig {
  const skeleton = new Skeleton();
  const names = new Map<string, number>();
  const bone = (name: string) => {
    const index = names.get(name);
    if (index === undefined) throw new Error(`Unknown bone ${name}`);
    return index;
  };
  const addBone = (name: string, parent: string, position: Vec3) => {
    const index = skeleton.add(parent ? bone(parent) : -1, position);
    names.set(name, index);
    return index;
  };
  const j = spec.joints;
  addBone('body', '', j.body);
  addBone('chest', 'body', j.chest);
  addBone('pelvis', 'body', j.pelvis);
  j.neck.forEach((position, i) => addBone(`neck${i}`, i ? `neck${i - 1}` : 'chest', position));
  addBone('head', `neck${j.neck.length - 1}`, j.head);
  j.tail.forEach((position, i) => addBone(`tail${i}`, i ? `tail${i - 1}` : 'pelvis', position));
  const legNames: [string, LegSpec, number, boolean][] = [
    ['FL', spec.fore, 1, true],
    ['FR', spec.fore, -1, true],
    ['HL', spec.hind, 1, false],
    ['HR', spec.hind, -1, false],
  ];
  for (const [prefix, leg, side] of legNames) {
    const x = leg.x * side;
    addBone(`${prefix}0`, leg.attach, [x, leg.pivot[0], leg.pivot[1]]);
    leg.joints.forEach((joint, i) => addBone(`${prefix}${i + 1}`, `${prefix}${i}`, [x, joint[0], joint[1]]));
  }

  const resolve = (weights: NamedWeights | undefined): Weights | undefined => {
    if (weights === undefined) return undefined;
    if (typeof weights === 'string') return bone(weights);
    const out: Record<number, number> = {};
    for (const key of Object.keys(weights)) out[bone(key)] = weights[key];
    return out;
  };
  const namedLoft = (rings: NamedRing[], options: NamedLoftOptions = {}) =>
    loft(
      rings.map((ring) => ({ ...ring, w: resolve(ring.w) })),
      { ...options, weights: resolve(options.weights) },
    );
  const swap = new Map<number, number>();
  for (let i = 0; i < 4; i += 1) {
    for (const [left, right] of [
      ['FL', 'FR'],
      ['HL', 'HR'],
    ]) {
      swap.set(bone(`${left}${i}`), bone(`${right}${i}`));
      swap.set(bone(`${right}${i}`), bone(`${left}${i}`));
    }
  }
  const mirror = (geometry: THREE.BufferGeometry) => mirrorX(geometry, (index) => swap.get(index) ?? index);
  const coat: THREE.BufferGeometry[] = [];
  const gear: THREE.BufferGeometry[] = [];
  const ctx: BuildContext = {
    coat,
    gear,
    loft: namedLoft,
    mirror,
    both: (list, geometry) => list.push(geometry, mirror(geometry)),
    bone,
    addBone,
  };

  for (const [kind, leg] of [
    ['fore', spec.fore],
    ['hind', spec.hind],
  ] as const) {
    const prefix = kind === 'fore' ? 'F' : 'H';
    for (const side of [1, -1]) {
      const name = `${prefix}${side > 0 ? 'L' : 'R'}`;
      const rings: NamedRing[] = leg.rings.map(([y, z, rx, ry, segment]) => ({
        p: [leg.x * side + (leg.splay ?? 0) * side * Math.max(0, 1 - y / leg.pivot[0]), y, z],
        rx,
        ry,
        w: SEGMENT_WEIGHTS[String(segment)](leg.attach, name, leg.bodyBlend),
        detail: spec.legDetail?.(y),
      }));
      coat.push(namedLoft(rings, { ref: [0, 0, 1], segments: 10, sub: 3, paint: spec.legPaint(kind, side) }));
    }
  }
  spec.build(ctx);

  const coatMaterial = spec.coatMaterial();
  const gearMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: gearAtlas(),
    roughness: 0.62,
    side: THREE.DoubleSide,
  });
  const geometry = mergeGroups([coat, gear]);
  const mesh = skeleton.skin(geometry, [coatMaterial, gearMaterial]);
  const root = new THREE.Group();
  root.add(mesh);

  const bones = (name: string) => skeleton.bones[bone(name)];
  const body = bones('body');
  const chest = bones('chest');
  const pelvis = bones('pelvis');
  const neck = j.neck.map((_, i) => bones(`neck${i}`));
  const head = bones('head');
  const tail = j.tail.map((_, i) => bones(`tail${i}`));
  const seat = names.has('seat') ? bones('seat') : null;
  const riderTorso = names.has('torso') ? bones('torso') : null;
  const helm = names.has('helm') ? bones('helm') : null;
  const seatRest = seat ? seat.position.clone() : new THREE.Vector3();
  const bodyRestY = body.position.y;
  const restBody: [number, number] = [j.body[2], j.body[1]];
  const restAttach = {
    chest: [j.chest[2], j.chest[1]] as [number, number],
    pelvis: [j.pelvis[2], j.pelvis[1]] as [number, number],
  };

  const legs: LegRig[] = legNames.map(([prefix, leg, , fore], index) => {
    const pivot: [number, number] = [leg.pivot[1], leg.pivot[0]];
    const j1: [number, number] = [leg.joints[0][1], leg.joints[0][0]];
    const j2: [number, number] = [leg.joints[1][1], leg.joints[1][0]];
    const j3: [number, number] = [leg.joints[2][1], leg.joints[2][0]];
    const restUpper = angleOf(pivot, j1);
    const restMiddle = angleOf(j1, j2);
    const restLower = angleOf(j2, j3);
    return {
      spec: leg,
      bones: [0, 1, 2, 3].map((i) => bones(`${prefix}${i}`)),
      attach: leg.attach,
      upper: distance(pivot, j1),
      middle: distance(j1, j2),
      lower: distance(j2, j3),
      restUpper,
      restMiddle,
      restLower,
      restFlex: restLower - restMiddle,
      pastern: [leg.hoof[1] - j3[0], leg.hoof[0] - j3[1]],
      fore,
      index,
    };
  });

  const effects = addEffects(root, body, spec.lane, spec.trailLength);
  const tint = stateTint([coatMaterial, gearMaterial]);
  const gait = spec.gait;
  const solution = { upper: 0, middle: 0, lower: 0 };
  let cycle = (spec.seed % 97) / 97;
  let wobble = 0;
  let weary = 0;
  let pace = 0;
  let glory = 0;
  const seedPhase = (spec.seed % 628) / 100;

  const update = (state: EntrantState, speed: number, dt: number, time: number) => {
    const target = state === 'DNF' ? 0 : speed;
    pace += (target - pace) * Math.min(1, dt * 8);
    const v = pace;
    wobble += ((state === 'STUMBLED' ? 1 : 0) - wobble) * Math.min(1, dt * (state === 'STUMBLED' ? 6 : 2.5));
    weary += ((state === 'TIRED' ? 1 : state === 'DNF' ? 1.4 : 0) - weary) * Math.min(1, dt * 2);
    glory += ((state === 'FINISHED' ? 1 : 0) - glory) * Math.min(1, dt * 1.5);
    const g = smooth(gait.trotSpeed, gait.gallopSpeed, v);
    const move = smooth(0.05, 1.2, v);
    const stride = mix(gait.walkStride, gait.stride, smooth(1, gait.topSpeed, v)) * (1 - 0.1 * weary * g);
    cycle = frac(cycle + (dt * v) / stride);
    const duty = mix(0.62, gait.duty, g);
    const reach = Math.min(duty * stride, gait.maxReach) * move;
    const tau = Math.PI * 2;
    const idle = 1 - move;

    const bob =
      -gait.crouch * g -
      gait.bob * g * Math.cos(tau * (cycle - 0.55)) +
      0.012 * (1 - g) * move * Math.cos(tau * cycle * 2) +
      Math.sin(time * 1.7 + seedPhase) * 0.006 * idle -
      0.04 * weary * idle;
    const pitch = gait.pitch * g * Math.sin(tau * (cycle - 0.3)) + 0.14 * wobble + 0.02 * weary;
    const roll = Math.sin(time * 17) * 0.1 * wobble + Math.sin(tau * cycle) * 0.02 * (1 - g) * move;
    const spineFlex = gait.spine * g;
    const chestRot = spineFlex * 0.5 * Math.cos(tau * (cycle - 0.42));
    const pelvisRot = -spineFlex * Math.cos(tau * (cycle - 0.92));
    body.position.y = bodyRestY + bob;
    body.rotation.set(pitch, Math.sin(tau * cycle) * 0.015 * g, roll);
    chest.rotation.x = chestRot;
    pelvis.rotation.x = pelvisRot;
    const bodyZ = restBody[0];
    const bodyY = restBody[1] + bob;

    for (const leg of legs) {
      const s = leg.spec;
      const attachPhi = pitch + (leg.attach === 'chest' ? chestRot : pelvisRot);
      const attachRest = restAttach[leg.attach];
      const [az, ay] = rotate2(attachRest[0] - restBody[0], attachRest[1] - restBody[1], -pitch);
      const [pz, py] = rotate2(s.pivot[1] - attachRest[0], s.pivot[0] - attachRest[1], -attachPhi);
      const rootZ = bodyZ + az + pz;
      const rootY = bodyY + ay + py;
      const phase = frac(cycle + mix(gait.phases.walk[leg.index], gait.phases.gallop[leg.index], g));
      let offset: number;
      let lift = 0;
      let flex = 0;
      let pastern: number;
      if (phase < duty) {
        const u = phase / duty;
        offset = reach * (0.5 - u);
        const load = Math.sin(Math.PI * u);
        pastern = 0.16 * load * g + 0.05 * load;
        flex = (leg.fore ? 0 : 0.1) * load * g;
      } else {
        const q = (phase - duty) / (1 - duty);
        const ease = q * q * (3 - 2 * q);
        offset = reach * (ease - 0.5);
        const arc = Math.sin(Math.PI * Math.min(1, q * 1.08) ** 0.9);
        lift = mix(s.lift[0], s.lift[1], g) * arc * move;
        flex = mix(s.flex[0], s.flex[1], g) * Math.sin(Math.PI * q ** 0.8) * move;
        pastern = -mix(0.5, 1.15, g) * Math.sin(Math.PI * Math.min(1, q * 1.25)) * move;
      }
      const stumble = wobble * Math.sin(time * 23 + leg.index * 1.9) * 0.12;
      const hoofZ = s.hoof[1] + s.centreShift * g * move + offset + stumble;
      const hoofY = lift;
      const [qz, qy] = rotate2(leg.pastern[0], leg.pastern[1], pastern);
      solveLimb(
        rootZ,
        rootY,
        hoofZ - qz,
        hoofY - qy,
        leg.upper,
        leg.middle,
        leg.lower,
        leg.restFlex + flex * s.flexSign,
        s.bend,
        solution,
      );
      const upperPhi = -(solution.upper - leg.restUpper);
      const middlePhi = -(solution.middle - leg.restMiddle);
      const lowerPhi = -(solution.lower - leg.restLower);
      leg.bones[0].rotation.x = upperPhi - attachPhi;
      leg.bones[1].rotation.x = middlePhi - upperPhi;
      leg.bones[2].rotation.x = lowerPhi - middlePhi;
      leg.bones[3].rotation.x = -pastern - lowerPhi;
    }

    const nod = gait.neckNod * g * Math.sin(tau * (cycle - 0.38));
    const lower = gait.neckLower * g + 0.3 * weary + 0.25 * wobble - 0.12 * glory;
    const look = Math.sin(time * 0.31 + seedPhase) * 0.22 * idle;
    const graze = Math.max(0, Math.sin(time * 0.17 + seedPhase * 2)) * 0.1 * idle;
    neck.forEach((item, i) => {
      const share = 1 / neck.length;
      item.rotation.x = (lower + nod + graze) * share * (i === 0 ? 1.3 : 0.85) - chestRot * (i === 0 ? 1 : 0);
      item.rotation.y = look * share;
    });
    head.rotation.x = -(lower + nod) * 0.45 + Math.sin(time * 0.9 + seedPhase) * 0.04 * idle;
    head.rotation.y = look * 0.6;

    const stream = smooth(1.5, 11, v) * gait.tailStream;
    tail.forEach((item, i) => {
      const wave = Math.sin(time * (2.2 + g * 7) - i * 1.1 + seedPhase);
      if (i === 0) {
        item.rotation.x = stream + wave * 0.05 * g - pelvisRot;
        item.rotation.z = wave * (0.1 + 0.22 * idle);
      } else {
        item.rotation.x = -stream * 0.22 + wave * 0.1 * g;
        item.rotation.z = wave * (0.08 + 0.12 * idle);
      }
    });

    if (seat && riderTorso) {
      const upright = (1 - g) * 0.62 + glory * 0.5 * g;
      seat.position.y = seatRest.y - bob * 0.55 - (1 - g) * 0.06;
      seat.rotation.x = -pitch * 0.8 + wobble * 0.2;
      riderTorso.rotation.x = -upright + Math.sin(tau * (cycle - 0.2)) * 0.05 * g + 0.12 * weary * g;
      if (helm) helm.rotation.x = upright * 0.75 - 0.1 * weary;
    }

    tint(state, dt);
    effects.update(state, dt, time);
  };

  return { root, height: spec.height, update };
}
