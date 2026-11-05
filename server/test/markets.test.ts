import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  expandTemplate,
  leaderLaps,
  legWins,
  shouldCloseInRunning,
  suspensionFor,
  validateTemplate,
  winningEntrants,
  type TemplateEntry,
} from '../src/domain/markets.ts';

const templates: Record<string, { markets: TemplateEntry[] }> = JSON.parse(
  readFileSync(new URL('../../shared/market-templates.json', import.meta.url), 'utf8'),
);

function closing(raceClass: string, laps: number) {
  return expandTemplate(templates[raceClass].markets, laps)
    .filter((s) => s.type !== 'TRICAST' && s.type !== 'LEADER_AT_LAP')
    .map((s) => [s.type, s.closesAtLap, s.closesAtLock]);
}

function leaderSpecs(raceClass: string, laps: number) {
  return expandTemplate(templates[raceClass].markets, laps)
    .filter((s) => s.type === 'LEADER_AT_LAP')
    .map((s) => [s.params.lap, s.opensAt, s.closesAtLap, s.closesAtLock]);
}

const preRace = (type: string) => [type, null, true];
const atLap = (type: string, lap: number) => [type, lap, false];

void describe('market templates', () => {
  void it('never offers a leader market on the final lap', () => {
    assert.deepEqual(leaderLaps(7, 2), [2, 4, 6]);
    assert.deepEqual(leaderLaps(8, 2), [2, 4, 6]);
    assert.deepEqual(leaderLaps(3, 2), [2]);
  });

  void it('expands the standard template for a 7-lap race', () => {
    const specs = expandTemplate(templates.STANDARD.markets, 7);
    assert.equal(specs.filter((s) => s.type === 'FINISH_POSITION').length, 3);
    assert.deepEqual(
      specs.filter((s) => s.type === 'LEADER_AT_LAP').map((s) => s.params.lap),
      [2, 4, 6],
    );
    const win = specs.find((s) => s.type === 'FINISH_POSITION' && s.params.position === 1)!;
    assert.equal(win.closesAtLap, 2);
    assert.equal(win.opensAt, 'OPEN');
    assert.ok(specs.find((s) => s.type === 'TRICAST')!.closesAtLock);
  });

  void it('closes finish markets one lap before half distance, pre-race only for sprints', () => {
    const against = [preRace('AGAINST_FINISH_POSITION'), preRace('AGAINST_TOP_N')];
    assert.deepEqual(closing('SPRINT', 3), [
      preRace('FINISH_POSITION'),
      preRace('FINISH_POSITION'),
      preRace('FINISH_POSITION'),
      preRace('TOP_N'),
      ...against,
    ]);
    assert.deepEqual(closing('STANDARD', 8), [
      atLap('FINISH_POSITION', 3),
      atLap('FINISH_POSITION', 3),
      atLap('FINISH_POSITION', 3),
      atLap('TOP_N', 3),
      ...against,
    ]);
    assert.deepEqual(closing('ENDURANCE', 12), [
      atLap('FINISH_POSITION', 5),
      atLap('FINISH_POSITION', 5),
      atLap('FINISH_POSITION', 5),
      atLap('TOP_N', 5),
      ...against,
    ]);
    const short = expandTemplate([{ type: 'TOP_N', params: { n: 3 }, closes: { lapsBeforeHalf: 1 } }], 5)[0];
    assert.deepEqual([short.closesAtLap, short.closesAtLock, short.closesRule.at], [null, true, 'LOCK']);
    const locked = expandTemplate([{ type: 'AGAINST_TOP_N', params: { n: 3 }, closes: { at: 'LOCK' } }], 8)[0];
    assert.deepEqual([locked.closesAtLap, locked.closesAtLock], [null, true]);
    assert.throws(() => validateTemplate([{ type: 'TOP_N', params: { n: 3 }, closes: { lapsBeforeHalf: -1 } }]));
  });

  void it('still accepts the older lapsBeforeEnd and atLap cutoffs', () => {
    assert.equal(
      expandTemplate([{ type: 'TOP_N', params: { n: 3 }, closes: { lapsBeforeEnd: 9 } }], 3)[0].closesAtLap,
      1,
    );
    assert.equal(expandTemplate([{ type: 'TOP_N', params: { n: 3 }, closes: { atLap: 'last' } }], 4)[0].closesAtLap, 4);
    assert.throws(() => validateTemplate([{ type: 'TOP_N', params: { n: 3 }, closes: { lapsBeforeEnd: -1 } }]));
  });

  void it('closes leader markets laps before their checkpoint, pre-race only when that is the start', () => {
    assert.deepEqual(leaderSpecs('STANDARD', 7), [
      [2, 'OPEN', null, true],
      [4, 'OPEN', 3, false],
      [6, 'OPEN', 5, false],
    ]);
    assert.deepEqual(leaderSpecs('ENDURANCE', 12).slice(0, 3), [
      [2, 'OPEN', null, true],
      [4, 'OPEN', 2, false],
      [6, 'OPEN', 4, false],
    ]);
    const legacy = expandTemplate(
      [{ type: 'LEADER_AT_LAP', every: 2, opens: { at: 'START' }, closes: { ticksBeforeCheckpoint: 6 } }],
      7,
    )[0];
    assert.equal(legacy.closesAtLap, 2);
    assert.equal(legacy.ticksBeforeCheckpoint, 6);
    assert.throws(() => validateTemplate([{ type: 'LEADER_AT_LAP', every: 2, closes: { lapsBeforeCheckpoint: 0 } }]));
  });

  void it('omits leader markets for sprints', () => {
    assert.equal(
      expandTemplate(templates.SPRINT.markets, 4).some((s) => s.type === 'LEADER_AT_LAP'),
      false,
    );
  });

  void it('validates admin templates', () => {
    assert.throws(() => validateTemplate([{ type: 'FINISH_POSITION', params: { position: 4 } }]));
    assert.throws(() => validateTemplate([]));
    assert.equal(validateTemplate(templates.ENDURANCE.markets).length, 8);
    for (const template of Object.values(templates))
      assert.deepEqual(
        template.markets.filter((entry) => entry.type.startsWith('AGAINST_')).map((entry) => entry.type),
        ['AGAINST_FINISH_POSITION', 'AGAINST_TOP_N'],
      );
  });
});

