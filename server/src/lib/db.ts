import pg from 'pg';
import { env, envInt } from './config.ts';

pg.types.setTypeParser(1700, (value) => Number.parseFloat(value));
pg.types.setTypeParser(1082, (value) => value);

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
