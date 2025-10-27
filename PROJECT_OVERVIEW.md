# 🛰️ Sentra — Real-Time, Multi-Cloud Deployment Intelligence

## What It Is
**Sentra** is a **self-hosted control plane** that makes deployments **safe and autonomous** by using **live telemetry** to drive **canary/blue-green** rollouts. It integrates **cleanly across AWS, Azure, and GCP** — and works in hybrid setups.

**Outcome:** Zero-downtime releases with **automatic promote, pause, and rollback** based on real-time SLOs.

---

## Why It Matters
Traditional CI/CD deploys code blindly; observability alerts you **after** users are impacted.  
Sentra creates a **closed loop**: deploy → observe (metrics/logs/traces) → decide → act.  
Detection and reaction happen in **seconds**, not minutes.

---

## How It Works (5 steps)
1. Start canary at **5%** traffic.  
2. Collect telemetry (Prometheus/Loki/Tempo) continuously.  
3. Every few seconds, evaluate SLOs (error rate, p95, log error ratio, trace error ratio).  
4. **Healthy** → promote to **15% → 30% → 50% → 100%**.  
5. **Degraded** → auto-pause or **rollback**; everything is audited and visible live in the UI.

**Telemetry-to-decision latency:** ~**2–5 s**.

---

## Multi-Cloud Integration
- **Kubernetes (EKS/AKS/GKE):** Istio/Linkerd (precise L7) or NGINX canary; replica fallback mode.  
- **Serverless:** AWS Lambda aliases, GCP Cloud Run revisions, Azure Functions slots.  
- **Containers:** AWS ECS (ALB weights/CodeDeploy), Azure Container Apps.  
- **VMs/legacy:** LB backend weighting; agents for telemetry.

**Two deployment models:**
- **Centralized control plane** (simple start)  
- **Federated satellites** (scale, low egress/latency)

---

## Architecture (at a glance)
- **Go Rollout Controller:** telemetry polling + decisions  
- **Node.js API:** REST/WS, policies & audit  
- **Next.js UI:** live rollout dashboard  
- **MySQL:** policies, deployments, incidents (authoritative)  
- **Redis:** live state, locks, pub/sub  
- **Prometheus / Loki / Tempo:** metrics, logs, traces (OTel)

---

## Impact (Before vs After)
| Metric | Before | With Sentra |
|---|---|---|
| Failure detection | Minutes | **Seconds** |
| Downtime | High | **Near-zero** |
| Rollbacks | Manual | **Autonomous** |
| Release velocity | Slow (risk-averse) | **Continuous & safe** |
| Multi-cloud ops | Fragmented | **Unified adapters** |

---

## Roadmap
1) Controller + multi-cloud adapters  
2) Next.js UI (live SLO overlays)  
3) Federated satellites for large estates  
4) ML-assisted predictions & dynamic SLOs  
5) Packaged distribution (.exe/.dmg)

© 2025 AshSan Labs. All rights reserved.
