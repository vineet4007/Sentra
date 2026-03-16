# Sentra — Phase 0–1 Scaffold

## Prereqs
- Docker & Docker Compose
- Go 1.22+
- Node.js 20+

## Setup
```bash
cp .env.example .env
make up
make logs
```

## Configuration
- `.env.example` contains working local defaults plus placeholders for future project, deployment, and telemetry integration.
- Safe in local `.env`: service ports, local URLs, project names, service names, environment names, and dummy integration values.
- Do not keep real cloud credentials, API keys, or tokens in Git. For shared or production setups, use a secret manager or workload identity instead.
- Fresh local MySQL volumes will auto-run SQL files from `db/migrations/`. If the database already exists, run `make db-migrate` to apply schema changes to the running container.

Services exposed:
- Web UI: http://localhost:3000
- API: http://localhost:8080/health
- Controller health: http://localhost:8090/health
- Controller telemetry validation: http://localhost:8090/telemetry/validate
- Prometheus: http://localhost:9090
- Loki HTTP: http://localhost:3100
- Tempo: http://localhost:3200

## Monitoring Direction
Sentra's monitoring flow is intended to be:
- read metrics from Prometheus
- read logs from Loki
- read traces from Tempo
- evaluate rollout health against policy thresholds
- promote, pause, or roll back based on the observed telemetry

This repository now provides the local telemetry stack, project onboarding flow, rollout decision engine, and a first end-to-end reconcile loop for local Kubernetes-style traffic control.
It also now includes a Next.js control-room UI for onboarding, live rollout visibility, audit trails, and SSE-driven updates.

Step 4 adds controller-side telemetry readers and snapshot endpoints. The current telemetry contract is documented in [TELEMETRY_REQUIREMENTS.md](/Users/vineetchauhan/Desktop/AshSan/Sentra/TELEMETRY_REQUIREMENTS.md).

## API Surface

Current Step 3 API routes:

- `GET /health`
- `GET /events`
- `GET /projects`
- `GET /projects/:id`
- `POST /projects`
- `POST /projects/onboard`
- `GET /environments`
- `PUT /environments/:id/integrations`
- `POST /integrations/validate`
- `GET /policies`
- `POST /policies`
- `GET /deployments`
- `POST /deployments`
- `GET /rollouts`
- `GET /rollouts/live`

## Web UI

Current Step 9 frontend flow:

- `/` shows the Sentra control room
- onboarding form for project, target, telemetry, and rollout policy setup
- rollout board with traffic progression, gate results, incidents, and audit summaries
- live SSE pulse powered through the web proxy at `/api/events`
- `/rollouts/:id` shows a rollout detail view with step history, audit trail, incidents, and current action data

Local note:
- When the API runs inside Docker Compose, telemetry validation must use URLs reachable from the API container, such as `http://prometheus:9090`, `http://loki:3100`, and `http://tempo:3200`.
- `GET /events` now sends an initial `rollout_snapshot` event from Redis before streaming new rollout events.
- `GET /rollouts` now includes persisted `auditEvents` alongside rollout steps, incidents, and Redis-backed live state.
- The web service proxies API and SSE traffic through `/api/*`, so the browser does not need direct CORS access to the backend services.

## Controller Telemetry Surface

Current Step 4 controller routes:

- `GET /health`
- `GET /metrics`
- `GET /telemetry/validate`
- `GET /telemetry/snapshot`
- `POST /rollouts/evaluate`
- `POST /rollouts/reconcile`

Snapshot example:

```bash
curl 'http://localhost:8090/telemetry/snapshot?service=payments-api&environment=staging&version=candidate'
```

Evaluation example:

```bash
curl -X POST 'http://localhost:8090/rollouts/evaluate' \
  -H 'Content-Type: application/json' \
  -d '{
    "labels": { "service": "payments-api", "environment": "staging", "version": "candidate" },
    "policy": {
      "rolloutSteps": [5, 25, 50, 100],
      "evaluationWindowSec": 60,
      "pollIntervalSec": 5,
      "warmupSec": 30,
      "requiredPasses": 3,
      "failureMode": "pause",
      "sloConfig": {
        "errorRatePct": { "max": 2 },
        "latencyP95Ms": { "max": 500 },
        "logErrorRatioPct": { "max": 1 }
      }
    },
    "state": {
      "currentStepIndex": 0,
      "currentWeight": 5,
      "consecutivePasses": 0,
      "consecutiveFailures": 0,
      "stepStartedAt": "2026-03-13T10:00:00Z"
    }
  }'
```

Local note:
- Loki query APIs require `LOKI_TENANT_ID`. The local `.env.example` uses `local`.
- In an empty local stack, rollout evaluation is expected to pause with `no_data` until real application telemetry exists.
- `POST /rollouts/evaluate` now publishes `rollout.evaluated` events and persists the latest deployment state in Redis for API replay.
- `POST /rollouts/reconcile` loads deployment state from MySQL, applies a Kubernetes-style traffic action, persists rollout and audit state, and republishes the latest live action through Redis.
- The current Kubernetes adapter runs in local `simulation` mode by default, so Sentra executes the control-plane loop end to end without requiring a real cluster in local development.

Reconcile example:

```bash
curl -X POST 'http://localhost:8090/rollouts/reconcile' \
  -H 'Content-Type: application/json' \
  -d '{
    "deploymentId": 1
  }'
```

## Dev
- API dev mode:
  ```bash
  cd services/api && npm i && npm run dev
  ```
- Controller:
  ```bash
  cd services/controller && go run .
  ```

## Verification
- Smoke-check the local stack:
  ```bash
  make smoke
  ```
- Run the end-to-end rollout verifier:
  ```bash
  make integration
  ```
- Run both:
  ```bash
  make verify
  ```
- Build and lint the frontend directly:
  ```bash
  cd services/web && npm run lint && npm run build
  ```

## Next (Phase 1 tasks)
- Extend the Kubernetes adapter from local simulation mode to direct cluster apply mode.
- Add more adapter and failure-path coverage as the backend expands.
- Expand the UI into the broader multi-cloud product described in the architecture docs.
