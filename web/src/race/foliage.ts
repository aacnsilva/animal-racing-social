import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm2, loft, noise2, type Ring } from './kit';

function plain(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color' && name !== 'uv') geometry.deleteAttribute(name);
  }
  if (!geometry.getAttribute('uv')) {
    geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2),
    );
  }
  return geometry.index ? geometry.toNonIndexed() : geometry;
}

function tint(geometry: THREE.BufferGeometry, paint: (out: THREE.Color, p: THREE.Vector3, n: THREE.Vector3) => void) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    p.fromBufferAttribute(position, i);
    n.fromBufferAttribute(normal, i);
    paint(color, p, n);
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function blob(radius: number, detail: number, seed: number, squash: number, lump: number): THREE.BufferGeometry {
  const geometry = mergeVertices(
    new THREE.IcosahedronGeometry(radius, detail).deleteAttribute('uv').deleteAttribute('normal'),
  );
  const position = geometry.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    v.fromBufferAttribute(position, i);
    const n = v.clone().normalize();
    const k =
      1 +
      lump *
        (fbm2(n.x * 2.3 + seed, n.y * 2.3 + n.z * 1.7, 3, seed) -
          0.5 +
          (noise2(n.z * 5 + seed, n.x * 5, seed + 3) - 0.5) * 0.5);
    position.setXYZ(i, v.x * k, v.y * k * squash, v.z * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

const lerpColor = (a: THREE.Color, b: THREE.Color, t: number, out: THREE.Color) =>
  out.copy(a).lerp(b, Math.max(0, Math.min(1, t)));

function trunk(points: [number, number, number][], radii: number[], bark: THREE.Color): THREE.BufferGeometry {
  const rings: Ring[] = points.map((p, i) => ({ p, rx: radii[i], ry: radii[i] }));
  const geometry = loft(rings, { ref: [0, 0, 1], segments: 7, sub: 2, color: bark, capStart: false });
  return tint(plain(geometry), (out, p) => {
    out.copy(bark).multiplyScalar(0.75 + noise2(p.y * 3, p.x * 9 + p.z * 9, 5) * 0.5);
  });
}

export function broadleaf(seed: number, leaf: string, leafDark: string): THREE.BufferGeometry {
  const light = new THREE.Color(leaf);
  const dark = new THREE.Color(leafDark);
  const bark = new THREE.Color('#4a3524');
  const rand = (i: number) => noise2(i * 7.31 + seed * 3.7, seed * 1.3 + i, seed);
  const height = 2.4 + rand(1) * 1.3;
  const parts: THREE.BufferGeometry[] = [
    trunk(
      [
        [0, -0.2, 0],
        [0.05, height * 0.45, 0.03],
        [-0.04, height * 0.8, -0.05],
        [0, height * 1.05, 0],
      ],
      [0.36, 0.24, 0.17, 0.08],
      bark,
    ),
  ];
  const count = 9;
  const centre = new THREE.Vector3(0, height + 1.7, 0);
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + rand(i + 3) * 2;
    const radius = i === 0 ? 0 : 1.5 + rand(i + 9) * 1.5;
    const size = i === 0 ? 2.7 : 1.5 + rand(i + 20) * 1.1;
    const lift = i === 0 ? 0.6 : (rand(i + 30) - 0.45) * 2.4;
    const part = blob(size, i === 0 ? 2 : 1, seed * 13 + i * 5, 0.8, 0.75);
    part.translate(centre.x + Math.cos(angle) * radius, centre.y + lift, centre.z + Math.sin(angle) * radius);
    parts.push(
      tint(plain(part), (out, p, n) => {
        const up = (p.y - (centre.y - 2.4)) / 5.4;
        lerpColor(
          dark,
          light,
          0.05 + up * 0.55 + n.y * 0.3 + (noise2(p.x * 2.1, p.z * 2.1 + p.y, seed) - 0.5) * 0.6,
          out,
        );
      }),
    );
  }
  for (const part of parts.slice(1)) {
    const normal = part.getAttribute('normal');
    const position = part.getAttribute('position');
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < normal.count; i += 1) {
      n.fromBufferAttribute(normal, i);
      p.fromBufferAttribute(position, i).sub(centre).normalize();
      n.lerp(p, 0.35).normalize();
      normal.setXYZ(i, n.x, n.y, n.z);
    }
  }
  return mergeGeometries(parts);
}

