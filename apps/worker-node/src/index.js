import 'dotenv/config';
import { Kafka, logLevel } from 'kafkajs';
import Redis from 'ioredis';
import { createClient } from '@clickhouse/client';

const brokers = (process.env.KAFKA_BROKERS || 'localhost:19092').split(',');
const kafka = new Kafka({ clientId: 'worker-node', brokers, logLevel: logLevel.NOTHING });
const TOPIC = 'price_updates';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: null
});

const ch = createClient({
  url: process.env.CLICKHOUSE_URL || 'http://127.0.0.1:8123',
  username: process.env.CLICKHOUSE_USER || 'sentra',
  password: process.env.CLICKHOUSE_PASSWORD || 'sentra'
});

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

async function upsertPriceRedis(update) {
  const key = `sentra:price:${update.sku}`;
  await redis.hset(key, {
    sku: update.sku,
    price: String(update.price),
    stock: String(update.stock),
    ts_ms: String(update.ts_ms)
  });
}

async function insertClickHouse(update) {
  await ch.insert({
    table: 'sentra.price_updates',
    values: [update],
    format: 'JSONEachRow'
  });
}

async function main() {
  await Promise.all([redis.connect(), ensureClickHouse()]);
  const consumer = kafka.consumer({ groupId: 'worker-node-g1' });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });
  console.log(`✅ worker-node consuming ${TOPIC} @ ${brokers.join(',')}`);

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const key = message.key?.toString();
      const val = message.value?.toString();
      try {
        const update = JSON.parse(val);
        await Promise.all([upsertPriceRedis(update), insertClickHouse(update)]);
      } catch (e) {
        console.error('worker error:', e.message, 'payload=', val);
      }
      console.log(`[${topic}/${partition}] ${key} -> ${val}`);
    }
  });
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
