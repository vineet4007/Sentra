# Sentra Implementation Plan

This file turns the current project docs and code into one practical build plan.
It is meant to be the working checklist we update as Sentra moves from scaffold to usable product.

## Status Legend

- `[x]` Done in the current repo
- `[ ]` Not done yet

## Project Goal

Sentra is intended to become a self-hosted, telemetry-driven deployment control plane that can:

- observe live metrics, logs, and traces
- evaluate rollout health every few seconds
- promote, pause, or roll back deployments automatically
- support multi-cloud and hybrid environments through adapter layers

## Current Reality

The repo has moved beyond the initial scaffold phase.
It can now boot a local stack, evaluate rollout health, execute a first end-to-end rollout loop in a Kubernetes-style local simulation mode, and expose that loop through a real frontend.

## User Integration Inputs We Must Support

These are the things a Sentra user will need to connect before the platform can monitor and control a real project.

### Project and service identity

- [x] Project name
- [x] Service name
- [x] Environment name such as `dev`, `staging`, or `prod`
- [x] Deployment target type such as Kubernetes, Lambda, ECS, Cloud Run, or Azure Functions
- [x] Repo, image, or revision metadata for each deployment

### Deployment access and project keys

- [x] Kubernetes access details such as cluster, namespace, and service account or kube context
- [ ] AWS integration details such as role ARN, region, and target service identifiers
- [ ] Azure integration details such as subscription, tenant, managed identity, and resource names
- [ ] GCP integration details such as project ID, workload identity, and target service names
- [x] Secret references for any required API keys, tokens, or credentials

Important rule:

- [ ] Do not store raw cloud secrets directly in Git
- [ ] For local development, allow `.env`
- [ ] For real deployments, use secret managers or workload identity and store only secret references in Sentra

### Telemetry and monitoring inputs

- [x] Prometheus endpoint and any auth details needed for metrics queries
- [x] Loki endpoint and any auth details needed for log queries
- [x] Tempo endpoint and any auth details needed for trace queries
- [x] Standard labels for telemetry such as `project`, `service`, `env`, `version`, `region`, and `cluster`
- [x] SLO thresholds for each service such as error rate, latency, and failure ratio

### User-facing outputs

- [x] Live rollout status
- [x] Promote, pause, and rollback decisions
- [x] Audit log of what Sentra did and why
- [x] Current telemetry gate results
- [ ] Incident and failure summaries

## How Monitoring Is Supposed To Work

Sentra is not meant to monitor systems in the same way a dashboard tool does.
Its monitoring model is part of a decision loop:

1. A user connects a project, environment, deployment target, and telemetry sources.
2. Sentra reads live metrics from Prometheus, logs from Loki, and traces from Tempo.
3. The controller evaluates rollout health every few seconds over a sliding time window.
4. Sentra compares live telemetry against service-specific SLO thresholds.
5. If the rollout looks healthy, Sentra promotes to the next step.
6. If telemetry degrades, Sentra pauses or rolls back.
7. The API and UI show the current state, telemetry gate results, and the reason for each decision.

### What Sentra should monitor first

- [ ] Error rate from Prometheus
- [ ] p95 latency from Prometheus
- [ ] Log error ratio from Loki
- [ ] Trace failure ratio from Tempo
- [ ] Deployment step timing and rollout progression

### How users should connect monitoring

- [x] Register their project and environment in Sentra
- [x] Provide deployment target configuration
- [x] Provide telemetry endpoints and label conventions
- [x] Provide secret references or identity-based access
- [x] Define rollout policy and SLO thresholds
- [x] Start a deployment and watch live rollout decisions

## Step-by-Step Plan

### Step 0: Define the foundation and scaffold

Status: Done

- [x] Project vision documented across `project.md`, `PROJECT_OVERVIEW.md`, `PROJECT_AIMS.md`, and `architecture.md`
- [x] Local infrastructure scaffolded with Docker Compose
- [x] Go controller service created
- [x] Node.js API service created
- [x] Prometheus, Loki, Promtail, and Tempo config added
- [x] Basic health endpoints added for API and controller

