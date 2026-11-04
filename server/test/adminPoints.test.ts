import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adminPointsDelta, adminPointsLedgerType, adminPointsNotification } from '../src/domain/adminPoints.ts';

void describe('admin points', () => {
  void it('credits a bonus in full', () => {
    assert.equal(adminPointsDelta('BONUS', 500, 0), 500);
    assert.equal(adminPointsDelta('BONUS', 500, 10_000), 500);
  });

  void it('debits a penalty but never below zero', () => {
    assert.equal(adminPointsDelta('PENALTY', 500, 10_000), -500);
    assert.equal(adminPointsDelta('PENALTY', 500, 200), -200);
    assert.equal(adminPointsDelta('PENALTY', 500, 0), 0);
  });

  void it('maps kinds to ledger and notification types', () => {
    assert.equal(adminPointsLedgerType('BONUS'), 'ADMIN_BONUS');
    assert.equal(adminPointsLedgerType('PENALTY'), 'ADMIN_PENALTY');
    assert.equal(adminPointsNotification('ADMIN_BONUS'), 'POINTS_BONUS');
    assert.equal(adminPointsNotification('ADMIN_PENALTY'), 'POINTS_PENALTY');
    assert.equal(adminPointsNotification('ADMIN_ADJUST'), null);
  });
});
