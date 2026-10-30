import { env } from '../../lib/config.ts';
import { verifyJwt } from '../../lib/crypto.ts';
import { one, type Pool } from '../../lib/db.ts';
import { ApiError, type Ctx } from '../../lib/http.ts';
import type { Producer } from 'kafkajs';
import type { Redis } from '../../lib/redis.ts';

export type Deps = { pool: Pool; redis: Redis; producer: Producer };

export type AuthUser = { userId: string; role: 'USER' | 'ADMIN' };

export const jwtSecret = () => env('JWT_SECRET', 'dev-only-jwt-secret-change-me');
export const publicUrl = () => env('PUBLIC_URL', 'http://localhost:8080').replace(/\/$/, '');
export const secureCookies = () => publicUrl().startsWith('https://');

export function authenticate(ctx: Ctx): void {
  const header = ctx.req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return;
  const claims = verifyJwt<{ sub: string; role: 'USER' | 'ADMIN' }>(header.slice(7), jwtSecret());
  if (!claims) throw new ApiError(401, 'UNAUTHORIZED', 'Access token invalid or expired');
  ctx.state.user = { userId: claims.sub, role: claims.role } satisfies AuthUser;
}

export function optionalUser(ctx: Ctx): AuthUser | null {
  return (ctx.state.user as AuthUser | undefined) ?? null;
}

export function requireUser(ctx: Ctx): AuthUser {
  const user = optionalUser(ctx);
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in required');
  return user;
}

export async function requireActiveUser(ctx: Ctx, deps: Deps): Promise<AuthUser> {
  const user = requireUser(ctx);
  const row = await one(deps.pool, 'SELECT banned_at FROM identity.users WHERE user_id = $1', [user.userId]);
  if (!row) throw new ApiError(401, 'UNAUTHORIZED', 'Unknown user');
  if (row.banned_at) throw new ApiError(403, 'BANNED', 'This account is banned');
  return user;
}

export async function requireAdmin(ctx: Ctx, deps: Deps): Promise<AuthUser> {
  const user = requireUser(ctx);
  const row = await one(deps.pool, 'SELECT role, banned_at FROM identity.users WHERE user_id = $1', [user.userId]);
  if (!row || row.role !== 'ADMIN' || row.banned_at) throw new ApiError(403, 'FORBIDDEN', 'Admin role required');
  return user;
}

const RATE_SCRIPT = `
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local tokens = tonumber(data[1]) or burst
local ts = tonumber(data[2]) or now
tokens = math.min(burst, tokens + math.max(0, now - ts) / 1000 * rate)
local wait = 0
if tokens >= 1 then tokens = tokens - 1 else wait = math.ceil((1 - tokens) / rate * 1000) end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], 10000)
return wait`;

export async function rateLimit(ctx: Ctx, deps: Deps, bucket: 'bet' | 'read'): Promise<void> {
  const rate = bucket === 'bet' ? 10 : 50;
  const who = optionalUser(ctx)?.userId ?? ctx.ip;
  const wait = Number(await deps.redis.eval(RATE_SCRIPT, { keys: [`rl:${who}:${bucket}`], arguments: [String(rate), String(rate), String(Date.now())] }));
  if (wait > 0) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests', { retryAfter: Math.ceil(wait / 1000) });
}

export function userJson(row: Record<string, any>, providers: string[]) {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    providers,
    createdAt: row.created_at.toISOString(),
  };
}
