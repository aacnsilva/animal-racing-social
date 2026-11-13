import * as THREE from 'three';
import { normalTexture, pixelTexture, tileFbm, tileNoise } from './kit';

export type SurfaceTextures = {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap?: THREE.Texture;
  roughness: number;
  metalness: number;
  normalScale: number;
  tile: number;
};

const hex = (value: string): [number, number, number] => {
  const c = new THREE.Color(value);
  return [c.r, c.g, c.b];
};

const blend = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const srgb = (c: [number, number, number]): [number, number, number] => [
  c[0] ** (1 / 2.2),
  c[1] ** (1 / 2.2),
  c[2] ** (1 / 2.2),
];

const cache = new Map<string, SurfaceTextures>();

function build(kind: string): SurfaceTextures {
  const size = 512;
  const broad = tileFbm(size, 4, 4, 3);
  const medium = tileFbm(size, 16, 3, 7);
  const fine = tileNoise(size, 128, 13);
  const grit = tileNoise(size, 256, 19);
  switch (kind) {
    case 'GRASS':
    case 'TURF': {
      const dark = hex(kind === 'TURF' ? '#33682a' : '#2b5021');
      const light = hex(kind === 'TURF' ? '#679f40' : '#5a8a38');
      const dry = hex('#93a04c');
      const height = new Float32Array(size * size);
      for (let i = 0; i < height.length; i += 1) height[i] = fine[i] * 0.25 + grit[i] * 0.6 + medium[i] * 0.25;
      return {
        map: pixelTexture(size, (_, __, i) => {
          const t = Math.min(1, Math.max(0, medium[i] * 0.5 + fine[i] * 0.3 + grit[i] * 0.4 - 0.1));
          const base = blend(dark, light, t);
          return srgb(blend(base, dry, Math.max(0, broad[i] - 0.55) * 1.2 * grit[i]));
        }),
        normalMap: normalTexture(height, size, 4),
        roughness: 0.92,
        metalness: 0,
        normalScale: 0.55,
        tile: 3.5,
      };
    }
    case 'DIRT': {
      const dark = hex('#6b4027');
      const light = hex('#a8704a');
      const height = new Float32Array(size * size);
      for (let i = 0; i < height.length; i += 1) {
        const x = i % size;
        height[i] = medium[i] * 0.8 + grit[i] * 0.35 + Math.sin((x / size) * Math.PI * 2 * 22 + broad[i] * 9) * 0.05;
      }
      return {
        map: pixelTexture(size, (_, __, i) => {
          const base = blend(dark, light, Math.min(1, medium[i] * 0.9 + fine[i] * 0.3));
          const speck = grit[i] > 0.86 ? 1.25 : grit[i] < 0.1 ? 0.75 : 1;
          return srgb([base[0] * speck, base[1] * speck, base[2] * speck]);
        }),
        normalMap: normalTexture(height, size, 6),
        roughness: 0.95,
        metalness: 0,
        normalScale: 1,
        tile: 6,
      };
    }
    case 'SAND': {
      const dark = hex('#c9a468');
      const light = hex('#ecd29c');
      const height = new Float32Array(size * size);
      for (let i = 0; i < height.length; i += 1) {
        const y = Math.floor(i / size);
        height[i] =
          Math.sin((y / size) * Math.PI * 2 * 14 + broad[i] * 14 + medium[i] * 3) * 0.32 +
          medium[i] * 0.3 +
          grit[i] * 0.2;
      }
      return {
        map: pixelTexture(size, (_, __, i) =>
          srgb(blend(dark, light, Math.min(1, 0.35 + height[i] * 0.3 + medium[i] * 0.4 + (grit[i] - 0.5) * 0.25))),
        ),
        normalMap: normalTexture(height, size, 1.5),
        roughness: 0.9,
        metalness: 0,
        normalScale: 1,
        tile: 7,
      };
    }
    case 'MUD': {
      const wet = hex('#2e1c0e');
      const clay = hex('#5c3a20');
      const height = new Float32Array(size * size);
      const puddle = new Float32Array(size * size);
      for (let i = 0; i < height.length; i += 1) {
        const level = broad[i] * 0.7 + medium[i] * 0.3;
        puddle[i] = Math.min(1, Math.max(0, (0.4 - level) * 9));
        height[i] = (1 - puddle[i]) * (medium[i] * 0.9 + fine[i] * 0.4 + grit[i] * 0.2);
      }
      return {
        map: pixelTexture(size, (_, __, i) => srgb(blend(blend(clay, wet, 1 - medium[i]), wet, puddle[i] * 0.8))),
        normalMap: normalTexture(height, size, 3.5),
        roughnessMap: pixelTexture(
          size,
          (_, __, i) => {
            const r = 0.9 - puddle[i] * 0.62 - grit[i] * 0.12;
            return [0, r, 0];
          },
          false,
        ),
        roughness: 1,
        metalness: 0,
        normalScale: 0.9,
        tile: 9,
      };
    }
    case 'ICE': {
      const deep = hex('#8fbcd6');
      const pale = hex('#e3f1f7');
      const height = new Float32Array(size * size);
      const crack = new Float32Array(size * size);
      for (let i = 0; i < height.length; i += 1) {
        const ridge = Math.abs(medium[i] - 0.5) * 2;
        crack[i] = Math.max(0, 1 - ridge * 14);
        height[i] = fine[i] * 0.08 - crack[i] * 0.5 + broad[i] * 0.2;
      }
      return {
        map: pixelTexture(size, (_, __, i) =>
          srgb(blend(blend(deep, pale, broad[i] * 0.8 + fine[i] * 0.2), pale, crack[i] * 0.8)),
        ),
        normalMap: normalTexture(height, size, 2.5),
        roughnessMap: pixelTexture(
          size,
          (_, __, i) => {
            const r = 0.14 + Math.max(0, broad[i] - 0.5) * 0.45 + crack[i] * 0.25;
            return [0, r, 0];
          },
          false,
        ),
        roughness: 1,
        metalness: 0,
        normalScale: 0.6,
        tile: 10,
      };
    }
    case 'SNOW': {
      const shade = hex('#b4c8dc');
      const bright = hex('#e9f0f6');
      const height = new Float32Array(size * size);
      for (let i = 0; i < height.length; i += 1) height[i] = broad[i] * 0.8 + medium[i] * 0.5 + grit[i] * 0.08;
      return {
        map: pixelTexture(size, (_, __, i) =>
          srgb(blend(shade, bright, Math.min(1, 0.3 + medium[i] * 0.5 + broad[i] * 0.4))),
        ),
        normalMap: normalTexture(height, size, 3),
        roughness: 0.75,
        metalness: 0,
        normalScale: 0.8,
        tile: 12,
      };
    }
    case 'ROCK': {
      const dark = hex('#5d5348');
      const light = hex('#a3978a');
      const height = new Float32Array(size * size);
      for (let i = 0; i < height.length; i += 1)
        height[i] = Math.abs(medium[i] - 0.5) * 1.6 + broad[i] * 0.6 + grit[i] * 0.2;
      return {
        map: pixelTexture(size, (_, __, i) => srgb(blend(dark, light, Math.min(1, height[i] * 0.7 + fine[i] * 0.2)))),
        normalMap: normalTexture(height, size, 7),
        roughness: 0.95,
        metalness: 0,
        normalScale: 1.2,
        tile: 8,
      };
    }
    default: {
      const height = new Float32Array(size * size);
      for (let i = 0; i < height.length; i += 1) height[i] = medium[i] * 0.5 + grit[i] * 0.5;
      return {
        map: pixelTexture(size, (_, __, i) => {
          const v = 0.8 + medium[i] * 0.2 + (grit[i] - 0.5) * 0.12;
          return [v, v, v];
        }),
        normalMap: normalTexture(height, size, 3),
        roughness: 0.8,
        metalness: 0,
        normalScale: 0.5,
        tile: 3,
      };
    }
  }
}

