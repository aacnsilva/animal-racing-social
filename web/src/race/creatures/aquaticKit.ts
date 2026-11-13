import * as THREE from 'three';
import { loft, mergeGroups, mirrorX, Skeleton, type LoftOptions, type Ring, type Vec3, type Weights } from '../kit';

export type NamedWeights = string | Record<string, number>;
export type NamedRing = Omit<Ring, 'w'> & { w?: NamedWeights };
export type NamedLoftOptions = Omit<LoftOptions, 'weights'> & { weights?: NamedWeights };

const ease = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class AquaticBuilder {
  readonly skeleton = new Skeleton();
  readonly skin: THREE.BufferGeometry[] = [];
  readonly gear: THREE.BufferGeometry[] = [];
  readonly rider: THREE.BufferGeometry[] = [];
  private readonly names = new Map<string, number>();
  private readonly swaps = new Map<number, number>();

  index(name: string): number {
    const index = this.names.get(name);
    if (index === undefined) throw new Error(`Unknown bone ${name}`);
    return index;
  }

  bone(name: string): THREE.Bone {
    return this.skeleton.bones[this.index(name)];
  }

  rest(name: string): THREE.Vector3 {
    return this.skeleton.rest[this.index(name)];
  }

  addBone(name: string, parent: string, position: Vec3): THREE.Bone {
    const index = this.skeleton.add(parent ? this.index(parent) : -1, position);
    this.names.set(name, index);
    return this.skeleton.bones[index];
  }

  pair(left: string, right: string): void {
    this.swaps.set(this.index(left), this.index(right));
    this.swaps.set(this.index(right), this.index(left));
  }

  resolve(weights: NamedWeights | undefined): Weights | undefined {
    if (weights === undefined) return undefined;
    if (typeof weights === 'string') return this.index(weights);
    const out: Record<number, number> = {};
    for (const key of Object.keys(weights)) out[this.index(key)] = weights[key];
    return out;
  }

  loft(rings: NamedRing[], options: NamedLoftOptions = {}): THREE.BufferGeometry {
    return loft(
      rings.map((ring) => ({ ...ring, w: this.resolve(ring.w) })),
      { ...options, weights: this.resolve(options.weights) },
    );
  }

  mirror(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
    return mirrorX(geometry, (index) => this.swaps.get(index) ?? index);
  }

  both(list: THREE.BufferGeometry[], geometry: THREE.BufferGeometry): void {
    list.push(geometry, this.mirror(geometry));
  }

  build(materials: THREE.Material[]): THREE.SkinnedMesh {
    const geometry = mergeGroups([this.skin, this.gear, this.rider]);
    return this.skeleton.skin(geometry, materials);
  }
}

export function chainWeights(first: string, joints: [number, string][], t: number, soft = 1): Record<string, number> {
  const out: Record<string, number> = {};
  let carried = 1;
  let name = first;
  for (let k = 0; k < joints.length; k += 1) {
    const at = joints[k][0];
    const before = k > 0 ? at - joints[k - 1][0] : k + 1 < joints.length ? joints[k + 1][0] - at : 1;
    const after = k + 1 < joints.length ? joints[k + 1][0] - at : before;
    const half = Math.max(1e-4, 0.5 * soft * Math.min(before, after));
    const passed = ease(at - half, at + half, t);
    const weight = carried * (1 - passed);
    if (weight > 1e-4) out[name] = weight;
    carried *= passed;
    name = joints[k][1];
  }
  if (carried > 1e-4) out[name] = carried;
  return out;
}

export type Section = { z: number; y: number; rx: number; ry: number; down?: number };

const catmull = (a: number, b: number, c: number, d: number, t: number) =>
  0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);

const clampTo = (value: number, x: number, y: number) => Math.max(Math.min(x, y), Math.min(Math.max(x, y), value));

export class Profile {
  constructor(readonly sections: Section[]) {}

  at(z: number): Required<Section> {
    const s = this.sections;
    const n = s.length;
    let i = 0;
    while (i < n - 2 && z > s[i + 1].z) i += 1;
    const t = Math.max(0, Math.min(1, (z - s[i].z) / (s[i + 1].z - s[i].z)));
    const a = s[Math.max(0, i - 1)];
    const b = s[i];
    const c = s[i + 1];
    const d = s[Math.min(n - 1, i + 2)];
    return {
      z,
      y: catmull(a.y, b.y, c.y, d.y, t),
      rx: clampTo(catmull(a.rx, b.rx, c.rx, d.rx, t), b.rx, c.rx),
      ry: clampTo(catmull(a.ry, b.ry, c.ry, d.ry, t), b.ry, c.ry),
      down: clampTo(
        catmull(a.down ?? a.ry, b.down ?? b.ry, c.down ?? c.ry, d.down ?? d.ry, t),
        b.down ?? b.ry,
        c.down ?? c.ry,
      ),
    };
  }

