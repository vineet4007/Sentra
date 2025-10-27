# 🛰️ Sentra — Real-Time, Multi-Cloud Deployment Intelligence

## 🔍 Overview
**Sentra** is a **self-hosted, deployment-aware observability and control plane** that runs in your infra and automates canary/blue-green rollouts using **live telemetry** (metrics, logs, traces). It integrates **cleanly across AWS, Azure, and GCP** — and supports hybrid/multi-cloud estates.

**Core promise:** zero-downtime, risk-aware releases with **automatic promote/pause/rollback** based on real-time SLOs.

---

## 🎯 What Problems Sentra Solves
- **Blind deployments:** CI/CD pushes code without knowing if it’s safe.  
- **Reactive observability:** you notice issues after users do.  
- **Manual rollbacks:** slow, error-prone, stressful.  
- **Inconsistent multi-cloud ops:** every provider has different knobs for traffic splitting.

**Sentra** creates a **closed-loop** between rollouts and telemetry, standardizing control across clouds.

---

## 🧩 Multi-Cloud Topologies

### A) Centralized Control Plane (start here)
- One global Sentra control plane (Node API + Go controller + MySQL/Redis).
- All clusters/services export telemetry to central Prometheus/Loki/Tempo.
- Controller acts remotely via K8s/Cloud APIs.

**Pros:** simple; fast to adopt.  
**Cons:** cross-cloud telemetry egress & latency to central plane.

### B) Federated Satellites (scale here)
- A **Sentra Satellite** (controller + collectors) per cluster/region/cloud.
- A small **Global Coordinator** (Node API + MySQL/Redis) aggregates policies & audits.
- Decisions are **local**; only summaries stream centrally.

**Pros:** low egress/latency, fault isolation, scales to large estates.  
**Cons:** more components to operate.

---

## 🧠 Architecture (High Level)

             ┌───────────────────────────┐
             │        Next.js UI         │
             │  Live rollout + analytics │
             └────────────┬──────────────┘
                          │ REST / WS
                          ▼
             ┌───────────────────────────┐
             │        Node API Layer     │
             │  Policies + audit + auth  │
             └────────────┬──────────────┘
                          │ Redis pub/sub
                          ▼
             ┌───────────────────────────┐
             │     Go Rollout Controller │
             │ Telemetry-driven decisions│
             ├────────────┬──────────────┤
             │ Queries    │ Acts on      │
             │ Prometheus │ K8s Deployments
             │ Loki       │ Ingress/Mesh (Istio/NGINX)
             │ Tempo      │ Cloud APIs (Lambda/Run/ECS/Functions)
             └────────────┴──────────────┘
                    ▲               ▲
                    │               │
            MySQL (policies,     Kubernetes / Cloud
            rollouts, audit)     provider APIs (AWS/Azure/GCP)

---

## 📡 Telemetry Plane (standard everywhere)
- **Metrics → Prometheus (or VictoriaMetrics/Thanos):** error rate, p95 latency, resources.  
- **Logs → Loki (Promtail/Fluent Bit):** error ratio, patterns.  
- **Traces → Tempo (OTel):** distributed latency & failures.

**Labels to standardize:** `cloud`, `region`, `cluster`, `project`, `service`, `env`, `version`.

**Real-time loop:** evaluate every **2–5 s** with sliding windows (e.g., 30–60 s).

---

## 🔧 Control Adapters (per runtime)

### Kubernetes (EKS/AKS/GKE)
- **Ingress/mesh traffic split:**  
  - **Istio/Linkerd** → VirtualService/ServiceProfile weights (precise).  
  - **NGINX Ingress** → canary annotations (by weight, header, or cookie).  
  - **Fallback:** replica-based approximation (document precision limits).
- **Identity:** IRSA (AWS), Workload Identity (Azure/GCP).

### Serverless
- **AWS Lambda** → weighted **aliases**.  
- **GCP Cloud Run** → **revision traffic percentages**.  
- **Azure Functions** → **slots + routing rules**.

### Container services
- **AWS ECS/Fargate** → ALB **weighted target groups** or **CodeDeploy** blue/green.  
- **Azure Container Apps** → revision split API.  
- **GCP Cloud Run (containers)** → same as serverless.

### VMs/legacy
- LB backend weights (ALB/NGINX/Envoy/NGFW); OTel Collector + Promtail agents on VMs.

---

## 🗄️ Control-Plane Data (MySQL) — minimal, audit-friendly
- **projects:** id, name, repo_url  
- **services:** project_id, name, k8s identifiers, adapter type  
- **environments:** project_id, name, kube_context/namespace  
- **policies:** service_id/env_id, SLOs (JSON), steps `[5,15,20,30,30]`, windows, pass_count  
- **deployments:** service_id/env_id, image/revision, status, started/completed  
- **rollout_steps:** deployment_id, step_index, weight, status, metrics_snapshot, decision  
- **incidents:** deployment_id, step_index, type, details

Redis handles **live state, locks, pub/sub**.

---

## 🔄 Decision Loop (deterministic)
1. Set target traffic (e.g., 5%).  
2. Warm-up 30–60 s.  
3. Every 5 s, evaluate gates over sliding window:  
   - `error_rate ≤ 1%` (PromQL)  
   - `p95_latency_ms ≤ 400` (PromQL)  
   - `log_error_ratio ≤ 0.5%` (Loki)  
   - *(optional)* `trace_error_ratio ≤ 0.5%` (TraceQL)  
4. **All pass** N consecutive times → promote to next step.  
5. **Fail** → pause; if severe → rollback.  
6. Stream state to UI (WS/SSE) and snapshot to MySQL (audit).

---

## 🔒 Identity, Security, Residency
- **Identity:** STS AssumeRole (AWS), AAD Workload Identity (Azure), Workload Identity Federation (GCP).  
- **Secrets:** cloud secret managers + CSI drivers.  
- **mTLS/TLS:** OTel exports + control plane APIs.  
- **Residency:** keep **telemetry stores per region/tenant**; stream only summaries centrally if required.

---

## 🧭 Tech Stack
- **Rollout Engine:** Go (1.23+)  
- **API Layer:** Node.js (TypeScript)  
- **Frontend:** Next.js (SSR)  
- **Control Stores:** MySQL (authoritative), Redis (real-time)  
- **Telemetry:** Prometheus, Loki, Tempo (OTel)  
- **(Later)** ML: Python FastAPI for predictive rollbacks

---

## 🗺️ Roadmap
1) Controller + Node API (multi-cloud adapters)  
2) Next.js UI (live rollouts, SLO overlays, trace/log links)  
3) Precise L7 splits (Istio/NGINX); fallback replicas documented  
4) Federated satellites for large estates  
5) ML-assisted automation & dynamic SLOs; packaging (.exe/.dmg) last

© 2025 AshSan Labs. All rights reserved.
