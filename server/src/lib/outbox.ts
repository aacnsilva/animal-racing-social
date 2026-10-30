import pg from 'pg';
import type { Producer } from 'kafkajs';
import { env } from './config.ts';
import type { Pool, Queryable } from './db.ts';
import { encodeEnvelope, typeName, type Payload } from './kafka.ts';
import { errorFields, log } from './log.ts';
import { sleep } from './time.ts';

export type OutboxSchema = 'betting' | 'racing' | 'stable' | 'market' | 'wallet' | 'season' | 'notification' | 'admin';

const BATCH = 500;

export async function enqueue(db: Queryable, schema: OutboxSchema, topic: string, key: string, body: Payload): Promise<void> {
  await db.query(
    `INSERT INTO ${schema}.outbox (topic, msg_key, event_type, payload) VALUES ($1, $2, $3, $4)`,
    [topic, key, typeName(body.$case), encodeEnvelope(body)],
  );
}

export async function enqueueRaw(db: Queryable, schema: OutboxSchema, topic: string, key: string, eventType: string, bytes: Buffer): Promise<void> {
  await db.query(
    `INSERT INTO ${schema}.outbox (topic, msg_key, event_type, payload) VALUES ($1, $2, $3, $4)`,
    [topic, key, eventType, bytes],
  );
}

async function drain(pool: Pool, schema: OutboxSchema, producer: Producer): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [`outbox_${schema}`]);
    if (!lock.rows[0].locked) {
      await client.query('ROLLBACK');
      return 0;
    }
    const { rows } = await client.query(
      `SELECT outbox_id, topic, msg_key, payload FROM ${schema}.outbox WHERE published_at IS NULL ORDER BY outbox_id LIMIT ${BATCH}`,
    );
    if (rows.length > 0) {
      const byTopic = new Map<string, { key: string; value: Buffer }[]>();
      for (const row of rows) {
        const list = byTopic.get(row.topic) ?? [];
        list.push({ key: row.msg_key, value: row.payload });
        byTopic.set(row.topic, list);
      }
      await producer.sendBatch({ acks: -1, topicMessages: [...byTopic].map(([topic, messages]) => ({ topic, messages })) });
      await client.query(`UPDATE ${schema}.outbox SET published_at = now() WHERE outbox_id = ANY($1)`, [rows.map((r) => r.outbox_id)]);
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function startOutboxRelay(pool: Pool, schemas: OutboxSchema[], producer: Producer): Promise<() => Promise<void>> {
  let stopped = false;
  const wake = new Map<OutboxSchema, () => void>();
  const dirty = new Set<OutboxSchema>();
  const listener = new pg.Client({ connectionString: env('DATABASE_URL') });
  listener.on('error', (error) => log.error('outbox listener error', errorFields(error)));
  await listener.connect();
  listener.on('notification', (message) => {
    const schema = message.channel.replace(/^outbox_/, '') as OutboxSchema;
    dirty.add(schema);
    wake.get(schema)?.();
  });
  for (const schema of schemas) await listener.query(`LISTEN outbox_${schema}`);

  const loops = schemas.map(async (schema) => {
    while (!stopped) {
      dirty.delete(schema);
      let published = 0;
      try {
        published = await drain(pool, schema, producer);
      } catch (error) {
        log.error('outbox relay failed', { schema, ...errorFields(error) });
        await sleep(1000);
      }
      if (published >= BATCH || dirty.has(schema)) continue;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000);
        wake.set(schema, () => {
          clearTimeout(timer);
          wake.delete(schema);
          resolve();
        });
      });
    }
  });

  const cleanup = setInterval(() => {
    for (const schema of schemas) {
      pool.query(`DELETE FROM ${schema}.outbox WHERE published_at < now() - interval '1 day'`).catch(() => undefined);
    }
  }, 10 * 60 * 1000);

  return async () => {
    stopped = true;
    clearInterval(cleanup);
    for (const resolve of wake.values()) resolve();
    await Promise.all(loops);
    await listener.end();
  };
}
