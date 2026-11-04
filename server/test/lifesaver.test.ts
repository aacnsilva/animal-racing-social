import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lifesaverRef, lifesaverRejection, lifesaverState } from '../src/domain/lifesaver.ts';

const busted = { hasSeason: true, balance: 0, openStake: 0 };

void describe('lifesaver', () => {
  void it('is ready only when the player has lost every point', () => {
    assert.equal(lifesaverState(busted), 'READY');
    assert.equal(lifesaverState({ ...busted, balance: 1 }), 'AFLOAT');
    assert.equal(lifesaverState({ ...busted, openStake: 200 }), 'WAITING_ON_BETS');
    assert.equal(lifesaverState({ ...busted, hasSeason: false }), 'NO_SEASON');
  });

  void it('gives every claim its own ledger ref', () => {
    assert.notEqual(lifesaverRef('1', 0), lifesaverRef('1', 1));
    assert.notEqual(lifesaverRef('1', 0), lifesaverRef('2', 0));
    assert.notEqual(lifesaverRef('1', 0), 'free:1');
  });

  void it('maps every state that is not ready to an error code', () => {
    assert.equal(lifesaverRejection('READY'), null);
    assert.equal(lifesaverRejection('AFLOAT')?.code, 'NOT_BUSTED');
    assert.equal(lifesaverRejection('WAITING_ON_BETS')?.code, 'BETS_STILL_OPEN');
    assert.equal(lifesaverRejection('NO_SEASON')?.code, 'CONFLICT');
  });
});
