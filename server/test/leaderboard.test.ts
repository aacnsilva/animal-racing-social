import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applySettled, boardScore, emptyStats, roi, thresholdCrossings } from '../src/domain/leaderboard.ts';

describe('season stats', () => {
  it('tracks streaks, biggest payout and returns', () => {
    let stats = emptyStats();
    stats = applySettled(stats, { betId: 'b1', outcome: 'WON', stake: 100, returned: 300 });
    stats = applySettled(stats, { betId: 'b2', outcome: 'WON', stake: 100, returned: 150 });
    stats = applySettled(stats, { betId: 'b3', outcome: 'LOST', stake: 100, returned: 0 });
    stats = applySettled(stats, { betId: 'b4', outcome: 'CASHED_OUT', stake: 100, returned: 80 });
    assert.equal(stats.settledBets, 4);
    assert.equal(stats.bestStreak, 2);
    assert.equal(stats.currentStreak, 0);
    assert.equal(stats.biggestPayout, 300);
    assert.equal(stats.biggestPayoutBet, 'b1');
    assert.equal(roi(stats), (530 - 400) / 400);
  });

  it('ranks ROI and streak boards only after 20 settled bets', () => {
    let stats = emptyStats();
    for (let i = 0; i < 19; i++) stats = applySettled(stats, { betId: `b${i}`, outcome: 'WON', stake: 10, returned: 20 });
    assert.equal(boardScore('roi', stats, 0), null);
    assert.equal(boardScore('win-streak', stats, 0), null);
    stats = applySettled(stats, { betId: 'b19', outcome: 'WON', stake: 10, returned: 20 });
    assert.equal(boardScore('roi', stats, 0), 1);
    assert.equal(boardScore('win-streak', stats, 0), 20);
    assert.equal(boardScore('balance', stats, 12345), 12345);
  });

  it('detects top-10 and top-100 crossings', () => {
    assert.deepEqual(thresholdCrossings(150, 50), [{ threshold: 100, entered: true }]);
    assert.deepEqual(thresholdCrossings(11, 3), [{ threshold: 10, entered: true }]);
    assert.deepEqual(thresholdCrossings(5, 120), [{ threshold: 10, entered: false }, { threshold: 100, entered: false }]);
    assert.deepEqual(thresholdCrossings(null, 1), [{ threshold: 10, entered: true }, { threshold: 100, entered: true }]);
    assert.deepEqual(thresholdCrossings(40, 60), []);
  });
});
