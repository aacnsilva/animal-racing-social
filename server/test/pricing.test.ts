import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cashOutAmount, combinedPrice, harvilleProbability, payoutFor, priceFromProbability, tricastPrice } from '../src/domain/pricing.ts';

describe('priceFromProbability', () => {
  it('applies the margin and rounds to two decimals', () => {
    assert.equal(priceFromProbability(0.5, 0.05), 1.9);
    assert.equal(priceFromProbability(0.25, 0.05), 3.81);
  });

  it('clamps to the [1.01, 1000] range', () => {
    assert.equal(priceFromProbability(0.999, 0.05), 1.01);
    assert.equal(priceFromProbability(0, 0.05, 5000), 1000);
  });

  it('floors probabilities at half a run', () => {
    assert.equal(priceFromProbability(0, 0.05, 100), 190.48);
  });
});

describe('harville tricast', () => {
  const win = new Map([['e1', 0.5], ['e2', 0.3], ['e3', 0.2]]);

  it('computes exact-order probabilities that sum to one over all orders', () => {
    const orders = [['e1', 'e2', 'e3'], ['e1', 'e3', 'e2'], ['e2', 'e1', 'e3'], ['e2', 'e3', 'e1'], ['e3', 'e1', 'e2'], ['e3', 'e2', 'e1']];
    const total = orders.reduce((sum, order) => sum + harvilleProbability(win, order), 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
    assert.ok(Math.abs(harvilleProbability(win, ['e1', 'e2', 'e3']) - 0.5 * (0.3 / 0.5) * (0.2 / 0.2)) < 1e-12);
  });

  it('rejects orders with repeated entrants', () => {
    assert.equal(harvilleProbability(win, ['e1', 'e1', 'e2']), 0);
    assert.equal(tricastPrice(win, ['e1', 'e1', 'e2'], 0.05).price, 1000);
  });
});

describe('payouts', () => {
  it('multiplies combo prices', () => {
    assert.equal(combinedPrice([3.1, 1.8]), 5.58);
  });

  it('floors payouts to whole points', () => {
    assert.equal(payoutFor(100, 4.2), 420);
    assert.equal(payoutFor(3, 1.55), 4);
  });

  it('values cash-out from current probabilities minus the margin', () => {
    assert.equal(cashOutAmount(100, [4.2], [0.25], 0.05), 99);
    assert.equal(cashOutAmount(200, [3.1, 1.8], [1, 0.5], 0.05), 530);
  });
});
