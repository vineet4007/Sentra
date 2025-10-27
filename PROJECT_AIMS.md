# 🎯 Sentra — Aims & Technology Stack

## 1️⃣ Core Mission
Deliver **zero-downtime, risk-aware software deployments** through real-time telemetry feedback loops that automatically **promote, pause, or rollback** rollouts across multi-cloud environments.

---

## 2️⃣ Key Objective
Transform **observability from passive monitoring into active control**, bridging the gap between CI/CD systems and real-time telemetry (metrics, logs, traces).

---

## 3️⃣ Problem Sentra Solves
Modern deployment pipelines are **blind and reactive** — they deploy without understanding the system’s live health.  
Sentra fixes that by making deployments **aware**, **self-analyzing**, and **self-correcting**.

---

## 4️⃣ Real-Time Intelligence Loop
Sentra continuously evaluates live telemetry every **2–5 seconds**, detecting regressions before users are impacted.  
Telemetry-driven automation ensures **safer, faster, and more reliable rollouts**.

---

## 5️⃣ Multi-Cloud Integration
Sentra cleanly integrates with **AWS, Azure, GCP**, and hybrid infrastructures.

Supported adapters:
- **Kubernetes (EKS, AKS, GKE)**  
- **Serverless:** AWS Lambda, GCP Cloud Run, Azure Functions  
- **Container Services:** AWS ECS, Azure Container Apps  
- **Legacy / VM-based:** NGINX / Envoy / ALB-based weight routing

Sentra abstracts cloud-specific deployment mechanics into a **unified control layer** for consistent, automated rollout management.

---

## 6️⃣ Architecture Highlights
- **Go Rollout Controller:** Evaluates metrics/logs/traces and makes promotion decisions.  
- **Node.js API:** REST + WebSocket API for UI and automation.  
- **Next.js Frontend:** Real-time rollout visualization, telemetry overlays, and trace linkage.  
- **MySQL:** Persistent audit, rollout, and policy state.  
- **Redis:** Pub/sub for live updates and transient rollout state.  
- **Prometheus / Loki / Tempo:** Observability stack for telemetry ingestion (via OpenTelemetry).

---

## 7️⃣ Automation & AI Roadmap
In later phases, Sentra integrates a **Python FastAPI service** for:
- Anomaly detection (statistical & ML-based)
- Predictive rollback & canary tuning
- SLO drift prediction  
This enables Sentra to **adapt rollout strategies automatically** based on learned service behavior.

---

## 8️⃣ Design Philosophy
- **Self-hosted:** Data never leaves your infrastructure.  
- **Real-time:** Telemetry-to-decision latency under **5 seconds**.  
- **Extensible:** Pluggable adapters for any runtime or observability backend.  
- **Fail-safe:** Always reverts to last known healthy state when telemetry degrades.  

---

## 9️⃣ Development Stack

| Layer | Technology |
|-------|-------------|
| Rollout Controller | Go (1.23+) |
| API Layer | Node.js (TypeScript) |
| Frontend | Next.js (SSR) |
| Worker / Parallelism | Java 25 (Loom virtual threads) |
| Database | MySQL |
| Cache / Real-time State | Redis |
| Observability | Prometheus, Loki, Tempo |
| ML / Automation | Python FastAPI |
| Containerization | Docker + Compose |
| Cloud & Infra | Kubernetes, AWS, Azure, GCP (multi-cloud) |

---

## 🔟 Long-Term Goal
Make **Sentra** the industry’s standard **real-time deployment intelligence layer** —  
a unified control plane for:
- Autonomous rollout governance  
- Instant anomaly detection and rollback  
- Unified observability-driven decisioning  
- Continuous, safe delivery across clouds  

---

© 2025 AshSan Labs. All Rights Reserved.
