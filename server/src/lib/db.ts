import { Client as PgClient, Pool as PgPool, types, type PoolClient, type QueryResultRow } from 'pg';
import { env, envInt } from './config.ts';
import { failSpan, SpanKind, startSpan, tracing } from './telemetry.ts';

types.setTypeParser(types.builtins.NUMERIC, (value) => Number.parseFloat(value));
types.setTypeParser(types.builtins.DATE, (value) => value);

const UNTRACED_STATEMENTS = new Set(['BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'LISTEN', 'SELECT 1']);

export function summarizeSql(text: string): { operation: string; table: string } {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const words = normalized.split(' ');
  let operation = (words[0] ?? '').toUpperCase();
  if (operation === 'WITH')
    operation = (normalized.match(/\)\s*(SELECT|INSERT|UPDATE|DELETE)\b/i)?.[1] ?? 'WITH').toUpperCase();
  const table = normalized.match(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+\.[a-z_]+|[a-z_]+)/i)?.[1] ?? '';
  return { operation, table };
}

type QueryFn = (this: unknown, ...args: unknown[]) => unknown;

function queryText(first: unknown): string | undefined {
  if (typeof first === 'string') return first;
  if (typeof first === 'object' && first !== null && 'text' in first && typeof first.text === 'string')
    return first.text;
  return undefined;
}

function patchQuery(target: { query: QueryFn }): void {
  const original = target.query;
  target.query = function patched(this: unknown, ...args: unknown[]) {
    const text = queryText(args[0]);
    if (!text || typeof args[args.length - 1] === 'function' || !tracing()) return original.apply(this, args);
    const { operation, table } = summarizeSql(text);
    if (UNTRACED_STATEMENTS.has(operation) || UNTRACED_STATEMENTS.has(text.trim())) return original.apply(this, args);
    const span = startSpan(table ? `${operation} ${table}` : operation, {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system.name': 'postgresql',
        'db.operation.name': operation,
        'db.collection.name': table,
        'db.query.summary': `${operation} ${table}`.trim(),
      },
    });
    return Promise.resolve(original.apply(this, args)).then(
      (result) => {
        span.end();
        return result;
      },
      (error: unknown) => {
        failSpan(span, error);
        span.end();
        throw error;
      },
    );
  };
}

patchQuery(PgPool.prototype);
patchQuery(PgClient.prototype);

export type Pool = PgPool;
export type Client = PoolClient;
export type Queryable = PgPool | PoolClient;
export type Row = QueryResultRow;

export function createPool(url = env('DATABASE_URL'), max = envInt('DB_POOL_MAX', 10)): PgPool {
  const pool = new PgPool({ connectionString: url, max });
  pool.on('error', () => undefined);
  return pool;
}

export async function tx<T>(pool: PgPool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
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

export async function one<T = Row>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const rows = await many<T>(db, sql, params);
  return rows[0];
}

export async function many<T = Row>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(sql, params);
  const rows: T[] = result.rows;
  return rows;
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}
