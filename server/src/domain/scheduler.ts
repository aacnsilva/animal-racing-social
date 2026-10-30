import { MINUTE_MS } from '../lib/time.ts';

export type RaceClass = 'SPRINT' | 'STANDARD' | 'ENDURANCE';
export type Species = 'HORSE' | 'GIRAFFE';

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

export function isAvailable(bookings: readonly Booking[], startAt: Date, raceClass: RaceClass, recovery: Record<RaceClass, number>): boolean {
  const busyMs = (cls: RaceClass) => (MAX_RACE_MINUTES + (recovery[cls] ?? 90)) * MINUTE_MS;
  return bookings.every((booking) => {
    if (booking.startAt.getTime() <= startAt.getTime()) return booking.startAt.getTime() + busyMs(booking.raceClass) <= startAt.getTime();
    return startAt.getTime() + busyMs(raceClass) <= booking.startAt.getTime();
  });
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function validateProgramme(raw: unknown): Programme {
  const value = raw as Programme;
  const classes: RaceClass[] = ['SPRINT', 'STANDARD', 'ENDURANCE'];
  if (!value || typeof value !== 'object') throw new Error('programme must be an object');
  if (!Number.isInteger(value.racesPerHour) || value.racesPerHour < 1 || value.racesPerHour > 12) throw new Error('racesPerHour must be 1..12');
  if (!Array.isArray(value.classMix?.slots) || value.classMix.slots.length === 0) throw new Error('classMix.slots must be a non-empty array');
  for (const slot of value.classMix.slots) {
    if (!Array.isArray(slot) || slot.length === 0 || slot.some((cls) => !classes.includes(cls))) throw new Error('classMix.slots entries must list race classes');
  }
  if (!Array.isArray(value.speciesRotation) || value.speciesRotation.length === 0 || value.speciesRotation.some((s) => s !== 'HORSE' && s !== 'GIRAFFE')) {
    throw new Error('speciesRotation must list HORSE/GIRAFFE');
  }
  if (!Number.isInteger(value.horizonHours) || value.horizonHours < 1 || value.horizonHours > 48) throw new Error('horizonHours must be 1..48');
  for (const cls of classes) {
    if (!Number.isInteger(value.recoveryMinutes?.[cls]) || value.recoveryMinutes[cls] < 0) throw new Error(`recoveryMinutes.${cls} must be a non-negative integer`);
  }
  return value;
}
