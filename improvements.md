# Sentra Product Readiness And Improvements

Analysis date: 2026-06-15
Last updated: 2026-08-10

## Executive Verdict

Sentra is not technically complete enough to sell today as a finished production product.

It has strong product foundations: a real multi-service architecture, database schema, web control room, rollout controller, telemetry readers, guarded cloud adapters, AI advisory flow, Docker Compose deployment, and CI definitions. That is much more than a simple demo.

The Phase 0 build/test blockers found in the original analysis have now been fixed locally, the local demo workload now proves telemetry-backed canary and rollback decisions, the API incident surface now reads persisted incidents with manual operator actions stored in MySQL, API OIDC/RBAC is implemented locally, and API rate limiting can use Redis for multi-replica deployments. The repository is still not a sellable production product because production runtime verification, broader security hardening, release packaging, and operations acceptance work remain.

Best commercial positioning right now:

- Yes: sell as a private beta, design partner pilot, or founder-led implementation after the critical build blockers are fixed.
- No: do not sell as a self-serve enterprise-grade production product yet.
- No: do not claim full production readiness until real deployment, telemetry, rollback, packaging, and security acceptance tests pass end to end.

## Verification Results

Latest local verification:

| Area | Command | Result |
| --- | --- | --- |
| API build | `docker build --target build -t sentra-api-test services/api` | Passed |
| API tests | `docker run --rm sentra-api-test npm test` | Passed, 33 tests |
| Controller tests | `go test ./...` in `services/controller` through `golang:1.22-alpine` source copy | Passed |
| AI tests | `python -m unittest discover -s tests` in `services/ai` through `python:3.12-slim` source copy | Passed, 3 tests |
| Web lint | `npm run lint` in `services/web` through `node:20-alpine` source copy | Passed |
| Web build | `npm run build` in `services/web` through `node:20-alpine` source copy | Passed |
| Self-hosted package smoke | `bash scripts/package-selfhosted.sh phase0-smoke` | Passed; generated bundle validates `docker compose config` |
| Clean self-hosted stack smoke | `bash scripts/smoke-selfhosted-bundle.sh clean-smoke` | Passed; temporary extracted bundle starts on alternate ports, applies local smoke auth overrides by replacing env keys, uses Redis-backed rate limiting, and passes smoke checks |
| Demo workload canary/rollback | `bash scripts/run-demo-workload-flow.sh` | Passed; optional demo workload profile feeds real Prometheus/Loki signals into controller-built snapshots for promote and rollback decisions |
| Pilot documentation | README beta scope and pilot checklist, verified with `git diff --check` | Passed; README now states private-pilot scope, proof already green, pilot gates, and remaining production gaps |
| Incident persistence | `bash scripts/apply-mysql-migrations.sh`, `docker compose build api`, `docker compose up -d --no-deps --force-recreate api`, `curl -fsS http://localhost:8080/incidents`, and `POST /incidents/28/notes` local smoke | Passed; API now reads MySQL incidents and persists manual operator notes/actions with audit events |
| Full regression after incident persistence | `bash scripts/run-regression-suite.sh` | Passed; latest summary at `reports/regression/0.2.0-beta.1/20260810T091530Z/summary.md` |
| OIDC/RBAC API security | `docker build --target build -t sentra-api-test services/api` and `docker run --rm sentra-api-test npm test` | Passed; tests cover local JWKS-backed OIDC JWT verification, static bearer read-only RBAC mapping, viewer read access, operator write authority, and tenant-claim enforcement |
| Full regression after OIDC/RBAC | `bash scripts/run-regression-suite.sh` | Passed; latest summary at `reports/regression/0.2.0-beta.1/20260810T093845Z/summary.md` |
| Redis-backed API rate limiting | `docker build --target build -t sentra-api-test services/api`, `docker run --rm sentra-api-test npm test`, `docker compose build api`, `docker compose up -d --no-deps --force-recreate api`, `curl -fsS http://localhost:8080/health`, `curl -fsS http://localhost:8080/projects`, `docker compose exec -T redis redis-cli --raw KEYS 'sentra:rate-limit*'`, and `bash scripts/smoke-selfhosted-bundle.sh clean-smoke` | Passed; API tests cover Redis shared-counter and fail-closed behavior, the live Compose API wrote a `sentra:rate-limit:v1:60:...` key to Redis, and the packaged clean-smoke path runs with Redis-backed limits |
| Full regression after Redis-backed rate limiting | `bash scripts/run-regression-suite.sh` | Passed; latest summary at `reports/regression/0.2.0-beta.1/20260810T100424Z/summary.md` |

Previously observed failures now fixed:

- API compilation around the `/events` SSE route.
- API route test imports and environment variable names.
- API package `npm test` script glob handling.
- Controller slog attribute compilation.
- AI test execution with dependencies installed in the test environment.
- Self-hosted bundle includes `services/ai`, a seeded `.env`, and Compose config validation.
- Generated `.next` and Python cache outputs are ignored, removed from the working tree, and excluded from bundles.

