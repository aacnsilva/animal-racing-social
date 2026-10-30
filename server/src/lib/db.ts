import pg from 'pg';
import { env, envInt } from './config.ts';
import { failSpan, SpanKind, startSpan, tracing } from './telemetry.ts';

pg.types.setTypeParser(1700, (value) => Number.parseFloat(value));
pg.types.setTypeParser(1082, (value) => value);

const UNTRACED_STATEMENTS = new Set(['BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'LISTEN', 'SELECT 1']);

export function summarizeSql(text: string): { operation: string; table: string } {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const words = normalized.split(' ');
  let operation = (words[0] ?? '').toUpperCase();
  if (operation === 'WITH') operation = (normalized.match(/\)\s*(SELECT|INSERT|UPDATE|DELETE)\b/i)?.[1] ?? 'WITH').toUpperCase();
  const table = normalized.match(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+\.[a-z_]+|[a-z_]+)/i)?.[1] ?? '';
  return { operation, table };
}

function traced<T extends (...args: any[]) => any>(original: T): T {
  return function patched(this: unknown, ...args: any[]) {
    const first = args[0];
    const text: string | undefined = typeof first === 'string' ? first : first?.text;
    if (!text || typeof args[args.length - 1] === 'function' || !tracing()) return original.apply(this, args);
    const { operation, table } = summarizeSql(text);
    if (UNTRACED_STATEMENTS.has(operation) || UNTRACED_STATEMENTS.has(text.trim())) return original.apply(this, args);
    const span = startSpan(table ? `${operation} ${table}` : operation, {
      kind: SpanKind.CLIENT,
      attributes: { 'db.system.name': 'postgresql', 'db.operation.name': operation, 'db.collection.name': table, 'db.query.summary': `${operation} ${table}`.trim() },
    });
    return Promise.resolve(original.apply(this, args)).then(
      (result) => {
        span.end();
        return result;
      },
      (error) => {
        failSpan(span, error);
        span.end();
        throw error;
      },
    );
  } as T;
}

pg.Pool.prototype.query = traced(pg.Pool.prototype.query);
pg.Client.prototype.query = traced(pg.Client.prototype.query);

export type Pool = pg.Pool;
export type Client = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(url = env('DATABASE_URL'), max = envInt('DB_POOL_MAX', 10)): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max });
  pool.on('error', () => undefined);
  return pool;
}

export async function tx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function one<T = Record<string, any>>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await db.query(sql, params);
  return result.rows[0] as T | undefined;
}

export async function many<T = Record<string, any>>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}
