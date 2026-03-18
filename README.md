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
- Optional Step 10 security controls now exist:
  - `SENTRA_API_BEARER_TOKEN` protects the API.
  - `SENTRA_CONTROLLER_BEARER_TOKEN` protects controller write and telemetry endpoints.
  - `SENTRA_REQUIRE_TENANT`, `SENTRA_DEFAULT_TENANT`, and `SENTRA_TENANT_HEADER` enable tenant-scoped API reads and writes.

Services exposed:
- Web UI: http://localhost:3000
- API: http://localhost:8080/health
- AI advisor: http://localhost:8000/health
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
- `GET /satellites`
- `GET /satellites/:id`
- `GET /satellites/:id/tasks`
- `POST /satellites/heartbeat`
- `POST /satellites/:id/tasks`
- `POST /satellites/tasks/claim`
- `POST /satellites/tasks/:taskId/report`

## Web UI

Current Step 9 frontend flow:

- `/` shows the Sentra control room
- onboarding form for project, target, telemetry, and rollout policy setup
- rollout board with traffic progression, AI shadow advice, federation task context, incidents, and audit summaries
- live SSE pulse powered through the web proxy at `/api/events`
- `/rollouts/:id` shows a rollout detail view with step history, audit trail, incidents, and current action data
- `/satellites/:id` shows a satellite detail view with capability, telemetry validation, and delegated task history

Local note:
- When the API runs inside Docker Compose, telemetry validation must use URLs reachable from the API container, such as `http://prometheus:9090`, `http://loki:3100`, and `http://tempo:3200`.
- `GET /events` now sends an initial `rollout_snapshot` event from Redis before streaming new rollout events.
- `GET /rollouts` now includes persisted `auditEvents` alongside rollout steps, incidents, and Redis-backed live state.
- `GET /rollouts` now also includes `aiAdvisor` shadow-mode output plus deployment-linked `satelliteTasks`.
- The web service proxies API and SSE traffic through `/api/*`, so the browser does not need direct CORS access to the backend services.
- When API auth is enabled, the web proxy will forward `SENTRA_API_BEARER_TOKEN` and `SENTRA_DEFAULT_TENANT` automatically for same-origin UI requests.
- Project and environment reads now redact stored secret references and sensitive config keys from API responses.
- Sentra now rejects inline secret-looking keys such as `token`, `password`, `secret`, or `privateKey` in stored integration config and expects secret references instead.
- Docker Compose now defaults the API AI advisor settings to `SENTRA_AI_ENABLED=true` and `SENTRA_AI_URL=http://ai:8000`, so older local `.env` files still pick up the external advisor service.

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
- Step 10 now adds a guarded `kubectl` mode for Kubernetes targets. It stays off by default and requires both controller-level opt-in and per-environment target opt-in before Sentra will touch a real cluster.
- Step 10 also adds Cloud Run as the first cloud-managed adapter. It supports local `simulation` mode plus guarded `gcloud` traffic updates for revision-based rollouts.
- Step 10 now also adds AWS Lambda alias traffic control. It supports local `simulation` mode plus guarded `aws` CLI alias updates for weighted canaries.
- Step 10 now also adds Azure Container Apps revision traffic control. It supports local `simulation` mode plus guarded `az` CLI traffic updates for revision-based rollouts.
- Step 10 now also adds delegated federation. Satellites can heartbeat into the API coordinator, advertise task-worker capability, claim queued reconcile tasks, execute them locally, and report completion centrally.
- Step 10 now also adds the first AI shadow-mode advisory layer. Rollouts are enriched with heuristic risk scoring, recommendation hints, and rationale, but Sentra still treats that layer as advisory-only.
- Step 10 now also adds optional bearer auth on controller rollout endpoints so reconcile and evaluation actions can be protected independently from public health checks.

Reconcile example:

```bash
curl -X POST 'http://localhost:8090/rollouts/reconcile' \
  -H 'Content-Type: application/json' \
  -d '{
    "deploymentId": 1
  }'
```

