import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__dirname, '../../packages/proto/sentra.proto');
const pkgDef = protoLoader.loadSync(PROTO_PATH, { keepCase: true, longs: String });
const proto = grpc.loadPackageDefinition(pkgDef).sentra;
const client = new proto.Ingest(`localhost:${process.env.GRPC_PORT || 50051}`, grpc.credentials.createInsecure());

async function send(n = 10) {
  await new Promise((resolve, reject) => {
    const call = client.StreamUpdates((err, ack) => err ? reject(err) : (console.log('Ack:', ack), resolve()));
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      call.write({ sku: `SKU-${(i%3)+1}`, price: 100+i, stock: 50-i, ts_ms: now+i });
    }
    call.end();
  });
}
send().catch(e => console.error(e));
