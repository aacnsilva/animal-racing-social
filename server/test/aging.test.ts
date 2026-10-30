import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ageFactor, currentStats, formToken, lifeStage, pushForm, randomBase, retirementReason, type SpeciesConfig } from '../src/domain/aging.ts';

const species = JSON.parse(readFileSync(new URL('../../shared/species.json', import.meta.url), 'utf8')) as SpeciesConfig[];
const horse = species.find((s) => s.species === 'HORSE')!;
const giraffe = species.find((s) => s.species === 'GIRAFFE')!;

describe('aging', () => {
  it('rises to a prime peak and declines afterwards', () => {
    assert.ok(ageFactor(horse, 0) < ageFactor(horse, 25));
    assert.equal(ageFactor(horse, 60), 1);
    assert.ok(ageFactor(horse, 130) < ageFactor(horse, 95));
  });

  it('keeps age effects within a few percent so fields stay competitive', () => {
    for (const config of [horse, giraffe]) {
      for (let day = 0; day < config.maxCareerDays; day++) assert.ok(ageFactor(config, day) >= 0.95);
    }
  });

  it('applies a per-animal decline rate only in the veteran stage', () => {
    assert.equal(ageFactor(horse, 50, 1.3), ageFactor(horse, 50, 1));
    assert.ok(ageFactor(horse, 120, 1.3) < ageFactor(horse, 120, 1));
  });

  it('maps career days to life stages per species', () => {
    assert.equal(lifeStage(horse, 10), 'ROOKIE');
    assert.equal(lifeStage(horse, 30), 'PRIME');
    assert.equal(lifeStage(giraffe, 30), 'ROOKIE');
    assert.equal(lifeStage(giraffe, 120), 'VETERAN');
  });

  it('retires at max age or when declining below threshold', () => {
    assert.equal(retirementReason(horse, 140, 0.9), 'AGE');
    assert.equal(retirementReason(horse, 120, 0.95), 'DECLINE');
    assert.equal(retirementReason(horse, 120, 0.97), null);
    assert.equal(retirementReason(horse, 60, 0.5), null);
  });

  it('scales stats and draws bases inside species ranges', () => {
    assert.deepEqual(currentStats({ velocity: 15, stamina: 80, acceleration: 3, consistency: 0.8 }, 0.9), { velocity: 13.5, stamina: 72, acceleration: 2.7, consistency: 0.72 });
    for (let i = 0; i < 50; i++) {
      const base = randomBase(giraffe);
      assert.ok(base.velocity >= 13.6 && base.velocity <= 14.4);
      assert.ok(base.consistency >= 0.6 && base.consistency <= 0.92);
    }
  });

  it('keeps the latest five form tokens', () => {
    assert.equal(formToken('DISQUALIFIED', 8), 'DQ');
    assert.equal(formToken('NON_RUNNER', 8), 'NR');
    assert.deepEqual(pushForm(['1', '2', '3', '4', '5'], 'DQ'), ['DQ', '1', '2', '3', '4']);
  });
});
