# Sentra Telemetry Requirements

This file documents the first telemetry contract used by the controller in Step 4.

## Goal

The controller needs enough telemetry to answer four rollout questions:

- Is the telemetry backend reachable?
- What is the current application error rate?
- What is the current p95 latency?
- Are logs or traces showing active failure signals?

## Required Sources

- Prometheus for metrics
- Loki for logs
- Tempo for traces

## Standard Labels

Sentra currently assumes these standard labels when it builds Prometheus and Loki queries:

- `project`
- `service`
- `env`
- `version`
- `region`
- `cluster`
- `cloud`

The controller snapshot endpoint allows these label keys to be overridden per request with query params such as `serviceLabel` or `environmentLabel`.

## Default Signal Queries

### Prometheus

The controller builds these default rollout signals:

- Error rate percent from `http_server_request_duration_seconds_count`
- p95 latency from `http_server_request_duration_seconds_bucket`

These defaults are meant to align with common OpenTelemetry-to-Prometheus HTTP metrics. If a project uses different metric names, the query layer will need to be extended in a later step.

### Loki

The controller builds:

- total log count over the current evaluation window
- error log count using `|= "error"`
- log error ratio percent computed in the controller

Local note:

- The current Loki setup requires an `X-Scope-OrgID` header for query APIs.
- Local development uses `LOKI_TENANT_ID=local`.

### Tempo

The controller currently uses Tempo search to count recent matching traces.

It builds TraceQL using these resource attributes when available:

- `resource.service.name`
- `resource.deployment.environment`
- `resource.service.version`

This is enough for connectivity checks and normalized trace-count snapshots. A richer trace failure ratio can be added in Step 5.

## Controller Endpoints

Step 4 adds two controller endpoints:

- `GET /telemetry/validate`
- `GET /telemetry/snapshot`
- `POST /rollouts/evaluate`

Example:

```bash
curl 'http://localhost:8090/telemetry/snapshot?service=payments-api&environment=staging&version=candidate'
```

Optional query params:

- `windowSec`
- `stepSec`
- `limit`
- `project`, `service`, `environment`, `version`, `region`, `cluster`, `cloud`
- `projectLabel`, `serviceLabel`, `environmentLabel`, `versionLabel`, `regionLabel`, `clusterLabel`, `cloudLabel`

## What This Enables

With this contract in place, the controller can now:

- validate telemetry connectivity on its own
- build consistent rollout-health snapshots
- expose a normalized data shape for the decision engine
- make deterministic rollout decisions from policy plus telemetry

The next step is to propagate these decisions through Redis and into the API for live rollout state streaming.
