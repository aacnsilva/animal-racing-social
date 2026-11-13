import * as THREE from 'three';
import type { TrackPath } from '../lib/track';
import type { Rect } from './water-props';
import {
  bubbleStreams,
  lightShafts,
  plankton,
  surfaceMaterial,
  waterPatch,
  waterUniforms,
  type BubbleSource,
  type ParticleOptions,
  type PatchOptions,
  type ShaftOptions,
  type SurfaceOptions,
  type WaterLook,
  type WaterUniforms,
} from './water-shaders';
import { causticTexture, detailTexture, waterNormalTexture } from './water-textures';

export type Shadow = 'none' | 'cast' | 'receive' | 'both';

export type FogSpec = { color: string; near: number; far: number };

export type VenueHints = {
  fog: { water: FogSpec; air: FogSpec };
  background: { water: string; air: string | null };
  sun: { direction: THREE.Vector3; color: string; intensity: number };
  ambient: { sky: string; ground: string; intensity: number };
  environmentIntensity: number;
  indoor: boolean;
};

export function sunFrom(elevationDeg: number, azimuthDeg: number): THREE.Vector3 {
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
  const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
  return new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  );
}

export class Stage {
  readonly group = new THREE.Group();
  readonly textures: THREE.Texture[] = [];
  readonly uniforms: WaterUniforms;
  readonly normalMap: THREE.Texture;
  readonly track: TrackPath;
  readonly random: () => number;
  readonly look: WaterLook;
  envIntensity = 0.35;
  private shaftUniform: { value: THREE.Vector3 } | null = null;

  constructor(track: TrackPath, random: () => number, look: WaterLook) {
    this.track = track;
    this.random = random;
    this.look = look;
    this.normalMap = this.keep(waterNormalTexture());
    this.uniforms = waterUniforms(look, this.keep(causticTexture()), this.keep(detailTexture()));
  }

  keep<T extends THREE.Texture>(texture: T): T {
    this.textures.push(texture);
    return texture;
  }

  add<T extends THREE.Object3D>(object: T): T {
    this.group.add(object);
    return object;
  }

  rect(margin: number): Rect {
    const track = this.track;
    return {
      minX: track.minX - margin,
      maxX: track.maxX + margin,
      minZ: track.minZ - margin,
      maxZ: track.maxZ + margin,
    };
  }

  standard(params: THREE.MeshStandardMaterialParameters, patch: PatchOptions = {}): THREE.MeshStandardMaterial {
    return waterPatch(
      new THREE.MeshStandardMaterial({ envMapIntensity: this.envIntensity, ...params }),
      this.uniforms,
      patch,
    );
  }

  basic(params: THREE.MeshBasicMaterialParameters, patch: PatchOptions = {}): THREE.MeshBasicMaterial {
    return waterPatch(new THREE.MeshBasicMaterial(params), this.uniforms, patch);
  }

  shade<T extends THREE.Object3D>(object: T, shadow: Shadow): T {
    object.castShadow = shadow === 'cast' || shadow === 'both';
    object.receiveShadow = shadow === 'receive' || shadow === 'both';
    return object;
  }

  mesh(geometry: THREE.BufferGeometry, material: THREE.Material, shadow: Shadow = 'receive'): THREE.Mesh {
    return this.add(this.shade(new THREE.Mesh(geometry, material), shadow));
  }

  surface(geometry: THREE.BufferGeometry, options: Omit<SurfaceOptions, 'normalMap'>): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, surfaceMaterial(this.uniforms, { ...options, normalMap: this.normalMap }));
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    return this.add(mesh);
  }

  shafts(options: ShaftOptions): THREE.Mesh {
    const shafts = lightShafts(this.uniforms, this.random, options);
    this.shaftUniform = shafts.direction;
    this.shaftDirection();
    return this.add(shafts.mesh);
  }

  shaftDirection(): void {
    const sun = this.uniforms.uSunDir.value;
    this.shaftUniform?.value.set(-sun.x * 0.75, -sun.y, -sun.z * 0.75).normalize();
  }

  particles(options: ParticleOptions): THREE.Points {
    return this.add(plankton(this.uniforms, this.random, options));
  }

  bubbles(sources: BubbleSource[], perSource: number): THREE.Points {
    return this.add(bubbleStreams(this.uniforms, this.random, sources, perSource));
  }
}

export function planeSurface(rect: Rect, level: number, cell: number): THREE.BufferGeometry {
  const width = rect.maxX - rect.minX;
  const depth = rect.maxZ - rect.minZ;
  const geometry = new THREE.PlaneGeometry(
    width,
    depth,
    Math.min(96, Math.max(2, Math.round(width / cell))),
    Math.min(96, Math.max(2, Math.round(depth / cell))),
  );
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((rect.minX + rect.maxX) / 2, level, (rect.minZ + rect.maxZ) / 2);
  return geometry;
}

export function warpedGrid(
  cx: number,
  cz: number,
  core: number,
  reach: number,
  segments: number,
): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(2, 2, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  const warp = (t: number) => {
    const a = Math.abs(t);
    const linear = a * core * 1.6;
    const far = a ** 4 * (reach - core * 1.6);
    return Math.sign(t) * (linear + far);
  };
  for (let i = 0; i < position.count; i += 1) {
    position.setXYZ(i, cx + warp(position.getX(i)), 0, cz + warp(position.getZ(i)));
  }
  return geometry;
}
