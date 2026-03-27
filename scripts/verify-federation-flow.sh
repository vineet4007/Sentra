#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$ROOT_DIR/.env.example"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No .env or .env.example file found in $ROOT_DIR" >&2
  exit 1
fi

while IFS='=' read -r key value; do
  [[ -n "$key" ]] || continue
  [[ "$key" =~ ^# ]] && continue
  export "$key=$value"
done < "$ENV_FILE"

SATELLITE_NAME_VALUE="federation-smoke-$(date +%s)"
SATELLITE_VERSION_VALUE="smoke"

restore_controller() {
  docker compose up -d controller >/dev/null 2>&1 || true
}

debug_state() {
  echo "Current satellites:" >&2
  docker compose exec -T api sh -lc "wget -qO- http://localhost:8080/satellites" >&2 || true
}

trap restore_controller EXIT

echo "Starting API for federation verification..."
docker compose up -d api >/dev/null

echo "Starting controller with satellite heartbeat and task polling enabled..."
env \
  SATELLITE_ENABLED=true \
  SATELLITE_NAME="$SATELLITE_NAME_VALUE" \
  SATELLITE_MODE=satellite \
  SATELLITE_VERSION="$SATELLITE_VERSION_VALUE" \
  SATELLITE_COORDINATOR_URL="http://api:8080" \
  SATELLITE_HEARTBEAT_INTERVAL_SEC=5 \
  SATELLITE_COORDINATOR_TIMEOUT_SEC=5 \
  SATELLITE_TASKS_ENABLED=true \
  SATELLITE_TASK_POLL_INTERVAL_SEC=2 \
  SATELLITE_TASK_LEASE_SEC=20 \
  docker compose up -d --build controller >/dev/null

echo "Waiting for satellite heartbeat..."
for _ in {1..10}; do
  payload="$(docker compose exec -T api sh -lc "wget -qO- http://localhost:8080/satellites")"
  if grep -q "\"name\":\"${SATELLITE_NAME_VALUE}\"" <<<"$payload"; then
    echo "Verified satellite heartbeat for ${SATELLITE_NAME_VALUE}"
    break
  fi
  sleep 2
done

payload="$(docker compose exec -T api sh -lc "wget -qO- http://localhost:8080/satellites")"
if ! grep -q "\"name\":\"${SATELLITE_NAME_VALUE}\"" <<<"$payload"; then
  echo "Satellite heartbeat did not appear in coordinator registry" >&2
  debug_state
  exit 1
fi

echo "Queueing delegated reconcile tasks through the coordinator..."
if ! docker compose exec -T -e SATELLITE_NAME="${SATELLITE_NAME_VALUE}" api node - <<'NODE'
const apiBaseUrl = 'http://localhost:8080'
const prometheusUrl = 'http://prometheus:9090'
const lokiUrl = 'http://loki:3100'
const tempoUrl = 'http://tempo:3200'
const satelliteName = process.env.SATELLITE_NAME

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function log(message) {
  process.stdout.write(`${message}\n`)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function requestJson(path, options = {}) {
  const url = new URL(path, apiBaseUrl)
  const headers = new Headers(options.headers || {})
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${url}: ${error}\nBody: ${text}`)
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${JSON.stringify(payload)}`)
  }

  return payload
}

function buildHealthySnapshot(projectName, serviceName, environmentName, revision) {
  return {
    generatedAt: '2026-03-18T12:10:00Z',
    window: {
      start: '2026-03-18T12:09:00Z',
      end: '2026-03-18T12:10:00Z',
      rangeSec: 60,
      stepSec: 5,
    },
    labels: {
      project: projectName,
      service: serviceName,
      environment: environmentName,
      version: revision,
    },
    labelMap: {
      project: 'project',
      service: 'service',
      environment: 'env',
      version: 'version',
      region: 'region',
      cluster: 'cluster',
      cloud: 'cloud',
    },
    validation: [
      { source: 'prometheus', url: prometheusUrl, status: 'ok', durationMs: 1 },
      { source: 'loki', url: lokiUrl, status: 'ok', durationMs: 1 },
      { source: 'tempo', url: tempoUrl, status: 'ok', durationMs: 1 },
    ],
    metrics: {
      errorRatePct: {
        name: 'error_rate_pct',
        source: 'prometheus',
        query: 'synthetic',
        unit: 'pct',
        status: 'ok',
        value: 0.2,
      },
      latencyP95Ms: {
        name: 'latency_p95_ms',
        source: 'prometheus',
        query: 'synthetic',
        unit: 'ms',
        status: 'ok',
        value: 120,
      },
    },
    logs: {
      logErrorRatioPct: {
        name: 'log_error_ratio_pct',
        source: 'loki',
        query: 'synthetic',
        unit: 'pct',
        status: 'ok',
        value: 0.1,
      },
    },
    traces: {
      recentTraceCount: {
        name: 'recent_trace_count',
        source: 'tempo',
        query: 'synthetic',
        unit: 'count',
        status: 'ok',
        value: 12,
      },
    },
  }
}

async function waitForSatellite(name) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await requestJson('/satellites')
    const satellite = response.data.items.find((item) => item.name === name)
    if (satellite) {
      return satellite
    }
    await delay(1000)
  }

  throw new Error(`Satellite ${name} did not appear in coordinator list`)
}

async function waitForTaskStatus(satelliteId, taskId, expectedStatus) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await requestJson(`/satellites/${satelliteId}/tasks?limit=20`)
    const task = response.data.items.find((item) => item.id === taskId)
    if (task && task.status === expectedStatus) {
      return task
    }
    await delay(1500)
  }

  throw new Error(`Task ${taskId} did not reach status ${expectedStatus}`)
}