  point(z: number, angle: number, inflate = 0): Vec3 {
    const s = this.at(z);
    const sin = Math.sin(angle);
    return [(s.rx + inflate) * Math.cos(angle), s.y + ((sin >= 0 ? s.ry : s.down) + inflate) * sin, z];
  }

  ring(z: number, inflate: number, w?: NamedWeights): NamedRing {
    const s = this.at(z);
    return { p: [0, s.y, z], rx: s.rx + inflate, ry: s.ry + inflate, down: s.down + inflate, w };
  }
}

export type FoilStation = { p: Vec3; chord: number; thick: number; w?: NamedWeights; c?: THREE.ColorRepresentation };

export function foil(
  builder: AquaticBuilder,
  stations: FoilStation[],
  options: NamedLoftOptions = {},
): THREE.BufferGeometry {
  return builder.loft(
    stations.map((s) => ({ p: s.p, rx: s.chord / 2, ry: s.thick / 2, w: s.w, c: s.c })),
    { segments: 8, sub: 3, ...options },
  );
}

export function revise(
  geometry: THREE.BufferGeometry,
  visit: (position: THREE.Vector3, color: THREE.Color, detail: number) => number,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  const detail = geometry.getAttribute('detail');
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    p.fromBufferAttribute(position, i);
    c.fromBufferAttribute(color, i);
    detail.setX(i, visit(p, c, detail.getX(i)));
    color.setXYZ(i, c.r, c.g, c.b);
  }
  return geometry;
}

export type SkinOptions = {
  map: THREE.Texture;
  scale: number;
  bump?: THREE.Texture;
  bumpScale?: number;
  bumpStrength?: number;
};

export function aquaticSkin(material: THREE.MeshStandardMaterial, options: SkinOptions): void {
  const uniforms = {
    uAqMap: { value: options.map },
    uAqScale: { value: options.scale },
    uAqBump: { value: options.bump ?? options.map },
    uAqBumpScale: { value: options.bumpScale ?? options.scale },
    uAqBumpStrength: { value: options.bump ? (options.bumpStrength ?? 0.01) : 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float detail;\nvarying vec3 vAqPosition;\nvarying vec3 vAqNormal;\nvarying float vAqDetail;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvAqPosition = position;\nvAqNormal = normal;\nvAqDetail = detail;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform sampler2D uAqMap;',
          'uniform sampler2D uAqBump;',
          'uniform float uAqScale;',
          'uniform float uAqBumpScale;',
          'uniform float uAqBumpStrength;',
          'varying vec3 vAqPosition;',
          'varying vec3 vAqNormal;',
          'varying float vAqDetail;',
        ].join('\n'),
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'vec3 aqWeight = pow(abs(normalize(vAqNormal)), vec3(4.0));',
          'aqWeight /= aqWeight.x + aqWeight.y + aqWeight.z;',
          'vec3 aqP = vAqPosition * uAqScale;',
          'vec3 aqColor = texture2D(uAqMap, aqP.zy).rgb * aqWeight.x + texture2D(uAqMap, aqP.zx).rgb * aqWeight.y + texture2D(uAqMap, aqP.xy).rgb * aqWeight.z;',
          'diffuseColor.rgb *= mix(vec3(1.0), aqColor, clamp(vAqDetail, 0.0, 1.0));',
        ].join('\n'),
      )
      .replace(
        '#include <normal_fragment_maps>',
        [
          '#include <normal_fragment_maps>',
          'if (uAqBumpStrength > 0.0) {',
          'vec3 aqB = vAqPosition * uAqBumpScale;',
          'float aqH = (texture2D(uAqBump, aqB.zy).r * aqWeight.x + texture2D(uAqBump, aqB.zx).r * aqWeight.y + texture2D(uAqBump, aqB.xy).r * aqWeight.z) * uAqBumpStrength * clamp(vAqDetail, 0.0, 1.0);',
          'vec3 aqSx = dFdx(-vViewPosition);',
          'vec3 aqSy = dFdy(-vViewPosition);',
          'vec3 aqR1 = cross(aqSy, normal);',
          'vec3 aqR2 = cross(normal, aqSx);',
          'float aqDet = dot(aqSx, aqR1) * faceDirection;',
          'vec3 aqGrad = sign(aqDet) * (dFdx(aqH) * aqR1 + dFdy(aqH) * aqR2);',
          'normal = normalize(abs(aqDet) * normal - aqGrad);',
          '}',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'aquatic-skin';
}

export function quatAbout(out: THREE.Quaternion, x: number, y: number, z: number, angle: number): THREE.Quaternion {
  const half = angle / 2;
  const s = Math.sin(half);
  return out.set(x * s, y * s, z * s, Math.cos(half));
}
