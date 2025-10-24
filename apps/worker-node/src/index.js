import 'dotenv/config';
import { Kafka, logLevel } from 'kafkajs';
import Redis from 'ioredis';

const brokers = (process.env.KAFKA_BROKERS || 'localhost:19092').split(',');
const kafka = new Kafka({ clientId: 'worker-node', brokers, logLevel: logLevel.NOTHING });
const TOPIC = 'price_updates';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: null
});

async function upsertPrice(update) {
  const key = `sentra:price:${update.sku}`;
  await redis.hset(key, {
    sku: update.sku,
    price: String(update.price),
    stock: String(update.stock),
    ts_ms: String(update.ts_ms)
  });
}

async function main() {
  await redis.connect();
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
        await upsertPrice(update);
      } catch (e) {
        console.error('worker parse/upsert error:', e.message, 'payload=', val);
      }
      console.log(`[${topic}/${partition}] ${key} -> ${val}`);
    }
  });
}

main().catch(e => { console.error(e); process.exit(1); });
