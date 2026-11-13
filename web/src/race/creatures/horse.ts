import * as THREE from 'three';
import { pixelTexture, tileFbm, triplanarDetail } from '../kit';
import { addJockey } from './jockey';
import { buildQuadruped, type BuildContext, type NamedRing, type QuadSpec } from './quadruped';
import { atlasCell, BLANK_UV, laneIndex, type AnimalRig } from './rig';

type Coat = {
  body: string;
  points: string;
  mane: string;
  muzzle: string;
  socks: [number, number, number, number];
  blaze: number;
  dapple: number;
};

const COATS: Coat[] = [
  { body: '#6e4023', points: '#17120f', mane: '#15110e', muzzle: '#2a1d16', socks: [1, 0, 0, 1], blaze: 1, dapple: 0 },
  { body: '#b9b6b0', points: '#6a686a', mane: '#dedbd4', muzzle: '#5b595c', socks: [0, 0, 0, 0], blaze: 0, dapple: 1 },
  { body: '#3a2418', points: '#120e0c', mane: '#120e0c', muzzle: '#1c1512', socks: [0, 0, 0, 0], blaze: 0, dapple: 0 },
  { body: '#c9a063', points: '#b98f55', mane: '#efe3c4', muzzle: '#8e7350', socks: [0, 1, 1, 0], blaze: 1, dapple: 0 },
  { body: '#9a5a2c', points: '#7c4722', mane: '#8c5127', muzzle: '#5f3a22', socks: [0, 0, 1, 1], blaze: 1, dapple: 0 },
  { body: '#1f1b19', points: '#0f0d0c', mane: '#0f0d0c', muzzle: '#151211', socks: [1, 1, 0, 0], blaze: 1, dapple: 0 },
  { body: '#b08d5e', points: '#1b1613', mane: '#1b1613', muzzle: '#2c241d', socks: [0, 0, 0, 0], blaze: 0, dapple: 0 },
  { body: '#5a3120', points: '#3d2317', mane: '#4a2a1b', muzzle: '#33211a', socks: [1, 1, 1, 1], blaze: 1, dapple: 0 },
  { body: '#7d8087', points: '#2b2c31', mane: '#2b2c31', muzzle: '#3a3b40', socks: [0, 0, 0, 0], blaze: 0, dapple: 1 },
  { body: '#84502b', points: '#1c1613', mane: '#1c1613', muzzle: '#2b1e17', socks: [0, 1, 0, 0], blaze: 0, dapple: 0 },
];

let coatDetail: THREE.Texture | null = null;
let dappleDetail: THREE.Texture | null = null;

function coatTexture(dapple: boolean): THREE.Texture {
  if (dapple && dappleDetail) return dappleDetail;
  if (!dapple && coatDetail) return coatDetail;
  const size = 256;
  const fine = tileFbm(size, 16, 4, 11);
  const broad = tileFbm(size, 3, 3, 23);
  const spots = tileFbm(size, 14, 2, 41);
  const texture = pixelTexture(size, (_, __, i) => {
    let value = 0.9 + fine[i] * 0.12 + broad[i] * 0.1;
    if (dapple) value *= 0.9 + 0.16 * Math.min(1, Math.max(0, (spots[i] - 0.38) * 5));
    return [value, value, value];
  });
  if (dapple) dappleDetail = texture;
  else coatDetail = texture;
  return texture;
}

const HOOF = new THREE.Color('#231d19');
const WHITE = new THREE.Color('#ece7df');

