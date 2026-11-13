import * as THREE from 'three';
import {
  anemone,
  blob,
  branchCoral,
  domeCoral,
  fanCoral,
  fishGeometry,
  grassGeometry,
  instanced,
  kelpGeometry,
  rockPaint,
  school,
  tableCoral,
  tubeSponge,
  type Placement,
  type SchoolSpec,
} from './water-props';
import type { Stage } from './water-stage';

export type ReefMaterials = {
  rock: THREE.MeshStandardMaterial;
  coral: THREE.MeshStandardMaterial;
  soft: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  kelp: THREE.MeshStandardMaterial;
  fish: THREE.MeshStandardMaterial;
  giant: THREE.MeshStandardMaterial;
};

export function reefMaterials(stage: Stage): ReefMaterials {
  return {
    rock: stage.standard({ vertexColors: true, roughness: 0.95 }, { detail: 0.75, detailScale: 0.9 }),
    coral: stage.standard({ vertexColors: true, roughness: 0.8 }, { detail: 0.35, detailScale: 2.2 }),
    soft: stage.standard({ vertexColors: true, roughness: 0.6 }, { sway: 0.07 }),
    grass: stage.standard({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }, { sway: 0.09 }),
    kelp: stage.standard({ vertexColors: true, roughness: 0.65, side: THREE.DoubleSide }, { sway: 0.009 }),
    fish: stage.standard({ vertexColors: true, roughness: 0.4, metalness: 0.25 }, { swim: true, caustics: 0.6 }),
    giant: stage.standard({ vertexColors: true, roughness: 0.7 }, { swim: true, wiggle: 0.03, caustics: 0.5 }),
  };
}

const CORAL_COLORS = ['#e8735a', '#f2a65a', '#d96ba0', '#b784d6', '#f0d27a', '#7fc8a9', '#e85d75', '#f4efe2'];
const ROCK_COLORS = ['#a9a69c', '#8f877a', '#b3ab99', '#7f8482'];

function palette(colors: string[], random: () => number, spread: number): (i: number, out: THREE.Color) => void {
  return (_i, out) => {
    out.set(colors[Math.floor(random() * colors.length)]).multiplyScalar(1 - spread / 2 + random() * spread);
  };
}

function split(placements: Placement[], kinds: number): Placement[][] {
  const out: Placement[][] = Array.from({ length: kinds }, () => []);
  placements.forEach((placement, i) => out[i % kinds].push(placement));
  return out;
}

export function addRocks(
  stage: Stage,
  materials: ReefMaterials,
  placements: Placement[],
  size: number,
  moss: string,
): void {
  const groups = split(placements, 3);
  groups.forEach((list, k) => {
    if (!list.length) return;
    const geometry = blob(2, 100 + k * 31, 0.3, 0.55 + k * 0.12, rockPaint('#ffffff', moss, 7 + k));
    for (const placement of list) {
      placement.scale *= size;
      placement.sy = 0.8 + stage.random() * 0.6;
    }
    stage.add(stage.shade(instanced(geometry, materials.rock, list, palette(ROCK_COLORS, stage.random, 0.3)), 'both'));
  });
}

export function addCorals(stage: Stage, materials: ReefMaterials, placements: Placement[], size: number): void {
  const random = stage.random;
  const kinds = [branchCoral(random), fanCoral(random), domeCoral(17), tableCoral(), tubeSponge(random)];
  const scales = [1.1, 1.0, 0.9, 1.0, 1.1];
  split(placements, kinds.length).forEach((list, k) => {
    if (!list.length) {
      kinds[k].dispose();
      return;
    }
    for (const placement of list) placement.scale *= size * scales[k];
    stage.add(stage.shade(instanced(kinds[k], materials.coral, list, palette(CORAL_COLORS, random, 0.35)), 'both'));
  });
}

export function addAnemones(stage: Stage, materials: ReefMaterials, placements: Placement[]): void {
  if (!placements.length) return;
  const colors = ['#f08a5d', '#e85d9a', '#c9f0a8', '#f6d55c', '#b392f0'];
  stage.add(
    stage.shade(
      instanced(anemone(stage.random), materials.soft, placements, palette(colors, stage.random, 0.3)),
      'receive',
    ),
  );
}

export function addGrass(stage: Stage, materials: ReefMaterials, placements: Placement[], height: number): void {
  if (!placements.length) return;
  const geometry = grassGeometry(stage.random, 16, height, '#1d4a22', '#7fb04a');
  stage.add(
    stage.shade(
      instanced(geometry, materials.grass, placements, (_i, out) => {
        out.setRGB(0.75 + stage.random() * 0.5, 0.8 + stage.random() * 0.4, 0.7 + stage.random() * 0.4);
      }),
      'receive',
    ),
  );
}

export function addKelp(stage: Stage, materials: ReefMaterials, placements: Placement[], height: number): void {
  if (!placements.length) return;
  split(placements, 2).forEach((list) => {
    if (!list.length) return;
    stage.add(
      stage.shade(
        instanced(kelpGeometry(stage.random, height), materials.kelp, list, (_i, out) => {
          out.setRGB(0.75 + stage.random() * 0.5, 0.8 + stage.random() * 0.4, 0.6 + stage.random() * 0.5);
        }),
        'receive',
      ),
    );
  });
}

export function addFish(
  stage: Stage,
  materials: ReefMaterials,
  look: { back: string; belly: string; stripe: string | null },
  spec: SchoolSpec,
): void {
  if (!spec.centres.length) return;
  stage.add(school(fishGeometry(look.back, look.belly, look.stripe), materials.fish, stage.random, spec));
}
