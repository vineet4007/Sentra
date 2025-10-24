# Sentra — Autonomous Real‑Time Infrastructure Platform

> **Tagline:** *Real‑time, fault‑tolerant streaming with zero‑downtime delivery, protected by an autonomous release guard.*

---

## Why Sentra exists
Modern systems need two things at once: **sub‑120ms end‑to‑end updates** at scale **and** deployments that **don’t break production**. Teams hack together brokers, caches, and dashboards—and still get pager fatigue, rollbacks, and silent data staleness.

**Sentra** fuses a **low‑latency streaming core** with an **AI‑assisted rollout controller** so you can ship continuously **without** sacrificing correctness.

---

## What Sentra proves (demo KPIs)
- **P95 end‑to‑end latency:** ≤ **120 ms** (ingest → compute → fanout)
- **Throughput:** ≥ **50k events/sec** on a 3‑node broker
- **Staleness window:** ≤ **300 ms** between read model and event log
- **Autonomous rollback:** < **90 s** from breach to restore
- **Error budget burn:** < **2%/day** during canaries

These KPIs are enforced via SLOs in the rollout controller; demos hard‑fail if thresholds are missed.

---

## High‑level architecture
```
┌────────────┐    gRPC stream     ┌──────────────┐      events       ┌───────────────┐
│  Producers │ ─────────────────▶ │  Gateway API │ ────────────────▶ │  Broker (KP) │
└────────────┘                    └──────────────┘                    └───────────────┘
                                                             ┌─────────────────────────┐
                                                             │  Stream Workers (Node) │
                           parallel pricing / CPU            └─────────────────────────┘
                                         ┌────────────────┐            │            │
                                         │ Pricing (Java) │◀───────────┘            │
                                         └────────────────┘                         │
                                              │ idempotent writes                   │
                                              ▼                                     ▼
                                          ┌─────────┐                         ┌───────────┐
                                          │  Redis  │  hot KV                 │ ClickHouse│ OLAP
                                          └─────────┘                         └───────────┘
                                              │                                     │
                                              ▼                                     │
                                          ┌──────────┐                             │
                                          │ Postgres │  source of truth            │
                                          └──────────┘                             │
                                              │                                     │
                                              ▼                                     ▼
                                          ┌───────────────────────┐
                                          │ Fanout Edge (WS/SSE) │ → Clients/Dashboard
                                          └───────────────────────┘

Observability: OpenTelemetry → Prometheus (metrics), Loki (logs), Tempo/Jaeger (traces)
Progressive delivery: Argo Rollouts + Sentra Controller (risk gating)
```

---

## Microservices (in a monorepo)
- **gateway-node/** — gRPC ingest + REST for control; Fastify + OTel
- **worker-node/** — stream transforms, dedupe, idempotency, DLQ sinks
- **pricing-java/** — Quarkus service using virtual threads for CPU‑bound eval
- **fanout-edge/** — uWebSockets/SSE broadcaster with tenant routing
- **sentra-controller/** — rollout guard: reads metrics, evaluates policies, halts/rolls back
- **sentra-risk-java/** — lightweight risk scoring (GBM/XGBoost)
- **web-client/** — Next.js dashboard (live KPIs, chaos toggles, canary status)
- **proto/** — .proto contracts + buf breaking‑change checks

---

## Repository layout
```
/sentra-platform/
  apps/
    gateway-node/
    worker-node/
    pricing-java/
    fanout-edge/
    sentra-controller/
    sentra-risk-java/
    web-client/
  packages/
    proto/
    shared-lib/            # telemetry utils, schemas, feature flags
  deploy/
    k8s/                   # Helm/ArgoCD, Argo Rollouts, HPA, PDB, PodDisruptionBudgets
    dashboards/            # Grafana JSON
    analysis-templates/    # Argo Rollouts AnalysisTemplates (latency, 5xx, consumer lag)
  tests/
    load/                  # k6 scenarios
    chaos/                 # toxiproxy configs, pod-kill jobs
  ci/
    workflows/             # GitHub Actions (path‑based)
```

---

## Core guarantees (design tenets)
- **Partition tolerance:** per‑key partitioning; retries with jitter; circuit breakers; DLQ
- **Exactly‑once semantics (practical):** idempotent handlers + outbox pattern
- **Graceful deploys:** readiness gates, pre‑stop hooks, PDBs; progressive delivery only
- **Backpressure safety:** consumer‑lag HPA (KEDA), adaptive batching
- **Observability first:** RED/USE dashboards; exemplars linking metrics ↔ traces

---

## Quickstart (local, docker‑compose)
> _This section assumes Docker and Node 20+ / Java 21 are installed._

```bash
# 1) Clone and bootstrap
git clone https://github.com/<your-org>/sentra-platform.git
cd sentra-platform

# 2) Start infra (broker, redis, postgres, clickhouse, grafana)
docker compose -f deploy/local/docker-compose.yml up -d

# 3) Bootstrap services (install deps, generate gRPC stubs)
make bootstrap   # runs: pnpm i, mvn -q -DskipTests package, buf generate

# 4) Run services (dev)
make dev         # concurrently runs gateway, worker, fanout, pricing, controller

# 5) Open the dashboard
open http://localhost:3000
```

---

## Demo script (5 minutes, no excuses)
1. **Baseline throughput:** start 25k → 50k events/sec; show P95 ≤ 120 ms live.
2. **Partition chaos:** toggle toxiproxy partition; UI stays live; counters reconcile; no duplicate effects.
3. **Canary rollout:** push new pricing model; Sentra Controller gates by SLO; promote or auto‑rollback.
4. **Trace drill‑down:** click a product update → see ingest→compute→fanout spans with exemplars.
5. **Auto‑report:** export a one‑page KPI report (PDF) stamped with thresholds + pass/fail.

---

## SLOs & policies (policy‑as‑code excerpt)
```yaml
# deploy/analysis-templates/sentra-slos.yaml
slo:
  latency_p95_ms: 120
  error_rate_pct: 0.5
  consumer_lag_max: 5000
  staleness_ms: 300
rollout_gates:
  consecutive_breaches_to_rollback: 2
  evaluation_window_sec: 60
```

---

## CI/CD (gates that actually block)
- **Proto compat:** buf breaking‑change check (fail on incompatible RPCs/messages)
- **Perf smoke on PR:** k6 @ 5k msg/s, P95 < 150 ms or PR fails
- **Contract tests:** consumer/provider for gRPC + topic schemas
- **Security:** Snyk/Trivy + SBOM attached to release artifacts
- **Progressive delivery:** Argo Rollouts with pre/post‑promote AnalysisTemplates

---

## Roadmap
- [ ] v0.1: Local compose, end‑to‑end happy path, live metrics
- [ ] v0.2: Idempotency, DLQ, chaos tests, KPI export
- [ ] v0.3: Sentra Controller (halt/rollback), Slack notifier
- [ ] v0.4: Risk scoring service + adaptive canary windows
- [ ] v1.0: Multi‑tenant, per‑key QoS, autoscaling ClickHouse, cost guardrails

---

## Naming rationale (for clients & devs)
**Sentra** hints at *Sentinel* (guard) to non‑tech stakeholders and signals *observability/automation* to engineers. It is pronounceable, brandable, and directly tied to reliability and safety—without alienating non‑technical audiences.

---

## License
TBD (Apache‑2.0 recommended for demos/clients)

cle