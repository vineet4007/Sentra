# Sentra Project Structure

This document explains how the current Sentra repository is organized. It replaces the earlier scaffold snapshot with the structure of the working product loop: API, controller, web UI, AI advisor, database migrations, local observability, reports, and packaging.

Generated output is not part of the source map below. In a local checkout you may also see `services/web/.next/`, `services/api/dist/`, `dist/`, `.env`, `.DS_Store`, and Python `__pycache__/` folders.

## Top-Level Layout

```text
sentra/
|-- services/              Runtime services: API, controller, web, AI advisor
|-- db/                    MySQL schema and migration notes
|-- infra/                 Local observability config for Prometheus, Loki, Promtail, Tempo
|-- deploy/selfhosted/     Self-hosted Docker Compose packaging overlay and production env template
|-- scripts/               Smoke, integration, federation, regression, packaging, and AI report scripts
|-- reports/               Generated AI benchmark, dataset, model, and regression summaries
|-- docker-compose.yml     Local development stack
|-- Makefile               Common developer and verification commands
|-- VERSION                Locked release version
|-- README.md              Main setup and operational reference
|-- IMPLEMENTATION_PLAN.md Working build plan and status checklist
|-- OPERATIONS_RUNBOOK.md  Production-adjacent operational safeguards and runbook
|-- SENTRA_USER_GUIDE.md   Frontend operator guide
|-- architecture.md        Multi-cloud architecture direction
`-- *.md                   Product, safety, telemetry, and structure docs
```

## Runtime Services

Sentra is split into four service folders under `services/`.

### `services/api`

The Node.js TypeScript API owns onboarding, persisted control-plane writes, read models for the UI, SSE event streaming, tenant and auth handling, AI advisory aggregation, and report/export surfaces.

```text
services/api/
|-- Dockerfile
|-- package.json
|-- package-lock.json
|-- tsconfig.json
|-- eslint.config.js
|-- config/
|   `-- ai/
|       `-- candidate-risk-profile.json
`-- src/
    |-- index.ts                 Express app entrypoint
    |-- db.ts                    MySQL pool and query helpers
    |-- redis.ts                 Redis client wiring
    |-- events.ts                Rollout event publishing/streaming helpers
    |-- http.ts                  Shared HTTP helpers
    |-- middleware.ts            CORS and in-process API rate limiting
    |-- security.ts              API auth, tenancy, and redaction helpers
    |-- telemetry.ts             API-side telemetry validation helpers
    |-- rollout-safety.ts        Stable fallback and rollout policy validation
    |-- advisor.ts               AI advisor orchestration
    |-- advisor-candidate.ts     Candidate advisory series logic
    |-- ai.ts                    AI evaluation/benchmark data helpers
    |-- ai-shadow.ts             Shadow-mode advisory history and scorecards
    |-- candidate-profile.ts     Runtime loading of trained candidate profile
    |-- routes/
    |   |-- ai.ts
    |   |-- deployments.ts
    |   |-- environments.ts
    |   |-- health.ts
    |   |-- integrations.ts
    |   |-- policies.ts
    |   |-- projects.ts
    |   |-- rollouts.ts
    |   `-- satellites.ts
    `-- telemetry/
        `-- placeholder.ts