Exit criteria:
- The repo clearly communicates what Sentra is and what the first platform components are.

Validation notes:
- [x] `docker compose config` parses successfully
- [x] `go test ./...` passes for the controller
- [x] `npm run build` passes for the API
- [x] `npm run lint` passes for the API
- [x] `docker compose up -d --build` now works after fixing local stack compatibility issues

### Step 1: Stabilize the local developer baseline

Status: Done

- [x] `README.md` describes the local startup flow
- [x] `scripts/dev.sh` exists for quick local boot
- [x] Add the missing `.env.example` file expected by the README and startup script
- [x] Add placeholder variables that show where local project keys and telemetry endpoints will be configured
- [x] Document which values are safe for `.env` in development and which must move to secret managers later
- [x] Add `.gitignore` and `.editorconfig` so local setup is safer and more consistent
- [x] Confirm the repo boots cleanly from a fresh checkout using the documented setup steps
- [x] Verify the exposed services and health endpoints after startup
- [x] Document startup gaps and fix the ones found during verification

Exit criteria:
- A new developer can clone the repo, start the stack, and reach the health endpoints without manual fixes.

Step 1 notes:
- [x] Added `.env.example` with working local defaults and integration placeholders
- [x] Updated the controller to respect `CONTROLLER_HTTP_PORT`
- [x] Added the missing ESLint flat config for the API
- [x] Fixed the API Redis typing issue so the TypeScript build succeeds
- [x] Added `go.sum` entries so the controller can be tested cleanly
- [x] Removed the obsolete MySQL 8.4 authentication flag that prevented the database from starting
- [x] Updated the Loki config so the service can start in this local single-node setup
- [x] Verified API `/health`, controller `/health`, Prometheus readiness, and live Loki and Tempo HTTP responses
- [x] Verified Redis and MySQL health through `docker compose ps`

### Step 2: Create the control-plane data model and onboarding model

Status: Done

- [x] Add MySQL schema and migrations for `projects`
- [x] Add MySQL schema and migrations for `services`
- [x] Add MySQL schema and migrations for `environments`
- [x] Add MySQL schema and migrations for `policies`
- [x] Add MySQL schema and migrations for `deployments`
- [x] Add MySQL schema and migrations for `rollout_steps`
- [x] Add MySQL schema and migrations for `incidents` and audit records
- [x] Add a place to store deployment target configuration per environment
- [x] Add a place to store telemetry source configuration per environment
- [x] Store references to secrets or identities instead of raw cloud keys
- [x] Add label-mapping fields so Sentra knows how to query a user's metrics, logs, and traces
- [x] Decide which service owns reads and writes for these tables

Exit criteria:
- Sentra has a persistent, queryable source of truth for policies, deployments, rollout history, and user integration settings.

Validation notes:
- [x] Added `db/migrations/001_initial_control_plane.sql` and mounted it into MySQL for fresh local startup
- [x] Added `scripts/apply-mysql-migrations.sh` and `make db-migrate` for existing databases
- [x] Added `db/README.md` to document schema intent and service ownership
- [x] Verified the fresh MySQL container initialized the schema automatically
- [x] Verified the manual migration runner applies cleanly against an existing local database
- [x] Verified the `schema_migrations` table contains version `001`
- [x] Verified the core tables exist: `projects`, `services`, `environments`, `policies`, `deployments`, `rollout_steps`, `incidents`, and `audit_events`

### Step 3: Build the API beyond health checks

Status: Done

- [x] Redis client wiring exists
- [x] `/health` endpoint exists
- [x] Replace placeholder `/events` endpoint with real rollout event streaming
- [x] Add database connectivity and configuration
- [x] Add project onboarding endpoints
- [x] Add endpoints to register deployment target settings
- [x] Add endpoints to register telemetry endpoints and label mappings
- [x] Add validation to confirm the provided monitoring endpoints are reachable
- [x] Add endpoints to create and fetch policies
- [x] Add endpoints to create and fetch deployments
- [x] Add `/rollouts` endpoint for current rollout state
- [x] Add request validation and consistent response shapes

