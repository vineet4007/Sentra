# Sentra Directory Structure

This is the current source-focused directory map for Sentra.

Generated build output and local machine artifacts are intentionally not expanded here. That includes `services/web/.next/`, `services/api/dist/`, `dist/`, `.env`, `.DS_Store`, and Python `__pycache__/` folders.

```text
sentra/
|-- .github/
|   `-- workflows/
|       `-- ci.yml
|-- .editorconfig
|-- .env.example
|-- .gitignore
|-- Makefile
|-- VERSION
|-- docker-compose.yml
|-- README.md
|-- IMPLEMENTATION_PLAN.md
|-- PROJECT_AIMS.md
|-- PROJECT_OVERVIEW.md
|-- ROLLBACK_SAFETY_POLICY.md
|-- SENTRA_USER_GUIDE.md
|-- TELEMETRY_REQUIREMENTS.md
|-- architecture.md
|-- directory_structure.md
|-- project.md
|-- project_structure.md
|-- db/
|   |-- README.md
|   `-- migrations/
|       |-- 001_initial_control_plane.sql
|       |-- 002_tenant_security.sql
|       |-- 003_federated_satellites.sql
|       |-- 004_satellite_tasks.sql
|       |-- 005_ai_shadow_advisories.sql
|       `-- 006_ai_advisory_series.sql
|-- deploy/
|   `-- selfhosted/
|       |-- .env.production.example
|       |-- README.md
|       `-- docker-compose.selfhosted.yml
|-- infra/
|   |-- loki/
|   |   `-- loki-config.yml
|   |-- prometheus/
|   |   `-- prometheus.yml
|   |-- promtail/
|   |   `-- promtail-config.yml
|   `-- tempo/
|       `-- tempo.yml
|-- reports/
|   |-- ai/
|   |   |-- latest.md
|   |   |-- latest.json
|   |   |-- datasets/
|   |   |   |-- candidate-latest.jsonl
|   |   |   |-- latest-summary.md
|   |   |   |-- latest-summary.json
|   |   |   `-- primary-latest.jsonl
|   |   `-- models/
|   |       |-- candidate-risk-profile.md
|   |       `-- candidate-risk-profile.json
|   `-- regression/
|       `-- 0.2.0-beta.1/
|           |-- 20260327T043718Z/
|           |   `-- summary.md
|           |-- 20260327T044810Z/
|           |   `-- summary.md
|           `-- 20260327T060755Z/
|               `-- summary.md
|-- scripts/
|   |-- apply-mysql-migrations.sh
|   |-- dev.sh
|   |-- export-ai-training-dataset.mjs
|   |-- generate-ai-benchmark-report.mjs
|   |-- package-selfhosted.sh
|   |-- run-regression-suite.sh
|   |-- smoke-local-stack.sh
|   |-- train-ai-risk-profile.mjs
|   |-- verify-federation-flow.sh
|   |-- verify-multi-service-flow.mjs
|   `-- verify-rollout-flow.mjs
`-- services/
    |-- ai/
    |   |-- Dockerfile
    |   |-- requirements.txt
    |   |-- app/
    |   |   |-- __init__.py
    |   |   |-- advisor.py
    |   |   |-- main.py
    |   |   `-- models.py
    |   `-- tests/
    |       |-- __init__.py
    |       `-- test_advisor.py
    |-- api/
    |   |-- Dockerfile
    |   |-- eslint.config.js
    |   |-- package-lock.json
    |   |-- package.json
    |   |-- tsconfig.json
    |   |-- config/
    |   |   `-- ai/
    |   |       `-- candidate-risk-profile.json
    |   `-- src/
    |       |-- advisor-candidate.ts
    |       |-- advisor.ts
    |       |-- ai-shadow.ts
    |       |-- ai.ts
    |       |-- candidate-profile.ts
    |       |-- db.ts
    |       |-- events.ts
    |       |-- http.ts
    |       |-- index.ts
    |       |-- redis.ts
    |       |-- rollout-safety.ts
    |       |-- security.ts
    |       |-- telemetry.ts
    |       |-- routes/
    |       |   |-- ai.ts
    |       |   |-- deployments.ts
    |       |   |-- environments.ts
    |       |   |-- health.ts
    |       |   |-- integrations.ts
    |       |   |-- policies.ts
    |       |   |-- projects.ts
    |       |   |-- rollouts.ts
    |       |   `-- satellites.ts
    |       `-- telemetry/
    |           `-- placeholder.ts
    |-- controller/
    |   |-- Dockerfile
    |   |-- adapter.go
    |   |-- adapter_test.go
    |   |-- auth.go
    |   |-- auth_test.go
    |   |-- config.go
    |   |-- decision.go
    |   |-- decision_test.go
    |   |-- go.mod
    |   |-- go.sum
    |   |-- main.go
    |   |-- reconcile.go
    |   |-- rollout_state.go
    |   |-- satellite.go
    |   |-- satellite_test.go
    |   |-- satellite_tasks.go
    |   |-- satellite_tasks_test.go
    |   |-- stable_capacity.go
    |   |-- stable_capacity_test.go
    |   |-- store.go
    |   |-- telemetry.go
    |   |-- telemetry_test.go
    |   |-- traffic.go
    |   `-- traffic_test.go
    `-- web/
        |-- .dockerignore
        |-- Dockerfile
        |-- eslint.config.mjs
        |-- next-env.d.ts
        |-- next.config.ts
        |-- package-lock.json
        |-- package.json
        |-- tsconfig.json
        |-- app/
        |   |-- globals.css
        |   |-- layout.tsx
        |   |-- not-found.tsx
        |   |-- page.tsx
        |   |-- api/
        |   |   `-- [...path]/
        |   |       `-- route.ts
        |   |-- projects/
        |   |   `-- [id]/
        |   |       `-- page.tsx
        |   |-- rollouts/
        |   |   `-- [id]/
        |   |       `-- page.tsx
        |   `-- satellites/
        |       `-- [id]/
        |           `-- page.tsx
        |-- components/
        |   |-- ai-advisor-panel.tsx
        |   |-- ai-benchmark-panel.tsx
        |   |-- ai-evaluation-panel.tsx
        |   |-- ai-shadow-review-panel.tsx
        |   |-- dashboard-shell.tsx
        |   |-- delegate-task-panel.tsx
        |   |-- live-event-stream.tsx
        |   |-- onboarding-panel.tsx
        |   |-- project-detail-view.tsx
        |   |-- rollout-card.tsx
        |   |-- rollout-detail-view.tsx
        |   |-- satellite-detail-view.tsx
        |   |-- status-pill.tsx
        |   `-- step-track.tsx
        |-- lib/
        |   |-- api.ts
        |   `-- types.ts
        `-- public/
            `-- .gitkeep
```
