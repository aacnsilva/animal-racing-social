import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { freeLifesaverRef, lifesaverRejection, lifesaverState } from '../src/domain/lifesaver.ts';

const busted = { hasSeason: true, balance: 0, openStake: 0, freeUsed: 0 };

void describe('lifesaver', () => {
  void it('is ready only when the player has lost every point', () => {
    assert.equal(lifesaverState(busted), 'READY');
    assert.equal(lifesaverState({ ...busted, balance: 1 }), 'AFLOAT');
    assert.equal(lifesaverState({ ...busted, openStake: 200 }), 'WAITING_ON_BETS');
    assert.equal(lifesaverState({ ...busted, hasSeason: false }), 'NO_SEASON');
  });

  void it('allows one free lifesaver per season', () => {
    assert.equal(lifesaverState({ ...busted, freeUsed: 1 }), 'USED');
    assert.equal(lifesaverState({ ...busted, freeUsed: 1, openStake: 50 }), 'USED');
    assert.notEqual(freeLifesaverRef('1'), freeLifesaverRef('2'));
  });

  void it('maps every state that is not ready to an error code', () => {
    assert.equal(lifesaverRejection('READY'), null);
    assert.equal(lifesaverRejection('AFLOAT')?.code, 'NOT_BUSTED');
    assert.equal(lifesaverRejection('WAITING_ON_BETS')?.code, 'BETS_STILL_OPEN');
    assert.equal(lifesaverRejection('USED')?.code, 'LIFESAVER_USED');
    assert.equal(lifesaverRejection('NO_SEASON')?.code, 'CONFLICT');
  });
});
