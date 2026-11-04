export const SPECIES = ['HORSE', 'GIRAFFE', 'SHARK', 'OCTOPUS'] as const;
export type Species = (typeof SPECIES)[number];

export const HABITATS = ['TERRAIN', 'AQUATIC'] as const;
export type Habitat = (typeof HABITATS)[number];

export const SURFACES_BY_HABITAT = {
  TERRAIN: ['DIRT', 'GRASS', 'SAND', 'MUD', 'ICE'],
  AQUATIC: ['POOL', 'AQUARIUM', 'OPEN_SEA'],
} as const satisfies Record<Habitat, readonly string[]>;
export type Surface = (typeof SURFACES_BY_HABITAT)[Habitat][number];

export const SURFACES: readonly Surface[] = [...SURFACES_BY_HABITAT.TERRAIN, ...SURFACES_BY_HABITAT.AQUATIC];

export const SPECIES_HABITAT: Record<Species, Habitat> = {
  HORSE: 'TERRAIN',
  GIRAFFE: 'TERRAIN',
  SHARK: 'AQUATIC',
  OCTOPUS: 'AQUATIC',
};

export function isSpecies(value: unknown): value is Species {
  return SPECIES.some((species) => species === value);
}

export function surfaceHabitat(surface: string): Habitat | undefined {
  return HABITATS.find((habitat) => SURFACES_BY_HABITAT[habitat].some((known) => known === surface));
}
