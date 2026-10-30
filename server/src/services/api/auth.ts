import { env } from '../../lib/config.ts';
import { pkceChallenge, randomToken, seal, sha256, signJwt, unseal } from '../../lib/crypto.ts';
import { many, one, tx, type Queryable } from '../../lib/db.ts';
import { ApiError, noContent, redirect, serializeCookie, v, type Router } from '../../lib/http.ts';
import { newId, newUserId, shardOf } from '../../lib/ids.ts';
import { walletApi } from '../../lib/internal.ts';
import { errorFields, log } from '../../lib/log.ts';
import { activeSeason } from '../../lib/seasons.ts';
import { DAY_MS } from '../../lib/time.ts';
import { jwtSecret, publicUrl, requireUser, secureCookies, userJson, type Deps } from './context.ts';

type ProviderId = 'google' | 'github';
type Provider = { id: ProviderId; clientId: string; clientSecret: string; authorizeUrl: string; tokenUrl: string; userinfoUrl: string; scope: string };

const DEFAULTS: Record<ProviderId, Omit<Provider, 'id' | 'clientId' | 'clientSecret'>> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userinfoUrl: 'https://api.github.com/user',
    scope: 'read:user',
  },
};

export function providers(): Provider[] {
  return (['google', 'github'] as const).flatMap((id) => {
    const prefix = `OAUTH_${id.toUpperCase()}_`;
    const clientId = process.env[`${prefix}CLIENT_ID`];
    if (!clientId) return [];
    return [{
      id,
      clientId,
      clientSecret: env(`${prefix}CLIENT_SECRET`, ''),
      authorizeUrl: env(`${prefix}AUTHORIZE_URL`, DEFAULTS[id].authorizeUrl),
      tokenUrl: env(`${prefix}TOKEN_URL`, DEFAULTS[id].tokenUrl),
      userinfoUrl: env(`${prefix}USERINFO_URL`, DEFAULTS[id].userinfoUrl),
      scope: DEFAULTS[id].scope,
    }];
  });
}

function provider(id: string | undefined): Provider {
  const found = providers().find((p) => p.id === id);
  if (!found) throw new ApiError(404, 'NOT_FOUND', 'Unknown or disabled provider');
  return found;
}

const ACCESS_TTL = 900;
const REFRESH_TTL_DAYS = 30;
const REFRESH_COOKIE = 'ars_refresh';
const OAUTH_COOKIE = 'ars_oauth';

function safeRedirect(target: string | null | undefined): string {
  if (!target || !target.startsWith('/') || target.startsWith('//')) return '/';
  return target;
}

