import { randomInt } from 'node:crypto';
import { envInt } from './config.ts';

const EPOCH_MS = 1767225600000n;
const node = BigInt(envInt('NODE_ID', randomInt(32)) & 31);
let lastMs = -1n;
let sequence = 0n;

export function newId(shard = 0): string {
  let ms = BigInt(Date.now()) - EPOCH_MS;
  if (ms < lastMs) ms = lastMs;
  if (ms === lastMs) {
    sequence = (sequence + 1n) & 127n;
    if (sequence === 0n) ms = lastMs + 1n;
  } else {
    sequence = 0n;
  }
  lastMs = ms;
  return ((ms << 22n) | (BigInt(shard & 1023) << 12n) | (node << 7n) | sequence).toString();
}

export function shardOf(id: string): number {
  return Number((BigInt(id) >> 12n) & 1023n);
}

export function newUserId(): string {
  return newId(randomInt(1024));
}

export function idTime(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + EPOCH_MS));
}

export function entrantKey(entrantId: number): string {
  return `e${entrantId}`;
}

export function entrantNumber(key: string): number {
  const value = Number.parseInt(key.startsWith('e') ? key.slice(1) : key, 10);
  if (!Number.isInteger(value) || value < 1 || value > 10) throw new Error(`Invalid entrant id ${key}`);
  return value;
}
