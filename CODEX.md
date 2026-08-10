# Sentra Codex Reference

This file is the repo-level implementation reference for Codex. Read it before making code, architecture, documentation, release, or test changes in this repository.

## Product Identity

Sentra is a self-hosted, telemetry-driven deployment safety control plane. Its job is to make progressive delivery safer by watching live rollout signals and coordinating promote, pause, rollback, incident, audit, and operator-review flows.

Current product positioning is beta/private-pilot. Do not describe Sentra as fully production-ready until build/test gates, packaging, real rollout verification, security, and operations gates are green end to end. Some historical README sections still overclaim production readiness; `improvements.md` is the current readiness source of truth.

## Business Logic Guardrails

These rules should not be changed casually:

- Deterministic rollout safety remains the source of truth for traffic actions.
- AI is shadow/advisory only. AI may recommend, score, explain, and benchmark. AI must not directly mutate live traffic, approve promotion, or execute rollback.
- Rollout actions must preserve stable fallback capacity unless an explicit rollback/complete state requires otherwise.
- Pause and rollback behavior must favor safety over speed when telemetry is missing, stale, failing, or contradictory.
- Tenant isolation, auditability, and operator authority are product requirements, not optional polish.
- Cloud adapters must be explicit about capability level: simulation, dry-run, limited production, or production.
- Do not remove telemetry, incident, audit, or safety checks to make a demo pass.
- Do not hardcode local absolute paths, personal tokens, cloud credentials, or environment-specific secrets.
- Do not reintroduce multiple plan/runbook markdown files. Keep project planning and readiness notes consolidated unless the user explicitly asks otherwise.

## System Architecture

Primary services:

- `services/api`: Node.js/Express/TypeScript API. Owns HTTP routes, security middleware, tenant scoping, event streaming, AI orchestration, DB access, Redis access, incidents, audit, and read models.
- `services/controller`: Go rollout controller. Owns reconcile logic, rollout decisions, telemetry evaluation, cloud/runtime adapters, traffic state, satellite tasks, and controller metrics.
- `services/web`: Next.js control room. Owns operator-facing dashboard, project, rollout, satellite, AI advisory, AI evaluation, and benchmark views.
- `services/ai`: Python/FastAPI shadow advisor. Produces advisory-only rollout recommendations from rollout context.
- `db/migrations`: MySQL schema source of truth.
- `infra`: local Prometheus, Loki, Tempo, and Promtail configuration.
- `scripts`: verification, packaging, regression, AI dataset, and benchmark automation.

Local Compose services and ports:

- Web UI: `http://localhost:3000`
- API: `http://localhost:8080/health`
- AI advisor: `http://localhost:8000/health`
- Controller: `http://localhost:8090/health`
- Prometheus: `http://localhost:9090`
- Loki: `http://localhost:3100`
- Tempo: `http://localhost:3200`

## Rollout Business Flow

The intended rollout loop is:

1. Project, service, environment, policy, and deployment records are created in MySQL.
2. Controller reads rollout state and telemetry signals.
3. Telemetry is evaluated against policy gates.
4. Controller decides initialize, promote, pause, rollback, or complete.
5. Traffic adapters apply or simulate target traffic state.
6. API records rollout steps, audit events, incidents, and AI shadow advisories.
7. Web UI streams and displays rollout, telemetry, incident, and advisory state.

Any change to this flow must preserve safety-first behavior and auditability.

## AI Implementation Reference

AI is implemented as a shadow advisory layer, not as an autonomous controller.

Current AI components:

- `services/ai/app/main.py`: FastAPI app with `/health` and `POST /advisories/rollouts`.
- `services/ai/app/models.py`: Pydantic contract for rollout context and advisory output.
- `services/ai/app/advisor.py`: heuristic shadow advisor implementation.
- `services/api/src/ai.ts`: API-side resolver that calls the external AI service and falls back to local heuristic advisor if unavailable.
- `services/api/src/advisor.ts`: local primary heuristic advisor fallback.
- `services/api/src/advisor-candidate.ts`: candidate advisor stream.
- `services/api/src/ai-shadow.ts`: persistence, evaluation, benchmark, comparison, and dataset logic.
- `services/api/src/routes/ai.ts`: AI evaluation, benchmark, and dataset API routes.
- `db/migrations/005_ai_shadow_advisories.sql`, `006_ai_advisory_series.sql`, `007_read_model_indexes.sql`: persisted AI advisory schema/indexes.
- `reports/ai`: generated AI datasets, model reports, benchmark outputs, and candidate risk profile artifacts.
- `scripts/export-ai-training-dataset.mjs`, `train-ai-risk-profile.mjs`, `generate-ai-benchmark-report.mjs`: AI data and benchmark automation.

