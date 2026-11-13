import * as THREE from 'three';
import { pixelTexture, tileFbm, triplanarDetail } from '../kit';
import { addJockey } from './jockey';
import { buildQuadruped, type BuildContext, type QuadSpec } from './quadruped';
import { atlasCell, BLANK_UV, laneIndex, type AnimalRig } from './rig';

type Pattern = { cream: string; patch: [number, number, number]; line: number; cells: number; jag: number };

const PATTERNS: Pattern[] = [
  { cream: '#ecd9ad', patch: [0.5, 0.27, 0.12], line: 0.07, cells: 6, jag: 0.25 },
  { cream: '#e6cc98', patch: [0.36, 0.19, 0.09], line: 0.13, cells: 7, jag: 0.9 },
  { cream: '#f0dfbb', patch: [0.6, 0.36, 0.16], line: 0.1, cells: 5, jag: 0.5 },
];

const textures = new Map<number, THREE.Texture>();

function patchTexture(index: number): THREE.Texture {
  const cached = textures.get(index);
  if (cached) return cached;
  const pattern = PATTERNS[index];
  const size = 512;
  const cells = pattern.cells;
  const points: { x: number; y: number; tone: number }[] = [];
  let seed = 77 + index * 131;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let cy = 0; cy < cells; cy += 1) {
    for (let cx = 0; cx < cells; cx += 1) {
      points.push({
        x: (cx + 0.15 + random() * 0.7) / cells,
        y: (cy + 0.15 + random() * 0.7) / cells,
        tone: 0.82 + random() * 0.36,
      });
    }
  }
  const warpA = tileFbm(size, 6, 3, 5 + index);
  const warpB = tileFbm(size, 6, 3, 9 + index);
  const grain = tileFbm(size, 40, 2, 21);
  const texture = pixelTexture(size, (px, py, i) => {
    const x = px / size + (warpA[i] - 0.5) * 0.05 * pattern.jag;
    const y = py / size + (warpB[i] - 0.5) * 0.05 * pattern.jag;
    let first = 9;
    let second = 9;
    let tone = 1;
    const gx = Math.floor(x * cells);
    const gy = Math.floor(y * cells);
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const cx = (((gx + ox) % cells) + cells) % cells;
        const cy = (((gy + oy) % cells) + cells) % cells;
        const point = points[cy * cells + cx];
        let dx = Math.abs(point.x - (((x % 1) + 1) % 1));
        let dy = Math.abs(point.y - (((y % 1) + 1) % 1));
        if (dx > 0.5) dx = 1 - dx;
        if (dy > 0.5) dy = 1 - dy;
        const d = Math.hypot(dx, dy) * cells;
        if (d < first) {
          second = first;
          first = d;
          tone = point.tone;
        } else if (d < second) second = d;
      }
    }
    const edge = second - first;
    const inside = Math.min(1, Math.max(0, (edge - pattern.line) / 0.06));
    const depth = 0.86 + 0.14 * Math.min(1, edge * 2) + (grain[i] - 0.5) * 0.12;
    const r = 1 + (pattern.patch[0] * tone * depth - 1) * inside;
    const g = 1 + (pattern.patch[1] * tone * depth - 1) * inside;
    const b = 1 + (pattern.patch[2] * tone * depth - 1) * inside;
    return [r ** (1 / 2.2), g ** (1 / 2.2), b ** (1 / 2.2)];
  });
  textures.set(index, texture);
  return texture;
}

const HOOF = new THREE.Color('#2a221b');