export function surfaceTextures(kind: string): SurfaceTextures {
  let entry = cache.get(kind);
  if (!entry) {
    entry = build(kind);
    cache.set(kind, entry);
  }
  return entry;
}

export function surfaceMaterial(
  kind: string,
  extra: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  const t = surfaceTextures(kind);
  return new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(t.normalScale, t.normalScale),
    roughnessMap: t.roughnessMap ?? null,
    roughness: t.roughness,
    metalness: t.metalness,
    ...extra,
  });
}

let macro: THREE.Texture | null = null;

function macroTexture(): THREE.Texture {
  if (macro) return macro;
  const size = 256;
  const a = tileFbm(size, 3, 5, 91);
  const b = tileFbm(size, 7, 3, 57);
  macro = pixelTexture(
    size,
    (_, __, i) => {
      const v = a[i] * 0.7 + b[i] * 0.3;
      return [v, v, v];
    },
    false,
  );
  return macro;
}

export function addMacroVariation(material: THREE.MeshStandardMaterial, scale = 0.035, strength = 0.9): void {
  const uniforms = { uMacro: { value: macroTexture() } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uMacro;')
      .replace(
        '#include <map_fragment>',
        [
          '#include <map_fragment>',
          '#ifdef USE_MAP',
          `float macroA = texture2D(uMacro, vMapUv * ${scale.toFixed(4)}).r;`,
          `float macroB = texture2D(uMacro, vMapUv * ${(scale * 0.19).toFixed(4)} + 0.37).r;`,
          `diffuseColor.rgb *= 1.0 + (macroA + macroB - 1.0) * ${strength.toFixed(3)};`,
          '#endif',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => `macro:${scale}:${strength}`;
}
