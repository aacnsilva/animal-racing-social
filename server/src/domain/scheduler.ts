import { MINUTE_MS } from '../lib/time.ts';
import { isSpecies, SPECIES, type Species } from './species.ts';

export { isSpecies, type Species };

export type RaceClass = 'SPRINT' | 'STANDARD' | 'ENDURANCE';

export type Programme = {
  racesPerHour: number;
  classMix: { slots: RaceClass[][] };
  speciesRotation: Species[];
  horizonHours: number;
  recoveryMinutes: Record<RaceClass, number>;
};

export const MAX_RACE_MINUTES = 10;

export function slotMinutes(programme: Programme): number {
  return Math.max(1, Math.floor(60 / Math.max(1, programme.racesPerHour)));
}

export function slotsBetween(from: Date, to: Date, programme: Programme): Date[] {
  const step = slotMinutes(programme) * MINUTE_MS;
  const slots: Date[] = [];
  for (let t = Math.ceil(from.getTime() / step) * step; t <= to.getTime(); t += step) slots.push(new Date(t));
  return slots;
}

export function slotPlan(start: Date, programme: Programme): { raceClass: RaceClass; species: Species } {
  const minutes = slotMinutes(programme);
  const slotIndex = Math.floor(start.getTime() / (minutes * MINUTE_MS));
  const hourIndex = Math.floor(start.getTime() / (60 * MINUTE_MS));
  const indexInHour = Math.floor(start.getUTCMinutes() / minutes);
  const slots = programme.classMix.slots;
  const options = slots[indexInHour % slots.length] ?? ['STANDARD'];
  const raceClass = options[hourIndex % options.length] ?? 'STANDARD';
  const species = programme.speciesRotation[slotIndex % programme.speciesRotation.length] ?? 'HORSE';
  return { raceClass, species };
}

export type Booking = { startAt: Date; raceClass: RaceClass };

export function isAvailable(
  bookings: readonly Booking[],
  startAt: Date,
  raceClass: RaceClass,
  recovery: Record<RaceClass, number>,
): boolean {
  const busyMs = (cls: RaceClass) => (MAX_RACE_MINUTES + (recovery[cls] ?? 90)) * MINUTE_MS;
  return bookings.every((booking) => {
    if (booking.startAt.getTime() <= startAt.getTime())
      return booking.startAt.getTime() + busyMs(booking.raceClass) <= startAt.getTime();
    return startAt.getTime() + busyMs(raceClass) <= booking.startAt.getTime();
  });
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const RACE_CLASSES: readonly RaceClass[] = ['SPRINT', 'STANDARD', 'ENDURANCE'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

export function isRaceClass(value: unknown): value is RaceClass {
  return RACE_CLASSES.some((cls) => cls === value);
}

function assertProgramme(value: unknown): asserts value is Programme {
  if (!isObject(value)) throw new Error('programme must be an object');
  if (!isInteger(value.racesPerHour) || value.racesPerHour < 1 || value.racesPerHour > 12)
    throw new Error('racesPerHour must be 1..12');
  const slots = isObject(value.classMix) ? value.classMix.slots : undefined;
  if (!Array.isArray(slots) || slots.length === 0) throw new Error('classMix.slots must be a non-empty array');
  for (const slot of slots) {
    if (!Array.isArray(slot) || slot.length === 0 || slot.some((cls) => !isRaceClass(cls)))
      throw new Error('classMix.slots entries must list race classes');
  }
  const rotation = value.speciesRotation;
  if (!Array.isArray(rotation) || rotation.length === 0 || rotation.some((s) => !isSpecies(s))) {
    throw new Error(`speciesRotation must list ${SPECIES.join('/')}`);
  }
  if (!isInteger(value.horizonHours) || value.horizonHours < 1 || value.horizonHours > 48)
    throw new Error('horizonHours must be 1..48');
  const recovery = value.recoveryMinutes;
  for (const cls of RACE_CLASSES) {
    const minutes = isObject(recovery) ? recovery[cls] : undefined;
    if (!isInteger(minutes) || minutes < 0) throw new Error(`recoveryMinutes.${cls} must be a non-negative integer`);
  }
}

export function validateProgramme(raw: unknown): Programme {
  assertProgramme(raw);
  return raw;
}
