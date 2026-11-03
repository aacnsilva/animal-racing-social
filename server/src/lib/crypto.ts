import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isRecord } from './http.ts';

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

export type JwtClaims = Record<string, unknown> & { exp: number };

function isClaims(value: unknown): value is JwtClaims {
  return isRecord(value) && typeof value.exp === 'number';
}

function decodeJson(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

export function verifyJwt(token: string, secret: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  if (!safeEqual(Buffer.from(signature, 'base64url'), hmac(secret, `${header}.${body}`))) return null;
  try {
    const headerJson = decodeJson(header);
    if (!isRecord(headerJson) || headerJson.alg !== 'HS256') return null;
    const claims = decodeJson(body);
    if (!isClaims(claims) || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export function seal(value: unknown, secret: string, ttlSeconds: number): string {
  return signJwt({ v: value }, secret, ttlSeconds);
}

export function unseal<T>(token: string | undefined, secret: string, guard: (value: unknown) => value is T): T | null {
  if (!token) return null;
  const claims = verifyJwt(token, secret);
  return claims && guard(claims.v) ? claims.v : null;
}

export function pkceChallenge(verifier: string): string {
  return base64url(sha256(verifier));
}
