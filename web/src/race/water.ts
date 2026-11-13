import type * as THREE from 'three';
import type { TrackPath } from '../lib/track';
import { buildAquarium } from './water-aquarium';
import { buildPool } from './water-pool';
import { buildOpenSea } from './water-sea';
import { waterPatch } from './water-shaders';
import type { FogSpec, Stage, VenueHints } from './water-stage';

export type WaterTheme = 'POOL' | 'AQUARIUM' | 'OPEN_SEA';

const THEMES: readonly WaterTheme[] = ['POOL', 'AQUARIUM', 'OPEN_SEA'];

export function waterTheme(surface: string): WaterTheme | null {
  return THEMES.find((theme) => theme === surface) ?? null;
}

export type WaterVenue = {
  group: THREE.Group;
  textures: THREE.Texture[];
  level: number;
  animate: (time: number) => void;
  update: (time: number, camera?: THREE.Camera) => void;
  fog: { water: FogSpec; air: FogSpec };
  background: { water: string; air: string | null };
  sun: { direction: THREE.Vector3; color: string; intensity: number };
  ambient: { sky: string; ground: string; intensity: number };
  environmentIntensity: number;
  indoor: boolean;
  setSun: (direction: THREE.Vector3) => void;
  patchMaterial: <T extends THREE.Material>(material: T, caustics?: number) => T;
};

type Colors = { track: string; ground: string; infield: string; accent: string; sky: string; fog: string };

function venue(stage: Stage, hints: VenueHints): WaterVenue {
  const uniforms = stage.uniforms;
  const animate = (time: number) => {
    uniforms.uTime.value = time;
  };
  return {
    group: stage.group,
    textures: stage.textures,
    level: stage.look.level,
    animate,
    update: animate,
    ...hints,
    setSun: (direction) => {
      uniforms.uSunDir.value.copy(direction).normalize();
      stage.shaftDirection();
    },
    patchMaterial: (material, caustics = 1) => waterPatch(material, uniforms, { caustics }),
  };
}

export function buildWaterVenue(
  theme: WaterTheme,
  track: TrackPath,
  random: () => number,
  _colors: Colors,
): WaterVenue {
  const built =
    theme === 'POOL'
      ? buildPool(track, random)
      : theme === 'AQUARIUM'
        ? buildAquarium(track, random)
        : buildOpenSea(track, random);
  return venue(built.stage, built.hints);
}
