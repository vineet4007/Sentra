import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { Kafka } from 'kafkajs';
import Fastify from 'fastify';
import Redis from 'ioredis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__dirname, '../../../packages/proto/sentra.proto');
const pkgDef = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: String });
const proto = grpc.loadPackageDefinition(pkgDef).sentra;

const brokers = (process.env.KAFKA_BROKERS || 'localhost:19092').split(',');
const kafka = new Kafka({ clientId: 'gateway-node', brokers });
const producer = kafka.producer({ allowAutoTopicCreation: true });
const admin = kafka.admin();
const TOPIC = 'price_updates';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: null
});

async function initKafka() {
  await producer.connect();
  await admin.connect();
  const topics = await admin.listTopics();
  if (!topics.includes(TOPIC)) {
    await admin.createTopics({ topics: [{ topic: TOPIC, numPartitions: 3, replicationFactor: 1 }] });
  }
  await admin.disconnect();
}

const serviceImpl = {
  Health: async (_call, cb) => cb(null, { ok: true, msg: 'gateway healthy' }),
  StreamUpdates: async (call, cb) => {
    let n = 0;
    try {
      for await (const upd of call) {
        if (!upd?.sku || !upd?.ts_ms) continue;
        await producer.send({ topic: TOPIC, messages: [{ key: upd.sku, value: JSON.stringify(upd) }] });
        n++;
      }
      cb(null, { ok: true, msg: `ingested ${n}` });
    } catch (e) {
      cb({ code: grpc.status.INTERNAL, message: e.message });
    }
  }
};

async function startGrpc() {
  const server = new grpc.Server();
  server.addService(proto.Ingest.service, serviceImpl);
  const port = Number(process.env.GRPC_PORT || 50051);
  return new Promise((resolve, reject) => {
    server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, actual) => {
      if (err) return reject(err);
      server.start();
      console.log(`✅ gateway-node gRPC :${actual}, Kafka → ${brokers.join(',')} topic=${TOPIC}`);
      resolve();
    });
  });
}

async function startHttp() {
  const app = Fastify();
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/price/:sku', async (req, reply) => {
    const sku = req.params.sku;
    const key = `sentra:price:${sku}`;
    const fields = await redis.hgetall(key);
    if (!fields || Object.keys(fields).length === 0) {
      return reply.code(404).send({ ok: false, error: 'not_found' });
    }
    return { ok: true, data: { sku: fields.sku, price: Number(fields.price), stock: Number(fields.stock), ts_ms: Number(fields.ts_ms) } };
  });
  const httpPort = Number(process.env.HTTP_PORT || 8080);
  await app.listen({ host: '0.0.0.0', port: httpPort });
  console.log(`✅ gateway-node HTTP :${httpPort}`);
}

async function main() {
  await Promise.all([initKafka(), redis.connect()]);
  await Promise.all([startGrpc(), startHttp()]);
}

main().catch(e => { console.error(e); process.exit(1); });
