const apiBaseUrl = process.env.SENTRA_API_URL || 'http://localhost:8080'
const controllerBaseUrl = process.env.SENTRA_CONTROLLER_URL || 'http://localhost:8090'
const prometheusUrl = process.env.SENTRA_INTERNAL_PROMETHEUS_URL || 'http://prometheus:9090'
const lokiUrl = process.env.SENTRA_INTERNAL_LOKI_URL || 'http://loki:3100'
const tempoUrl = process.env.SENTRA_INTERNAL_TEMPO_URL || 'http://tempo:3200'

const runId = String(Date.now())
const projectName = `multi-service-project-${runId}`
const environmentName = `staging-${runId}`
const namespace = `sentra-ms-${runId}`

const checkoutServiceName = `checkout-api-${runId}`
const inventoryServiceName = `inventory-api-${runId}`

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

function buildSnapshot({ serviceName, revision, errorRatePct, latencyP95Ms }) {
  return {
    generatedAt: '2026-03-27T12:10:00Z',
    window: {
      start: '2026-03-27T12:09:00Z',
      end: '2026-03-27T12:10:00Z',
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
        value: errorRatePct,
      },
    },
    traces: {
      recentTraceCount: {
        name: 'recent_trace_count',
        source: 'tempo',
        query: 'synthetic',
        unit: 'count',
        status: 'ok',
        value: 18,
      },
    },
  }
}

