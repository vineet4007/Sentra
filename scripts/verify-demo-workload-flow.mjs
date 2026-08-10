const apiBaseUrl = process.env.SENTRA_API_URL || 'http://localhost:8080'
const controllerBaseUrl = process.env.SENTRA_CONTROLLER_URL || 'http://localhost:8090'
const demoWorkloadUrl = process.env.SENTRA_DEMO_WORKLOAD_URL || 'http://localhost:18091'
const prometheusUrl = process.env.SENTRA_INTERNAL_PROMETHEUS_URL || 'http://prometheus:9090'
const lokiUrl = process.env.SENTRA_INTERNAL_LOKI_URL || 'http://loki:3100'
const tempoUrl = process.env.SENTRA_INTERNAL_TEMPO_URL || 'http://tempo:3200'

const apiBearerToken = process.env.SENTRA_API_BEARER_TOKEN || ''
const actionToken = process.env.SENTRA_ACTION_TOKEN || ''
const actionHeader = process.env.SENTRA_ACTION_HEADER || 'x-sentra-action-token'
const actionActorHeader = process.env.SENTRA_ACTION_ACTOR_HEADER || 'x-sentra-actor'
const controllerBearerToken = process.env.SENTRA_CONTROLLER_BEARER_TOKEN || ''
const tenantHeader = process.env.SENTRA_TENANT_HEADER || 'x-sentra-tenant'

const runId = String(Date.now())
const tenantKey = process.env.SENTRA_DEMO_TENANT || `demo-${runId}`
const projectName = `demo-project-${runId}`
const serviceName = `demo-workload-${runId}`
const environmentName = `staging-${runId}`
const namespace = `sentra-demo-${runId}`

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

function apiHeaders() {
  const headers = {
    [tenantHeader]: tenantKey,
  }
  if (apiBearerToken) {
    headers.Authorization = `Bearer ${apiBearerToken}`
  }
  if (actionToken) {
    headers[actionHeader] = actionToken
    headers[actionActorHeader] = 'demo-workload-verifier'
  }
  return headers
}

function controllerHeaders() {
  if (!controllerBearerToken) {
    return {}
  }
  return {
    Authorization: `Bearer ${controllerBearerToken}`,
  }
}