Exit criteria:
- The API can onboard a project, validate monitoring inputs, create rollout-related records, and expose live rollout state to clients.

Validation notes:
- [x] Added shared MySQL pool configuration and health checks in the API
- [x] Added project, environment, integration, policy, deployment, and rollout routes
- [x] Added Redis-backed SSE event streaming on `/events`
- [x] Verified `npm run lint` passes for the API
- [x] Verified `npm run build` passes for the API
- [x] Verified `POST /projects/onboard` creates project, service, and environment records
- [x] Verified `POST /integrations/validate` reaches Prometheus, Loki, and Tempo successfully
- [x] Verified `PUT /environments/:id/integrations` updates deployment target, telemetry config, labels, and secret refs
- [x] Verified `POST /policies` stores SLO config and rollout steps
- [x] Verified `POST /deployments` creates a deployment and seeds rollout steps from policy
- [x] Verified `GET /deployments`, `GET /policies`, and `GET /rollouts` return the expected control-plane state
- [x] Verified `/events` streams the `deployment.created` event published through Redis

### Step 4: Build telemetry readers

Status: Done

- [x] Prometheus, Loki, and Tempo are present in local infra
- [x] Telemetry adapter placeholder file exists
- [x] Add typed Prometheus query client
- [x] Add typed Loki query client
- [x] Add typed Tempo query client
- [x] Define a standard telemetry snapshot shape shared by the controller
- [x] Add polling windows and sampling intervals
- [x] Add initial validation queries to confirm a user's telemetry integration is working
- [x] Add label-based query construction so monitoring can be scoped per project, service, environment, and version
- [x] Document which metrics, logs, and traces are required for rollout decisions

Exit criteria:
- The controller can fetch the telemetry needed to evaluate rollout gates for a user-connected project.

Validation notes:
- [x] Added controller-side Prometheus, Loki, and Tempo HTTP clients
- [x] Added `/telemetry/validate` for backend reachability checks
- [x] Added `/telemetry/snapshot` for normalized rollout-health snapshots
- [x] Added background telemetry validation metrics in the controller
- [x] Added local timing and Loki tenant config to `.env.example`
- [x] Added `TELEMETRY_REQUIREMENTS.md` to document the Step 4 telemetry contract
- [x] Verified `go test ./...` passes for the controller after the telemetry reader changes

### Step 5: Implement the rollout decision engine

Status: Done

- [x] Define rollout steps such as `5 -> 25 -> 50 -> 100`
- [x] Add warm-up timing and sliding evaluation windows
- [x] Implement SLO gates such as error rate and p95 latency
- [x] Implement log-based and trace-based gates
- [x] Add consecutive pass or fail logic
- [x] Emit `promote`, `pause`, and `rollback` decisions
- [x] Expose controller metrics for decisions and failures
- [x] Attach human-readable reasons to each decision so users understand what was monitored and why Sentra acted

Exit criteria:
- The controller can make deterministic rollout decisions from live telemetry.

Validation notes:
- [x] Added a deterministic controller evaluation engine on top of the Step 4 telemetry snapshot layer
- [x] Added `POST /rollouts/evaluate` to combine rollout policy, rollout state, and live telemetry into a decision
- [x] Added support for warm-up timing, consecutive pass counts, threshold failures, severe rollback thresholds, and safe no-data pauses
- [x] Added rollout decision Prometheus metrics for evaluations, emitted decisions, and gate failures
- [x] Added unit tests for warm-up hold, promote, pause, rollback, and no-data cases
- [x] Verified `go test ./...` passes for the controller after the Step 5 changes
- [x] Verified a synthetic healthy evaluation promotes from `5%` to `25%`
- [x] Verified a live local evaluation pauses when telemetry backends are reachable but application signals are still `no_data`

### Step 6: Add live state propagation through Redis

Status: Done

- [x] Define Redis channels or keys for rollout events and live state
- [x] Publish controller decisions into Redis
- [x] Subscribe from the API and relay updates to clients
- [x] Add a durable snapshot strategy so the latest rollout state survives reconnects