async function onboardProject() {
  log(`Creating multi-service integration project ${projectName}`)
  const response = await requestJson(apiBaseUrl, '/projects/onboard', {
    method: 'POST',
    body: {
      validateTelemetry: true,
      project: {
        name: projectName,
        repoUrl: 'https://example.com/sentra-multi-service',
      },
      service: {
        name: checkoutServiceName,
        adapterType: 'kubernetes',
        serviceConfig: {
          workload: checkoutServiceName,
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
          deployment: checkoutServiceName,
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

async function createService(projectId, serviceName) {
  const response = await requestJson(apiBaseUrl, `/projects/${projectId}/services`, {
    method: 'POST',
    body: {
      name: serviceName,
      adapterType: 'kubernetes',
      serviceConfig: {
        workload: serviceName,
        namespace,
      },
    },
  })

  return response.data.service
}

async function createPolicy(serviceId, environmentId, { errorRateMax, latencyMax }) {
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
        errorRatePct: { max: errorRateMax },
        latencyP95Ms: { max: latencyMax },
      },
    },
  })

  return response.data.policy
}

async function createDeployment(serviceId, environmentId, policyId, revision, serviceName) {
  const response = await requestJson(apiBaseUrl, '/deployments', {
    method: 'POST',
    body: {
      serviceId,
      environmentId,
      policyId,
      revision,
      imageRef: `ghcr.io/example/${serviceName}:${revision}`,
      initiatedBy: 'multi-service-integration',
      deploymentMetadata: {
        version: revision,
        service: serviceName,
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

async function fetchProject(projectId) {
  const response = await requestJson(apiBaseUrl, `/projects/${projectId}`)
  return response.data
}

async function fetchRollout(deploymentId) {
  const response = await requestJson(apiBaseUrl, `/rollouts?deploymentId=${deploymentId}`)
  assert(response.data.items.length === 1, `Expected one rollout for deployment ${deploymentId}`)
  return response.data.items[0]
}

async function fetchRolloutsByService(serviceId) {
  const response = await requestJson(apiBaseUrl, `/rollouts?serviceId=${serviceId}&limit=20`)
  return response.data.items
}

async function fetchAiEvaluationSummary() {
  const response = await requestJson(apiBaseUrl, '/ai/evaluation?limit=100')
  return response.data
}

async function fetchAiDataset(series) {
  const response = await requestJson(apiBaseUrl, `/ai/dataset?series=${series}&limit=200`)
  return response.data
}

async function verifyCheckoutPromotion(serviceId, environmentId, policyId) {
  const revision = `checkout-${runId}`
  const deployment = await createDeployment(serviceId, environmentId, policyId, revision, checkoutServiceName)

  const initialized = await reconcile(deployment.id)
  assert(initialized.phase === 'initialized', 'Expected checkout rollout to initialize first')
  assert(initialized.deployment.currentWeight === 5, 'Expected checkout rollout to start at 5%')
  await delay(1100)

  const healthySnapshot = buildSnapshot({
    serviceName: checkoutServiceName,
    revision,
    errorRatePct: 0.2,
    latencyP95Ms: 120,
  })

  const firstHealthy = await reconcile(deployment.id, healthySnapshot)
  assert(firstHealthy.evaluation?.decision === 'hold', 'Expected first checkout healthy reconcile to hold')

  const promoted = await reconcile(deployment.id, healthySnapshot)
  assert(promoted.evaluation?.decision === 'promote', 'Expected checkout second healthy reconcile to promote')
  assert(promoted.deployment.currentWeight === 25, 'Expected checkout rollout to reach 25%')

  const rollout = await fetchRollout(deployment.id)
  assert(rollout.serviceName === checkoutServiceName, 'Expected checkout rollout service name to match')
  assert(rollout.status === 'running', 'Expected checkout rollout to remain running')
  assert(rollout.currentWeight === 25, 'Expected checkout rollout weight to be 25')

  return { deployment, rollout }
}

async function verifyInventoryRollback(serviceId, environmentId, policyId) {
  const revision = `inventory-${runId}`
  const deployment = await createDeployment(serviceId, environmentId, policyId, revision, inventoryServiceName)

  const initialized = await reconcile(deployment.id)
  assert(initialized.phase === 'initialized', 'Expected inventory rollout to initialize first')
  await delay(1100)

  const badSnapshot = buildSnapshot({
    serviceName: inventoryServiceName,
    revision,
    errorRatePct: 9,
    latencyP95Ms: 900,
  })

  const rolledBack = await reconcile(deployment.id, badSnapshot)
  assert(rolledBack.evaluation?.decision === 'rollback', 'Expected inventory unhealthy reconcile to rollback')
  assert(rolledBack.deployment.status === 'rolled_back', 'Expected inventory deployment to be rolled_back')

  const rollout = await fetchRollout(deployment.id)
  assert(rollout.serviceName === inventoryServiceName, 'Expected inventory rollout service name to match')
  assert(rollout.status === 'rolled_back', 'Expected inventory rollout to be rolled_back')
  assert(rollout.currentWeight === 0, 'Expected inventory rollout traffic to be 0 after rollback')
  assert(rollout.incidents.length > 0, 'Expected inventory rollback to record incidents')

  return { deployment, rollout }
}

async function main() {
  const onboarded = await onboardProject()
  const checkoutService = onboarded.service
  const environment = onboarded.environment
  const inventoryService = await createService(onboarded.project.id, inventoryServiceName)

  const projectDetails = await fetchProject(onboarded.project.id)
  assert(projectDetails.services.length === 2, 'Expected project to expose two services after attaching inventory service')
  assert(projectDetails.environments.length === 1, 'Expected shared environment to remain single')

  const checkoutPolicy = await createPolicy(checkoutService.id, environment.id, {
    errorRateMax: 2,
    latencyMax: 500,
  })
  const inventoryPolicy = await createPolicy(inventoryService.id, environment.id, {
    errorRateMax: 2,
    latencyMax: 500,
  })

  const checkoutResult = await verifyCheckoutPromotion(checkoutService.id, environment.id, checkoutPolicy.id)
  const inventoryResult = await verifyInventoryRollback(inventoryService.id, environment.id, inventoryPolicy.id)

  const checkoutRollouts = await fetchRolloutsByService(checkoutService.id)
  assert(
    checkoutRollouts.some((rollout) => rollout.id === checkoutResult.deployment.id && rollout.serviceName === checkoutServiceName),
    'Expected checkout service rollouts query to include checkout deployment only',
  )
  assert(
    checkoutRollouts.every((rollout) => rollout.serviceName === checkoutServiceName),
    'Expected checkout service rollouts query to stay isolated to checkout service',
  )

  const inventoryRollouts = await fetchRolloutsByService(inventoryService.id)
  assert(
    inventoryRollouts.some((rollout) => rollout.id === inventoryResult.deployment.id && rollout.serviceName === inventoryServiceName),
    'Expected inventory service rollouts query to include inventory deployment only',
  )
  assert(
    inventoryRollouts.every((rollout) => rollout.serviceName === inventoryServiceName),
    'Expected inventory service rollouts query to stay isolated to inventory service',
  )

  const aiEvaluation = await fetchAiEvaluationSummary()
  const serviceNames = new Set(aiEvaluation.services.map((service) => service.serviceName))
  assert(serviceNames.has(checkoutServiceName), 'Expected AI evaluation to include checkout service scorecard')
  assert(serviceNames.has(inventoryServiceName), 'Expected AI evaluation to include inventory service scorecard')

  const aiDatasetCandidate = await fetchAiDataset('candidate')
  const datasetServiceNames = new Set(aiDatasetCandidate.items.map((item) => item.serviceName))
  assert(datasetServiceNames.has(checkoutServiceName), 'Expected candidate AI dataset to include checkout service rows')
  assert(datasetServiceNames.has(inventoryServiceName), 'Expected candidate AI dataset to include inventory service rows')

  assert(
    checkoutResult.rollout.status === 'running' && inventoryResult.rollout.status === 'rolled_back',
    'Expected multi-service test to keep rollout outcomes isolated per service',
  )

  log(
    `Multi-service verification passed for project ${projectName}: ${checkoutServiceName} promoted independently while ${inventoryServiceName} rolled back.`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