Direct apply note:
- Keep `deployment_target_config.mode=simulation` for normal local work.
- To opt into direct Kubernetes apply, set `deployment_target_config.mode=kubectl`, `deployment_target_config.allowDirectApply=true`, and optionally `deployment_target_config.context`.
- The controller must also set `KUBERNETES_APPLY_ENABLED=true`.
- Real cluster mutations still require the second gate `KUBERNETES_ALLOW_MUTATIONS=true`. Otherwise Sentra will only allow `dryRun=true`.
- `KUBERNETES_ALLOWED_CONTEXTS` and `KUBERNETES_ALLOWED_CLUSTERS` can restrict which targets the controller is allowed to touch.
- In this Step 10 slice, direct `kubectl` apply supports the ingress canary strategy. Other Kubernetes strategies still stay in simulation mode until their direct-apply contract is defined.

Cloud Run note:
- Use `service.adapterType=cloudrun` and `environment.deploymentTargetType=cloudrun`.
- Store Cloud Run target config in `deployment_target_config`, for example:
  - `project`
  - `region`
  - `service`
  - `stableRevision`
  - `mode`
  - `allowDirectApply`
- Sentra uses the deployment `revision` as the candidate Cloud Run revision and `deploymentMetadata.stableRevision` or `deployment_target_config.stableRevision` as the stable revision.
- Keep `mode=simulation` for normal local work.
- To opt into guarded direct apply, set `mode=gcloud`, `allowDirectApply=true`, `GCP_CLOUDRUN_APPLY_ENABLED=true`, and `GCP_CLOUDRUN_ALLOW_MUTATIONS=true`.
- `GCP_CLOUDRUN_ALLOWED_PROJECTS` and `GCP_CLOUDRUN_ALLOWED_REGIONS` can restrict which Cloud Run targets the controller is allowed to touch.
- In this Step 10 slice, Cloud Run direct apply uses `gcloud run services update-traffic` for revision percentages. Because `gcloud` does not provide a true traffic dry-run for this path, use `simulation` mode when you want a non-mutating rehearsal.

AWS Lambda note:
- Use `service.adapterType=lambda` and `environment.deploymentTargetType=lambda`.
- Store Lambda target config in `deployment_target_config`, for example:
  - `functionName`
  - `aliasName`
  - `region`
  - `stableVersion`
  - `mode`
  - `allowDirectApply`
- Sentra uses the deployment `revision` as the candidate Lambda version and `deploymentMetadata.stableVersion` or `deployment_target_config.stableVersion` as the stable version.
- Keep `mode=simulation` for normal local work.
- To opt into guarded direct apply, set `mode=awscli`, `allowDirectApply=true`, `AWS_LAMBDA_APPLY_ENABLED=true`, and `AWS_LAMBDA_ALLOW_MUTATIONS=true`.
- `AWS_LAMBDA_ALLOWED_REGIONS` and `AWS_LAMBDA_ALLOWED_FUNCTIONS` can restrict which Lambda targets the controller is allowed to touch.
- In this Step 10 slice, Lambda direct apply uses `aws lambda update-alias` with `AdditionalVersionWeights` so Sentra can run weighted alias canaries and then promote or roll back by resetting the alias primary version.

Azure Container Apps note:
- Use `service.adapterType=containerapps` and `environment.deploymentTargetType=containerapps`.
- Store Azure target config in `deployment_target_config`, for example:
  - `subscriptionId`
  - `resourceGroup`
  - `containerAppName`
  - `stableRevision`
  - `mode`
  - `allowDirectApply`
- Sentra uses the deployment `revision` as the candidate Azure Container Apps revision and `deploymentMetadata.stableRevision` or `deployment_target_config.stableRevision` as the stable revision.
- Keep `mode=simulation` for normal local work.
- To opt into guarded direct apply, set `mode=azcli`, `allowDirectApply=true`, `AZURE_CONTAINERAPPS_APPLY_ENABLED=true`, and `AZURE_CONTAINERAPPS_ALLOW_MUTATIONS=true`.
- `AZURE_CONTAINERAPPS_ALLOWED_SUBSCRIPTIONS` and `AZURE_CONTAINERAPPS_ALLOWED_RESOURCE_GROUPS` can restrict which Azure targets the controller is allowed to touch.
- In this Step 10 slice, Azure Container Apps direct apply uses `az containerapp ingress traffic set --revision-weight ...`, which requires multiple revision mode on the target app.

