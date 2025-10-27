import 'dotenv/config';
import { Kafka, logLevel } from 'kafkajs';
import Redis from 'ioredis';
import { createClient } from '@clickhouse/client';
import { context as otContext, trace, propagation, SpanKind } from '@opentelemetry/api';

// ---- Config ----
const brokers = (process.env.KAFKA_BROKERS || 'localhost:19092').split(',');
const TOPIC = process.env.TOPIC || 'price_updates';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: null
});

const ch = createClient({
  url: process.env.CLICKHOUSE_URL || 'http://127.0.0.1:8123',
  username: process.env.CLICKHOUSE_USER || 'sentra',
  password: process.env.CLICKHOUSE_PASSWORD || 'sentra'
});

const kafka = new Kafka({ clientId: 'worker-node', brokers, logLevel: logLevel.NOTHING });
const tracer = trace.getTracer('sentra-worker');

// ---- ClickHouse bootstrap ----
async function ensureClickHouse() {
  try {
    await ch.ping();
  } catch (e) {
    console.error('ClickHouse ping failed. Check CLICKHOUSE_URL/USER/PASSWORD and container health:', e.message);
    throw e;
  }
  await ch.exec({ query: `CREATE DATABASE IF NOT EXISTS sentra` });
  await ch.exec({
    query: `
      CREATE TABLE IF NOT EXISTS sentra.price_updates (
        ts_ms   UInt64,
        sku     String,
        price   Float64,
        stock   Int32
      )
      ENGINE = MergeTree
      ORDER BY (sku, ts_ms)
    `
  });
}

// ---- Redis helper ----
async function upsertPriceRedis(update) {
  const key = `sentra:price:${update.sku}`;
  await redis.hset(key, {
    sku: update.sku,
    price: String(update.price),
    stock: String(update.stock),
    ts_ms: String(update.ts_ms)
  });
}

// ---- ClickHouse insert ----
async function insertClickHouse(update) {
  await ch.insert({
    table: 'sentra.price_updates',
    values: [update],
    format: 'JSONEachRow'
  });
}

// ---- Main consume loop with tracing propagation ----
async function main() {
  await Promise.all([redis.connect(), ensureClickHouse()]);

  const consumer = kafka.consumer({ groupId: process.env.WORKER_GROUP_ID || 'worker-node-g1' });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

  console.log(`✅ worker-node consuming ${TOPIC} @ ${brokers.join(',')}`);

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const key = message.key?.toString();
      const val = message.value?.toString();

      // Normalize Kafka headers to a carrier (Buffer -> string)
      const carrier = {};
      if (message.headers) {
        for (const [k, v] of Object.entries(message.headers)) {
          if (v == null) continue;
          carrier[k] = Buffer.isBuffer(v) ? v.toString() : String(v);
        }
      }

      // Extract upstream trace context (from gateway's PRODUCER span)
      const parentCtx = propagation.extract(otContext.active(), carrier, {
        get: (c, k) => c[k],
        keys: (c) => Object.keys(c || {})
      });

      await otContext.with(parentCtx, async () => {
        // Create CONSUMER span that continues the gateway trace
        const consumeSpan = tracer.startSpan('kafka.consume', {
          kind: SpanKind.CONSUMER,
          attributes: {
            'messaging.system': 'kafka',
            'messaging.destination': topic,
            'messaging.destination_kind': 'topic',
            'messaging.kafka.partition': partition,
            'sentra.key': key
          }
        });

        await otContext.with(trace.setSpan(otContext.active(), consumeSpan), async () => {
          try {
            const update = JSON.parse(val);

            // Redis write span
            const redisSpan = tracer.startSpan('redis.hset', {
              attributes: { 'db.system': 'redis', 'sentra.sku': update.sku }
            });
            await otContext.with(trace.setSpan(otContext.active(), redisSpan), async () => {
              await upsertPriceRedis(update);
            });
            redisSpan.end();

            // ClickHouse insert span
            const chSpan = tracer.startSpan('clickhouse.insert', {
              attributes: {
                'db.system': 'clickhouse',
                'db.name': 'sentra',
                'db.operation': 'INSERT',
                'sentra.sku': update.sku
              }
            });
            await otContext.with(trace.setSpan(otContext.active(), chSpan), async () => {
              await insertClickHouse(update);
            });
            chSpan.end();

          } catch (e) {
            consumeSpan.recordException(e);
            console.error('worker error:', e.message, 'payload=', val);
          } finally {
            console.log(`[${topic}/${partition}] ${key} -> ${val}`);
            consumeSpan.end();
          }
        });
      });
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    try {
      await consumer.disconnect();
    } catch {}
    try {
      await redis.quit();
    } catch {}
    try {
      await ch.close();
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
