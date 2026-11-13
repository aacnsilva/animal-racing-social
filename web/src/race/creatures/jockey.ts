import * as THREE from 'three';
import { LANE_COLORS, LANE_TEXT } from '../../lib/track';
import type { Vec3 } from '../kit';
import type { BuildContext, NamedLoftOptions, NamedRing } from './quadruped';
import { BLANK_UV } from './rig';

export type JockeySpec = {
  seat: [number, number];
  scale: number;
  footX: number;
  footDrop: number;
  hands: Vec3;
  handBone: string;
  footBone: string;
  laneIndex: number;
};

const SKIN = ['#e7c19b', '#c68a5e', '#8d5a3b', '#f1d2b6', '#a56e45'];

export function addJockey(ctx: BuildContext, spec: JockeySpec): void {
  const [sy, sz] = spec.seat;
  const k = spec.scale;
  const at = (x: number, y: number, z: number): Vec3 => [x * k, sy + y * k, sz + z * k];
  const lane = new THREE.Color(LANE_COLORS[spec.laneIndex]);
  const contrast = new THREE.Color(LANE_TEXT[spec.laneIndex] === '#111' ? '#1a1a1a' : '#f6f4ee');
  const pattern = spec.laneIndex % 3;
  const skin = SKIN[spec.laneIndex % SKIN.length];
  const breeches = '#f1efe8';
  const boot = '#15120f';
  ctx.addBone('seat', 'body', at(0, 0.02, 0));
  ctx.addBone('torso', 'seat', at(0, 0.06, 0.02));
  ctx.addBone('helm', 'torso', at(0, 0.22, 0.5));
  const gear = ctx.gear;
  const part = (rings: NamedRing[], color: THREE.ColorRepresentation, extra: NamedLoftOptions = {}) =>
    ctx.loft(rings, { color, uvRect: BLANK_UV, segments: 8, sub: 2, ...extra });

  gear.push(
    part(
      [
        { p: at(0, 0.02, -0.14), rx: 0.05 * k, ry: 0.05 * k, w: 'seat' },
        { p: at(0, 0.04, -0.06), rx: 0.15 * k, ry: 0.11 * k, w: 'seat' },
        { p: at(0, 0.1, 0.12), rx: 0.16 * k, ry: 0.1 * k, w: { seat: 0.5, torso: 0.5 }, c: breeches },
        { p: at(0, 0.15, 0.2), rx: 0.165 * k, ry: 0.1 * k, w: 'torso', c: lane },
      ],
      breeches,
      { capEnd: false },
    ),
    part(
      [
        { p: at(0, 0.14, 0.18), rx: 0.165 * k, ry: 0.1 * k, w: 'torso' },
        { p: at(0, 0.19, 0.32), rx: 0.175 * k, ry: 0.105 * k, w: 'torso' },
        { p: at(0, 0.21, 0.44), rx: 0.17 * k, ry: 0.095 * k, w: 'torso' },
        { p: at(0, 0.215, 0.5), rx: 0.1 * k, ry: 0.07 * k, w: 'torso' },
        { p: at(0, 0.235, 0.54), rx: 0.05 * k, ry: 0.05 * k, w: { torso: 0.5, helm: 0.5 }, c: skin },
      ],
      lane,
      {
        paint: (out, _, v) => {
          if (pattern === 1 && v > 0.3 && v < 0.55) out.copy(contrast);
          if (pattern === 2 && Math.floor(v * 7) % 2 === 1) out.lerp(contrast, 0.9);
        },
      },
    ),
  );
  const headCentre = at(0, 0.3, 0.62);
  const head = (radius: number, yShift: number, color: THREE.ColorRepresentation, arc?: [number, number]) => {
    const rings: NamedRing[] = [];
    for (let i = 0; i <= 6; i += 1) {
      const a = (i / 6) * Math.PI;
      const s = Math.max(0.03, Math.sin(a));
      rings.push({
        p: [0, headCentre[1] + yShift * k, headCentre[2] - Math.cos(a) * radius * k],
        rx: radius * k * s,
        ry: radius * k * s,
        w: 'helm',
      });
    }
    return ctx.loft(rings, { color, uvRect: BLANK_UV, segments: 10, sub: 1, arc });
  };
  gear.push(head(0.088, 0, skin));
  gear.push(head(0.108, 0.012, lane, [-0.25, Math.PI + 0.25]));
  gear.push(
    part(
      [
        { p: at(0, 0.3, 0.7), rx: 0.085 * k, ry: 0.012 * k, w: 'helm' },
        { p: at(0, 0.285, 0.79), rx: 0.06 * k, ry: 0.008 * k, w: 'helm' },
      ],
      contrast,
      { sub: 1 },
    ),
    part(
      [
        { p: at(0, 0.296, 0.655), rx: 0.092 * k, ry: 0.03 * k, w: 'helm' },
        { p: at(0, 0.29, 0.705), rx: 0.08 * k, ry: 0.028 * k, w: 'helm' },
      ],
      '#1c2530',
      { sub: 1, arc: [0, Math.PI] },
    ),
  );

  const hand: Vec3 = [spec.hands[0], spec.hands[1], spec.hands[2]];
  const sleeve = pattern === 0 ? contrast : lane;
  const arm = part(
    [
      { p: at(0.165, 0.2, 0.44), rx: 0.055 * k, ry: 0.055 * k, w: 'torso' },
      { p: at(0.21, 0.08, 0.5), rx: 0.047 * k, ry: 0.047 * k, w: 'torso' },
      {
        p: [hand[0] + 0.05 * k, hand[1] + 0.03 * k, hand[2] - 0.16 * k],
        rx: 0.04 * k,
        ry: 0.04 * k,
        w: { torso: 0.5, [spec.handBone]: 0.5 },
      },
      { p: [hand[0], hand[1], hand[2] - 0.04 * k], rx: 0.034 * k, ry: 0.034 * k, w: spec.handBone, c: '#f6f4ee' },
      { p: hand, rx: 0.04 * k, ry: 0.036 * k, w: spec.handBone, c: '#f6f4ee' },
      {
        p: [hand[0], hand[1] - 0.01 * k, hand[2] + 0.05 * k],
        rx: 0.02 * k,
        ry: 0.02 * k,
        w: spec.handBone,
        c: '#f6f4ee',
      },
    ],
    sleeve,
    { ref: [1, 0, 0] },
  );
  ctx.both(gear, arm);

  const footY = sy - spec.footDrop;
  const leg = part(
    [
      { p: at(0.1, 0.04, -0.04), rx: 0.085 * k, ry: 0.08 * k, w: 'seat' },
      { p: at(0.17, -0.02, 0.14), rx: 0.075 * k, ry: 0.07 * k, w: 'seat' },
      {
        p: [spec.footX - 0.05, sy - 0.1 * k, sz + 0.3 * k],
        rx: 0.062 * k,
        ry: 0.058 * k,
        w: { seat: 0.5, [spec.footBone]: 0.5 },
      },
      {
        p: [spec.footX - 0.02, (sy - 0.1 * k + footY) / 2 - 0.02, sz + 0.2 * k],
        rx: 0.05 * k,
        ry: 0.05 * k,
        w: spec.footBone,
        c: boot,
      },
      { p: [spec.footX, footY + 0.03, sz + 0.1 * k], rx: 0.04 * k, ry: 0.042 * k, w: spec.footBone, c: boot },
    ],
    breeches,
    { ref: [1, 0, 0], sub: 3 },
  );
  ctx.both(gear, leg);
  const foot = part(
    [
      { p: [spec.footX, footY + 0.02, sz + 0.04 * k], rx: 0.036 * k, ry: 0.04 * k, w: spec.footBone },
      { p: [spec.footX, footY, sz + 0.14 * k], rx: 0.04 * k, ry: 0.035 * k, w: spec.footBone },
      { p: [spec.footX, footY - 0.005, sz + 0.25 * k], rx: 0.036 * k, ry: 0.024 * k, w: spec.footBone },
    ],
    boot,
    { sub: 2 },
  );
  ctx.both(gear, foot);
  const stirrup = part(
    [
      { p: [spec.footX - 0.03, footY + 0.36, sz + 0.14 * k], rx: 0.012, ry: 0.012, w: spec.footBone },
      { p: [spec.footX + 0.045, footY + 0.1, sz + 0.17 * k], rx: 0.012, ry: 0.012, w: spec.footBone },
      { p: [spec.footX + 0.05, footY - 0.03, sz + 0.17 * k], rx: 0.012, ry: 0.03, w: spec.footBone },
      { p: [spec.footX - 0.04, footY - 0.03, sz + 0.17 * k], rx: 0.012, ry: 0.03, w: spec.footBone },
    ],
    '#c9ccd1',
    { ref: [0, 0, 1], segments: 5, sub: 2 },
  );
  ctx.both(gear, stirrup);
}