Federated satellites note:
- The current federation slice adds a central `satellites` registry in MySQL plus a `satellite_tasks` queue for delegated execution.
- Enable a controller to behave like a satellite with:
  - `SATELLITE_ENABLED=true`
  - `SATELLITE_COORDINATOR_URL=http://api:8080`
  - optional `SATELLITE_COORDINATOR_TOKEN`
  - optional `SATELLITE_TENANT_KEY`
  - `SATELLITE_TASKS_ENABLED=true` to let the satellite poll and execute delegated reconcile work
  - optional `SATELLITE_TASK_POLL_INTERVAL_SEC`
  - optional `SATELLITE_TASK_LEASE_SEC`
- A satellite heartbeat publishes:
  - local identity such as `name`, `cloud`, `region`, and `cluster`
  - supported adapters and direct-apply capability flags
  - current telemetry validation summaries
  - whether the satellite can execute delegated task types such as `reconcile.deployment`
- `GET /satellites` computes freshness centrally and marks stale satellites when heartbeats stop arriving.
- `POST /satellites/:id/tasks` queues delegated work on a specific satellite.
- `POST /satellites/tasks/claim` and `POST /satellites/tasks/:taskId/report` form the coordinator-to-satellite task protocol.
- In the current federation slice, delegated work is intentionally narrow: the coordinator can queue `reconcile.deployment` tasks, and the satellite runs the existing local reconcile loop against its own controller runtime.
- The rollout detail page now lets operators queue delegated reconcile work from the UI when a live task-worker satellite is available.

AI advisory note:
- Sentra now exposes a first advisory-only AI layer directly in the rollout payload through `aiAdvisor`.
- The current advisor runs in `shadow` mode with engine `fastapi-shadow-v1`.
- The advisor is served by a separate FastAPI service under `services/ai`, and the API batches rollout contexts to it with local heuristic fallback if the service is unavailable.
- It uses rollout gates, incidents, audit history, current action, and delegated satellite task outcomes to estimate:
  - `riskScore`
  - `confidencePct`
  - `recommendation`
  - operator-facing rationale and signal summaries
- This layer is intentionally non-authoritative. It does not override the deterministic controller.

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
- `make integration` now also verifies that rollouts expose AI shadow advisor output.
- Run the container-backed AI advisor unit tests:
  ```bash
  make ai-test
  ```
- Run the federation verifier:
  ```bash
  make federation
  ```
- `make federation` now verifies both satellite heartbeats and delegated reconcile task execution through the coordinator queue.
- Run both:
  ```bash
  make verify
  ```
- Build and lint the frontend directly:
  ```bash
  cd services/web && npm run lint && npm run build
  ```

## Packaged Distribution
- Sentra now includes a first self-hosted packaging flow for Docker Compose deployments.
- Build a distributable archive with:
  ```bash
  make package
  ```
- This creates `dist/sentra-selfhosted-<timestamp>.tar.gz`.
- The bundle includes the API, controller, web app, migrations, observability config, and a self-hosted runtime overlay.
- For packaged installs, unpack the archive, copy `deploy/selfhosted/.env.production.example` to `.env`, then run:
  ```bash
  docker compose -f docker-compose.yml -f deploy/selfhosted/docker-compose.selfhosted.yml up -d --build
  ```
- The packaged overlay adds restart policies and log rotation defaults without changing the current repo's development flow.
- The production env template also includes optional satellite coordinator settings for federated deployments and delegated task workers.

## Next (Phase 1 tasks)
- Add the next runtime adapters after Kubernetes, Cloud Run, Lambda, and Azure Container Apps.
- Expand tenant-aware operations beyond the current project-scope model where needed.
- Expand federated satellite work beyond the current delegated reconcile queue into broader remote execution and richer local autonomy.
- Keep AI and ML work advisory-first once enough rollout history exists.
- Expand the UI into the broader multi-cloud product described in the architecture docs.
