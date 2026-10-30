import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function sha256(input: Buffer | string): Buffer {
  return createHash('sha256').update(input).digest();
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function hmac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signJwt(claims: Record<string, unknown>, secret: string, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds }));
  const signature = base64url(hmac(secret, `${header}.${body}`));
  return `${header}.${body}.${signature}`;
}

export function verifyJwt<T extends Record<string, unknown>>(token: string, secret: string): (T & { exp: number; iat: number }) | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  if (!safeEqual(Buffer.from(signature, 'base64url'), hmac(secret, `${header}.${body}`))) return null;
  try {
    const headerJson = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (headerJson.alg !== 'HS256') return null;
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export function seal(value: unknown, secret: string, ttlSeconds: number): string {
  return signJwt({ v: value }, secret, ttlSeconds);
}

export function unseal<T>(token: string | undefined, secret: string): T | null {
  if (!token) return null;
  const claims = verifyJwt<{ v: T }>(token, secret);
  return claims ? claims.v : null;
}

export function pkceChallenge(verifier: string): string {
  return base64url(sha256(verifier));
}
