import { LANE_COLORS } from '../lib/track';
import type { Species } from '../lib/types';
import type { Habitat } from './tracks';

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

export type AnimalStats = {
  species: Species;
  name: string;
  emoji: string;
  blurb: string;
  habitat: Habitat;
  top: number;
  accel: number;
  handling: number;
  boost: number;
  drain: number;
  regen: number;
  offroad: number;
  bars: { speed: number; accel: number; handling: number; stamina: number };
};

export const ANIMALS: Record<Species, AnimalStats> = {
  HORSE: {
    species: 'HORSE',
    name: 'Horse',
    emoji: '🐴',
    blurb: 'The all-rounder. Fast, steady and always in the fight.',
    habitat: 'TERRAIN',
    top: 29,
    accel: 11,
    handling: 2.0,
    boost: 1.27,
    drain: 0.3,
    regen: 0.085,
    offroad: 0.58,
    bars: { speed: 4, accel: 3, handling: 3, stamina: 3 },
  },
  GIRAFFE: {
    species: 'GIRAFFE',
    name: 'Giraffe',
    emoji: '🦒',
    blurb: 'Huge stride, huge top speed. Needs room to turn.',
    habitat: 'TERRAIN',
    top: 30.4,
    accel: 7.6,
    handling: 1.6,
    boost: 1.24,
    drain: 0.25,
    regen: 0.075,
    offroad: 0.6,
    bars: { speed: 5, accel: 2, handling: 2, stamina: 4 },
  },
  SHARK: {
    species: 'SHARK',
    name: 'Shark',
    emoji: '🦈',
    blurb: 'Explosive launches and a savage boost that burns quickly.',
    habitat: 'AQUATIC',
    top: 28.9,
    accel: 14,
    handling: 1.95,
    boost: 1.35,
    drain: 0.4,
    regen: 0.11,
    offroad: 0.52,
    bars: { speed: 3, accel: 5, handling: 3, stamina: 2 },
  },
  OCTOPUS: {
    species: 'OCTOPUS',
    name: 'Octopus',
    emoji: '🐙',
    blurb: 'Eight legs of grip. Corners like it is on rails.',
    habitat: 'AQUATIC',
    top: 28.3,
    accel: 12.5,
    handling: 2.5,
    boost: 1.27,
    drain: 0.3,
    regen: 0.095,
    offroad: 0.74,
    bars: { speed: 2, accel: 4, handling: 5, stamina: 3 },
  },
};

export const SPECIES_ORDER: Species[] = ['HORSE', 'GIRAFFE', 'SHARK', 'OCTOPUS'];

export function isSpecies(value: unknown): value is Species {
  return SPECIES_ORDER.some((entry) => entry === value);
}

export const SLOT_COLORS = LANE_COLORS;

const BOT_NAMES = [
  'Thunderhoof',
  'Sir Trots',
  'Neckbreaker',
  'Lady Longlegs',
  'Finn Diesel',
  'Jawdropper',
  'Inky',
  'Tentacool Tim',
  'Biscuit',
  'Mango',
  'Captain Splash',
  'Zoomies',
  'Pickles',
  'Nimbus',
  'Rocket Ron',
  'Clementine',
  'Waffles',
  'Dash',
  'Pebble',
  'Turbo Tina',
];

export function mulberry(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type GridEntry = {
  slot: number;
  id: string | null;
  name: string;
  species: Species;
  skill: number;
};

const SKILL: Record<Difficulty, [number, number]> = {
  EASY: [0.84, 0.91],
  MEDIUM: [0.9, 0.96],
  HARD: [0.95, 1.01],
};

export function buildGrid(
  humans: { slot: number; id: string; name: string; species: Species }[],
  bots: number,
  seed: number,
  difficulty: Difficulty,
): GridEntry[] {
  const random = mulberry(seed ^ 0x51ab);
  const grid: GridEntry[] = humans.map((human) => ({ ...human, skill: 1 }));
  const taken = new Set(humans.map((human) => human.slot));
  const names = BOT_NAMES.map((name) => ({ name, order: random() }))
    .toSorted((a, b) => a.order - b.order)
    .map((entry) => entry.name);
  const [low, high] = SKILL[difficulty];
  let added = 0;
  for (let slot = 0; slot < 10 && added < bots; slot++) {
    if (taken.has(slot)) continue;
    grid.push({
      slot,
      id: null,
      name: names[added],
      species: SPECIES_ORDER[Math.floor(random() * SPECIES_ORDER.length)],
      skill: low + (high - low) * random(),
    });
    added += 1;
  }
  return grid.toSorted((a, b) => a.slot - b.slot);
}

export function gridPosition(slot: number): { s: number; lat: number } {
  const row = Math.floor(slot / 2);
  const side = slot % 2 === 0 ? -1 : 1;
  return { s: -(7 + row * 7.5 + (side > 0 ? 3.75 : 0)), lat: side * 3.6 };
}

export function fmtRaceTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '--:--.---';
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function ordinal(place: number): string {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  const unit = place % 10;
  return `${place}${unit === 1 ? 'st' : unit === 2 ? 'nd' : unit === 3 ? 'rd' : 'th'}`;
}
