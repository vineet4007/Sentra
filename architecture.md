# 🛰️ Sentra — Real-Time Deployment Intelligence Platform

## 🔍 Overview

**Sentra** is a **self-hosted, deployment-aware observability and intelligence platform**  
that continuously **monitors, analyzes, and controls application rollouts** in real time.

Unlike traditional CI/CD or monitoring tools, Sentra **connects the dots** between deployments, telemetry, and reliability —  
making rollout decisions based on *live metrics, logs, and traces* instead of static thresholds or manual checks.

Sentra’s goal:  
> Enable fully automated, zero-downtime, risk-aware deployments across environments  
> — without sacrificing visibility, safety, or developer control.

---

## 🎯 Core Motive

Modern DevOps pipelines still deploy **blindly** — they push versions out, then react *after* users report issues.  
Sentra flips that model.

It continuously ingests **real-time telemetry** during a rollout and uses it to:
- Detect regressions or anomalies.
- Automatically pause, rollback, or promote deployments.
- Correlate metrics, traces, and logs to each deployment step.
- Provide a unified dashboard for **deployment health analytics**.

Sentra isn’t just observability. It’s **observability that acts**.

---

## 🧠 Key Capabilities

| Category | Description |
|-----------|--------------|
| **Intelligent Rollouts** | Dynamic rollout progression (e.g. 5% → 15% → 30% → 50%) based on live metrics and anomaly detection. |
| **Auto-Rollback & Pause** | Instantly halts or reverses deployments when SLOs degrade or errors spike. |
| **Real-Time Telemetry Loop** | Evaluates Prometheus, Loki, and Tempo data every few seconds to drive rollout decisions. |
| **Trace-Linked Analysis** | Correlates OTel spans and errors to specific versions and rollout steps. |
| **Unified UI** | Next.js-based dashboard with live rollout status, metrics, and trace inspection. |
| **Zero-Downtime Strategy** | Smart canary + blue/green orchestration with adaptive rollout speed. |
| **Self-Hosted** | Fully containerized; runs inside your infrastructure with no vendor lock-in. |

---

## 🏗️ Architecture

### 🧩 High-Level Diagram

             ┌───────────────────────────┐
             │        Next.js UI         │
             │  Live rollout + analytics │
             └────────────┬──────────────┘
                          │ WebSocket / REST
                          ▼
             ┌───────────────────────────┐
             │        Node API Layer     │
             │  Policy mgmt + audit log  │
             └────────────┬──────────────┘
                          │ Redis pub/sub
                          ▼
             ┌───────────────────────────┐
             │      Go Rollout Controller│
             │  Telemetry-driven deploys │
             ├────────────┬──────────────┤
             │ Queries:   │ Actions:      │
             │ - Prometheus (metrics)     │
             │ - Loki (logs)              │
             │ - Tempo (traces)           │
             │                            │
             │ Controls:                  │
             │ - Kubernetes / Docker API  │
             └────────────┬──────────────┘
                          │
       ┌──────────────────┴──────────────────┐
       │               Datastores            │
       │ MySQL → rollout state + policies    │
       │ Redis → live cache + pub/sub        │
       └─────────────────────────────────────┘

---

## 📡 Telemetry Plane

| Type | Source | Collector | Use Case |
|------|---------|-----------|-----------|
| **Metrics** | Application services | Prometheus | Error rates, latency, CPU/mem, SLO gates |
| **Logs** | Stdout / structured JSON | Loki | Detect error spikes, anomalies |
| **Traces** | OpenTelemetry spans | Tempo | Track distributed latency & errors |

The **Go controller** polls these telemetry sources in 5–10 s intervals, evaluates gates, and reacts automatically.

---

## 🧩 Control Plane

| Component | Description |
|------------|--------------|
| **Go Rollout Controller** | Core logic — runs rollout loops, polls telemetry, applies policy logic, and issues promote/pause/rollback commands. |
| **Node API** | REST + WebSocket interface for UI and automation integrations. |
| **MySQL** | Persistent store for rollout states, policies, and audit history. |
| **Redis** | High-speed pub/sub for live state updates between controller and UI. |
| **Next.js Frontend** | Real-time rollout visualization, telemetry overlays, and operator actions. |

---

## ⚙️ Technology Stack

| Layer | Technology | Purpose |
|-------|-------------|----------|
| Backend (Gateway/API) | **Node.js (TypeScript)** | API, SSE/WS, event hub |
| Rollout Engine | **Go (v1.23)** | High-concurrency telemetry polling & decision logic |
| Worker (Processing) | **Java 25 (Loom)** | Parallel log/trace aggregation and enrichment |
| Observability | **Prometheus + Loki + Tempo** | Metrics, logs, and traces pipeline |
| Cache | **Redis** | Live state and message bus |
| Database | **MySQL** | Persistent rollout state and configs |
| Frontend | **Next.js (SSR)** | Dashboard and real-time controls |
| ML Automation (future) | **Python FastAPI** | Anomaly detection, predictive scaling |
| Deployment | **Docker Compose / Kubernetes** | Fully containerized, self-hosted stack |

---

## 🔄 Real-Time Evaluation Loop

1. **Canary step deployed (5% traffic).**  
2. **Telemetry polled every few seconds:**
   - Prometheus → error rate, latency
   - Loki → log error ratio
   - Tempo → trace latency and error count
3. **SLOs evaluated.**
4. **Pass → increase traffic; Fail → pause or rollback.**
5. **UI updates instantly via WebSocket.**

Each decision is traced and logged for auditability.

---

## 🧭 Roadmap

| Phase | Focus |
|--------|--------|
| **1** | Gateway + Worker + ClickHouse analytics (completed) |
| **2** | Real-time tracing + OTel instrumentation (in progress) |
| **3** | **Go rollout controller** (real-time deployment intelligence) |
| **4** | Next.js frontend with live dashboard & control UI |
| **5** | ML automation for predictive rollbacks and dynamic SLO tuning |
| **6** | Packaging → `.exe` / `.dmg` for self-hosted clients |

---

## 🚀 Vision

Sentra will become the **first self-hosted, real-time deployment intelligence system**  
that unifies observability, rollouts, and automated recovery in a single, cohesive platform.

It’s not just about seeing the problem — it’s about **preventing it before users notice**.

---

## 📜 License & Ownership

© 2025 AshSan Labs. All rights reserved.  
Sentra is developed and maintained under the AshSan Labs initiative.
