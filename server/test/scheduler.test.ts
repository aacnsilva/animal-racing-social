import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { isAvailable, slotPlan, slotsBetween, validateProgramme, type Programme } from '../src/domain/scheduler.ts';
import { SPECIES_HABITAT, surfaceHabitat } from '../src/domain/species.ts';

const programme: Programme = JSON.parse(readFileSync(new URL('../../shared/programme.json', import.meta.url), 'utf8'));

void describe('programme slots', () => {
  void it('produces six aligned slots per hour', () => {
    const slots = slotsBetween(new Date('2026-10-30T12:05:00Z'), new Date('2026-10-30T13:00:00Z'), programme);
    assert.deepEqual(
      slots.map((s) => s.toISOString()),
      [
        '2026-10-30T12:10:00.000Z',
        '2026-10-30T12:20:00.000Z',
        '2026-10-30T12:30:00.000Z',
        '2026-10-30T12:40:00.000Z',
        '2026-10-30T12:50:00.000Z',
        '2026-10-30T13:00:00.000Z',
      ],
    );
  });

  void it('alternates terrain and aquatic species and follows the class mix', () => {
    const plans = slotsBetween(new Date('2026-10-30T12:00:00Z'), new Date('2026-10-30T13:59:00Z'), programme).map(
      (slot) => slotPlan(slot, programme),
    );
    assert.deepEqual(
      plans.map((p) => p.raceClass),
      [
        'SPRINT',
        'STANDARD',
        'SPRINT',
        'SPRINT',
        'STANDARD',
        'SPRINT',
        'SPRINT',
        'STANDARD',
        'ENDURANCE',
        'SPRINT',
        'STANDARD',
        'ENDURANCE',
      ],
    );
    const habitats = plans.map((p) => SPECIES_HABITAT[p.species]);
    for (let i = 1; i < habitats.length; i++) assert.notEqual(habitats[i], habitats[i - 1]);
    assert.deepEqual(new Set(plans.map((p) => p.species)), new Set(['HORSE', 'GIRAFFE', 'SHARK', 'OCTOPUS']));
  });

  void it('pairs every species with a habitat that has venues for every class', () => {
    const venues: { class: string; surface: string; habitat: string }[] = JSON.parse(
      readFileSync(new URL('../../shared/venues.json', import.meta.url), 'utf8'),
    );
    for (const venue of venues) assert.equal(surfaceHabitat(venue.surface), venue.habitat, venue.surface);
    for (const species of programme.speciesRotation) {
      for (const raceClass of ['SPRINT', 'STANDARD', 'ENDURANCE']) {
        assert.ok(
          venues.some((venue) => venue.class === raceClass && venue.habitat === SPECIES_HABITAT[species]),
          `${species} has no ${raceClass} venue`,
        );
      }
    }
  });

  void it('validates admin programmes', () => {
    assert.equal(validateProgramme(programme).racesPerHour, 6);
    assert.throws(() => validateProgramme({ ...programme, racesPerHour: 0 }));
    assert.throws(() => validateProgramme({ ...programme, speciesRotation: ['ANT'] }));
  });
});

const at = (iso: string) => new Date(iso);

void describe('recovery rule', () => {
  const recovery = programme.recoveryMinutes;

  void it('requires max race length plus recovery after a previous race', () => {
    const previous = [{ startAt: at('2026-10-30T12:00:00Z'), raceClass: 'STANDARD' as const }];
    assert.equal(isAvailable(previous, at('2026-10-30T13:39:00Z'), 'SPRINT', recovery), false);
    assert.equal(isAvailable(previous, at('2026-10-30T13:40:00Z'), 'SPRINT', recovery), true);
  });

  void it('protects races already booked later', () => {
    const later = [{ startAt: at('2026-10-30T14:00:00Z'), raceClass: 'SPRINT' as const }];
    assert.equal(isAvailable(later, at('2026-10-30T11:50:00Z'), 'ENDURANCE', recovery), true);
    assert.equal(isAvailable(later, at('2026-10-30T11:51:00Z'), 'ENDURANCE', recovery), false);
  });

  void it('never double-books concurrent races', () => {
    const same = [{ startAt: at('2026-10-30T12:00:00Z'), raceClass: 'SPRINT' as const }];
    assert.equal(isAvailable(same, at('2026-10-30T12:00:00Z'), 'SPRINT', recovery), false);
  });
});