export function conifer(seed: number, leaf: string, leafDark: string, snow: number): THREE.BufferGeometry {
  const light = new THREE.Color(leaf);
  const dark = new THREE.Color(leafDark);
  const white = new THREE.Color('#f4f9fc');
  const bark = new THREE.Color('#3f2e22');
  const rand = (i: number) => noise2(i * 5.1 + seed * 2.9, seed + i * 0.7, seed + 40);
  const height = 6.5 + rand(1) * 3.5;
  const parts: THREE.BufferGeometry[] = [
    trunk(
      [
        [0, -0.2, 0],
        [0, height * 0.5, 0],
        [0, height * 0.9, 0],
      ],
      [0.26, 0.15, 0.04],
      bark,
    ),
  ];
  const tiers = 7;
  for (let i = 0; i < tiers; i += 1) {
    const t = i / (tiers - 1);
    const radius = (2.3 - t * 1.9) * (0.9 + rand(i + 3) * 0.25);
    const tierHeight = height * 0.3 * (1 - t * 0.35);
    const cone = new THREE.ConeGeometry(radius, tierHeight, 11, 3, true);
    const position = cone.getAttribute('position');
    for (let k = 0; k < position.count; k += 1) {
      const x = position.getX(k);
      const y = position.getY(k);
      const z = position.getZ(k);
      const rim = 1 - (y + tierHeight / 2) / tierHeight;
      const wave = 1 + rim * 0.22 * Math.sin(Math.atan2(z, x) * 5 + i * 1.7 + seed);
      position.setXYZ(k, x * wave, y - rim * rim * 0.35, z * wave);
    }
    cone.computeVertexNormals();
    cone.translate(0, height * (0.22 + t * 0.7) + tierHeight / 2, 0);
    parts.push(
      tint(plain(cone), (out, p, n) => {
        const r = Math.hypot(p.x, p.z) / Math.max(0.2, radius);
        lerpColor(dark, light, 0.2 + r * 0.6 + (noise2(p.x * 3, p.z * 3 + p.y, seed) - 0.5) * 0.4, out);
        if (snow > 0) out.lerp(white, Math.max(0, Math.min(1, (n.y - 0.25) * 2.2 + (r - 0.5) * 0.6)) * snow);
      }),
    );
  }
  return mergeGeometries(parts);
}

export function palm(seed: number): THREE.BufferGeometry {
  const bark = new THREE.Color('#7b6248');
  const light = new THREE.Color('#6f9a3a');
  const dark = new THREE.Color('#2f5a22');
  const rand = (i: number) => noise2(i * 3.3 + seed * 1.9, seed * 0.7 + i, seed + 80);
  const height = 6.5 + rand(1) * 3;
  const lean = (rand(2) - 0.5) * 2.4;
  const top = new THREE.Vector3(lean, height, (rand(3) - 0.5) * 1.2);
  const parts: THREE.BufferGeometry[] = [
    trunk(
      [
        [0, -0.2, 0],
        [lean * 0.15, height * 0.35, top.z * 0.2],
        [lean * 0.55, height * 0.72, top.z * 0.6],
        [top.x, top.y, top.z],
      ],
      [0.3, 0.2, 0.17, 0.15],
      bark,
    ),
  ];
  const fronds = 11;
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  for (let f = 0; f < fronds; f += 1) {
    const angle = (f / fronds) * Math.PI * 2 + rand(f + 5) * 0.5;
    const length = 3 + rand(f + 20) * 1.2;
    const rise = 0.5 + rand(f + 40) * 0.9;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const segments = 7;
    const spine: THREE.Vector3[] = [];
    const widths: number[] = [];
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      spine.push(
        new THREE.Vector3(
          top.x + dx * length * t,
          top.y + rise * Math.sin(t * 2.2) - t * t * length * 0.55,
          top.z + dz * length * t,
        ),
      );
      widths.push(0.08 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.05) ** 0.7));
    }
    for (let i = 0; i < segments; i += 1) {
      for (const side of [-1, 1]) {
        const a = spine[i];
        const b = spine[i + 1];
        const ea = new THREE.Vector3(a.x - dz * widths[i] * side, a.y - widths[i] * 0.45, a.z + dx * widths[i] * side);
        const eb = new THREE.Vector3(
          b.x - dz * widths[i + 1] * side,
          b.y - widths[i + 1] * 0.45,
          b.z + dx * widths[i + 1] * side,
        );
        const quad = side > 0 ? [a, b, ea, b, eb, ea] : [a, ea, b, b, ea, eb];
        for (const v of quad) {
          positions.push(v.x, v.y, v.z);
          lerpColor(dark, light, 0.25 + (i / segments) * 0.5 + (v === ea || v === eb ? 0.25 : 0), color);
          colors.push(color.r, color.g, color.b);
        }
      }
    }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  leaves.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  leaves.computeVertexNormals();
  const normal = leaves.getAttribute('normal');
  for (let i = 0; i < normal.count; i += 1) {
    const ny = Math.abs(normal.getY(i));
    normal.setXYZ(i, normal.getX(i) * 0.4, ny * 0.6 + 0.6, normal.getZ(i) * 0.4);
  }
  leaves.normalizeNormals();
  parts.push(leaves);
  const crown = blob(0.28, 1, seed, 1, 0.2);
  crown.translate(top.x, top.y - 0.1, top.z);
  parts.push(tint(plain(crown), (out) => out.set('#5a4a2c')));
  return mergeGeometries(parts);
}