async function onboardProject(runId) {
  const projectName = `federation-project-${runId}`
  const serviceName = `payments-api-${runId}`
  const environmentName = `staging-${runId}`
  const namespace = `sentra-federation-${runId}`

  const response = await requestJson('/projects/onboard', {
    method: 'POST',
    body: {
      validateTelemetry: true,
      project: {
        name: projectName,
        repoUrl: 'https://example.com/sentra-federation',
      },
      service: {
        name: serviceName,
        adapterType: 'kubernetes',
        serviceConfig: {
          workload: serviceName,
          namespace,
        },
      },
      environment: {
        name: environmentName,
        deploymentTargetType: 'kubernetes',
        deploymentTargetConfig: {
          mode: 'simulation',
          strategy: 'canary',
          namespace,
          deployment: serviceName,
        },
        telemetrySourceConfig: {
          prometheusUrl,
          lokiUrl,
          tempoUrl,
        },
        telemetryLabelMap: {
          project: 'project',
          service: 'service',
          environment: 'env',
          version: 'version',
        },
      },
    },
  })

  assert(response.data.telemetryValidation?.ok === true, 'Expected telemetry validation to pass')
  return {
    projectName,
    serviceName,
    environmentName,
    serviceId: response.data.service.id,
    environmentId: response.data.environment.id,
  }
}

async function createPolicy(serviceId, environmentId) {
  const response = await requestJson('/policies', {
    method: 'POST',
    body: {
      serviceId,
      environmentId,
      rolloutSteps: [5, 25],
      evaluationWindowSec: 60,
      pollIntervalSec: 5,
      warmupSec: 1,
      requiredPasses: 1,
      failureMode: 'rollback',
      sloConfig: {
        errorRatePct: { max: 2 },
        latencyP95Ms: { max: 500 },
      },
    },
  })

  return response.data.policy
}

async function createDeployment(serviceId, environmentId, policyId, revision) {
  const response = await requestJson('/deployments', {
    method: 'POST',
    body: {
      serviceId,
      environmentId,
      policyId,
      revision,
      initiatedBy: 'federation-verify',
      deploymentMetadata: {
        version: revision,
      },
    },
  })

  return response.data.deployment
}

async function queueTask(satelliteId, body) {
  const response = await requestJson(`/satellites/${satelliteId}/tasks`, {
    method: 'POST',
    body,
  })

  return response.data.task
}

async function fetchRollout(deploymentId) {
  const response = await requestJson(`/rollouts?deploymentId=${deploymentId}`)
  assert(response.data.items.length === 1, `Expected one rollout for deployment ${deploymentId}`)
  return response.data.items[0]
}

async function main() {
  assert(satelliteName, 'SATELLITE_NAME must be provided')

  const runId = String(Date.now())
  log(`Using satellite ${satelliteName} for delegated reconcile verification`)

  const satellite = await waitForSatellite(satelliteName)
  const onboarding = await onboardProject(runId)
  const policy = await createPolicy(onboarding.serviceId, onboarding.environmentId)
  const revision = `federated-${runId}`
  const deployment = await createDeployment(
    onboarding.serviceId,
    onboarding.environmentId,
    policy.id,
    revision,
  )

  log(`Queueing initialize task for deployment ${deployment.id}`)
  const initTask = await queueTask(satellite.id, {
    taskType: 'reconcile.deployment',
    deploymentId: deployment.id,
    createdBy: 'federation-verify',
  })
  const completedInitTask = await waitForTaskStatus(satellite.id, initTask.id, 'completed')
  assert(
    completedInitTask.result?.phase === 'initialized',
    `Expected initialize task to complete with phase=initialized, got ${JSON.stringify(completedInitTask.result)}`,
  )
  await delay(1100)

  log(`Queueing evaluation task for deployment ${deployment.id}`)
  const evaluationTask = await queueTask(satellite.id, {
    taskType: 'reconcile.deployment',
    payload: {
      deploymentId: deployment.id,
      telemetrySnapshot: buildHealthySnapshot(
        onboarding.projectName,
        onboarding.serviceName,
        onboarding.environmentName,
        revision,
      ),
    },
    createdBy: 'federation-verify',
  })
  const completedEvaluationTask = await waitForTaskStatus(
    satellite.id,
    evaluationTask.id,
    'completed',
  )
  assert(
    completedEvaluationTask.result?.phase === 'evaluated',
    `Expected evaluation task phase=evaluated, got ${JSON.stringify(completedEvaluationTask.result)}`,
  )

  const rollout = await fetchRollout(deployment.id)
  assert(
    rollout.currentWeight === 25,
    `Expected delegated rollout to promote to 25, got ${rollout.currentWeight}`,
  )
  assert(
    Array.isArray(rollout.satelliteTasks) && rollout.satelliteTasks.length >= 2,
    'Expected delegated rollout to expose satellite task history',
  )
  assert(
    rollout.aiAdvisor?.mode === 'shadow',
    'Expected delegated rollout to include AI shadow advisor output',
  )
  assert(
    rollout.aiAdvisor?.engine === 'fastapi-shadow-v1',
    `Expected delegated rollout to be advised by the external AI service, got ${rollout.aiAdvisor?.engine}`,
  )
  assert(
    typeof rollout.aiAdvisor?.prediction?.rollbackProbabilityPct === 'number',
    'Expected delegated rollout to expose AI prediction probabilities',
  )
  assert(
    typeof rollout.aiShadow?.review?.status === 'string',
    'Expected delegated rollout to expose AI shadow review status',
  )

  log(`Verified delegated reconcile via satellite ${satelliteName} for deployment ${deployment.id}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
NODE
then
  echo "Delegated task verification failed" >&2
  debug_state
  exit 1
fi

echo "Federation verification completed successfully for ${SATELLITE_NAME_VALUE}"