```

Current API responsibilities:

- project, service, environment, policy, deployment, rollout, and satellite routes
- same-origin data source for the Next.js frontend
- Redis-backed rollout live state and SSE replay support
- AI advisory history, evaluation, benchmark, dataset, and candidate comparison surfaces
- tenant-aware reads and writes when tenancy is enabled
- optional action-authority checks for human/operator write routes
- configurable CORS, JSON body limits, and in-process rate limiting
- secret redaction and inline secret rejection for integration config

### `services/controller`

The Go controller owns telemetry reads, deterministic rollout decisions, reconciliation, adapter execution, traffic state, federation heartbeat, and delegated satellite task execution.

```text
services/controller/
|-- Dockerfile
|-- go.mod
|-- go.sum
|-- main.go
|-- config.go
|-- auth.go
|-- store.go
|-- telemetry.go
|-- decision.go
|-- reconcile.go
|-- adapter.go
|-- traffic.go
|-- rollout_state.go
|-- satellite.go
|-- satellite_tasks.go
|-- stable_capacity.go
|-- *_test.go
```

Current controller responsibilities:

- `GET /health`, `GET /metrics`, `GET /telemetry/validate`, and `GET /telemetry/snapshot`
- `POST /rollouts/evaluate` for deterministic policy evaluation
- `POST /rollouts/reconcile` for loading deployment state and applying the next action
- Prometheus, Loki, and Tempo telemetry readers
- stable-capacity guards before rollout initialization and promotion
- Kubernetes, Cloud Run, AWS Lambda, and Azure Container Apps traffic adapters
- safe simulation defaults plus guarded direct-apply modes
- Redis live-state publication and MySQL audit/step/incident persistence
- satellite heartbeat and delegated `reconcile.deployment` task execution

### `services/web`

The Next.js frontend owns the operator control room, onboarding flow, rollout details, project workspace, satellite detail view, AI advisory panels, and the same-origin proxy to the API.

```text
services/web/
|-- Dockerfile
|-- package.json
|-- package-lock.json
|-- tsconfig.json
|-- next.config.ts
|-- eslint.config.mjs
|-- app/
|   |-- layout.tsx
|   |-- page.tsx
|   |-- globals.css
|   |-- not-found.tsx
|   |-- api/[...path]/route.ts
|   |-- projects/[id]/page.tsx
|   |-- rollouts/[id]/page.tsx
|   `-- satellites/[id]/page.tsx
|-- components/
|   |-- dashboard-shell.tsx
|   |-- onboarding-panel.tsx
|   |-- rollout-card.tsx
|   |-- rollout-detail-view.tsx
|   |-- project-detail-view.tsx
|   |-- satellite-detail-view.tsx
|   |-- delegate-task-panel.tsx
|   |-- live-event-stream.tsx
|   |-- ai-advisor-panel.tsx
|   |-- ai-benchmark-panel.tsx
|   |-- ai-evaluation-panel.tsx
|   |-- ai-shadow-review-panel.tsx
|   |-- status-pill.tsx
|   `-- step-track.tsx
|-- lib/
|   |-- api.ts
|   `-- types.ts
`-- public/
    `-- .gitkeep
```

Current frontend responsibilities:

- homepage control room at `/`
- project workspace at `/projects/:id`
- rollout detail page at `/rollouts/:id`
- satellite detail page at `/satellites/:id`
- onboarding for project, service, environment, telemetry, policy, and optional deployment revision
- rollout cards with traffic shape, gate summaries, incidents, AI context, and audit links
- delegated reconcile action when a live task-worker satellite is available
- API/SSE proxy through `app/api/[...path]/route.ts`

### `services/ai`

The Python FastAPI service provides the first advisory-only AI layer.

```text
services/ai/
|-- Dockerfile
|-- requirements.txt
|-- app/
|   |-- __init__.py
|   |-- main.py
|   |-- advisor.py
|   `-- models.py
`-- tests/
    |-- __init__.py
    `-- test_advisor.py
```

Current AI responsibilities:

- `fastapi-shadow-v1` advisory runtime
- risk scoring, rollback probability, predicted outcome, confidence, anomaly summaries, and rationale
- container-backed unit tests via `make ai-test`
- advisory-only operation; deterministic controller decisions remain authoritative

## Data Model

Database structure lives under `db/`.

```text
db/
|-- README.md
`-- migrations/
    |-- 001_initial_control_plane.sql
    |-- 002_tenant_security.sql
    |-- 003_federated_satellites.sql
    |-- 004_satellite_tasks.sql
    |-- 005_ai_shadow_advisories.sql
    |-- 006_ai_advisory_series.sql
    `-- 007_read_model_indexes.sql
```

The migrations define the persistent control plane:

- projects, services, environments, policies, deployments, rollout steps, incidents, and audit events
- tenant scoping and secret-reference support
- satellite registry and delegated task queue
- AI advisory history, advisory series, and model comparison data
- read-model indexes for common rollout, audit, incident, satellite, and AI queries

Fresh MySQL volumes apply these migrations automatically through Docker. Existing local databases can be migrated with `make db-migrate`.

## Local Infrastructure

Local observability configuration lives under `infra/`.

```text
infra/
|-- prometheus/
|   `-- prometheus.yml
|-- loki/
|   `-- loki-config.yml
|-- promtail/
|   `-- promtail-config.yml
`-- tempo/
    `-- tempo.yml
```

`docker-compose.yml` wires the local stack:

- MySQL for authoritative state
- Redis for live state, pub/sub, locks, and replay
- Prometheus for metrics
- Loki and Promtail for logs
- Tempo for traces
- API, controller, AI advisor, and web services