AI input context includes deployment id, rollout status, current traffic weight, last deterministic decision, live gate evaluation, incidents, rollout steps, audit events, satellite tasks, and optional `metadata.shadowBaseline`.

AI output contract includes:

- `mode`: always `shadow`
- `engine`: model/heuristic identifier
- `recommendation`: `continue`, `pause`, `rollback`, `investigate`, or `collect_more_data`
- `severity`: `low`, `elevated`, `high`, or `critical`
- `confidencePct`
- `riskScore`
- `headline`
- `summary`
- `rationales`
- `signals`
- `anomalies`
- `prediction`

AI promotion rules:

- Candidate AI output must be persisted as a separate candidate series.
- Candidate AI must be compared against the primary stream on shared rollout outcomes.
- Do not promote candidate AI from synthetic-only evidence.
- Promotion requires enough resolved outcomes, no material accuracy regression, risky-outcome recall not worse, warning precision not materially worse, and acceptable Brier score.
- Even promoted AI remains advisory-only unless the user explicitly changes the product requirement and the controller has separate safety gates.

## Data Model Anchors

Core MySQL entities include:

- projects
- services
- environments
- policies
- deployments
- rollout steps
- incidents
- audit events
- satellites
- satellite tasks
- AI advisories

Preserve foreign-key relationships, tenant scoping, audit trails, and read-model indexes when changing schema or queries.

## Security Requirements

Keep these security concepts intact:

- Bearer token protection for read access.
- Separate action authority token/header for mutating operator actions.
- Controller bearer token for controller write and telemetry endpoints.
- Tenant header/default tenant behavior.
- CORS restrictions.
- Request/body limits.
- Rate limiting.
- Sensitive value redaction in logs.
- Satellite request signing and replay protection.

Near-term security improvements should move toward production OIDC provider acceptance, web session handling, CSRF/same-origin clarity, route-by-route tenant isolation tests, and edge/per-endpoint rate-limit tuning.

## Implementation Workflow For Codex

Before changing code:

1. Read this `CODEX.md`.
2. Check `git status --short`.
3. Read the files directly involved in the requested change.
4. Check `improvements.md` when working on readiness, product gaps, or roadmap items.
5. Prefer existing patterns over new abstractions.
6. Keep edits scoped.
7. Do not revert user changes.

Before declaring a phase/gate complete:

- API build and tests must pass.
- Controller tests must pass.
- AI tests must pass.
- Web lint/build must pass.
- Docker Compose config/start/smoke should pass for stack-level changes.
- Self-hosted package smoke should pass for packaging changes.
- `git status --short` should be understood and explained.

## Current Phase Priority

The immediate stabilization and production-sellability status is:

1. Done: API package test script runs the test files correctly.
2. Done: Phase 0 service verification gates pass locally through containerized source-copy runs.
3. Done: self-hosted packaging includes `services/ai` and validates the generated Compose config.
4. Done: generated build/cache artifacts are ignored, excluded from bundles, and removed from the working tree.
5. Done: README truth cleanup removed older consolidated "production-ready" overclaims.
6. Done: local stack smoke and full local regression suite pass against the running Compose stack.
7. Done: clean extracted self-hosted bundle startup passes on alternate host ports.
8. Done: a local demo workload proves Prometheus/Loki-backed canary promotion and rollback through controller-built telemetry snapshots.
9. Done: README now includes honest beta/private-pilot scope, current proof, remaining production gaps, and a pilot deployment checklist.
10. Done: API incident endpoints read persisted MySQL incidents, and manual acknowledge/note/resolve operator actions persist to `incident_actions` with audit events.
11. Done: API OIDC/RBAC validates RS256 JWTs through discovery/JWKS, maps SSO roles to `viewer`, `operator`, and `admin`, and can authorize operator/admin writes without a shared action token.
12. Done: API rate limiting supports Redis-backed shared counters for multi-replica deployments, with memory as the local default and fail-closed Redis behavior by default.
13. Next: get the working tree committed/pushed, then continue Phase 2 with production migration tests, web E2E coverage, signed bundles, and operations verification.

## Documentation Rules

- Keep `README.md` as the unified documentation surface.
- Keep `improvements.md` as the readiness and roadmap assessment.
- Keep this `CODEX.md` as the implementation guardrail for Codex.
- Do not add separate runbooks, plans, or status files unless the user explicitly asks.
- When docs and code disagree, verify against code and update docs truthfully.
