import { randomUUID } from 'node:crypto';
import { Kafka, logLevel, type Consumer, type Producer } from 'kafkajs';
import { Envelope } from '../gen/ars/v1/events.ts';
import { env } from './config.ts';
import type { Pool } from './db.ts';
import { errorFields, log } from './log.ts';
import { sleep } from './time.ts';

export type Payload = NonNullable<Envelope['payload']>;
export type PayloadCase = Payload['$case'];
export type PayloadOf<C extends PayloadCase> = Extract<Payload, { $case: C }>['value'];

export const Topics = {
  raceLifecycle: 'race.lifecycle',
  raceCommands: 'race.commands',
  raceTicks: 'race.ticks',
  marketEvents: 'market.events',
  betCommands: 'bet.commands',
  betEvents: 'bet.events',
  walletEvents: 'wallet.events',
  stableEvents: 'stable.events',
  seasonEvents: 'season.events',
  notificationEvents: 'notification.events',
  adminAudit: 'admin.audit',
} as const;

export const allTopics: string[] = Object.values(Topics);

export function payload<C extends PayloadCase>(kind: C, value: PayloadOf<C>): Payload {
  return { $case: kind, value } as Payload;
}

export function typeName(kind: PayloadCase): string {
  return kind[0]!.toUpperCase() + kind.slice(1);
}

export function encodeEnvelope(body: Payload): Buffer {
  const envelope: Envelope = {
    eventId: randomUUID(),
    type: typeName(body.$case),
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: body,
  };
  return Buffer.from(Envelope.encode(envelope).finish());
}

export function decodeEnvelope(bytes: Uint8Array): Envelope {
  return Envelope.decode(bytes);
}

export function createKafka(clientId: string): Kafka {
  return new Kafka({
    clientId,
    brokers: env('KAFKA_BROKERS', 'localhost:29092').split(','),
    logLevel: logLevel.WARN,
    retry: { initialRetryTime: 300, retries: 10 },
    logCreator: () => ({ namespace, level, log: entry }) => {
      const { message, ...rest } = entry;
      if (level <= logLevel.WARN) log.warn(`kafka ${namespace}: ${message}`, rest);
    },
  });
}

export async function createProducer(kafka: Kafka): Promise<Producer> {
  const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1, allowAutoTopicCreation: false });
  await producer.connect();
  return producer;
}

export type MessageMeta = { topic: string; partition: number; offset: string; key: string | null };
export type Handler = (envelope: Envelope, meta: MessageMeta) => Promise<void>;

export type ConsumerOptions = {
  kafka: Kafka;
  groupId: string;
  topics: string[];
  handler: Handler;
  pool?: Pool;
  fromBeginning?: boolean;
  concurrency?: number;
  attempts?: number;
};

export async function runConsumer(options: ConsumerOptions): Promise<Consumer> {
  const consumer = options.kafka.consumer({ groupId: options.groupId, allowAutoTopicCreation: false });
  await consumer.connect();
  await consumer.subscribe({ topics: options.topics, fromBeginning: options.fromBeginning ?? true });
  const attempts = options.attempts ?? 5;
  await consumer.run({
    partitionsConsumedConcurrently: options.concurrency ?? 1,
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      const meta: MessageMeta = { topic, partition, offset: message.offset, key: message.key?.toString() ?? null };
      if (!message.value) return;
      let envelope: Envelope;
      try {
        envelope = decodeEnvelope(message.value);
      } catch (error) {
        await deadLetter(options, meta, message.value, null, error);
        return;
      }
      for (let attempt = 1; ; attempt++) {
        try {
          await options.handler(envelope, meta);
          return;
        } catch (error) {
          if (attempt >= attempts) {
            await deadLetter(options, meta, message.value, envelope.type, error);
            return;
          }
          log.warn('handler failed, retrying', { group: options.groupId, type: envelope.type, attempt, ...errorFields(error) });
          await heartbeat().catch(() => undefined);
          await sleep(Math.min(250 * 2 ** attempt, 5000));
          await heartbeat().catch(() => undefined);
        }
      }
    },
  });
  return consumer;
}

async function deadLetter(options: ConsumerOptions, meta: MessageMeta, value: Buffer, type: string | null, error: unknown): Promise<void> {
  log.error('message dead-lettered', { group: options.groupId, ...meta, type, ...errorFields(error) });
  if (!options.pool) return;
  await options.pool.query(
    `INSERT INTO admin.dlq (consumer, topic, partition, msg_offset, msg_key, event_type, payload, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [options.groupId, meta.topic, meta.partition, meta.offset, meta.key, type, value, error instanceof Error ? error.message : String(error)],
  ).catch((dbError) => log.error('dlq insert failed', errorFields(dbError)));
}