export function acacia(seed: number): THREE.BufferGeometry {
  const bark = new THREE.Color('#5a4633');
  const light = new THREE.Color('#7f9443');
  const dark = new THREE.Color('#3f5a26');
  const rand = (i: number) => noise2(i * 4.7 + seed * 2.3, seed + i * 1.1, seed + 120);
  const height = 4.2 + rand(1) * 1.5;
  const parts: THREE.BufferGeometry[] = [
    trunk(
      [
        [0, -0.2, 0],
        [0.2, height * 0.5, 0.1],
        [0.1, height * 0.85, 0],
      ],
      [0.3, 0.2, 0.14],
      bark,
    ),
  ];
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + rand(i + 2) * 1.5;
    const reach = 1.6 + rand(i + 9) * 1.2;
    parts.push(
      trunk(
        [
          [0.15, height * 0.7, 0],
          [Math.cos(angle) * reach * 0.6, height * 0.95, Math.sin(angle) * reach * 0.6],
          [Math.cos(angle) * reach, height * 1.08, Math.sin(angle) * reach],
        ],
        [0.12, 0.08, 0.04],
        bark,
      ),
    );
    const pad = blob(1.7 + rand(i + 15) * 0.7, 2, seed * 3 + i, 0.24, 0.5);
    pad.translate(Math.cos(angle) * reach, height * 1.12, Math.sin(angle) * reach);
    parts.push(
      tint(plain(pad), (out, p, n) => {
        lerpColor(dark, light, 0.35 + n.y * 0.5 + (noise2(p.x * 2, p.z * 2, seed) - 0.5) * 0.4, out);
      }),
    );
  }
  const cap = blob(2.6, 2, seed * 7, 0.2, 0.5);
  cap.translate(0.1, height * 1.2, 0);
  parts.push(
    tint(plain(cap), (out, p, n) => {
      lerpColor(dark, light, 0.4 + n.y * 0.5 + (noise2(p.x * 2, p.z * 2, seed) - 0.5) * 0.4, out);
    }),
  );
  return mergeGeometries(parts);
}

export function cactus(seed: number): THREE.BufferGeometry {
  const green = new THREE.Color('#4d7c45');
  const rib = new THREE.Color('#345c33');
  const paint = (out: THREE.Color, angle: number) => {
    out.copy(green).lerp(rib, 0.5 + 0.5 * Math.sin(angle * 9));
  };
  const rand = (i: number) => noise2(i * 6.1 + seed, seed * 0.3 + i, seed + 160);
  const height = 3 + rand(1) * 1.6;
  const parts = [
    plain(
      loft(
        [
          { p: [0, -0.1, 0], rx: 0.32, ry: 0.32 },
          { p: [0, height * 0.6, 0], rx: 0.34, ry: 0.34 },
          { p: [0, height, 0], rx: 0.28, ry: 0.28 },
          { p: [0, height + 0.25, 0], rx: 0.06, ry: 0.06 },
        ],
        { ref: [0, 0, 1], segments: 14, sub: 3, paint },
      ),
    ),
  ];
  for (const side of [-1, 1]) {
    const y = height * (0.35 + rand(side + 5) * 0.25);
    const reach = 0.75 + rand(side + 8) * 0.3;
    const up = 0.9 + rand(side + 11) * 0.9;
    parts.push(
      plain(
        loft(
          [
            { p: [side * 0.15, y, 0], rx: 0.2, ry: 0.2 },
            { p: [side * reach, y + 0.08, 0], rx: 0.2, ry: 0.2 },
            { p: [side * (reach + 0.12), y + up * 0.5, 0], rx: 0.19, ry: 0.19 },
            { p: [side * (reach + 0.12), y + up, 0], rx: 0.16, ry: 0.16 },
            { p: [side * (reach + 0.12), y + up + 0.18, 0], rx: 0.04, ry: 0.04 },
          ],
          { ref: [0, 0, 1], segments: 10, sub: 3, paint },
        ),
      ),
    );
  }
  return mergeGeometries(parts);
}

