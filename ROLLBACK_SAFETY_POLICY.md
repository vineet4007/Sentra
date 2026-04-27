# Sentra Rollback Safety Policy

This document defines how Sentra should protect live user traffic during a rollout failure.

## Core rule

The previous stable version must stay available while the candidate version is being tested.

Rollback must mean:

- the candidate stops receiving traffic
- the stable version resumes serving traffic
- users keep getting responses from the last known good release

Rollback must not mean:

- shutting the service down
- leaving a known-bad candidate on partial traffic
- forcing users to wait for a fresh redeploy before traffic is safe again

## Authority rule

Sentra's execution identity may have permission to move traffic, but Sentra access alone must not grant that permission to every user.

- autonomous rollback follows stored policy, telemetry gates, and controller execution identity
- user-initiated rollout actions require Sentra action authority
- individual users do not need direct cloud IAM roles for approved Sentra actions
- direct cloud IAM should stay scoped to Sentra service accounts, roles, managed identities, or federated workload identities
- audit records should preserve which Sentra actor initiated human/operator actions whenever that context is available

## Canonical failure example

If a rollout progresses like this:

1. Stable serves `100%`
2. Candidate is deployed and warmed up
3. Sentra shifts to `5% candidate / 95% stable`
4. Sentra shifts to `25% candidate / 75% stable`
5. The rollout fails at `25%`

Then the expected Sentra behavior is:

- shift traffic to `0% candidate / 100% stable`
- mark the rollout as `rolled_back`
- keep the candidate available only for debugging or later redeploy
- require the next fixed candidate to start again from the first rollout step

Sentra should not keep serving `5%` to the failed candidate just because it was healthy earlier at lower load.

## Production safety rules

Sentra should follow these rules during any real rollout:

- keep the stable version deployed until the rollout is fully complete
- send traffic to the candidate gradually
- keep an explicit stable fallback floor so the candidate does not absorb all traffic during the test window
- require health checks and warmup time before each promotion
- pause on missing telemetry rather than guessing
- rollback on critical gate failures or configured rollback failure mode
- restore traffic to the stable revision or version during rollback
- keep enough stable capacity available to absorb traffic again
- use connection draining or graceful traffic handoff where the platform supports it
- require backward-compatible database and contract changes during rollout windows

## What Sentra already maintains today

### Control-plane behavior

- Sentra evaluates rollout gates before each promotion step
- Sentra pauses on missing telemetry
- Sentra rolls back on severe gate failures or when `failureMode=rollback`
- Sentra does not continue promoting a failed rollout

### Traffic behavior by adapter

- Kubernetes ingress canary mode keeps the main stable path in place and changes the canary weight
- Cloud Run rollback restores traffic to the configured `stableRevision`
- AWS Lambda rollback restores the alias primary version to the configured `stableVersion`
- Azure Container Apps rollback restores traffic to the configured `stableRevision`

### Current rollout state semantics

- Sentra now publishes explicit `candidateWeight`, `stableWeight`, and `recoveredToStable` values in live rollout state
- `deployments.current_weight` still represents candidate traffic weight in MySQL
- after rollback, Sentra records candidate weight as `0` and surfaces the stable side explicitly in API and UI traffic summaries

That means operators can now see both the candidate share and the stable fallback share directly.

### Stable fallback floor

- Sentra now supports `deploymentTargetConfig.stableTrafficFloorPct`
- onboarding defaults to `5`, which makes the recommended rollout path `5,25,50,95`
- policy writes are validated so rollout steps cannot exceed `100 - stableTrafficFloorPct`
- environment edits also validate existing policies before raising the fallback floor

This does not replace all runtime capacity checks, but it does stop first-time configurations from accidentally draining the stable path during candidate evaluation.

### Stable capacity checks

- Sentra now runs a stable-capacity guard before rollout initialization and promotion.
- Kubernetes targets can verify a configured `stableDeployment` through `kubectl get deployment ... -o json`.
- The guard checks minimum ready replicas, minimum available replicas, and optional available percentage.
- If the stable target cannot be verified, Sentra pauses the rollout, records a `stable_capacity_blocked` incident, emits a `rollout.promotion_blocked_stable_capacity` audit event, and keeps candidate traffic at its current weight.
- In simulation mode, operators can provide assumed capacity values under `deploymentTargetConfig.stableCapacity` to rehearse the control path without a live cluster.
- Cloud Run, Lambda, and Azure Container Apps currently validate the stable rollback identity before promotion; deeper provider-specific capacity checks are still future work.

For non-container workloads, the same rule applies: Sentra needs a stable fallback target and a runtime-specific way to verify it. That might be a Lambda version, Cloud Run revision, Azure revision, VM backend pool, or external load-balancer target group.

## What Sentra does not fully enforce yet

- Sentra does not yet model connection draining as a first-class rollout safety feature
- Sentra does not yet block rollouts based on database migration compatibility or contract safety
- Sentra does not yet perform deep runtime capacity checks for every non-Kubernetes adapter

These are important hardening tasks before calling rollback protection fully production-complete.

## Current assessment

Sentra is already following the correct rollback direction and now makes it more visible and safer:

- move traffic away from the failing candidate
- return service to the last known good release
- keep an operator-visible stable fallback share in API and UI state
- validate safer default rollout steps against a configured stable fallback floor
- block Kubernetes promotions when stable capacity cannot be verified

But it is not yet fully production-hardened for zero-surprise rollback operations because provider-wide capacity depth, draining, and schema or contract safety checks are still missing.
The remaining gap is mostly runtime hardening, not control-plane intent.

## Recommended next hardening work

1. Expand stable-capacity checks beyond Kubernetes into Cloud Run, Lambda, Azure Container Apps, and external load-balancer adapters.
2. Add connection-draining or grace-period support where the runtime allows it.
3. Add rollout checks for backward-compatible schema and contract changes.
4. Add integration tests that assert rollback returns all traffic to stable targets.
5. Extend stable fallback enforcement into more runtime-specific safeguards where traffic systems support it.
