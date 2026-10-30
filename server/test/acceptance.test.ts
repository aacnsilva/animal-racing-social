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

  it('NONE with a tolerance accepts small moves either way and locks the current price', () => {
    assert.deepEqual(decidePrice('NONE', 4.2, 4.5, 0.1), { ok: true, lockedPrice: 4.5 });
    assert.deepEqual(decidePrice('NONE', 4.2, 3.9, 0.1), { ok: true, lockedPrice: 3.9 });
    assert.deepEqual(decidePrice('NONE', 4.0, 4.4, 0.1), { ok: true, lockedPrice: 4.4 });
    assert.deepEqual(decidePrice('NONE', 4.2, 4.7, 0.1), { ok: false, reason: 'PRICE_CHANGED' });
    assert.deepEqual(decidePrice('NONE', 4.2, 3.7, 0.1), { ok: false, reason: 'PRICE_CHANGED' });
  });

  it('BETTER with a tolerance also accepts small drops', () => {
    assert.deepEqual(decidePrice('BETTER', 4.2, 9.0, 0.1), { ok: true, lockedPrice: 9.0 });
    assert.deepEqual(decidePrice('BETTER', 4.0, 3.6, 0.1), { ok: true, lockedPrice: 3.6 });
    assert.deepEqual(decidePrice('BETTER', 4.0, 3.5, 0.1), { ok: false, reason: 'PRICE_CHANGED' });
  });
});