## Self-Hosted Packaging

```text
deploy/
`-- selfhosted/
    |-- .env.production.example
    |-- README.md
    `-- docker-compose.selfhosted.yml
```

The self-hosted overlay adds restart policies and log rotation defaults while keeping the development stack architecture intact. `scripts/package-selfhosted.sh` builds distributable archives under `dist/`.

## Scripts

```text
scripts/
|-- dev.sh
|-- apply-mysql-migrations.sh
|-- smoke-local-stack.sh
|-- verify-rollout-flow.mjs
|-- verify-multi-service-flow.mjs
|-- verify-federation-flow.sh
|-- run-regression-suite.sh
|-- generate-ai-benchmark-report.mjs
|-- export-ai-training-dataset.mjs
|-- train-ai-risk-profile.mjs
`-- package-selfhosted.sh
```

The scripts cover local startup, migration application, smoke checks, rollout verification, multi-service verification, federation verification, AI benchmark/dataset/profile workflows, regression runs, and packaging.

## Reports and Generated Evidence

```text
reports/
|-- ai/
|   |-- latest.md
|   |-- latest.json
|   |-- datasets/
|   |   |-- primary-latest.jsonl
|   |   |-- candidate-latest.jsonl
|   |   |-- latest-summary.md
|   |   `-- latest-summary.json
|   `-- models/
|       |-- candidate-risk-profile.md
|       `-- candidate-risk-profile.json
`-- regression/
    `-- 0.2.0-beta.1/
        |-- 20260327T043718Z/
        |   `-- summary.md
        |-- 20260327T044810Z/
        |   `-- summary.md
        `-- 20260327T060755Z/
            `-- summary.md
```

Reports currently include:

- AI benchmark readiness output
- primary and candidate advisory datasets
- candidate risk profile artifacts
- version-stamped regression summaries

## Documentation Map

```text
README.md                  Main setup, API, UI, controller, verification, and packaging reference
IMPLEMENTATION_PLAN.md     Working roadmap and completion checklist
SENTRA_USER_GUIDE.md       First-time frontend and operator guide
ROLLBACK_SAFETY_POLICY.md  Stable fallback and rollback safety expectations
OPERATIONS_RUNBOOK.md      TLS, request guardrails, graceful shutdown, backup/restore, health checks
TELEMETRY_REQUIREMENTS.md  Prometheus, Loki, Tempo, label, and query contract
architecture.md            Multi-cloud architecture and topology direction
PROJECT_OVERVIEW.md        Product overview
PROJECT_AIMS.md            Mission, goals, and technology stack
project.md                 Short product pitch
db/README.md               Database ownership and migration notes
deploy/selfhosted/README.md Self-hosted bundle instructions
directory_structure.md     Compact repository tree
project_structure.md       This structure and ownership guide
```

## Source Ownership Summary

| Area | Primary owner | Purpose |
| --- | --- | --- |
| `services/api` | Node API | Onboarding, CRUD, SSE, live views, AI evaluation, tenancy, auth |
| `services/controller` | Go controller | Telemetry reads, decisions, reconciliation, adapters, audit writes |
| `services/web` | Next.js UI | Operator control room, onboarding, rollout/project/satellite views |
| `services/ai` | FastAPI advisor | Advisory-only risk scoring and anomaly summaries |
| `db/migrations` | API and controller shared schema | Persistent control-plane state |
| `infra` | Local observability stack | Prometheus, Loki, Promtail, Tempo |
| `scripts` | Repo automation | Verification, reports, packaging, migrations |
| `reports` | Generated artifacts | AI and regression evidence |
| `deploy/selfhosted` | Packaging | Production-oriented Compose overlay |

## Current Product Shape

Sentra now has a working local product loop:

1. The UI onboards a project, service, environment, telemetry config, rollout policy, and optional deployment revision.
2. The API persists control-plane state in MySQL and publishes live updates through Redis/SSE.
3. The controller reads telemetry, evaluates rollout policy, reconciles traffic state, writes audit history, and publishes current action state.
4. Runtime adapters support safe simulation by default and guarded direct-apply modes for Kubernetes, Cloud Run, AWS Lambda, and Azure Container Apps.
5. Satellites can heartbeat, claim delegated reconcile tasks, execute them locally, and report completion centrally.
6. The AI service and API-side shadow layer expose advisory risk context, benchmark readiness, datasets, scorecards, and candidate model comparison without controlling rollout decisions.
