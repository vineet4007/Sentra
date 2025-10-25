import 'dotenv/config';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes as S } from '@opentelemetry/semantic-conventions';

const exporter = new OTLPTraceExporter({});

const sdk = new NodeSDK({
  traceExporter: exporter,
  resource: new Resource({ [S.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME_WORKER || 'sentra-worker' }),
  instrumentations: [getNodeAutoInstrumentations()]
});

sdk.start();