## What Is Already Strong

- Clear product idea: a telemetry-driven rollout control plane with automated promote, pause, and rollback.
- Multi-service architecture: API, controller, web UI, AI advisor, MySQL, Redis, Prometheus, Loki, Tempo.
- Real database schema with projects, services, environments, policies, deployments, rollout steps, incidents, audit events, satellites, and AI advisory history.
- Guarded rollout adapters exist for Kubernetes, Cloud Run, Lambda, and Azure Container Apps.
- Controller has meaningful unit tests for decisions, adapters, telemetry parsing, satellites, auth, traffic state, and stable capacity.
- Web app builds successfully and has real operator flows for dashboard, project detail, rollout detail, and satellite detail views.
- API has security middleware for bearer auth, tenant scoping, action authority, CORS, rate limiting, body limits, and sensitive config rejection.
- CI workflow is present for API, controller, web, AI, Compose validation, image builds, and vulnerability scanning.
- Self-hosted packaging exists as a starting point.

## Critical Blockers Before Selling

1. Done: Fix API compilation.
   - Restore `app.get('/events', asyncHandler(async (req, res) => { ... }))` around the SSE block in `services/api/src/index.ts`.
   - Run `npm run build` until clean.

2. Done: Fix API tests.
   - Correct imports in `services/api/src/routes.test.ts`, especially `../db.js` to the right source-relative path.
   - Align test environment variables with the current implementation. Tests use older names like `SENTRA_API_TOKEN`, while security code expects names like `SENTRA_API_BEARER_TOKEN`.
   - Make route tests independent of a developer's local MySQL state, or provide a test database bootstrap.

3. Done: Fix controller compilation.
   - Convert slog attributes to variadic `any` correctly in `services/controller/logger.go`.
   - Run `go test ./...` until all controller tests pass.

4. Done: Fix self-hosted packaging.
   - `scripts/package-selfhosted.sh` includes `services/ai`.
   - The generated bundle includes a seeded `.env` from `deploy/selfhosted/.env.production.example`.
   - The package script validates the generated bundle with `docker compose config`.

5. Done: Stop shipping generated artifacts.
   - `.gitignore` should include `.next/` and `__pycache__/`.
   - Remove tracked build/cache outputs if they are committed.
   - Product repos should be reproducible from source, not from checked-in local build artifacts.

6. Done: Make documentation truthful.
   - The README now starts with a Phase 0 beta/status warning.
   - Older consolidated "production-ready" and "85-90%" overclaim phrases have been replaced with beta/private-pilot wording.

## Product Gaps To Close

### Deployment Control

- Prove at least one real runtime path end to end, preferably Kubernetes first.
- Local demo workload now proves Prometheus/Loki-backed canary promotion and rollback through the controller's real telemetry path; a Kubernetes runtime proof is still pending.
- Add acceptance tests for initialize, promote, pause, rollback, and complete.
- Verify rollback identity and stable capacity on real infrastructure, not only simulation or unit tests.
- Make cloud adapter support explicit by tier: simulation, dry-run, limited production, production.

### Observability And Telemetry

- Remove or replace `services/api/src/telemetry/placeholder.ts`.
- Ensure rollout decisions use real telemetry by default in production paths.
- Add dashboard visibility when telemetry is missing, stale, partial, or misconfigured.
- Add provider-specific telemetry setup examples for Kubernetes, ECS, Cloud Run, Lambda, and Azure Container Apps.

### Incidents

- Done locally: API incident endpoints read controller-created MySQL incidents as the source of truth.
- Done locally: Manual acknowledge, note, and resolve actions persist to `incident_actions` and write audit events.
- Add explicit persisted action rows for controller auto-resolve flows.
- Add notification integrations for Slack, PagerDuty, email, and webhooks.

### Security

- Done locally: API accepts OIDC JWTs via discovery/JWKS and maps identity-provider roles to `viewer`, `operator`, and `admin`.
- Done locally: RBAC can authorize OIDC operator/admin writes without the shared action token.
- Done locally: API rate limiting can use Redis-backed shared counters, with fail-closed behavior by default when Redis is unavailable.
- Add web session handling and CSRF/same-origin protections for browser-origin write actions.
- Run production identity-provider acceptance against at least one real OIDC provider.
- Tune edge/gateway and per-endpoint limits for production deployments.
- Add security regression tests around tenant isolation for every route.
- Add a secret scanning step and remove local absolute paths from generated config.

### AI Advisor

- Treat the AI feature as advisory-only until there is real production data.
- The current AI dataset evidence appears mostly synthetic, so it is not strong enough for autonomous decisions.
- Remove local absolute dataset paths from `services/api/config/ai/candidate-risk-profile.json`.
- Add model/version metadata, calibration reports, rollback outcome labeling, and promotion gates based on real rollout history.

### Web Product Experience