Exit criteria:
- The API and controller share rollout state in real time through Redis.

Validation notes:
- [x] Reused the shared `sentra:rollout-events` channel for controller evaluation events
- [x] Added Redis-backed per-deployment latest-state keys and an index set for replayable live state
- [x] Updated controller evaluation to publish `rollout.evaluated` events and persist latest state
- [x] Added API live-state readers plus `GET /rollouts/live`
- [x] Updated `GET /rollouts` to include Redis-backed `liveState` alongside database rollout records
- [x] Updated `/events` to emit an initial `rollout_snapshot` from Redis before subscribing for new events
- [x] Verified controller tests still pass and API lint/build still pass after the Redis changes
- [x] Verified a controller evaluation for `deploymentId=1` is streamed by the API as `rollout.evaluated`
- [x] Verified `/rollouts/live` and `/rollouts?deploymentId=1` both return the persisted latest rollout state
- [x] Verified reconnecting to `/events` replays the stored rollout snapshot immediately

### Step 7: Ship the first real deployment adapter

Status: Done

- [x] Pick a single target runtime for v1
- [x] Implement one real adapter, preferably Kubernetes traffic weighting
- [x] Translate controller decisions into actual rollout actions
- [x] Add safety checks before promote and rollback actions
- [x] Record every action in persistent audit history

Exit criteria:
- Sentra can observe, decide, and act on one real deployment target end to end.

Validation notes:
- [x] Added controller-side MySQL loading for deployments, policies, rollout steps, and environment target config
- [x] Added `POST /rollouts/reconcile` so the controller can initialize and advance a deployment from stored state
- [x] Added a Kubernetes-style traffic adapter with safe local `simulation` mode
- [x] Added rollout step and deployment persistence for initialize, hold, pause, rollback, promote, and complete actions
- [x] Added audit event persistence and surfaced audit history through `GET /rollouts`
- [x] Added Redis live-state publishing for controller-applied actions so reconnects replay the latest action state
- [x] Added controller tests for adapter behavior and label-map normalization
- [x] Verified a pending deployment initializes to `5%` traffic through the reconcile loop
- [x] Verified warmup and healthy-hold actions persist back into MySQL and Redis live state
- [x] Verified three healthy synthetic reconciles promote the deployment from `5%` to `25%` and start the next rollout step

Important note:
- [x] The current adapter executes in local Kubernetes-style `simulation` mode. The end-to-end control loop is real inside Sentra, while direct cluster writes can be the next hardening step when we move past local verification.

### Step 8: Add auditability, tests, and operational confidence

Status: Done

- [x] Persist rollout decisions and step transitions
- [x] Add unit tests for policy evaluation and decision logic
- [x] Add integration tests for API, Redis, and controller flow
- [x] Add startup smoke tests for the local stack
- [x] Add failure-path tests for degraded telemetry and rollback behavior

Exit criteria:
- Core rollout behavior is testable, auditable, and reliable enough for iterative expansion.

Validation notes:
- [x] Added `scripts/smoke-local-stack.sh` for local health, readiness, and live-state smoke checks
- [x] Added `scripts/verify-rollout-flow.mjs` for end-to-end API/controller/Redis rollout verification
- [x] Added `make smoke`, `make integration`, and `make verify` targets to make the confidence checks easy to rerun
- [x] Verified the smoke script passes against the running Docker stack
- [x] Verified the integration script provisions a fresh project, promotes one deployment through healthy synthetic telemetry, and rolls back another deployment through unhealthy telemetry
- [x] Verified rollback creates incidents and audit history through the API rollout view

### Step 9: Build the UI after the backend loop is real

Status: Done

- [x] Create the Next.js frontend described in the docs
- [x] Add project onboarding screens for keys, target config, and telemetry setup
- [x] Show current rollout state and step progression
- [x] Show SLO gate results and recent telemetry
- [x] Show audit history and rollback reasons
- [x] Stream live changes from the API

Exit criteria:
- Users can watch rollouts and understand why Sentra made each decision.

