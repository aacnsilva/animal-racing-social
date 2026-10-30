import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { errorFields, log } from './log.ts';
import { BUCKETS, extractContext, failSpan, histogram, SpanKind, SpanStatusCode, withSpan, type Span } from './telemetry.ts';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class Reply {
  status: number;
  body: unknown;
  headers: Record<string, string | string[]>;

  constructor(status: number, body?: unknown, headers: Record<string, string | string[]> = {}) {
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

export const accepted = (body: unknown) => new Reply(202, body);
export const noContent = (headers: Record<string, string | string[]> = {}) => new Reply(204, undefined, headers);
export const redirect = (location: string, cookies: string[] = []) => new Reply(302, undefined, { location, 'set-cookie': cookies });

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  cookies: Record<string, string>;
  ip: string;
  state: Record<string, unknown>;
  body: () => Promise<any>;
  setCookies: string[];
};

export type Handler = (ctx: Ctx) => Promise<unknown>;
export type Middleware = (ctx: Ctx) => Promise<void>;

type Route = { method: string; path: string; parts: string[]; handler: Handler };

export class Router {
  routes: Route[] = [];
  middlewares: Middleware[] = [];

  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  add(method: string, path: string, handler: Handler): this {
    this.routes.push({ method, path, parts: path.split('/').filter(Boolean), handler });
    return this;
  }

  get(path: string, handler: Handler) { return this.add('GET', path, handler); }
  post(path: string, handler: Handler) { return this.add('POST', path, handler); }
  put(path: string, handler: Handler) { return this.add('PUT', path, handler); }
  patch(path: string, handler: Handler) { return this.add('PATCH', path, handler); }
  delete(path: string, handler: Handler) { return this.add('DELETE', path, handler); }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string>; path: string } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method || route.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < parts.length; i++) {
        const pattern = route.parts[i]!;
        if (pattern.startsWith(':')) params[pattern.slice(1)] = decodeURIComponent(parts[i]!);
        else if (pattern !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params, path: route.path };
    }
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export type CookieOptions = { maxAge?: number; path?: string; httpOnly?: boolean; secure?: boolean; sameSite?: 'Lax' | 'Strict' | 'None' };

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? '/'}`, `SameSite=${options.sameSite ?? 'Lax'}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly ?? true) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new ApiError(413, 'VALIDATION_FAILED', 'Request body too large');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  const type = req.headers['content-type'] ?? '';
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Body must be valid JSON');
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  if (Buffer.isBuffer(body)) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(body);
    return;
  }
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...(body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

const FLOWS: [RegExp, string][] = [
  [/^\/v1\/admin\/races\/:raceId\/cancel$/, 'cancellation'],
  [/^\/v1\/admin\//, 'admin'],
  [/^\/v1\/bets\/:betId\/cashout$/, 'cashout'],
  [/^\/v1\/bets\/combos$/, 'combo'],
  [/^\/v1\/markets\/:marketId\/bets$/, 'bet'],
  [/^\/v1\/auth\//, 'auth'],
  [/^\/v1\/me\/rewards\/daily$/, 'daily-reward'],
  [/^\/internal\//, 'internal'],
];

function flowOf(method: string, path: string): string | undefined {
  if (method === 'GET' && !path.startsWith('/v1/admin/')) return undefined;
  return FLOWS.find(([pattern]) => pattern.test(path))?.[1];
}

const requestDuration = () => histogram('http.server.request.duration', 's', 'Duration of HTTP server requests', BUCKETS.http);

async function handle(router: Router, ctx: Ctx, route: ReturnType<Router['match']>, span: Span | null): Promise<void> {
  const { res } = ctx;
  try {
    if (!route) throw new ApiError(404, 'NOT_FOUND', `No route for ${ctx.method} ${ctx.url.pathname}`);
    ctx.params = route.params;
    for (const middleware of router.middlewares) await middleware(ctx);
    const result = await route.handler(ctx);
    if (res.headersSent || res.writableEnded) return;
    const reply = result instanceof Reply ? result : new Reply(200, result);
    const cookies = [...ctx.setCookies, ...([] as string[]).concat(reply.headers['set-cookie'] ?? [])];
    const headers = { ...reply.headers, ...(cookies.length ? { 'set-cookie': cookies } : {}) };
    sendJson(res, reply.status, reply.body, headers);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof ApiError) {
      const headers: Record<string, string> = {};
      if (error.status === 429 && typeof error.details === 'object' && error.details && 'retryAfter' in error.details) {
        headers['retry-after'] = String((error.details as { retryAfter: number }).retryAfter);
      }
      if (span && error.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR, message: error.code });
      if (span) span.setAttribute('ars.error_code', error.code);
      sendJson(res, error.status, { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) }, headers);
    } else {
      if (span) failSpan(span, error);
      log.error('unhandled error', { method: ctx.method, path: ctx.url.pathname, ...errorFields(error) });
      sendJson(res, 500, { code: 'INTERNAL', message: 'Internal error' });
    }
  }
}

export function serve(router: Router, port: number): Server {
  const server = createServer(async (req, res) => {
    const started = performance.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    let parsedBody: Promise<any> | null = null;
    const ctx: Ctx = {
      req,
      res,
      method,
      url,
      params: {},
      query: url.searchParams,
      cookies: parseCookies(req.headers.cookie),
      ip: String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0]!.trim(),
      state: {},
      body: () => (parsedBody ??= readBody(req)),
      setCookies: [],
    };
    const route = router.match(method === 'HEAD' ? 'GET' : method, url.pathname);
    if (url.pathname === '/healthz') {
      await handle(router, ctx, route, null);
      return;
    }
    const template = route?.path ?? 'unmatched';
    const flow = flowOf(method, template);
    await withSpan(`${method} ${template}`, {
      kind: SpanKind.SERVER,
      parent: extractContext(req.headers),
      attributes: { 'http.request.method': method, 'http.route': template, 'url.path': url.pathname, ...(flow ? { 'ars.flow': flow } : {}) },
    }, async (span) => {
      res.setHeader('x-trace-id', span.spanContext().traceId);
      for (const [name, value] of Object.entries(route?.params ?? {})) {
        if (/^\d{1,19}$/.test(value)) span.setAttribute(`ars.${name.replace(/Id$/, '_id').toLowerCase()}`, value);
      }
      await handle(router, ctx, route, span);
      span.setAttribute('http.response.status_code', res.statusCode);
      const seconds = (performance.now() - started) / 1000;
      requestDuration().record(seconds, { 'http.route': template, 'http.request.method': method, 'http.response.status_code': res.statusCode });
      log.info('http', { method, path: url.pathname, route: template, status: res.statusCode, ms: Math.round(seconds * 1000) });
    });
  });
  server.listen(port);
  return server;
}

