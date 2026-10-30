import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { isAvailable, slotPlan, slotsBetween, validateProgramme, type Programme } from '../src/domain/scheduler.ts';

const programme = JSON.parse(readFileSync(new URL('../../shared/programme.json', import.meta.url), 'utf8')) as Programme;

describe('programme slots', () => {
  it('produces three aligned slots per hour', () => {
    const slots = slotsBetween(new Date('2026-10-30T12:05:00Z'), new Date('2026-10-30T13:00:00Z'), programme);
    assert.deepEqual(slots.map((s) => s.toISOString()), ['2026-10-30T12:20:00.000Z', '2026-10-30T12:40:00.000Z', '2026-10-30T13:00:00.000Z']);
  });

  it('alternates species and follows the class mix', () => {
    const plans = slotsBetween(new Date('2026-10-30T12:00:00Z'), new Date('2026-10-30T13:59:00Z'), programme).map((slot) => slotPlan(slot, programme));
    assert.deepEqual(plans.map((p) => p.raceClass), ['SPRINT', 'STANDARD', 'SPRINT', 'SPRINT', 'STANDARD', 'ENDURANCE']);
    const species = plans.map((p) => p.species);
    for (let i = 1; i < species.length; i++) assert.notEqual(species[i], species[i - 1]);
  });

  it('validates admin programmes', () => {
    assert.equal(validateProgramme(programme).racesPerHour, 3);
    assert.throws(() => validateProgramme({ ...programme, racesPerHour: 0 }));
    assert.throws(() => validateProgramme({ ...programme, speciesRotation: ['ANT'] }));
  });
});

describe('recovery rule', () => {
  const recovery = programme.recoveryMinutes;
  const at = (iso: string) => new Date(iso);

  it('requires max race length plus recovery after a previous race', () => {
    const previous = [{ startAt: at('2026-10-30T12:00:00Z'), raceClass: 'STANDARD' as const }];
    assert.equal(isAvailable(previous, at('2026-10-30T13:39:00Z'), 'SPRINT', recovery), false);
    assert.equal(isAvailable(previous, at('2026-10-30T13:40:00Z'), 'SPRINT', recovery), true);
  });

  it('protects races already booked later', () => {
    const later = [{ startAt: at('2026-10-30T14:00:00Z'), raceClass: 'SPRINT' as const }];
    assert.equal(isAvailable(later, at('2026-10-30T11:50:00Z'), 'ENDURANCE', recovery), true);
    assert.equal(isAvailable(later, at('2026-10-30T11:51:00Z'), 'ENDURANCE', recovery), false);
  });

  it('never double-books concurrent races', () => {
    const same = [{ startAt: at('2026-10-30T12:00:00Z'), raceClass: 'SPRINT' as const }];
    assert.equal(isAvailable(same, at('2026-10-30T12:00:00Z'), 'SPRINT', recovery), false);
  });
});