Validation notes:
- [x] Added a new Next.js web service in `services/web`
- [x] Added a control-room homepage with onboarding, rollout board, and live event pulse
- [x] Added a rollout detail view with step progression, gate results, incidents, audit history, and action context
- [x] Added a same-origin `/api/*` proxy in the web app for backend JSON and SSE traffic
- [x] Added web Docker wiring so the frontend runs at `localhost:3000` in Compose
- [x] Verified `npm run lint` passes for the web service
- [x] Verified `npm run build` passes for the web service
- [x] Verified the homepage renders live rollout data through the running Docker stack
- [x] Verified `/rollouts/1` renders the rollout detail experience with audit and gate data
- [x] Verified the frontend SSE proxy returns the initial `connected` and `rollout_snapshot` events

### Step 10: Expand to the broader platform vision

Status: In progress

- [x] Extend the Kubernetes adapter from simulation-only mode to guarded `kubectl` direct apply mode
- [x] Add more runtime adapters for AWS, Azure, and GCP services
- [x] Support federated satellite deployments
- [x] Add auth, tenancy, and stronger security controls
- [ ] Add ML-assisted anomaly detection and predictive rollback features
- [x] Package the product for easier distribution

Exit criteria:
- Sentra moves from a single working control loop into the full multi-cloud platform described in the architecture docs.

Validation notes:
- [x] Added controller-level safety gates for direct Kubernetes apply: `KUBERNETES_APPLY_ENABLED`, `KUBERNETES_ALLOW_MUTATIONS`, and allowlists for contexts and clusters
- [x] Added per-environment target opt-in through `deployment_target_config.allowDirectApply`
- [x] Kept `simulation` as the default safe mode for local work
- [x] Added adapter tests for simulation, guarded `kubectl` dry-run command construction, and blocked mutation paths
- [x] Added Cloud Run as the first cloud-managed adapter with local `simulation` mode and guarded `gcloud` apply mode
- [x] Added Cloud Run controller safety gates for project and region allowlists plus explicit mutation enablement
- [x] Added adapter tests for Cloud Run simulation, guarded `gcloud` command construction, and missing stable revision failures
- [x] Added AWS Lambda as the next cloud-managed adapter with local `simulation` mode and guarded `aws` CLI alias update mode
- [x] Added Lambda controller safety gates for region and function allowlists plus explicit mutation enablement
- [x] Added adapter tests for Lambda simulation, guarded `aws lambda update-alias` command construction, and missing stable version failures
- [x] Added Azure Container Apps as the next cloud-managed adapter with local `simulation` mode and guarded `az` CLI traffic update mode
- [x] Added Azure Container Apps controller safety gates for subscription and resource group allowlists plus explicit mutation enablement
- [x] Added adapter tests for Azure Container Apps simulation, guarded `az containerapp ingress traffic set` command construction, and missing stable revision failures
- [x] Added the first federated-satellite coordinator slice with a MySQL `satellites` registry and tenant-scoped API heartbeat endpoints
- [x] Added controller-side satellite heartbeat support so a regional controller can publish local identity, capabilities, and telemetry freshness to the coordinator
- [x] Added controller tests for satellite heartbeat payloads, auth headers, tenant headers, and coordinator error handling
- [x] Added a MySQL `satellite_tasks` queue plus coordinator API routes for task queueing, claiming, listing, and completion reporting
- [x] Added controller-side satellite task polling so a regional controller can claim delegated reconcile work from the coordinator and report results back
- [x] Verified federated delegation end to end by queueing `reconcile.deployment` tasks through the coordinator and watching a satellite controller initialize then promote a rollout locally
- [x] Added rollout-linked satellite task history to the API and UI so operators can see which satellite executed delegated work
- [x] Added a satellite detail screen plus rollout-side delegated reconcile action from the UI
- [x] Added optional bearer auth for API and controller surfaces through environment configuration
- [x] Added tenant-aware project scoping with `tenant_key` persistence and request-level tenant filtering
- [x] Added response redaction for stored secret refs and sensitive integration config keys
- [x] Added validation that rejects inline secret material in persisted integration config and expects secret references instead
- [x] Verified tenant-filtered project reads return only tenant-owned records
- [x] Verified onboarding rejects inline secret-like fields with HTTP `400`
- [x] Added a self-hosted packaging script that produces a distributable Docker Compose archive under `dist/`
- [x] Added a packaged runtime overlay with restart policies and log rotation defaults
- [x] Added production-oriented bundle env and install docs under `deploy/selfhosted/`
- [x] Verified the packaging script produces a self-hosted archive that includes the install docs, runtime overlay, and core service sources
- [x] Added an initial advisory-only AI shadow layer (`heuristic-v1`) that computes rollout risk, confidence, and recommendation hints from gates, incidents, audit history, and satellite task outcomes
- [x] Verified integration and federation flows still pass with AI advisory output included in rollout responses