- Add web unit/component tests and at least one browser end-to-end test.
- Add empty, loading, error, and disconnected states for every dashboard panel.
- Add a guided first-run setup that validates API, database, telemetry, and target integration.
- Add operator controls for pause, resume, rollback, retry, and acknowledge with clear permissions.
- Add product-grade onboarding copy that says exactly what is connected, simulated, or unsafe.

### CI And Release

- Make CI the single source of truth for sellability.
- Required green gates should include API build/test, controller test, AI test, web lint/build, Compose config, package smoke, and regression suite.
- Pin GitHub Actions to stable versions where practical.
- Add release artifacts with checksums and a changelog.
- Add migration compatibility tests from old schema to new schema.

### Operations

- Add backup and restore verification, not only commands.
- Add health/readiness endpoints that distinguish dependency failures.
- Add graceful shutdown tests for API, controller, Redis streams, and DB connections.
- Add log retention guidance and production dashboards.
- Add resource sizing guidance for small, medium, and large installations.

## Sellability Assessment

### Can We Sell It Today?

Not as a complete technical product.

The original API and controller build blockers are fixed locally, the local real-telemetry demo proof is passing, manual incident operator actions now persist, API OIDC/RBAC is implemented, and Redis-backed API rate limiting is locally verified. The current state still has too much risk for a paying production customer because production runtime proof, production identity-provider acceptance, multi-replica runtime/session controls, and release acceptance gates are not complete.

### Can We Sell A Pilot Soon?

Yes, after a short stabilization sprint.

A reasonable pilot offer would be:

- "Private beta deployment safety platform."
- "Founder-led installation."
- "Kubernetes-first, Prometheus/Loki/Tempo-first."
- "AI advisory is experimental and not autonomous."
- "Cloud adapter mutation modes are gated and enabled only after validation."

### What Must Be True Before A Paid Production Launch?

- API and controller builds are clean. Local verification is passing; CI still needs to confirm.
- All tests pass in CI.
- Self-hosted bundle includes every service required by Compose. Local package smoke is passing.
- Fresh install works from `.env.production.example`. Local Compose config smoke and a clean extracted self-hosted bundle smoke are passing.
- One local real-telemetry demo canary rollout succeeds and one local real-telemetry demo rollback succeeds.
- A real production/pilot workload runtime proof still needs to pass before broad production launch.
- Tenant isolation is tested route by route.
- API OIDC/RBAC is configured against the pilot identity provider and role claims are accepted in writing.
- Incidents and manual operator actions are persisted locally; controller auto-resolve action rows and notification integrations still need hardening.
- Redis-backed API rate limiting is locally verified; browser sessions, edge limits, and multi-replica runtime acceptance still need hardening.
- Documentation no longer overclaims.

## Recommended Roadmap

### Phase 0: Stabilize The Repo

- [x] Fix API `index.ts` SSE route compile error.
- [x] Fix API test imports and env names.
- [x] Fix API package `npm test` script.
- [x] Fix controller `logger.go` slog attr conversion.
- [x] Verify AI tests with dependencies installed in the test workflow/container.
- [x] Update `.gitignore` for `.next/` and `__pycache__/`.
- [x] Remove tracked generated `.next` and Python cache artifacts from the working tree.
- [x] Fix self-hosted bundle to include `services/ai`.
- [x] Add self-hosted bundle Compose config smoke.
- [x] Finish README truth cleanup for older consolidated "production-ready" claims.
- [ ] Ensure `git status` is clean after commit/push.

### Phase 1: Make It Pilot-Sellable

- [x] Run local stack smoke script against the running Compose stack.
- [x] Run full local regression suite: smoke, integration, multi-service, federation, AI benchmark, AI dataset, and AI profile training.
- [x] Run full Docker Compose stack from a clean extracted self-hosted bundle.
- [x] Add a single "demo workload" that proves real telemetry-driven canary and rollback.
- [x] Add honest beta docs and a pilot deployment checklist.

### Phase 2: Make It Production-Sellable

- [x] Persist incidents and operator actions.
- [x] Add OIDC/SSO and RBAC.
- [x] Add Redis-backed rate limiting.
- Add production migration tests.
- Add web E2E tests.
- Add signed release bundles.
- Add real dashboards and alerting packs.

### Phase 3: Make It Enterprise-Sellable

- Multi-tenant admin console.
- Audit export.
- SOC2-oriented controls.
- SSO group mapping.
- Policy approval workflows.
- Webhook ecosystem.
- HA deployment mode.
- Clear pricing/package boundaries.

## Bottom Line

Sentra has the right shape for a valuable product, and the core idea is commercially credible. Technically, it is currently an impressive beta/prototype with real architecture, not a complete sellable production platform.

The fastest path is to fix the red build/test gates first, then run one real Kubernetes canary/rollback demo end to end. Once that works from a clean self-hosted bundle, it becomes reasonable to sell paid pilots with careful beta positioning.