export function buildHorse(laneHex: string): AnimalRig {
  const lane = new THREE.Color(laneHex);
  const index = laneIndex(laneHex);
  const coat = COATS[index % COATS.length];
  const bodyColor = new THREE.Color(coat.body);
  const points = new THREE.Color(coat.points);
  const mane = new THREE.Color(coat.mane);
  const muzzle = new THREE.Color(coat.muzzle);
  const under = bodyColor.clone().multiplyScalar(0.8);

  const legPaint: QuadSpec['legPaint'] = (kind, side) => {
    const sock = coat.socks[(kind === 'fore' ? 0 : 2) + (side > 0 ? 0 : 1)];
    const knee = kind === 'fore' ? 0.56 : 0.64;
    return (out, _, __, position) => {
      const y = position.y;
      out.copy(bodyColor).lerp(points, Math.min(1, Math.max(0, (knee + 0.14 - y) / 0.22)));
      if (sock && y < 0.34) out.lerp(WHITE, Math.min(1, (0.34 - y) / 0.05));
      if (y < 0.085) out.copy(HOOF);
    };
  };

  const shade: NonNullable<Parameters<BuildContext['loft']>[1]>['paint'] = (out, angle) => {
    const s = Math.sin(angle);
    if (s < -0.2) out.lerp(under, Math.min(1, (-0.2 - s) * 1.6));
  };

  const build = (ctx: BuildContext) => {
    ctx.coat.push(
      ctx.loft(
        [
          { p: [0, 1.27, -0.82], rx: 0.04, ry: 0.04, w: 'pelvis' },
          { p: [0, 1.25, -0.76], rx: 0.19, ry: 0.19, down: 0.27, w: 'pelvis' },
          { p: [0, 1.26, -0.56], rx: 0.285, ry: 0.255, down: 0.35, w: 'pelvis' },
          { p: [0, 1.24, -0.25], rx: 0.275, ry: 0.235, down: 0.29, w: { pelvis: 0.6, chest: 0.4 } },
          { p: [0, 1.22, 0.1], rx: 0.295, ry: 0.25, down: 0.35, w: { pelvis: 0.25, chest: 0.75 } },
          { p: [0, 1.22, 0.4], rx: 0.28, ry: 0.3, down: 0.4, w: 'chest' },
          { p: [0, 1.24, 0.62], rx: 0.25, ry: 0.26, down: 0.36, w: 'chest' },
          { p: [0, 1.22, 0.78], rx: 0.17, ry: 0.18, down: 0.26, w: 'chest' },
          { p: [0, 1.2, 0.85], rx: 0.04, ry: 0.04, w: 'chest' },
        ],
        { color: bodyColor, segments: 16, sub: 4, paint: shade },
      ),
      ctx.loft(
        [
          { p: [0, 1.22, 0.5], rx: 0.2, ry: 0.25, down: 0.3, w: 'chest' },
          { p: [0, 1.36, 0.66], rx: 0.17, ry: 0.2, down: 0.25, w: { chest: 0.6, neck0: 0.4 } },
          { p: [0, 1.52, 0.8], rx: 0.13, ry: 0.165, down: 0.19, w: 'neck0' },
          { p: [0, 1.74, 0.99], rx: 0.1, ry: 0.13, down: 0.14, w: 'neck1' },
          { p: [0, 1.89, 1.13], rx: 0.09, ry: 0.11, down: 0.12, w: { neck1: 0.5, head: 0.5 } },
          { p: [0, 1.94, 1.19], rx: 0.07, ry: 0.08, w: 'head' },
        ],
        { color: bodyColor, segments: 12, sub: 4, capStart: false, paint: shade },
      ),
    );
    const blazeWidth = coat.blaze ? 0.5 : 0;
    ctx.coat.push(
      ctx.loft(
        [
          { p: [0, 1.93, 1.08], rx: 0.07, ry: 0.07, w: 'head' },
          { p: [0, 1.925, 1.19], rx: 0.105, ry: 0.105, down: 0.135, w: 'head' },
          { p: [0, 1.84, 1.33], rx: 0.097, ry: 0.088, down: 0.125, w: 'head' },
          { p: [0, 1.745, 1.47], rx: 0.066, ry: 0.064, down: 0.082, w: 'head' },
          { p: [0, 1.665, 1.585], rx: 0.062, ry: 0.06, down: 0.078, w: 'head', c: muzzle },
          { p: [0, 1.625, 1.64], rx: 0.045, ry: 0.04, down: 0.05, w: 'head', c: muzzle },
          { p: [0, 1.61, 1.655], rx: 0.015, ry: 0.015, w: 'head', c: muzzle },
        ],
        {
          color: bodyColor,
          segments: 14,
          sub: 4,
          paint: (out, angle, v) => {
            if (blazeWidth && v > 0.18 && v < 0.9 && Math.abs(angle - Math.PI / 2) < blazeWidth * (0.6 + v * 0.5)) {
              out.copy(WHITE);
            }
            if (v > 0.86 && v < 0.97 && Math.abs(Math.cos(angle)) > 0.75 && Math.sin(angle) > -0.2) out.set('#0c0908');
          },
        },
      ),
    );
    const ear = ctx.loft(
      [
        { p: [0.062, 1.98, 1.13], rx: 0.036, ry: 0.024, w: 'head' },
        { p: [0.072, 2.06, 1.115], rx: 0.03, ry: 0.016, w: 'head' },
        { p: [0.078, 2.135, 1.1], rx: 0.004, ry: 0.004, w: 'head', c: points },
      ],
      { color: bodyColor, ref: [0, 0, 1], segments: 6, sub: 2 },
    );
    ctx.both(ctx.coat, ear);
    ctx.coat.push(
      ctx.loft(
        [
          { p: [0, 1.52, 0.42], rx: 0.012, ry: 0.012, w: 'chest' },
          { p: [0, 1.6, 0.56], rx: 0.03, ry: 0.05, w: { chest: 0.5, neck0: 0.5 } },
          { p: [0, 1.74, 0.72], rx: 0.034, ry: 0.07, w: 'neck0' },
          { p: [0, 1.9, 0.88], rx: 0.034, ry: 0.072, w: 'neck1' },
          { p: [0, 2.01, 1.03], rx: 0.032, ry: 0.06, w: { neck1: 0.5, head: 0.5 } },
          { p: [0, 2.04, 1.14], rx: 0.03, ry: 0.035, w: 'head' },
          { p: [0, 1.99, 1.24], rx: 0.026, ry: 0.022, w: 'head' },
          { p: [0, 1.93, 1.3], rx: 0.006, ry: 0.006, w: 'head' },
        ],
        { color: mane, segments: 6, sub: 4, detail: 0.4 },
      ),
      ctx.loft(
        [
          { p: [0, 1.3, -0.78], rx: 0.03, ry: 0.03, w: 'pelvis' },
          { p: [0, 1.25, -0.87], rx: 0.05, ry: 0.045, w: 'tail0' },
          { p: [0, 1.1, -0.94], rx: 0.055, ry: 0.05, w: { tail0: 0.6, tail1: 0.4 } },
          { p: [0, 0.98, -0.97], rx: 0.03, ry: 0.03, w: 'tail1' },
        ],
        { color: mane, ref: [0, 0, 1], segments: 8, sub: 3, detail: 0.4 },
      ),
    );
    const strands: [number, number, number, number, number][] = [
      [0, 0, 1, 0.05, 0],
      [0.045, 0.01, 0.9, 0.04, 0.08],
      [-0.045, 0.012, 0.86, 0.04, -0.08],
      [0.02, -0.03, 0.78, 0.036, 0.12],
      [-0.022, -0.028, 0.95, 0.036, -0.1],
      [0, 0.035, 0.7, 0.034, 0.02],
    ];
    strands.forEach(([dx, dz, length, width, flare], i) => {
      const tone = mane.clone().multiplyScalar(0.8 + (i % 3) * 0.2);
      const bottom = 1.16 - 0.84 * length;
      ctx.coat.push(
        ctx.loft(
          [
            { p: [dx * 0.4, 1.2, -0.89 + dz], rx: width * 0.6, ry: width * 0.6, w: 'tail0' },
            { p: [dx, 1.02, -0.955 + dz], rx: width, ry: width * 0.9, w: { tail0: 0.5, tail1: 0.5 } },
            {
              p: [dx + flare * 0.5, (1.02 + bottom) / 2, -0.995 + dz],
              rx: width * 1.05,
              ry: width * 0.9,
              w: { tail1: 0.5, tail2: 0.5 },
            },
            { p: [dx + flare, bottom + 0.14, -1.005 + dz], rx: width * 0.7, ry: width * 0.6, w: 'tail2' },
            { p: [dx + flare * 1.2, bottom, -1.0 + dz], rx: 0.004, ry: 0.004, w: 'tail2' },
          ],
          { color: tone, ref: [0, 0, 1], segments: 5, sub: 3, detail: 0.4 },
        ),
      );
    });
    ctx.coat.push(
      ctx.loft(
        [
          { p: [0, 1.3, -0.79], rx: 0.02, ry: 0.02, w: 'pelvis' },
          { p: [0, 1.29, -0.81], rx: 0.01, ry: 0.01, w: 'pelvis' },
        ],
        { color: mane, ref: [0, 0, 1], segments: 4, sub: 1 },
      ),
    );

    const blank = { uvRect: BLANK_UV };
    const eye = ctx.loft(
      [
        { p: [0.078, 1.868, 1.285], rx: 0.004, ry: 0.004, w: 'head' },
        { p: [0.094, 1.868, 1.3], rx: 0.024, ry: 0.02, w: 'head' },
        { p: [0.094, 1.866, 1.325], rx: 0.004, ry: 0.004, w: 'head' },
      ],
      { color: '#0a0706', ...blank, segments: 8, sub: 2 },
    );
    ctx.both(ctx.gear, eye);
    const leather = '#2a1a12';
    const collar = (y: number, z: number, rx: number, ry: number, down: number, width: number, color: string) => {
      const dz = width * 0.83;
      const dy = -width * 0.56;
      const rings: NamedRing[] = [
        { p: [0, y - dy / 2, z - dz / 2], rx, ry, down, w: 'head' },
        { p: [0, y + dy / 2, z + dz / 2], rx: rx * 0.97, ry: ry * 0.97, down: down * 0.97, w: 'head' },
      ];
      return ctx.loft(rings, { color, ...blank, segments: 12, sub: 1, capStart: false, capEnd: false });
    };
    ctx.gear.push(collar(1.752, 1.46, 0.076, 0.075, 0.094, 0.035, '#f1eee6'));
    ctx.gear.push(collar(1.9, 1.24, 0.111, 0.108, 0.137, 0.022, laneHex));
    const strap = (path: [number, number, number][], bonesAt: (string | Record<string, number>)[], radius: number) =>
      ctx.loft(
        path.map((p, i) => ({ p, rx: radius, ry: radius, w: bonesAt[i] })),
        { color: leather, ...blank, segments: 5, sub: 3, ref: [1, 0, 0] },
      );
    ctx.both(
      ctx.gear,
      strap(
        [
          [0.068, 1.7, 1.53],
          [0.1, 1.82, 1.36],
          [0.108, 1.95, 1.2],
          [0.07, 2.03, 1.15],
        ],
        ['head', 'head', 'head', 'head'],
        0.008,
      ),
    );
    ctx.both(
      ctx.gear,
      strap(
        [
          [0.07, 1.69, 1.53],
          [0.12, 1.7, 1.25],
          [0.13, 1.68, 1.02],
          [0.1, 1.66, 0.88],
        ],
        ['head', { head: 0.5, neck1: 0.5 }, { neck1: 0.5, neck0: 0.5 }, 'neck0'],
        0.007,
      ),
    );

    const cell = atlasCell(index);
    ctx.gear.push(
      ctx.loft(
        [
          { p: [0, 1.24, -0.3], rx: 0.288, ry: 0.248, down: 0.3, w: { pelvis: 0.6, chest: 0.4 } },
          { p: [0, 1.232, -0.1], rx: 0.297, ry: 0.256, down: 0.325, w: { pelvis: 0.45, chest: 0.55 } },
          { p: [0, 1.22, 0.1], rx: 0.308, ry: 0.264, down: 0.36, w: { pelvis: 0.25, chest: 0.75 } },
          { p: [0, 1.22, 0.3], rx: 0.3, ry: 0.296, down: 0.385, w: 'chest' },
        ],
        { color: '#ffffff', uvRect: cell, segments: 16, sub: 3, arc: [-0.5, Math.PI + 0.5] },
      ),
      ctx.loft(
        [
          { p: [0, 1.5, 0.02], rx: 0.04, ry: 0.02, w: 'chest' },
          { p: [0, 1.5, 0.1], rx: 0.15, ry: 0.045, w: 'chest' },
          { p: [0, 1.52, 0.24], rx: 0.13, ry: 0.04, w: 'chest' },
          { p: [0, 1.55, 0.38], rx: 0.09, ry: 0.035, w: 'chest' },
          { p: [0, 1.56, 0.43], rx: 0.02, ry: 0.015, w: 'chest' },
        ],
        { color: '#3a2417', ...blank, segments: 8, sub: 2 },
      ),
      ctx.loft(
        [
          { p: [0, 1.22, 0.33], rx: 0.287, ry: 0.305, down: 0.4, w: 'chest' },
          { p: [0, 1.22, 0.39], rx: 0.287, ry: 0.305, down: 0.405, w: 'chest' },
        ],
        { color: '#2a1a12', ...blank, segments: 16, sub: 1, capStart: false, capEnd: false },
      ),
    );
    addJockey(ctx, {
      seat: [1.68, 0.14],
      scale: 1,
      footX: 0.34,
      footDrop: 0.4,
      hands: [0.11, 1.66, 0.84],
      handBone: 'neck0',
      footBone: 'chest',
      laneIndex: index,
    });
  };

  const coatMaterial = () => {
    const material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.5,
      metalness: 0,
      sheen: 0.6,
      sheenRoughness: 0.4,
      sheenColor: bodyColor.clone().lerp(new THREE.Color('#ffffff'), 0.5),
    });
    triplanarDetail(material, { map: coatTexture(coat.dapple > 0), scale: 2.2 });
    return material;
  };

  return buildQuadruped({
    joints: {
      body: [0, 1.25, 0],
      chest: [0, 1.25, 0.3],
      pelvis: [0, 1.25, -0.3],
      neck: [
        [0, 1.32, 0.6],
        [0, 1.63, 0.9],
      ],
      head: [0, 1.91, 1.15],
      tail: [
        [0, 1.29, -0.8],
        [0, 1.05, -0.96],
        [0, 0.78, -1.0],
      ],
    },
    fore: {
      x: 0.17,
      pivot: [1.38, 0.5],
      joints: [
        [0.92, 0.52],
        [0.52, 0.53],
        [0.21, 0.52],
      ],
      hoof: [0, 0.6],
      rings: [
        [1.3, 0.58, 0.085, 0.16, -1],
        [1.1, 0.56, 0.09, 0.15, 0],
        [0.94, 0.53, 0.074, 0.11, 0.5],
        [0.78, 0.525, 0.06, 0.078, 1],
        [0.6, 0.53, 0.046, 0.054, 1],
        [0.52, 0.535, 0.05, 0.058, 1.5],
        [0.45, 0.53, 0.036, 0.044, 2],
        [0.3, 0.522, 0.032, 0.04, 2],
        [0.21, 0.52, 0.042, 0.05, 2.5],
        [0.12, 0.555, 0.036, 0.04, 3],
        [0.08, 0.578, 0.05, 0.056, 3],
        [0.0, 0.6, 0.058, 0.066, 3],
      ],
      bend: -1,
      flexSign: -1,
      attach: 'chest',
      bodyBlend: 0.6,
      centreShift: -0.12,
      lift: [0.1, 0.4],
      flex: [0.7, 1.85],
    },
    hind: {
      x: 0.165,
      pivot: [1.28, -0.58],
      joints: [
        [0.92, -0.46],
        [0.58, -0.76],
        [0.21, -0.73],
      ],
      hoof: [0, -0.65],
      rings: [
        [1.3, -0.58, 0.1, 0.2, -1],
        [1.1, -0.53, 0.105, 0.2, 0],
        [0.93, -0.47, 0.08, 0.135, 0.5],
        [0.76, -0.6, 0.058, 0.08, 1],
        [0.63, -0.72, 0.044, 0.06, 1],
        [0.58, -0.762, 0.046, 0.062, 1.5],
        [0.5, -0.752, 0.036, 0.046, 2],
        [0.32, -0.738, 0.033, 0.041, 2],
        [0.21, -0.73, 0.043, 0.051, 2.5],
        [0.12, -0.695, 0.036, 0.04, 3],
        [0.08, -0.672, 0.05, 0.056, 3],
        [0.0, -0.65, 0.058, 0.066, 3],
      ],
      bend: 1,
      flexSign: 1,
      attach: 'pelvis',
      bodyBlend: 0.6,
      centreShift: 0.2,
      lift: [0.08, 0.3],
      flex: [0.4, 0.95],
    },
    legPaint,
    build,
    coatMaterial,
    gait: {
      stride: 6.4,
      walkStride: 1.8,
      topSpeed: 15,
      trotSpeed: 3.5,
      gallopSpeed: 8,
      duty: 0.22,
      maxReach: 1.3,
      phases: { walk: [0.25, 0.75, 0, 0.5], gallop: [0.4, 0.52, 0, 0.12] },
      bob: 0.045,
      crouch: 0.09,
      pitch: 0.05,
      spine: 0.09,
      neckNod: 0.08,
      neckLower: 0.2,
      tailStream: 1.05,
    },
    height: 2.05,
    trailLength: 2.4,
    lane,
    seed: index * 37 + 11,
  });
}
