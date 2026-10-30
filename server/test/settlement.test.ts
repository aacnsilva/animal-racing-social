import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { comboViolation } from '../src/domain/combo.ts';
import { foldCombo, singleOutcome } from '../src/domain/settlement.ts';

describe('single settlement', () => {
  it('pays stake × locked price on a win and refunds a void', () => {
    assert.deepEqual(singleOutcome(100, 4.2, 'WON'), { status: 'WON', payout: 420 });
    assert.deepEqual(singleOutcome(100, 4.2, 'LOST'), { status: 'LOST', payout: 0 });
    assert.deepEqual(singleOutcome(100, 4.2, 'VOID'), { status: 'VOID', payout: 100 });
  });
});

describe('combo folding', () => {
  it('loses as soon as any leg loses', () => {
    assert.deepEqual(foldCombo(200, [{ status: 'LOST', lockedPrice: 3 }, { status: 'OPEN', lockedPrice: 2 }]), { status: 'LOST', payout: 0, effectivePrice: 0 });
  });

  it('waits while legs are open', () => {
    assert.deepEqual(foldCombo(200, [{ status: 'WON', lockedPrice: 3 }, { status: 'OPEN', lockedPrice: 2 }]), { status: 'OPEN' });
  });

  it('pays the product of winning legs and treats void legs as 1.00', () => {
    assert.deepEqual(foldCombo(200, [{ status: 'WON', lockedPrice: 3.1 }, { status: 'WON', lockedPrice: 1.8 }]), { status: 'WON', payout: 1116, effectivePrice: 5.58 });
    assert.deepEqual(foldCombo(200, [{ status: 'WON', lockedPrice: 3.1 }, { status: 'VOID', lockedPrice: 1.8 }]), { status: 'WON', payout: 620, effectivePrice: 3.1 });
  });

  it('refunds when every leg is void', () => {
    assert.deepEqual(foldCombo(200, [{ status: 'VOID', lockedPrice: 3.1 }, { status: 'VOID', lockedPrice: 1.8 }]), { status: 'VOID', payout: 200, effectivePrice: 1 });
  });
});

describe('combo rules', () => {
  const leg = (raceId: string, seasonId = 's1') => ({ marketId: `m${raceId}`, raceId, seasonId });

  it('requires 2..max legs on different races in one season', () => {
    assert.equal(comboViolation([leg('1')], 8), 'INVALID_SELECTION');
    assert.equal(comboViolation([leg('1'), leg('2')], 8), null);
    assert.equal(comboViolation([leg('1'), leg('1')], 8), 'COMBO_SAME_RACE');
    assert.equal(comboViolation([leg('1'), leg('2', 's2')], 8), 'COMBO_CROSS_SEASON');
    assert.equal(comboViolation(Array.from({ length: 9 }, (_, i) => leg(String(i))), 8), 'COMBO_TOO_MANY_LEGS');
  });
});