export function buildGiraffe(laneHex: string): AnimalRig {
  const lane = new THREE.Color(laneHex);
  const index = laneIndex(laneHex);
  const patternIndex = index % PATTERNS.length;
  const pattern = PATTERNS[patternIndex];
  const cream = new THREE.Color(pattern.cream);
  const pale = cream.clone().lerp(new THREE.Color('#fff6e0'), 0.45);
  const dark = new THREE.Color('#4a2c17');
  const muzzle = new THREE.Color('#5a4534');
  const blank = { uvRect: BLANK_UV };

  const legPaint: QuadSpec['legPaint'] = () => (out, _, __, position) => {
    out.copy(cream).lerp(pale, Math.min(1, Math.max(0, (1.25 - position.y) / 0.5)));
    if (position.y < 0.1) out.copy(HOOF);
  };

  const build = (ctx: BuildContext) => {
    const shade: NonNullable<Parameters<BuildContext['loft']>[1]>['paint'] = (out, angle) => {
      const s = Math.sin(angle);
      if (s < -0.35) out.lerp(pale, Math.min(1, (-0.35 - s) * 2.2));
    };
    ctx.coat.push(
      ctx.loft(
        [
          { p: [0, 2.1, -0.8], rx: 0.04, ry: 0.04, w: 'pelvis' },
          { p: [0, 2.12, -0.72], rx: 0.22, ry: 0.22, down: 0.3, w: 'pelvis' },
          { p: [0, 2.18, -0.5], rx: 0.33, ry: 0.28, down: 0.42, w: 'pelvis' },
          { p: [0, 2.28, -0.15], rx: 0.34, ry: 0.3, down: 0.42, w: { pelvis: 0.55, chest: 0.45 } },
          { p: [0, 2.38, 0.2], rx: 0.36, ry: 0.38, down: 0.5, w: { pelvis: 0.2, chest: 0.8 } },
          { p: [0, 2.45, 0.5], rx: 0.33, ry: 0.5, down: 0.55, w: 'chest' },
          { p: [0, 2.42, 0.72], rx: 0.24, ry: 0.36, down: 0.45, w: 'chest' },
          { p: [0, 2.38, 0.83], rx: 0.04, ry: 0.04, w: 'chest' },
        ],
        { color: cream, segments: 16, sub: 4, paint: shade },
      ),
      ctx.loft(
        [
          { p: [0, 2.42, 0.44], rx: 0.27, ry: 0.44, down: 0.42, w: 'chest' },
          { p: [0, 2.72, 0.62], rx: 0.23, ry: 0.34, down: 0.34, w: { chest: 0.5, neck0: 0.5 } },
          { p: [0, 3.02, 0.76], rx: 0.185, ry: 0.25, down: 0.25, w: 'neck0' },
          { p: [0, 3.5, 0.98], rx: 0.15, ry: 0.19, w: { neck0: 0.35, neck1: 0.65 } },
          { p: [0, 3.98, 1.19], rx: 0.125, ry: 0.155, w: { neck1: 0.35, neck2: 0.65 } },
          { p: [0, 4.4, 1.38], rx: 0.105, ry: 0.13, w: { neck2: 0.7, head: 0.3 } },
          { p: [0, 4.62, 1.47], rx: 0.085, ry: 0.1, w: 'head' },
        ],
        { color: cream, segments: 12, sub: 4, capStart: false },
      ),
      ctx.loft(
        [
          { p: [0, 4.66, 1.36], rx: 0.07, ry: 0.07, w: 'head', detail: 0.6 },
          { p: [0, 4.64, 1.49], rx: 0.105, ry: 0.1, down: 0.125, w: 'head', detail: 0.6 },
          { p: [0, 4.54, 1.68], rx: 0.092, ry: 0.085, down: 0.11, w: 'head', detail: 0.3 },
          { p: [0, 4.43, 1.86], rx: 0.066, ry: 0.06, down: 0.076, w: 'head', detail: 0, c: pale },
          { p: [0, 4.34, 2.0], rx: 0.062, ry: 0.056, down: 0.068, w: 'head', detail: 0, c: muzzle },
          { p: [0, 4.295, 2.06], rx: 0.03, ry: 0.028, w: 'head', detail: 0, c: muzzle },
        ],
        { color: cream, segments: 12, sub: 4 },
      ),
      ctx.loft(
        [
          { p: [0, 2.98, 0.5], rx: 0.015, ry: 0.015, w: 'chest' },
          { p: [0, 3.2, 0.6], rx: 0.03, ry: 0.06, w: 'neck0' },
          { p: [0, 3.66, 0.82], rx: 0.03, ry: 0.065, w: { neck0: 0.35, neck1: 0.65 } },
          { p: [0, 4.12, 1.03], rx: 0.028, ry: 0.06, w: { neck1: 0.35, neck2: 0.65 } },
          { p: [0, 4.52, 1.22], rx: 0.026, ry: 0.05, w: { neck2: 0.7, head: 0.3 } },
          { p: [0, 4.72, 1.34], rx: 0.01, ry: 0.01, w: 'head' },
        ],
        { color: '#6a4424', segments: 6, sub: 4, detail: 0 },
      ),
      ctx.loft(
        [
          { p: [0, 2.2, -0.76], rx: 0.04, ry: 0.04, w: 'pelvis' },
          { p: [0, 2.08, -0.86], rx: 0.035, ry: 0.035, w: 'tail0' },
          { p: [0, 1.7, -0.9], rx: 0.026, ry: 0.026, w: { tail0: 0.5, tail1: 0.5 } },
          { p: [0, 1.3, -0.9], rx: 0.024, ry: 0.024, w: { tail1: 0.5, tail2: 0.5 }, c: dark },
          { p: [0, 1.05, -0.9], rx: 0.06, ry: 0.06, w: 'tail2', c: '#1c130d' },
          { p: [0, 0.72, -0.9], rx: 0.008, ry: 0.008, w: 'tail2', c: '#1c130d' },
        ],
        { color: cream, ref: [0, 0, 1], segments: 7, sub: 4, detail: 0 },
      ),
    );
    const horn = ctx.loft(
      [
        { p: [0.052, 4.7, 1.44], rx: 0.03, ry: 0.03, w: 'head' },
        { p: [0.058, 4.82, 1.42], rx: 0.024, ry: 0.024, w: 'head' },
        { p: [0.062, 4.9, 1.41], rx: 0.032, ry: 0.032, w: 'head', c: '#20150e' },
        { p: [0.062, 4.94, 1.41], rx: 0.012, ry: 0.012, w: 'head', c: '#20150e' },
      ],
      { color: cream, ref: [0, 0, 1], segments: 7, sub: 2, detail: 0 },
    );
    ctx.both(ctx.coat, horn);
    const ear = ctx.loft(
      [
        { p: [0.085, 4.66, 1.4], rx: 0.02, ry: 0.035, w: 'head' },
        { p: [0.17, 4.69, 1.38], rx: 0.016, ry: 0.05, w: 'head' },
        { p: [0.25, 4.72, 1.36], rx: 0.004, ry: 0.006, w: 'head' },
      ],
      { color: pale, ref: [0, 1, 0], segments: 6, sub: 2, detail: 0 },
    );
    ctx.both(ctx.coat, ear);
    const eye = ctx.loft(
      [
        { p: [0.072, 4.575, 1.6], rx: 0.004, ry: 0.004, w: 'head' },
        { p: [0.092, 4.575, 1.62], rx: 0.026, ry: 0.022, w: 'head' },
        { p: [0.09, 4.572, 1.648], rx: 0.004, ry: 0.004, w: 'head' },
      ],
      { color: '#0a0706', ...blank, segments: 8, sub: 2 },
    );
    ctx.both(ctx.gear, eye);

    const cell = atlasCell(index);
    ctx.gear.push(
      ctx.loft(
        [
          { p: [0, 2.3, -0.12], rx: 0.355, ry: 0.32, down: 0.42, w: { pelvis: 0.5, chest: 0.5 } },
          { p: [0, 2.36, 0.08], rx: 0.368, ry: 0.365, down: 0.46, w: { pelvis: 0.3, chest: 0.7 } },
          { p: [0, 2.41, 0.26], rx: 0.372, ry: 0.42, down: 0.5, w: 'chest' },
          { p: [0, 2.44, 0.4], rx: 0.36, ry: 0.475, down: 0.52, w: 'chest' },
        ],
        { color: '#ffffff', uvRect: cell, segments: 16, sub: 3, arc: [-0.45, Math.PI + 0.45] },
      ),
      ctx.loft(
        [
          { p: [0, 2.66, -0.08], rx: 0.04, ry: 0.02, w: 'chest' },
          { p: [0, 2.72, 0.02], rx: 0.16, ry: 0.05, w: 'chest' },
          { p: [0, 2.8, 0.18], rx: 0.14, ry: 0.045, w: 'chest' },
          { p: [0, 2.9, 0.32], rx: 0.09, ry: 0.04, w: 'chest' },
          { p: [0, 2.93, 0.37], rx: 0.02, ry: 0.015, w: 'chest' },
        ],
        { color: '#3a2417', ...blank, segments: 8, sub: 2 },
      ),
      ctx.loft(
        [
          { p: [0, 2.43, 0.3], rx: 0.366, ry: 0.44, down: 0.515, w: 'chest' },
          { p: [0, 2.44, 0.36], rx: 0.364, ry: 0.465, down: 0.525, w: 'chest' },
        ],
        { color: '#2a1a12', ...blank, segments: 16, sub: 1, capStart: false, capEnd: false },
      ),
      ctx.loft(
        [
          { p: [0, 3.06, 0.78], rx: 0.192, ry: 0.255, down: 0.255, w: 'neck0' },
          { p: [0, 3.24, 0.86], rx: 0.178, ry: 0.235, down: 0.235, w: 'neck0' },
        ],
        { color: laneHex, ...blank, segments: 14, sub: 1, capStart: false, capEnd: false },
      ),
    );
    const rein = ctx.loft(
      [
        { p: [0.06, 4.36, 1.96], rx: 0.007, ry: 0.007, w: 'head' },
        { p: [0.13, 4.2, 1.5], rx: 0.007, ry: 0.007, w: { head: 0.5, neck2: 0.5 } },
        { p: [0.17, 3.6, 1.12], rx: 0.007, ry: 0.007, w: 'neck1' },
        { p: [0.14, 3.12, 0.84], rx: 0.007, ry: 0.007, w: 'neck0' },
      ],
      { color: '#2a1a12', ...blank, segments: 5, sub: 4, ref: [1, 0, 0] },
    );
    ctx.both(ctx.gear, rein);
    ctx.gear.push(
      ctx.loft(
        [
          { p: [0, 4.4, 1.9], rx: 0.07, ry: 0.066, down: 0.08, w: 'head' },
          { p: [0, 4.38, 1.935], rx: 0.068, ry: 0.064, down: 0.078, w: 'head' },
        ],
        { color: '#f1eee6', ...blank, segments: 12, sub: 1, capStart: false, capEnd: false },
      ),
    );
    addJockey(ctx, {
      seat: [3.04, 0.1],
      scale: 1,
      footX: 0.42,
      footDrop: 0.42,
      hands: [0.13, 3.1, 0.8],
      handBone: 'neck0',
      footBone: 'chest',
      laneIndex: index,
    });
  };

  const coatMaterial = () => {
    const material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0,
      sheen: 0.35,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color('#fff2d6'),
    });
    triplanarDetail(material, { map: patchTexture(patternIndex), scale: 0.62 });
    return material;
  };

  return buildQuadruped({
    joints: {
      body: [0, 2.3, 0],
      chest: [0, 2.4, 0.35],
      pelvis: [0, 2.2, -0.35],
      neck: [
        [0, 2.62, 0.52],
        [0, 3.25, 0.86],
        [0, 3.88, 1.14],
      ],
      head: [0, 4.56, 1.44],
      tail: [
        [0, 2.18, -0.78],
        [0, 1.7, -0.9],
        [0, 1.3, -0.9],
      ],
    },
    fore: {
      x: 0.22,
      pivot: [2.55, 0.42],
      joints: [
        [1.85, 0.46],
        [1.0, 0.48],
        [0.2, 0.47],
      ],
      hoof: [0, 0.54],
      rings: [
        [2.45, 0.48, 0.1, 0.2, -1],
        [2.15, 0.47, 0.1, 0.17, 0],
        [1.87, 0.46, 0.085, 0.12, 0.5],
        [1.5, 0.47, 0.066, 0.082, 1],
        [1.12, 0.48, 0.054, 0.06, 1],
        [1.0, 0.485, 0.062, 0.07, 1.5],
        [0.86, 0.48, 0.044, 0.05, 2],
        [0.4, 0.472, 0.04, 0.046, 2],
        [0.2, 0.47, 0.054, 0.06, 2.5],
        [0.11, 0.5, 0.05, 0.054, 3],
        [0.075, 0.52, 0.064, 0.07, 3],
        [0.0, 0.54, 0.072, 0.08, 3],
      ],
      bend: -1,
      flexSign: -1,
      attach: 'chest',
      bodyBlend: 0.6,
      centreShift: -0.15,
      lift: [0.16, 0.62],
      flex: [0.55, 1.5],
    },
    hind: {
      x: 0.2,
      pivot: [2.2, -0.55],
      joints: [
        [1.62, -0.42],
        [0.95, -0.72],
        [0.2, -0.67],
      ],
      hoof: [0, -0.6],
      rings: [
        [2.22, -0.56, 0.11, 0.22, -1],
        [1.95, -0.5, 0.115, 0.22, 0],
        [1.64, -0.43, 0.09, 0.15, 0.5],
        [1.3, -0.56, 0.066, 0.09, 1],
        [1.04, -0.69, 0.052, 0.066, 1],
        [0.95, -0.722, 0.056, 0.072, 1.5],
        [0.82, -0.712, 0.044, 0.052, 2],
        [0.4, -0.682, 0.04, 0.046, 2],
        [0.2, -0.67, 0.054, 0.06, 2.5],
        [0.11, -0.64, 0.05, 0.054, 3],
        [0.075, -0.62, 0.064, 0.07, 3],
        [0.0, -0.6, 0.072, 0.08, 3],
      ],
      bend: 1,
      flexSign: 1,
      attach: 'pelvis',
      bodyBlend: 0.6,
      centreShift: 0.3,
      lift: [0.12, 0.45],
      flex: [0.35, 0.85],
    },
    legPaint,
    legDetail: (y) => Math.min(1, Math.max(0, (y - 0.75) / 0.6)),
    build,
    coatMaterial,
    gait: {
      stride: 6,
      walkStride: 2.6,
      topSpeed: 15,
      trotSpeed: 3,
      gallopSpeed: 7.5,
      duty: 0.27,
      maxReach: 1.9,
      phases: { walk: [0.08, 0.58, 0, 0.5], gallop: [0.42, 0.53, 0, 0.1] },
      bob: 0.07,
      crouch: 0.16,
      pitch: 0.055,
      spine: 0.07,
      neckNod: 0.2,
      neckLower: 0.28,
      tailStream: 0.75,
    },
    height: 4.75,
    trailLength: 2.8,
    lane,
    seed: index * 53 + 7,
  });
}
