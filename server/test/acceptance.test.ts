import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decidePrice } from '../src/domain/acceptance.ts';

describe('decidePrice', () => {
  it('NONE accepts only an unchanged price and locks the accepted price', () => {
    assert.deepEqual(decidePrice('NONE', 4.2, 4.2), { ok: true, lockedPrice: 4.2 });
    assert.deepEqual(decidePrice('NONE', 4.2, 4.5), { ok: false, reason: 'PRICE_CHANGED' });
    assert.deepEqual(decidePrice('NONE', 4.2, 3.9), { ok: false, reason: 'PRICE_CHANGED' });
  });

  it('BETTER accepts equal or longer prices and locks the current price', () => {
    assert.deepEqual(decidePrice('BETTER', 4.2, 4.5), { ok: true, lockedPrice: 4.5 });
    assert.deepEqual(decidePrice('BETTER', 4.2, 4.2), { ok: true, lockedPrice: 4.2 });
    assert.deepEqual(decidePrice('BETTER', 4.2, 4.1), { ok: false, reason: 'PRICE_CHANGED' });
  });

  it('ANY accepts at the current price', () => {
    assert.deepEqual(decidePrice('ANY', 4.2, 2.0), { ok: true, lockedPrice: 2.0 });
  });
});
