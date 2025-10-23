import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { Kafka } from 'kafkajs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__dirname, '../../packages/proto/sentra.proto');
const pkgDef = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: String });
const proto = grpc.loadPackageDefinition(pkgDef).sentra;
const brokers = (process.env.KAFKA_BROKERS || 'localhost:19092').split(',');
const kafka = new Kafka({ clientId: 'gateway-node', brokers });
const producer = kafka.producer({ allowAutoTopicCreation: true });
const admin = kafka.admin();
const TOPIC = 'price_updates';

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

async function main() {
  await initKafka();
  const server = new grpc.Server();
  server.addService(proto.Ingest.service, serviceImpl);
  const port = Number(process.env.GRPC_PORT || 50051);
  server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, actual) => {
    if (err) process.exit(1);
    console.log(`✅ gateway-node gRPC :${actual}, Kafka → ${brokers.join(',')} topic=${TOPIC}`);
    server.start();
  });
}

main().catch(e => process.exit(1));
