import { createClient } from '@redis/client';
import { env } from './config.ts';
import { errorFields, log } from './log.ts';

function makeClient(url: string) {
  return createClient({ url });
}

export type Redis = ReturnType<typeof makeClient>;

export async function connectRedis(url = env('REDIS_URL', 'redis://localhost:6379')): Promise<Redis> {
  const client = makeClient(url);
  client.on('error', (error) => log.error('redis error', errorFields(error)));
  await client.connect();
  return client;
}

export async function getJson<T>(redis: Redis, key: string): Promise<T | null> {
  const value = await redis.get(key);
  return value === null ? null : (JSON.parse(value) as T);
}

export async function setJson(redis: Redis, key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await redis.set(key, JSON.stringify(value), { expiration: { type: 'EX', value: ttlSeconds } });
}
