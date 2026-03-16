const apiBaseUrl = process.env.SENTRA_API_URL || 'http://localhost:8080'
const controllerBaseUrl = process.env.SENTRA_CONTROLLER_URL || 'http://localhost:8090'
const prometheusUrl = process.env.SENTRA_INTERNAL_PROMETHEUS_URL || 'http://prometheus:9090'
const lokiUrl = process.env.SENTRA_INTERNAL_LOKI_URL || 'http://loki:3100'
const tempoUrl = process.env.SENTRA_INTERNAL_TEMPO_URL || 'http://tempo:3200'

const runId = String(Date.now())
const projectName = `step8-project-${runId}`
const serviceName = `payments-api-${runId}`
const environmentName = `staging-${runId}`
const namespace = `sentra-${runId}`

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function log(message) {
  process.stdout.write(`${message}\n`)
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function requestJson(baseUrl, path, options = {}) {
  const url = new URL(path, baseUrl)
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

function buildSnapshot(revision, { errorRatePct, latencyP95Ms }) {
  return {
    generatedAt: '2026-03-13T12:10:00Z',
    window: {
      start: '2026-03-13T12:09:00Z',
      end: '2026-03-13T12:10:00Z',
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
        value: errorRatePct,
      },
      latencyP95Ms: {
        name: 'latency_p95_ms',
        source: 'prometheus',
        query: 'synthetic',
        unit: 'ms',
        status: 'ok',
        value: latencyP95Ms,
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

async function onboardProject() {
  log(`Creating integration test project ${projectName}`)
  const response = await requestJson(apiBaseUrl, '/projects/onboard', {
    method: 'POST',
    body: {
      validateTelemetry: true,
      project: {
        name: projectName,
        repoUrl: 'https://example.com/sentra-smoke',
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

  assert(response.ok === true, 'Expected onboarding response ok=true')
  assert(response.data.telemetryValidation?.ok === true, 'Expected telemetry validation to pass')
  return response.data
}

async function createPolicy(serviceId, environmentId) {
  log('Creating rollout policy for integration test project')
  const response = await requestJson(apiBaseUrl, '/policies', {
    method: 'POST',
    body: {
      serviceId,
      environmentId,
      rolloutSteps: [5, 25],
      evaluationWindowSec: 60,
      pollIntervalSec: 5,
      warmupSec: 1,
      requiredPasses: 2,
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
  const response = await requestJson(apiBaseUrl, '/deployments', {
    method: 'POST',
    body: {
      serviceId,
      environmentId,
      policyId,
      revision,
      imageRef: `ghcr.io/example/${serviceName}:${revision}`,
      initiatedBy: 'step8-integration',
      deploymentMetadata: {
        version: revision,
        ticket: 'STEP8',
      },
    },
  })

  return response.data.deployment
}

async function reconcile(deploymentId, telemetrySnapshot) {
  const body = { deploymentId }
  if (telemetrySnapshot) {
    body.telemetrySnapshot = telemetrySnapshot
  }

  const response = await requestJson(controllerBaseUrl, '/rollouts/reconcile', {
    method: 'POST',
    body,
  })

  return response.data
}

async function fetchRollout(deploymentId) {
  const response = await requestJson(apiBaseUrl, `/rollouts?deploymentId=${deploymentId}`)
  assert(response.data.items.length === 1, `Expected one rollout for deployment ${deploymentId}`)
  return response.data.items[0]
}

async function verifyHealthyPromotion(serviceId, environmentId, policyId) {
  const revision = `promote-${runId}`
  log(`Creating healthy deployment ${revision}`)
  const deployment = await createDeployment(serviceId, environmentId, policyId, revision)

  const initialized = await reconcile(deployment.id)
  assert(initialized.phase === 'initialized', 'Expected initial reconcile to initialize rollout')
  assert(initialized.deployment.currentWeight === 5, 'Expected initialize step to set weight to 5')
  await delay(1100)

  const healthySnapshot = buildSnapshot(revision, { errorRatePct: 0.2, latencyP95Ms: 120 })
  const firstHealthy = await reconcile(deployment.id, healthySnapshot)
  assert(firstHealthy.evaluation?.decision === 'hold', 'Expected first healthy reconcile to hold')
  assert(
    firstHealthy.evaluation?.nextState?.consecutivePasses === 1,
    'Expected first healthy reconcile to increment consecutive passes to 1',
  )

  const promoted = await reconcile(deployment.id, healthySnapshot)
  assert(promoted.evaluation?.decision === 'promote', 'Expected second healthy reconcile to promote')
  assert(promoted.deployment.currentWeight === 25, 'Expected promotion to move weight to 25')

  const rollout = await fetchRollout(deployment.id)
  assert(rollout.status === 'running', 'Expected promoted rollout to stay running')
  assert(rollout.currentWeight === 25, 'Expected rollout current weight to be 25 after promotion')
  assert(
    rollout.steps.some((step) => step.stepIndex === 0 && step.status === 'completed'),
    'Expected first rollout step to be completed after promotion',
  )
  assert(
    rollout.steps.some((step) => step.stepIndex === 1 && step.status === 'in_progress'),
    'Expected second rollout step to be in progress after promotion',
  )
  assert(
    rollout.auditEvents.some((event) => event.eventType === 'rollout.promoted'),
    'Expected rollout audit history to include rollout.promoted',
  )
  assert(rollout.liveState?.decision === 'promote', 'Expected live state to record promote decision')

  log(`Healthy promotion verified for deployment ${deployment.id}`)
}

async function verifyRollbackFailurePath(serviceId, environmentId, policyId) {
  const revision = `rollback-${runId}`
  log(`Creating rollback deployment ${revision}`)
  const deployment = await createDeployment(serviceId, environmentId, policyId, revision)

  const initialized = await reconcile(deployment.id)
  assert(initialized.phase === 'initialized', 'Expected rollback deployment to initialize first')
  await delay(1100)

  const badSnapshot = buildSnapshot(revision, { errorRatePct: 9, latencyP95Ms: 900 })
  const rolledBack = await reconcile(deployment.id, badSnapshot)
  assert(rolledBack.evaluation?.decision === 'rollback', 'Expected unhealthy reconcile to rollback')
  assert(rolledBack.deployment.status === 'rolled_back', 'Expected deployment to be marked rolled_back')
  assert(rolledBack.deployment.currentWeight === 0, 'Expected rollback to reduce traffic to 0')

  const rollout = await fetchRollout(deployment.id)
  assert(rollout.status === 'rolled_back', 'Expected rollout status to be rolled_back')
  assert(rollout.currentWeight === 0, 'Expected rollout weight to be 0 after rollback')
  assert(Array.isArray(rollout.incidents) && rollout.incidents.length > 0, 'Expected incidents to be recorded')
  assert(
    rollout.auditEvents.some((event) => event.summary.includes('Rolled')),
    'Expected audit history to capture rollback action summary',
  )
  assert(rollout.liveState?.decision === 'rollback', 'Expected live state to record rollback decision')

  log(`Rollback failure path verified for deployment ${deployment.id}`)
}

async function main() {
  const onboarded = await onboardProject()
  const policy = await createPolicy(onboarded.service.id, onboarded.environment.id)

  await verifyHealthyPromotion(onboarded.service.id, onboarded.environment.id, policy.id)
  await verifyRollbackFailurePath(onboarded.service.id, onboarded.environment.id, policy.id)

  log(`Integration rollout verification passed for project ${projectName}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