export function bush(seed: number, leaf: string, leafDark: string): THREE.BufferGeometry {
  const light = new THREE.Color(leaf);
  const dark = new THREE.Color(leafDark);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i += 1) {
    const part = blob(0.8 + noise2(i, seed, 9) * 0.5, 1, seed + i * 11, 0.75, 0.5);
    part.translate((noise2(i * 3, seed, 4) - 0.5) * 1.4, 0.45, (noise2(seed, i * 5, 6) - 0.5) * 1.4);
    parts.push(
      tint(plain(part), (out, p, n) => {
        lerpColor(dark, light, 0.2 + p.y * 0.5 + n.y * 0.2 + (noise2(p.x * 3, p.z * 3, seed) - 0.5) * 0.4, out);
      }),
    );
  }
  return mergeGeometries(parts);
}

export function rock(seed: number, base: string): THREE.BufferGeometry {
  const light = new THREE.Color(base);
  const dark = light.clone().multiplyScalar(0.5);
  const geometry = blob(1, 2, seed * 17, 0.62, 0.9);
  geometry.translate(0, 0.3, 0);
  return tint(plain(geometry), (out, p, n) => {
    lerpColor(dark, light, 0.25 + n.y * 0.5 + (fbm2(p.x * 3 + seed, p.z * 3 + p.y * 2, 3, seed) - 0.5) * 0.9, out);
  });
}

export function grassTuft(tall: number, light: string, dark: string): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const tip = new THREE.Color(light);
  const base = new THREE.Color(dark);
  const color = new THREE.Color();
  const blades = 5;
  for (let b = 0; b < blades; b += 1) {
    const angle = (b / blades) * Math.PI * 2 + noise2(b, 3, 5) * 2;
    const offset = 0.05 + noise2(b, 7, 11) * 0.16;
    const ox = Math.cos(angle * 1.7) * offset;
    const oz = Math.sin(angle * 1.7) * offset;
    const height = tall * (0.6 + noise2(b, 13, 17) * 0.7);
    const lean = 0.1 + noise2(b, 19, 23) * 0.22;
    const width = 0.022 + noise2(b, 29, 31) * 0.015;
    const wx = Math.cos(angle + Math.PI / 2);
    const wz = Math.sin(angle + Math.PI / 2);
    const segments = 2;
    const row = (i: number) => {
      const t = i / segments;
      const w = width * (1 - t * 0.9);
      const cx = ox + Math.cos(angle) * lean * t * t;
      const cz = oz + Math.sin(angle) * lean * t * t;
      return [[cx - wx * w, height * t, cz - wz * w], [cx + wx * w, height * t, cz + wz * w], t] as const;
    };
    for (let i = 0; i < segments; i += 1) {
      const [a0, a1, ta] = row(i);
      const [b0, b1, tb] = row(i + 1);
      for (const [v, t] of [
        [a0, ta],
        [a1, ta],
        [b0, tb],
        [a1, ta],
        [b1, tb],
        [b0, tb],
      ] as const) {
        positions.push(v[0], v[1], v[2]);
        lerpColor(base, tip, t, color);
        colors.push(color.r, color.g, color.b);
        uvs.push(0.5, t);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geometry;
}

export function swayMaterial(
  material: THREE.MeshStandardMaterial,
  time: { value: number },
  amount: number,
  from: number,
  mode: 'tree' | 'grass',
): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    const sway =
      mode === 'tree'
        ? [
            '#ifdef USE_INSTANCING',
            'vec2 swayOrigin = instanceMatrix[3].xz;',
            '#else',
            'vec2 swayOrigin = vec2(0.0);',
            '#endif',
            `float swayWeight = max(0.0, transformed.y - ${from.toFixed(2)});`,
            'float swayPhase = uTime * 1.1 + swayOrigin.x * 0.21 + swayOrigin.y * 0.17;',
            `transformed.x += (sin(swayPhase) + 0.4 * sin(swayPhase * 2.7 + transformed.y)) * swayWeight * ${amount.toFixed(4)};`,
            `transformed.z += cos(swayPhase * 0.83 + transformed.x * 0.6) * swayWeight * ${(amount * 0.7).toFixed(4)};`,
          ]
        : [
            '#ifdef USE_INSTANCING',
            'vec2 swayOrigin = instanceMatrix[3].xz;',
            '#else',
            'vec2 swayOrigin = vec2(0.0);',
            '#endif',
            'float swayWeight = uv.y * uv.y;',
            'float swayPhase = uTime * 2.1 + swayOrigin.x * 0.35 + swayOrigin.y * 0.27;',
            `transformed.x += (sin(swayPhase) * 0.7 + sin(swayPhase * 2.3 + swayOrigin.y) * 0.3 + 0.5) * swayWeight * ${amount.toFixed(4)};`,
            `transformed.z += cos(swayPhase * 1.31) * swayWeight * ${(amount * 0.6).toFixed(4)};`,
          ];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${sway.join('\n')}`);
  };
  material.customProgramCacheKey = () => `sway:${mode}:${amount}:${from}`;
  return material;
}