function withParam(path: string, key: string, value: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

const refreshCookie = (token: string) => serializeCookie(REFRESH_COOKIE, token, { path: '/v1', maxAge: REFRESH_TTL_DAYS * 86400, secure: secureCookies() });
const clearRefreshCookie = () => serializeCookie(REFRESH_COOKIE, '', { path: '/v1', maxAge: 0, secure: secureCookies() });

async function issueRefresh(db: Queryable, userId: string, familyId?: string): Promise<string> {
  const token = randomToken(32);
  await db.query(
    `INSERT INTO identity.refresh_tokens (user_id, token_id, token_hash, family_id, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [userId, newId(shardOf(userId)), sha256(token), familyId ?? newId(shardOf(userId)), new Date(Date.now() + REFRESH_TTL_DAYS * DAY_MS)],
  );
  return token;
}

export async function userWithProviders(db: Queryable, userId: string) {
  const user = await one(db, 'SELECT * FROM identity.users WHERE user_id = $1', [userId]);
  if (!user) return null;
  const identities = await many(db, 'SELECT provider FROM identity.user_identities WHERE user_id = $1 ORDER BY provider', [userId]);
  return userJson(user, identities.map((row) => row.provider));
}

type Profile = { subject: string; name: string; email: string | null; avatarUrl: string | null };

async function fetchProfile(p: Provider, code: string, verifier: string): Promise<Profile> {
  const tokenResponse = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${publicUrl()}/v1/auth/${p.id}/callback`,
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const token = await tokenResponse.json() as { access_token?: string; error?: string };
  if (!tokenResponse.ok || !token.access_token) throw new Error(`token exchange failed: ${token.error ?? tokenResponse.status}`);
  const profileResponse = await fetch(p.userinfoUrl, {
    headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/json', 'user-agent': 'animal-racing-social' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!profileResponse.ok) throw new Error(`userinfo failed: ${profileResponse.status}`);
  const profile = await profileResponse.json() as Record<string, any>;
  if (p.id === 'google') {
    return { subject: String(profile.sub), name: profile.name || profile.email || 'Racer', email: profile.email ?? null, avatarUrl: profile.picture ?? null };
  }
  return { subject: String(profile.id), name: profile.name || profile.login || 'Racer', email: profile.email ?? null, avatarUrl: profile.avatar_url ?? null };
}

function isBootstrapAdmin(providerId: string, subject: string): boolean {
  return env('BOOTSTRAP_ADMINS', '').split(',').map((entry) => entry.trim()).filter(Boolean).includes(`${providerId}:${subject}`);
}

export function authRoutes(router: Router, deps: Deps): void {
  router.get('/v1/auth/providers', async () => ({ providers: providers().map((p) => p.id) }));

  router.get('/v1/auth/:provider/start', async (ctx) => {
    const p = provider(ctx.params.provider);
    const linkUserId = ctx.query.get('linkToken') ? unseal<string>(ctx.query.get('linkToken')!, jwtSecret()) : null;
    const state = randomToken(16);
    const verifier = randomToken(32);
    const stored = { state, verifier, provider: p.id, redirect: safeRedirect(ctx.query.get('redirect')), linkUserId };
    const url = new URL(p.authorizeUrl);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: p.clientId,
      redirect_uri: `${publicUrl()}/v1/auth/${p.id}/callback`,
      scope: p.scope,
      state,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: 'S256',
    }).toString();
    return redirect(url.toString(), [serializeCookie(OAUTH_COOKIE, seal(stored, jwtSecret(), 600), { path: '/v1/auth', maxAge: 600, secure: secureCookies() })]);
  });

  router.get('/v1/auth/:provider/callback', async (ctx) => {
    const p = provider(ctx.params.provider);
    const stored = unseal<{ state: string; verifier: string; provider: string; redirect: string; linkUserId: string | null }>(ctx.cookies[OAUTH_COOKIE], jwtSecret());
    const clearOauth = serializeCookie(OAUTH_COOKIE, '', { path: '/v1/auth', maxAge: 0, secure: secureCookies() });
    const fail = (code: string, target = '/') => redirect(withParam(target, 'authError', code), [clearOauth]);
    if (ctx.query.get('error')) return fail('PROVIDER_DENIED', stored?.redirect);
    if (!stored || stored.state !== ctx.query.get('state') || stored.provider !== p.id) return fail('STATE_MISMATCH');
    let profile: Profile;
    try {
      profile = await fetchProfile(p, ctx.query.get('code') ?? '', stored.verifier);
    } catch (error) {
      log.warn('oauth exchange failed', { provider: p.id, ...errorFields(error) });
      return fail('PROVIDER_ERROR', stored.redirect);
    }
    const outcome = await tx(deps.pool, async (client) => {
      const existing = await one(client, 'SELECT user_id FROM identity.user_identities WHERE provider = $1 AND provider_subject = $2', [p.id, profile.subject]);
      let userId: string;
      if (stored.linkUserId) {
        if (existing && existing.user_id !== stored.linkUserId) return { error: 'PROVIDER_ALREADY_LINKED' };
        userId = stored.linkUserId;
        if (!existing) {
          await client.query('INSERT INTO identity.user_identities (provider, provider_subject, user_id, email) VALUES ($1, $2, $3, $4)', [p.id, profile.subject, userId, profile.email]);
        }
      } else if (existing) {
        userId = existing.user_id;
      } else {
        userId = newUserId();
        await client.query('INSERT INTO identity.users (user_id, display_name, avatar_url) VALUES ($1, $2, $3)', [userId, profile.name.slice(0, 40), profile.avatarUrl]);
        await client.query('INSERT INTO identity.user_identities (provider, provider_subject, user_id, email) VALUES ($1, $2, $3, $4)', [p.id, profile.subject, userId, profile.email]);
      }
      if (isBootstrapAdmin(p.id, profile.subject)) await client.query(`UPDATE identity.users SET role = 'ADMIN' WHERE user_id = $1`, [userId]);
      const user = await one(client, 'SELECT banned_at FROM identity.users WHERE user_id = $1', [userId]);
      if (user?.banned_at) return { error: 'BANNED' };
      return { userId, token: await issueRefresh(client, userId) };
    });
    if ('error' in outcome) return fail(outcome.error!, stored.redirect);
    const season = await activeSeason(deps.pool);
    if (season) walletApi.ensure(outcome.userId, season.season_id).catch((error) => log.warn('wallet ensure failed', errorFields(error)));
    return redirect(stored.redirect, [refreshCookie(outcome.token), clearOauth]);
  });

  router.post('/v1/auth/refresh', async (ctx) => {
    const token = ctx.cookies[REFRESH_COOKIE];
    if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'No session');
    const result = await tx(deps.pool, async (client) => {
      const row = await one(client, 'SELECT * FROM identity.refresh_tokens WHERE token_hash = $1 FOR UPDATE', [sha256(token)]);
      if (!row || row.expires_at < new Date()) return { error: 'UNAUTHORIZED' as const };
      if (row.revoked_at) {
        if (Date.now() - row.revoked_at.getTime() < 30_000) return { userId: row.user_id as string, cookie: null };
        await client.query('UPDATE identity.refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id]);
        log.warn('refresh token reuse detected', { userId: row.user_id });
        return { error: 'UNAUTHORIZED' as const };
      }
      await client.query('UPDATE identity.refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND token_id = $2', [row.user_id, row.token_id]);
      return { userId: row.user_id as string, cookie: refreshCookie(await issueRefresh(client, row.user_id, row.family_id)) };
    });
    if ('error' in result) {
      ctx.setCookies.push(clearRefreshCookie());
      throw new ApiError(401, 'UNAUTHORIZED', 'Session expired');
    }
    const user = await userWithProviders(deps.pool, result.userId);
    const banned = await one(deps.pool, 'SELECT banned_at FROM identity.users WHERE user_id = $1', [result.userId]);
    if (!user || banned?.banned_at) {
      ctx.setCookies.push(clearRefreshCookie());
      throw new ApiError(401, banned?.banned_at ? 'BANNED' : 'UNAUTHORIZED', 'Session not allowed');
    }
    if (result.cookie) ctx.setCookies.push(result.cookie);
    return { accessToken: signJwt({ sub: user.userId, role: user.role }, jwtSecret(), ACCESS_TTL), expiresIn: ACCESS_TTL, user };
  });

  router.post('/v1/auth/logout', async (ctx) => {
    const token = ctx.cookies[REFRESH_COOKIE];
    if (token) {
      const row = await one(deps.pool, 'SELECT family_id FROM identity.refresh_tokens WHERE token_hash = $1', [sha256(token)]);
      if (row) await deps.pool.query('UPDATE identity.refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id]);
    }
    return noContent({ 'set-cookie': [clearRefreshCookie()] });
  });

  router.get('/v1/me', async (ctx) => {
    const user = await userWithProviders(deps.pool, requireUser(ctx).userId);
    if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Unknown user');
    return user;
  });

  router.patch('/v1/me', async (ctx) => {
    const { userId } = requireUser(ctx);
    const body = await ctx.body();
    if (body.displayName !== undefined) {
      await deps.pool.query('UPDATE identity.users SET display_name = $2 WHERE user_id = $1', [userId, v.str(body.displayName, 'displayName', { min: 2, max: 40 })]);
    }
    if (body.avatarUrl !== undefined) {
      const avatarUrl = body.avatarUrl === null ? null : v.str(body.avatarUrl, 'avatarUrl', { max: 500 });
      if (avatarUrl !== null && !/^https:\/\//.test(avatarUrl)) throw new ApiError(422, 'VALIDATION_FAILED', 'avatarUrl: must be an https URL');
      await deps.pool.query('UPDATE identity.users SET avatar_url = $2 WHERE user_id = $1', [userId, avatarUrl]);
    }
    return userWithProviders(deps.pool, userId);
  });

  router.post('/v1/me/providers/:provider/link', async (ctx) => {
    const { userId } = requireUser(ctx);
    const p = provider(ctx.params.provider);
    return { url: `/v1/auth/${p.id}/start?redirect=${encodeURIComponent('/me')}&linkToken=${encodeURIComponent(seal(userId, jwtSecret(), 300))}` };
  });
}