export function healthServer(port: number, check: () => Promise<boolean> = async () => true): Server {
  const router = new Router().get('/healthz', async () => {
    if (!(await check())) throw new ApiError(503, 'UNAVAILABLE', 'Not ready');
    return { ok: true };
  });
  return serve(router, port);
}

function invalid(field: string, message: string): never {
  throw new ApiError(422, 'VALIDATION_FAILED', `${field}: ${message}`, { field });
}

export const v = {
  str(value: unknown, field: string, options: { min?: number; max?: number } = {}): string {
    if (typeof value !== 'string') invalid(field, 'must be a string');
    const trimmed = value.trim();
    if (trimmed.length < (options.min ?? 1)) invalid(field, `must have at least ${options.min ?? 1} characters`);
    if (options.max !== undefined && trimmed.length > options.max) invalid(field, `must have at most ${options.max} characters`);
    return trimmed;
  },
  int(value: unknown, field: string, options: { min?: number; max?: number } = {}): number {
    const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof parsed !== 'number' || !Number.isInteger(parsed)) invalid(field, 'must be an integer');
    if (options.min !== undefined && parsed < options.min) invalid(field, `must be ≥ ${options.min}`);
    if (options.max !== undefined && parsed > options.max) invalid(field, `must be ≤ ${options.max}`);
    return parsed;
  },
  num(value: unknown, field: string, options: { min?: number; max?: number } = {}): number {
    const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) invalid(field, 'must be a number');
    if (options.min !== undefined && parsed < options.min) invalid(field, `must be ≥ ${options.min}`);
    if (options.max !== undefined && parsed > options.max) invalid(field, `must be ≤ ${options.max}`);
    return parsed;
  },
  oneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) invalid(field, `must be one of ${allowed.join(', ')}`);
    return value as T;
  },
  id(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^\d{1,19}$/.test(value)) invalid(field, 'must be an id string');
    return value;
  },
  date(value: unknown, field: string): Date {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) invalid(field, 'must be an RFC 3339 timestamp');
    return new Date(value);
  },
  bool(value: unknown, field: string): boolean {
    if (typeof value !== 'boolean') invalid(field, 'must be a boolean');
    return value;
  },
  obj(value: unknown, field: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(field, 'must be an object');
    return value as Record<string, unknown>;
  },
  arr(value: unknown, field: string, options: { min?: number; max?: number } = {}): unknown[] {
    if (!Array.isArray(value)) invalid(field, 'must be an array');
    if (options.min !== undefined && value.length < options.min) invalid(field, `must have at least ${options.min} items`);
    if (options.max !== undefined && value.length > options.max) invalid(field, `must have at most ${options.max} items`);
    return value;
  },
};

export function pathId(ctx: Ctx, name: string): string {
  const value = ctx.params[name];
  if (!value || !/^\d{1,19}$/.test(value)) throw new ApiError(404, 'NOT_FOUND', `Unknown ${name}`);
  return value;
}
