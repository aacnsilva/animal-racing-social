import type { Species } from '../lib/types';
import { buildGiraffe } from './creatures/giraffe';
import { buildHorse } from './creatures/horse';
import { buildOctopus } from './creatures/octopus';
import type { AnimalRig } from './creatures/rig';
import { buildShark } from './creatures/shark';

export type { AnimalRig };

const BUILDERS: Record<Species, (laneHex: string) => AnimalRig> = {
  HORSE: buildHorse,
  GIRAFFE: buildGiraffe,
  SHARK: buildShark,
  OCTOPUS: buildOctopus,
};

export function buildAnimal(species: Species, laneHex: string): AnimalRig {
  return (BUILDERS[species] ?? buildHorse)(laneHex);
}
