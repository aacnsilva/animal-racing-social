import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pkceChallenge, seal, signJwt, unseal, verifyJwt } from '../src/lib/crypto.ts';
import { decodeCursor, encodeCursor, page } from '../src/lib/cursor.ts';
import { ApiError, Router, v } from '../src/lib/http.ts';
import { entrantKey, entrantNumber, idTime, newId, shardOf } from '../src/lib/ids.ts';
import { isEnabled } from '../src/domain/notifications.ts';

describe('ids', () => {
  it('are unique, time-ordered and carry the shard', () => {
    const ids = Array.from({ length: 2000 }, () => newId(37));
    assert.equal(new Set(ids).size, ids.length);
    for (let i = 1; i < ids.length; i++) assert.ok(BigInt(ids[i]!) > BigInt(ids[i - 1]!));
    assert.equal(shardOf(ids[0]!), 37);
    assert.ok(Math.abs(idTime(ids[0]!).getTime() - Date.now()) < 5000);
    assert.ok(BigInt(ids[0]!) < 2n ** 63n);
  });

  it('maps entrant ids', () => {
    assert.equal(entrantKey(3), 'e3');
    assert.equal(entrantNumber('e10'), 10);
    assert.throws(() => entrantNumber('e11'));
  });
});

describe('jwt', () => {
  it('round-trips and rejects tampering or expiry', () => {
    const token = signJwt({ sub: '42', role: 'USER' }, 'secret', 60);
    assert.equal(verifyJwt(token, 'secret')?.sub, '42');
    assert.equal(verifyJwt(token, 'other'), null);
    assert.equal(verifyJwt(`${token.slice(0, -2)}xx`, 'secret'), null);
    assert.equal(verifyJwt(signJwt({ sub: '1' }, 'secret', -10), 'secret'), null);
  });

  it('seals values', () => {
    assert.deepEqual(unseal(seal({ a: 1 }, 's', 60), 's'), { a: 1 });
    assert.equal(unseal(seal({ a: 1 }, 's', 60), 'x'), null);
  });

  it('computes RFC 7636 PKCE challenges', () => {
    assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('router & validation', () => {
  it('matches parameterised routes', () => {
    const router = new Router().get('/v1/races/:raceId', async () => 'race').get('/v1/races/:raceId/result', async () => 'result');
    assert.deepEqual(router.match('GET', '/v1/races/123/result')?.params, { raceId: '123' });
    assert.equal(router.match('POST', '/v1/races/123'), null);
  });

  it('validates input with typed errors', () => {
    assert.equal(v.int('5', 'n', { min: 1 }), 5);
    assert.throws(() => v.int(0, 'n', { min: 1 }), (error: unknown) => error instanceof ApiError && error.code === 'VALIDATION_FAILED');
    assert.equal(v.oneOf('ANY', 'p', ['NONE', 'ANY']), 'ANY');
    assert.throws(() => v.id('12a', 'id'));
  });
});

describe('cursors', () => {
  it('round-trip and paginate', () => {
    assert.deepEqual(decodeCursor(encodeCursor(['2026-10-30T12:00:00Z', '9'])), ['2026-10-30T12:00:00Z', '9']);
    const result = page([1, 2, 3], 2, (n) => [n]);
    assert.deepEqual(result.items, [1, 2]);
    assert.deepEqual(decodeCursor(result.nextCursor), [2]);
    assert.equal(page([1], 2, (n) => [n]).nextCursor, null);
  });
});

describe('notification settings', () => {
  it('defaults on and honours the global switch', () => {
    assert.equal(isEnabled(null, 'BET_WON'), true);
    assert.equal(isEnabled({ enabled: false, types: {} }, 'BET_WON'), false);
    assert.equal(isEnabled({ enabled: true, types: { BET_WON: false } }, 'BET_WON'), false);
    assert.equal(isEnabled({ enabled: true, types: { BET_WON: false } }, 'BET_LOST'), true);
  });
});