void describe('in-running rules', () => {
  const entrants = [
    { id: 'e1', dist: 1000, speed: 15, pos: 1, state: 'RUNNING' },
    { id: 'e2', dist: 990, speed: 15, pos: 2, state: 'RUNNING' },
  ];

  void it('closes position markets when the leader starts the closing lap', () => {
    const market = { type: 'FINISH_POSITION' as const, closesAtLap: 4, ticksBeforeCheckpoint: null };
    assert.equal(shouldCloseInRunning(market, { lap: 3, entrants }, 500, 500), false);
    assert.equal(shouldCloseInRunning(market, { lap: 4, entrants }, 500, 500), true);
  });

  void it('closes leader markets a few ticks before the checkpoint', () => {
    const market = { type: 'LEADER_AT_LAP' as const, closesAtLap: 2, ticksBeforeCheckpoint: 6 };
    assert.equal(shouldCloseInRunning(market, { lap: 2, entrants: [{ ...entrants[0], dist: 900 }] }, 500, 500), false);
    assert.equal(shouldCloseInRunning(market, { lap: 2, entrants: [{ ...entrants[0], dist: 960 }] }, 500, 500), true);
    assert.equal(shouldCloseInRunning(market, { lap: 3, entrants: [{ ...entrants[0], dist: 1001 }] }, 500, 500), true);
  });

  void it('closes lap-based leader markets when the leader starts the closing lap', () => {
    const market = { type: 'LEADER_AT_LAP' as const, closesAtLap: 3, ticksBeforeCheckpoint: null };
    assert.equal(shouldCloseInRunning(market, { lap: 2, entrants: [{ ...entrants[0], dist: 990 }] }, 500, 500), false);
    assert.equal(shouldCloseInRunning(market, { lap: 3, entrants: [{ ...entrants[0], dist: 1001 }] }, 500, 500), true);
  });

  void it('suspends on incidents and top-three overtakes only', () => {
    const positions = new Map([
      ['e1', 1],
      ['e5', 5],
    ]);
    assert.deepEqual(suspensionFor([{ type: 'STUMBLE', id: 'e5' }], positions), { reason: 'INCIDENT', ticks: 4 });
    assert.deepEqual(suspensionFor([{ type: 'OVERTAKE', a: 'e1', id: undefined }], positions), {
      reason: 'INCIDENT',
      ticks: 2,
    });
    assert.equal(suspensionFor([{ type: 'OVERTAKE', a: 'e5' }], positions), null);
    assert.equal(suspensionFor([{ type: 'LAP', id: 'e1' }], positions), null);
  });
});

void describe('resulting', () => {
  const order = ['e3', 'e1', 'e5', 'e2'];
  const leaders = new Map([[2, 'e1']]);

  void it('derives winners per market type', () => {
    assert.deepEqual(winningEntrants('FINISH_POSITION', { position: 2 }, order, leaders), ['e1']);
    assert.deepEqual(winningEntrants('TOP_N', { n: 3 }, order, leaders), ['e3', 'e1', 'e5']);
    assert.deepEqual(winningEntrants('LEADER_AT_LAP', { lap: 2 }, order, leaders), ['e1']);
    assert.deepEqual(winningEntrants('LEADER_AT_LAP', { lap: 4 }, order, leaders), []);
  });

  void it('wins against markets for every entrant outside the target, including non-finishers', () => {
    const field = ['e1', 'e2', 'e3', 'e4', 'e5'];
    assert.deepEqual(winningEntrants('AGAINST_FINISH_POSITION', { position: 1 }, order, leaders, field), [
      'e1',
      'e2',
      'e4',
      'e5',
    ]);
    assert.deepEqual(winningEntrants('AGAINST_TOP_N', { n: 3 }, order, leaders, field), ['e2', 'e4']);
    assert.deepEqual(winningEntrants('AGAINST_FINISH_POSITION', { position: 1 }, [], leaders, field), []);
    assert.equal(legWins('AGAINST_TOP_N', { entrantId: 'e4' }, ['e2', 'e4'], order), true);
    assert.equal(legWins('AGAINST_TOP_N', { entrantId: 'e3' }, ['e2', 'e4'], order), false);
  });

  void it('validates against market params like their underlying market', () => {
    assert.doesNotThrow(() => validateTemplate([{ type: 'AGAINST_FINISH_POSITION', params: { position: 1 } }]));
    assert.throws(() => validateTemplate([{ type: 'AGAINST_FINISH_POSITION', params: { position: 4 } }]));
    assert.throws(() => validateTemplate([{ type: 'AGAINST_TOP_N', params: { n: 1 } }]));
  });

  void it('settles tricast legs on the exact official order', () => {
    assert.equal(legWins('TRICAST', { order: ['e3', 'e1', 'e5'] }, [], order), true);
    assert.equal(legWins('TRICAST', { order: ['e1', 'e3', 'e5'] }, [], order), false);
    assert.equal(legWins('TOP_N', { entrantId: 'e5' }, ['e3', 'e1', 'e5'], order), true);
    assert.equal(legWins('FINISH_POSITION', { entrantId: 'e2' }, ['e3'], order), false);
  });
});
