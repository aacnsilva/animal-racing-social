import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  expandTemplate, leaderLaps, legWins, shouldCloseInRunning, suspensionFor, validateTemplate, winningEntrants, type TemplateEntry,
} from '../src/domain/markets.ts';

const templates = JSON.parse(readFileSync(new URL('../../shared/market-templates.json', import.meta.url), 'utf8')) as Record<string, { markets: TemplateEntry[] }>;

describe('market templates', () => {
  it('never offers a leader market on the final lap', () => {
    assert.deepEqual(leaderLaps(7, 2), [2, 4, 6]);
    assert.deepEqual(leaderLaps(8, 2), [2, 4, 6]);
    assert.deepEqual(leaderLaps(3, 2), [2]);
  });

  it('expands the standard template for a 7-lap race', () => {
    const specs = expandTemplate(templates.STANDARD!.markets, 7);
    assert.equal(specs.filter((s) => s.type === 'FINISH_POSITION').length, 3);
    assert.deepEqual(specs.filter((s) => s.type === 'LEADER_AT_LAP').map((s) => s.params.lap), [2, 4, 6]);
    const win = specs.find((s) => s.type === 'FINISH_POSITION' && s.params.position === 1)!;
    assert.equal(win.closesAtLap, 7);
    assert.equal(win.opensAt, 'OPEN');
    assert.ok(specs.find((s) => s.type === 'TRICAST')!.closesAtLock);
  });

  it('omits leader markets for sprints', () => {
    assert.equal(expandTemplate(templates.SPRINT!.markets, 4).some((s) => s.type === 'LEADER_AT_LAP'), false);
  });

  it('validates admin templates', () => {
    assert.throws(() => validateTemplate([{ type: 'FINISH_POSITION', params: { position: 4 } }]));
    assert.throws(() => validateTemplate([]));
    assert.equal(validateTemplate(templates.ENDURANCE!.markets).length, 6);
  });
});

describe('in-running rules', () => {
  const entrants = [
    { id: 'e1', dist: 1000, speed: 15, pos: 1, state: 'RUNNING' },
    { id: 'e2', dist: 990, speed: 15, pos: 2, state: 'RUNNING' },
  ];

  it('closes position markets when the leader starts the closing lap', () => {
    const market = { type: 'FINISH_POSITION' as const, closesAtLap: 4, ticksBeforeCheckpoint: null };
    assert.equal(shouldCloseInRunning(market, { lap: 3, entrants }, 500, 500), false);
    assert.equal(shouldCloseInRunning(market, { lap: 4, entrants }, 500, 500), true);
  });

  it('closes leader markets a few ticks before the checkpoint', () => {
    const market = { type: 'LEADER_AT_LAP' as const, closesAtLap: 2, ticksBeforeCheckpoint: 6 };
    assert.equal(shouldCloseInRunning(market, { lap: 2, entrants: [{ ...entrants[0]!, dist: 900 }] }, 500, 500), false);
    assert.equal(shouldCloseInRunning(market, { lap: 2, entrants: [{ ...entrants[0]!, dist: 960 }] }, 500, 500), true);
    assert.equal(shouldCloseInRunning(market, { lap: 3, entrants: [{ ...entrants[0]!, dist: 1001 }] }, 500, 500), true);
  });

  it('suspends on incidents and top-three overtakes only', () => {
    const positions = new Map([['e1', 1], ['e5', 5]]);
    assert.deepEqual(suspensionFor([{ type: 'STUMBLE', id: 'e5' }], positions), { reason: 'INCIDENT', ticks: 4 });
    assert.deepEqual(suspensionFor([{ type: 'OVERTAKE', a: 'e1', id: undefined }], positions), { reason: 'INCIDENT', ticks: 2 });
    assert.equal(suspensionFor([{ type: 'OVERTAKE', a: 'e5' }], positions), null);
    assert.equal(suspensionFor([{ type: 'LAP', id: 'e1' }], positions), null);
  });
});

describe('resulting', () => {
  const order = ['e3', 'e1', 'e5', 'e2'];
  const leaders = new Map([[2, 'e1']]);

  it('derives winners per market type', () => {
    assert.deepEqual(winningEntrants('FINISH_POSITION', { position: 2 }, order, leaders), ['e1']);
    assert.deepEqual(winningEntrants('TOP_N', { n: 3 }, order, leaders), ['e3', 'e1', 'e5']);
    assert.deepEqual(winningEntrants('LEADER_AT_LAP', { lap: 2 }, order, leaders), ['e1']);
    assert.deepEqual(winningEntrants('LEADER_AT_LAP', { lap: 4 }, order, leaders), []);
  });

  it('settles tricast legs on the exact official order', () => {
    assert.equal(legWins('TRICAST', { order: ['e3', 'e1', 'e5'] }, [], order), true);
    assert.equal(legWins('TRICAST', { order: ['e1', 'e3', 'e5'] }, [], order), false);
    assert.equal(legWins('TOP_N', { entrantId: 'e5' }, ['e3', 'e1', 'e5'], order), true);
    assert.equal(legWins('FINISH_POSITION', { entrantId: 'e2' }, ['e3'], order), false);
  });
});
