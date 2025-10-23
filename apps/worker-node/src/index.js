import 'dotenv/config';
import { Kafka, logLevel } from 'kafkajs';

const brokers = (process.env.KAFKA_BROKERS || 'localhost:19092').split(',');
const kafka = new Kafka({ clientId: 'worker-node', brokers, logLevel: logLevel.NOTHING });
const TOPIC = 'price_updates';

async function main() {
  const consumer = kafka.consumer({ groupId: 'worker-node-g1' });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });
  console.log(`✅ worker-node consuming ${TOPIC} @ ${brokers.join(',')}`);
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const key = message.key?.toString();
      const val = message.value?.toString();
      console.log(`[${topic}/${partition}] ${key} -> ${val}`);
    }
  });
}
main().catch(e => process.exit(1));