async function requestJson(baseUrl, path, options = {}) {
  const url = path instanceof URL ? path : new URL(path, baseUrl)
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

function signalValue(signal) {
  return typeof signal?.value === 'number' ? signal.value : Number.NaN
}

function assertRealSnapshot(snapshot, label) {
  const errorRate = snapshot.metrics?.errorRatePct
  const latency = snapshot.metrics?.latencyP95Ms
  const logRatio = snapshot.logs?.logErrorRatioPct

  for (const [name, signal] of [
    ['errorRatePct', errorRate],
    ['latencyP95Ms', latency],
    ['logErrorRatioPct', logRatio],
  ]) {
    assert(signal, `${label}: expected ${name} signal`)
    assert(signal.status === 'ok', `${label}: expected ${name} to be ok, got ${signal.status}`)
    assert(signal.query && signal.query !== 'synthetic', `${label}: expected ${name} to use a real query`)
  }
}

async function setScenario(mode, version) {
  const url = new URL('/scenario', demoWorkloadUrl)
  url.searchParams.set('mode', mode)
  url.searchParams.set('project', projectName)
  url.searchParams.set('service', serviceName)
  url.searchParams.set('environment', environmentName)
  url.searchParams.set('version', version)

  const response = await requestJson(demoWorkloadUrl, url)
  assert(response.ok === true, `Expected demo workload to accept ${mode} scenario`)
}

async function fetchTelemetrySnapshot(version) {
  const url = new URL('/telemetry/snapshot', controllerBaseUrl)
  url.searchParams.set('project', projectName)
  url.searchParams.set('service', serviceName)
  url.searchParams.set('environment', environmentName)
  url.searchParams.set('version', version)
  url.searchParams.set('windowSec', '20')
  url.searchParams.set('stepSec', '5')
  url.searchParams.set('limit', '5')

  const response = await requestJson(controllerBaseUrl, url, {
    headers: controllerHeaders(),
  })
  assert(response.ok === true, 'Expected controller telemetry snapshot response ok=true')
  return response.data
}

function snapshotSummary(snapshot) {
  return {
    errorRatePct: {
      status: snapshot.metrics?.errorRatePct?.status,
      value: signalValue(snapshot.metrics?.errorRatePct),
    },
    latencyP95Ms: {
      status: snapshot.metrics?.latencyP95Ms?.status,
      value: signalValue(snapshot.metrics?.latencyP95Ms),
    },
    logErrorRatioPct: {
      status: snapshot.logs?.logErrorRatioPct?.status,
      value: signalValue(snapshot.logs?.logErrorRatioPct),
    },
  }
}

async function waitForSnapshot(version, label, predicate) {
  const deadline = Date.now() + 120_000
  let lastSnapshot = null

  while (Date.now() < deadline) {
    lastSnapshot = await fetchTelemetrySnapshot(version)
    const summary = snapshotSummary(lastSnapshot)
    const signalsReady =
      summary.errorRatePct.status === 'ok' &&
      summary.latencyP95Ms.status === 'ok' &&
      summary.logErrorRatioPct.status === 'ok'

    if (signalsReady && predicate(summary)) {
      assertRealSnapshot(lastSnapshot, label)
      return lastSnapshot
    }

    log(`${label}: waiting for telemetry ${JSON.stringify(summary)}`)
    await delay(2_000)
  }

  throw new Error(`${label}: timed out waiting for expected telemetry. Last snapshot: ${JSON.stringify(snapshotSummary(lastSnapshot))}`)
}

async function onboardProject() {
  log(`Creating demo project ${projectName}`)
  const response = await requestJson(apiBaseUrl, '/projects/onboard', {
    method: 'POST',
    headers: apiHeaders(),
    body: {
      validateTelemetry: true,
      project: {
        name: projectName,
        repoUrl: 'https://example.com/sentra-demo-workload',
      },
      service: {
        name: serviceName,
        adapterType: 'kubernetes',
        serviceConfig: {
          workload: serviceName,
          namespace,
          telemetryService: serviceName,
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
          stableTrafficFloorPct: 5,
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
  log('Creating demo rollout policy')
  const response = await requestJson(apiBaseUrl, '/policies', {
    method: 'POST',
    headers: apiHeaders(),
    body: {
      serviceId,
      environmentId,
      rolloutSteps: [5, 25],
      evaluationWindowSec: 20,
      pollIntervalSec: 5,
      warmupSec: 1,
      requiredPasses: 2,
      failureMode: 'rollback',
      sloConfig: {
        errorRatePct: { max: 2, rollbackAbove: 5 },
        latencyP95Ms: { max: 500, rollbackAbove: 750 },
        logErrorRatioPct: { max: 2, rollbackAbove: 5 },
      },
    },
  })

  return response.data.policy
}

async function createDeployment(serviceId, environmentId, policyId, revision) {
  const response = await requestJson(apiBaseUrl, '/deployments', {
    method: 'POST',
    headers: apiHeaders(),
    body: {
      serviceId,
      environmentId,
      policyId,
      revision,
      imageRef: `ghcr.io/example/${serviceName}:${revision}`,
      initiatedBy: 'demo-workload-verifier',
      source: 'demo-workload',
      deploymentMetadata: {
        version: revision,
        demo: 'real-telemetry',
        telemetryLabels: {
          project: projectName,
          service: serviceName,
          environment: environmentName,
          version: revision,
        },
      },
    },
  })

  return response.data.deployment
}

async function reconcile(deploymentId) {
  const response = await requestJson(controllerBaseUrl, '/rollouts/reconcile', {
    method: 'POST',
    headers: controllerHeaders(),
    body: { deploymentId },
  })

  return response.data
}

async function fetchRollout(deploymentId) {
  const response = await requestJson(apiBaseUrl, `/rollouts?deploymentId=${deploymentId}`, {
    headers: apiHeaders(),
  })
  assert(response.data.items.length === 1, `Expected one rollout for deployment ${deploymentId}`)
  return response.data.items[0]
}

function assertEvaluationUsesRealTelemetry(evaluation, label) {
  assert(evaluation?.telemetrySnapshot, `${label}: expected reconcile evaluation to include telemetry snapshot`)
  assertRealSnapshot(evaluation.telemetrySnapshot, label)
}

function assertHealthySummary(summary, label) {
  assert(summary.errorRatePct.value <= 2, `${label}: expected error rate <= 2, got ${summary.errorRatePct.value}`)
  assert(summary.latencyP95Ms.value <= 500, `${label}: expected p95 latency <= 500, got ${summary.latencyP95Ms.value}`)
  assert(
    summary.logErrorRatioPct.value <= 2,
    `${label}: expected log error ratio <= 2, got ${summary.logErrorRatioPct.value}`,
  )
}

function assertUnhealthySummary(summary, label) {
  const unhealthy =
    summary.errorRatePct.value > 5 ||
    summary.latencyP95Ms.value > 750 ||
    summary.logErrorRatioPct.value > 5
  assert(unhealthy, `${label}: expected at least one rollback threshold to be exceeded`)
}

async function verifyHealthyPromotion(serviceId, environmentId, policyId) {
  const revision = `demo-healthy-${runId}`
  log(`Preparing healthy demo workload telemetry for ${revision}`)
  await setScenario('healthy', revision)
  await waitForSnapshot(revision, 'healthy preflight', (summary) => {
    assertHealthySummary(summary, 'healthy preflight')
    return true
  })

  log(`Creating healthy deployment ${revision}`)
  const deployment = await createDeployment(serviceId, environmentId, policyId, revision)
  const initialized = await reconcile(deployment.id)
  assert(initialized.phase === 'initialized', 'Expected healthy deployment to initialize rollout')
  assert(initialized.deployment.currentWeight === 5, 'Expected initialize step to set weight to 5')
  await delay(1_200)

  const firstHealthy = await reconcile(deployment.id)
  assert(firstHealthy.evaluation?.decision === 'hold', 'Expected first healthy reconcile to hold')
  assert(firstHealthy.evaluation?.nextState?.consecutivePasses === 1, 'Expected first healthy pass to be recorded')
  assertEvaluationUsesRealTelemetry(firstHealthy.evaluation, 'first healthy reconcile')
  assertHealthySummary(snapshotSummary(firstHealthy.evaluation.telemetrySnapshot), 'first healthy reconcile')

  const promoted = await reconcile(deployment.id)
  assert(promoted.evaluation?.decision === 'promote', 'Expected second healthy reconcile to promote')
  assert(promoted.deployment.currentWeight === 25, 'Expected promotion to move weight to 25')
  assertEvaluationUsesRealTelemetry(promoted.evaluation, 'healthy promotion')
  assertHealthySummary(snapshotSummary(promoted.evaluation.telemetrySnapshot), 'healthy promotion')

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

  log(`Healthy real-telemetry promotion verified for deployment ${deployment.id}`)
}

async function verifyRollback(serviceId, environmentId, policyId) {
  const revision = `demo-rollback-${runId}`
  log(`Preparing unhealthy demo workload telemetry for ${revision}`)
  await setScenario('unhealthy', revision)
  await waitForSnapshot(revision, 'rollback preflight', (summary) => {
    assertUnhealthySummary(summary, 'rollback preflight')
    return true
  })

  log(`Creating rollback deployment ${revision}`)
  const deployment = await createDeployment(serviceId, environmentId, policyId, revision)
  const initialized = await reconcile(deployment.id)
  assert(initialized.phase === 'initialized', 'Expected rollback deployment to initialize first')
  assert(initialized.deployment.currentWeight === 5, 'Expected rollback deployment to start at 5')
  await delay(1_200)

  const rolledBack = await reconcile(deployment.id)
  assert(rolledBack.evaluation?.decision === 'rollback', 'Expected unhealthy reconcile to rollback')
  assert(rolledBack.deployment.status === 'rolled_back', 'Expected deployment to be marked rolled_back')
  assert(rolledBack.deployment.currentWeight === 0, 'Expected rollback to reduce traffic to 0')
  assertEvaluationUsesRealTelemetry(rolledBack.evaluation, 'rollback reconcile')
  assertUnhealthySummary(snapshotSummary(rolledBack.evaluation.telemetrySnapshot), 'rollback reconcile')

  const rollout = await fetchRollout(deployment.id)
  assert(rollout.status === 'rolled_back', 'Expected rollout status to be rolled_back')
  assert(rollout.currentWeight === 0, 'Expected rollout weight to be 0 after rollback')
  assert(Array.isArray(rollout.incidents) && rollout.incidents.length > 0, 'Expected rollback incident to be recorded')
  assert(
    rollout.auditEvents.some((event) => event.summary.includes('Rolled')),
    'Expected audit history to capture rollback action summary',
  )

  log(`Unhealthy real-telemetry rollback verified for deployment ${deployment.id}`)
}

async function main() {
  const onboarded = await onboardProject()
  const policy = await createPolicy(onboarded.service.id, onboarded.environment.id)

  await verifyHealthyPromotion(onboarded.service.id, onboarded.environment.id, policy.id)
  await verifyRollback(onboarded.service.id, onboarded.environment.id, policy.id)

  log(`Demo workload real telemetry verification passed for project ${projectName}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
