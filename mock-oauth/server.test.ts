import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { server } from './server.ts';

let base = '';
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const verifier = 'test-verifier-0123456789-abcdefghijklmnopqrstuv';
const challenge = createHash('sha256').update(verifier).digest('base64url');

async function authorize(provider: 'google' | 'github', redirectUri: string): Promise<string> {
  const response = await fetch(`${base}/${provider}/approve`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: `ars-${provider}`, redirect_uri: redirectUri, state: 'xyz', code_challenge: challenge, subject: 'alice', name: 'Alice', email: 'a@example.test', decision: 'allow' }),
  });
  const location = new URL(response.headers.get('location')!);
  assert.equal(location.searchParams.get('state'), 'xyz');
  return location.searchParams.get('code')!;
}

async function token(provider: 'google' | 'github', code: string, redirectUri: string, codeVerifier = verifier) {
  const path = provider === 'google' ? '/google/token' : '/github/login/oauth/access_token';
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: `ars-${provider}`, client_secret: `ars-${provider}-secret`, code_verifier: codeVerifier }),
  });
}

describe('mock oauth', () => {
  it('runs the Google code + PKCE flow', async () => {
    const redirectUri = 'http://localhost:8080/v1/auth/google/callback';
    const exchanged = await (await token('google', await authorize('google', redirectUri), redirectUri)).json() as { access_token: string };
    const profile = await (await fetch(`${base}/google/userinfo`, { headers: { authorization: `Bearer ${exchanged.access_token}` } })).json() as Record<string, unknown>;
    assert.deepEqual([profile.sub, profile.name], ['alice', 'Alice']);
  });

  it('returns numeric GitHub ids', async () => {
    const redirectUri = 'http://localhost:8080/v1/auth/github/callback';
    const exchanged = await (await token('github', await authorize('github', redirectUri), redirectUri)).json() as { access_token: string };
    const profile = await (await fetch(`${base}/github/user`, { headers: { authorization: `Bearer ${exchanged.access_token}` } })).json() as Record<string, unknown>;
    assert.equal(typeof profile.id, 'number');
    assert.equal(profile.login, 'alice');
  });

  it('rejects a wrong PKCE verifier and single-use codes', async () => {
    const redirectUri = 'http://localhost:8080/v1/auth/google/callback';
    const code = await authorize('google', redirectUri);
    assert.equal((await token('google', code, redirectUri, 'wrong-verifier')).status, 400);
    assert.equal((await token('google', code, redirectUri)).status, 400);
  });

  it('records Discord webhook deliveries', async () => {
    const posted = await fetch(`${base}/webhooks/discord`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'RaceOverdue' }) });
    assert.equal(posted.status, 204);
    const received = await (await fetch(`${base}/webhooks/discord`)).json() as { body: { content: string } }[];
    assert.equal(received.at(-1)?.body.content, 'RaceOverdue');
  });
});
