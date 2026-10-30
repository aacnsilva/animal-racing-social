import type { Server } from 'node:http';
import type { Consumer, Kafka, Producer } from 'kafkajs';
import { envInt } from './config.ts';
import { createPool, type Pool } from './db.ts';
import { healthServer } from './http.ts';
import { createKafka, createProducer } from './kafka.ts';
import { errorFields, log } from './log.ts';
import { startOutboxRelay, type OutboxSchema } from './outbox.ts';
import { connectRedis, type Redis } from './redis.ts';

export type Runtime = {
  name: string;
  pool: Pool;
  kafka: Kafka;
  producer: Producer;
  redis: Redis;
  consumers: Consumer[];
  onStop: (fn: () => Promise<void> | void) => void;
};

export async function bootstrap(name: string, options: { outbox?: OutboxSchema[]; health?: boolean } = {}): Promise<Runtime> {
  process.env.SERVICE_NAME ??= name;
  const pool = createPool();
  const kafka = createKafka(name);
  const producer = await createProducer(kafka);
  const redis = await connectRedis();
  const stops: (() => Promise<void> | void)[] = [];
  const consumers: Consumer[] = [];
  if (options.outbox?.length) stops.push(await startOutboxRelay(pool, options.outbox, producer));
  let health: Server | null = null;
  if (options.health ?? true) {
    health = healthServer(envInt('PORT', 3000), async () => {
      await pool.query('SELECT 1');
      return true;
    });
  }
  const runtime: Runtime = { name, pool, kafka, producer, redis, consumers, onStop: (fn) => stops.push(fn) };
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info('shutting down', { signal });
    for (const consumer of consumers) await consumer.disconnect().catch(() => undefined);
    for (const stop of stops.reverse()) await Promise.resolve(stop()).catch((error) => log.error('stop failed', errorFields(error)));
    health?.close();
    await producer.disconnect().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  log.info('started', { name });
  return runtime;
}

export function every(ms: number, task: () => Promise<void>, runtime: Runtime, label: string): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (error) {
      log.error(`${label} failed`, errorFields(error));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, ms);
  void run();
  runtime.onStop(() => clearInterval(timer));
}