## Recommended Current Focus

Continue Step 10 with broader multi-cloud coverage, federated topology, and packaging.

Why this is next:

- Sentra now has the first complete local product loop: onboarding, decisioning, actioning, auditability, and UI.
- The next missing layer is breadth: more adapters, stronger runtime auth, multi-cloud support, and the broader packaging and security model from the architecture docs.
- Step 10 is where Sentra grows from one working control loop into the wider platform vision.
- Future AI work should still stay behind the core platform expansion until enough real rollout history exists.

## What Is Already True Today

- The project vision is documented well.
- The architecture direction is clear.
- The repo already has the right top-level building blocks.
- The controller and API now form a working local rollout control loop.
- The observability stack is present locally.
- The repo has executable smoke and integration checks for the current backend flow.
- The repo now has a real control-room frontend on top of the current API and SSE surface.

## AI Strategy

AI should be part of Sentra, but not part of the first production-critical rollout loop.

### Recommended approach

- [x] Keep AI in the product vision
- [x] Design the system so AI can plug in later
- [x] Do not make AI a dependency for the first working version
- [x] Build the deterministic monitoring and decision engine first
- [ ] Add AI only after Sentra has real rollout history and telemetry data

### What to do now

- [ ] Store rollout history, telemetry snapshots, decisions, and outcomes in a structured way
- [ ] Keep controller decisions explainable and rule-based
- [ ] Define a clean interface where an AI service can later return risk scores, anomaly signals, or recommendations
- [ ] Capture enough metadata to compare predicted outcomes against real outcomes later

### What to do later

- [ ] Add a separate Python FastAPI service for AI and ML features
- [ ] Start with anomaly detection and risk scoring
- [ ] Run AI in shadow mode first so it recommends actions without executing them
- [ ] Compare AI recommendations against actual rollout outcomes
- [ ] Promote AI from advisory mode to limited decision support only after it proves reliable
- [ ] Consider advanced features later such as predictive rollback, canary tuning, and dynamic SLO suggestions

### Why this is the right order

- The first version of Sentra is already valuable without AI.
- AI needs historical rollout and telemetry data to be useful.
- Rule-based decisions are easier to test, explain, and trust early on.
- AI works best as an improvement layer on top of a stable control plane, not as a replacement for one.

## What We Should Do Immediately After Step 9

Move into Step 10 by expanding the current local control loop in this order:

1. [x] Extend the Kubernetes adapter from simulation mode to direct cluster apply mode with explicit safety gates.
2. [x] Add the next runtime adapter after Kubernetes, preferably one cloud-managed target such as Lambda aliases or Cloud Run revisions.
3. [x] Add stronger auth, tenancy, and secret-handling controls before broadening the deployment surface further.

## First User Onboarding Story We Should Target

The first complete user story should look like this:

1. A user registers a project and service.
2. The user selects one deployment target type.
3. The user adds telemetry sources for metrics, logs, and traces.
4. The user provides secret references or identity-based access.
5. The user defines SLO thresholds.
6. The user starts a deployment.
7. Sentra monitors telemetry, makes rollout decisions, and shows the reason for each decision.

If we can make this story work for one deployment target and one service, the rest of the platform can grow around a real core instead of assumptions.
