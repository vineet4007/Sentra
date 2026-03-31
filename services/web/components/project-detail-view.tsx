'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ProjectDetails } from '@/lib/types'
import { StatusPill } from '@/components/status-pill'

type ProjectDetailViewProps = {
  details: ProjectDetails
}

type SubmissionState = {
  status: 'idle' | 'success' | 'error'
  message: string
}

function valueAsString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function valueAsIntegerString(value: unknown, fallback = '') {
  return typeof value === 'number' && Number.isInteger(value) ? String(value) : fallback
}

function parseRolloutSteps(input: string) {
  return input
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
}

function parsePositiveInt(value: FormDataEntryValue | null) {
  const parsed = Number(String(value || ''))
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function parseNonNegativeInt(value: FormDataEntryValue | null) {
  const parsed = Number(String(value || ''))
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })

  const payload = (await response.json()) as { ok: boolean; data?: T; error?: { message?: string } }
  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.error?.message || 'Request failed')
  }

  return payload.data
}

export function ProjectDetailView({ details }: ProjectDetailViewProps) {
  const router = useRouter()
  const [serviceState, setServiceState] = useState<SubmissionState>({ status: 'idle', message: '' })
  const [isServicePending, setIsServicePending] = useState(false)
  const [environmentState, setEnvironmentState] = useState<SubmissionState>({ status: 'idle', message: '' })
  const [isEnvironmentPending, setIsEnvironmentPending] = useState(false)
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState(String(details.environments[0]?.id || ''))

  const selectedEnvironment =
    details.environments.find((environment) => String(environment.id) === selectedEnvironmentId) || null

  const environmentDefaults = useMemo(() => {
    const deploymentTargetConfig = selectedEnvironment?.deploymentTargetConfig || {}
    const telemetrySourceConfig = selectedEnvironment?.telemetrySourceConfig || {}
    return {
      deploymentTargetType: selectedEnvironment?.deploymentTargetType || 'kubernetes',
      namespace: valueAsString(deploymentTargetConfig.namespace),
      deployment: valueAsString(deploymentTargetConfig.deployment),
      stableTrafficFloorPct:
        valueAsIntegerString(deploymentTargetConfig.stableTrafficFloorPct) ||
        valueAsString(deploymentTargetConfig.stableTrafficFloorPct, '5'),
      prometheusUrl: valueAsString(telemetrySourceConfig.prometheusUrl),
      lokiUrl: valueAsString(telemetrySourceConfig.lokiUrl),
      tempoUrl: valueAsString(telemetrySourceConfig.tempoUrl),
    }
  }, [selectedEnvironment])

  async function handleAddService(formData: FormData) {
    const environmentId = parsePositiveInt(formData.get('environmentId'))
    const serviceName = String(formData.get('serviceName') || '').trim()
    const namespace = String(formData.get('namespace') || '').trim()
    const deploymentName = String(formData.get('deploymentName') || '').trim()
    const rolloutSteps = parseRolloutSteps(String(formData.get('rolloutSteps') || ''))
    const requiredPasses = Number(formData.get('requiredPasses') || 3)
    const warmupSec = Number(formData.get('warmupSec') || 30)
    const errorRateMax = Number(formData.get('errorRateMax') || 2)
    const latencyMax = Number(formData.get('latencyMax') || 500)
    const revision = String(formData.get('revision') || '').trim()
    const imageRef = String(formData.get('imageRef') || '').trim()

    if (!environmentId) {
      setServiceState({ status: 'error', message: 'Choose an environment for the new service.' })
      return
    }
    if (!serviceName) {
      setServiceState({ status: 'error', message: 'Service name is required.' })
      return
    }
    if (rolloutSteps.length === 0) {
      setServiceState({ status: 'error', message: 'Rollout steps must contain at least one traffic weight.' })
      return
    }

    setServiceState({ status: 'idle', message: '' })
    setIsServicePending(true)

    try {
      const created = await requestJson<{ service: { id: number } }>(`/api/projects/${details.project.id}/services`, {
        method: 'POST',
        body: JSON.stringify({
          name: serviceName,
          adapterType: 'kubernetes',
          serviceConfig: {
            workload: deploymentName || serviceName,
            namespace,
          },
        }),
      })

      await requestJson<{ policy: { id: number } }>('/api/policies', {
        method: 'POST',
        body: JSON.stringify({
          serviceId: created.service.id,
          environmentId,
          rolloutSteps,
          evaluationWindowSec: 60,
          pollIntervalSec: 5,
          warmupSec,
          requiredPasses,
          failureMode: 'rollback',
          sloConfig: {
            errorRatePct: { max: errorRateMax },
            latencyP95Ms: { max: latencyMax },
          },
        }),
      })

      if (revision) {
        await requestJson('/api/deployments', {
          method: 'POST',
          body: JSON.stringify({
            serviceId: created.service.id,
            environmentId,
            revision,
            imageRef: imageRef || null,
            initiatedBy: 'sentra-web',
            source: 'ui',
            deploymentMetadata: {
              version: revision,
            },
          }),
        })
      }

      setServiceState({
        status: 'success',
        message: revision
          ? `Attached ${serviceName} and launched ${revision}.`
          : `Attached ${serviceName}. It is ready for its first deployment.`,
      })
      router.refresh()
    } catch (error) {
      setServiceState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Sentra could not add the service.',
      })
    } finally {
      setIsServicePending(false)
    }
  }

  async function handleUpdateEnvironment(formData: FormData) {
    const environmentId = parsePositiveInt(formData.get('environmentId'))
    const deploymentTargetType = String(formData.get('deploymentTargetType') || '').trim()
    const namespace = String(formData.get('namespace') || '').trim()
    const deployment = String(formData.get('deployment') || '').trim()
    const stableTrafficFloorPct = parseNonNegativeInt(formData.get('stableTrafficFloorPct'))
    const prometheusUrl = String(formData.get('prometheusUrl') || '').trim()
    const lokiUrl = String(formData.get('lokiUrl') || '').trim()
    const tempoUrl = String(formData.get('tempoUrl') || '').trim()

    if (!environmentId) {
      setEnvironmentState({ status: 'error', message: 'Choose an environment to update.' })
      return
    }
    if (!deploymentTargetType) {
      setEnvironmentState({ status: 'error', message: 'Deployment target type is required.' })
      return
    }
    if (stableTrafficFloorPct === null) {
      setEnvironmentState({ status: 'error', message: 'Stable fallback floor must be a whole number.' })
      return
    }

    setEnvironmentState({ status: 'idle', message: '' })
    setIsEnvironmentPending(true)

    try {
      await requestJson<{ environment: { id: number } }>(`/api/environments/${environmentId}/integrations`, {
        method: 'PUT',
        body: JSON.stringify({
          validateTelemetry: true,
          deploymentTargetType,
          deploymentTargetConfig: {
            ...(selectedEnvironment?.deploymentTargetConfig || {}),
            namespace: namespace || null,
            deployment: deployment || null,
            stableTrafficFloorPct,
          },
          telemetrySourceConfig: {
            ...(selectedEnvironment?.telemetrySourceConfig || {}),
            prometheusUrl: prometheusUrl || null,
            lokiUrl: lokiUrl || null,
            tempoUrl: tempoUrl || null,
          },
        }),
      })

      setEnvironmentState({
        status: 'success',
        message: 'Environment integrations updated and telemetry revalidated.',
      })
      router.refresh()
    } catch (error) {
      setEnvironmentState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Sentra could not update the environment.',
      })
    } finally {
      setIsEnvironmentPending(false)
    }
  }

  return (
    <main className="detail-page">
      <section className="detail-header detail-header--project">
        <div>
          <Link href="/" className="back-link">
            Back to control room
          </Link>
          <p className="eyebrow">Project workspace</p>
          <h1>{details.project.name}</h1>
          <p>{details.project.repoUrl || 'This project does not have a repository URL recorded yet.'}</p>
        </div>
        <div className="detail-header__stack">
          <StatusPill
            label={`${details.services.length} service${details.services.length === 1 ? '' : 's'}`}
            tone="accent"
          />
          <StatusPill
            label={`${details.environments.length} environment${details.environments.length === 1 ? '' : 's'}`}
            tone="good"
          />
        </div>
      </section>

      <section className="detail-grid detail-grid--project">
        <div className="detail-main">
          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Project summary</p>
                <h2>Services, environments, and rollout ownership for this project.</h2>
              </div>
            </header>
            <div className="detail-metrics">
              <article>
                <span>Project ID</span>
                <strong>{details.project.id}</strong>
              </article>
              <article>
                <span>Services</span>
                <strong>{details.services.length}</strong>
              </article>
              <article>
                <span>Environments</span>
                <strong>{details.environments.length}</strong>
              </article>
              <article>
                <span>Updated</span>
                <strong>{details.project.updatedAt ? new Date(details.project.updatedAt).toLocaleString() : 'n/a'}</strong>
              </article>
            </div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Services</p>
                <h2>Every microservice currently attached to this project.</h2>
              </div>
            </header>
            <div className="project-strip">
              {details.services.length === 0 ? (
                <p className="muted">No services are attached yet.</p>
              ) : (
                details.services.map((service) => (
                  <article key={service.id} className="project-tile">
                    <div className="project-tile__head">
                      <strong>{service.name}</strong>
                      <StatusPill label={service.adapterType} tone="accent" />
                    </div>
                    <span>
                      Workload:{' '}
                      {valueAsString(service.serviceConfig?.workload) || valueAsString(service.serviceConfig?.deployment) || 'not recorded'}
                    </span>
                    <div className="project-tile__meta project-tile__meta--summary">
                      <span>ID {service.id}</span>
                      <span>{service.updatedAt ? new Date(service.updatedAt).toLocaleDateString() : 'n/a'}</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Environments</p>
                <h2>Telemetry and deployment target settings used by this project.</h2>
              </div>
            </header>
            <div className="project-strip">
              {details.environments.length === 0 ? (
                <p className="muted">No environments are attached yet.</p>
              ) : (
                details.environments.map((environment) => (
                  <article key={environment.id} className="project-tile">
                    <div className="project-tile__head">
                      <strong>{environment.name}</strong>
                      <StatusPill label={environment.deploymentTargetType} tone="good" />
                    </div>
                    <span>
                      Namespace: {valueAsString(environment.deploymentTargetConfig?.namespace) || 'not recorded'}
                    </span>
                    <span>
                      Target: {valueAsString(environment.deploymentTargetConfig?.deployment) || 'not recorded'}
                    </span>
                    <span>
                      Stable fallback:{' '}
                      {valueAsIntegerString(environment.deploymentTargetConfig?.stableTrafficFloorPct) ||
                        valueAsString(environment.deploymentTargetConfig?.stableTrafficFloorPct) ||
                        '0'}
                      %
                    </span>
                    <span>
                      Prometheus: {valueAsString(environment.telemetrySourceConfig?.prometheusUrl) || 'not recorded'}
                    </span>
                    <div className="project-tile__meta project-tile__meta--summary">
                      <span>ID {environment.id}</span>
                      <span>{environment.updatedAt ? new Date(environment.updatedAt).toLocaleDateString() : 'n/a'}</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>

        <aside className="detail-side">
          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Add service</p>
                <h2>Create another service in this project and give it its own rollout policy.</h2>
              </div>
            </header>
            {details.environments.length === 0 ? (
              <p className="muted">Add an environment first before attaching more services.</p>
            ) : (
              <form
                className="control-form"
                action={(formData) => {
                  void handleAddService(formData)
                }}
              >
                <div className="form-grid">
                  <label>
                    <span>Environment</span>
                    <select name="environmentId" defaultValue={details.environments[0]?.id}>
                      {details.environments.map((environment) => (
                        <option key={environment.id} value={environment.id}>
                          {environment.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Service</span>
                    <input name="serviceName" defaultValue="catalog-api" />
                  </label>
                  <label>
                    <span>Namespace</span>
                    <input
                      name="namespace"
                      defaultValue={valueAsString(details.environments[0]?.deploymentTargetConfig?.namespace)}
                    />
                  </label>
                  <label>
                    <span>Deployment target</span>
                    <input name="deploymentName" defaultValue="catalog-api" />
                  </label>
                  <label>
                    <span>Rollout steps</span>
                    <input name="rolloutSteps" defaultValue="5,25,50,95" />
                  </label>
                  <label>
                    <span>Error rate max (%)</span>
                    <input name="errorRateMax" defaultValue="2" />
                  </label>
                  <label>
                    <span>Latency p95 max (ms)</span>
                    <input name="latencyMax" defaultValue="500" />
                  </label>
                  <label>
                    <span>Required healthy passes</span>
                    <input name="requiredPasses" defaultValue="3" />
                  </label>
                  <label>
                    <span>Warmup (sec)</span>
                    <input name="warmupSec" defaultValue="30" />
                  </label>
                  <label>
                    <span>Revision</span>
                    <input name="revision" placeholder="build-2026-03-29.1" />
                  </label>
                  <label>
                    <span>Image ref</span>
                    <input name="imageRef" placeholder="ghcr.io/org/catalog-api:build-2026-03-29.1" />
                  </label>
                </div>

                <div className="form-footer">
                  <button className="primary-button" type="submit" disabled={isServicePending}>
                    {isServicePending ? 'Adding…' : 'Add service'}
                  </button>
                  {serviceState.message ? (
                    <p className={`form-feedback form-feedback--${serviceState.status}`}>{serviceState.message}</p>
                  ) : (
                    <p className="muted">Sentra will create the service, save a policy, and optionally start its first rollout.</p>
                  )}
                </div>
              </form>
            )}
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Environment settings</p>
                <h2>Update telemetry and deployment-target details for an existing environment.</h2>
              </div>
            </header>
            {details.environments.length === 0 ? (
              <p className="muted">No environments are available to edit yet.</p>
            ) : (
              <form
                className="control-form"
                action={(formData) => {
                  void handleUpdateEnvironment(formData)
                }}
              >
                <div className="form-grid">
                  <label>
                    <span>Environment</span>
                    <select
                      name="environmentId"
                      value={selectedEnvironmentId}
                      onChange={(event) => setSelectedEnvironmentId(event.target.value)}
                    >
                      {details.environments.map((environment) => (
                        <option key={environment.id} value={environment.id}>
                          {environment.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Deployment target type</span>
                    <input name="deploymentTargetType" defaultValue={environmentDefaults.deploymentTargetType} key={`${selectedEnvironmentId}-type`} />
                  </label>
                  <label>
                    <span>Namespace</span>
                    <input name="namespace" defaultValue={environmentDefaults.namespace} key={`${selectedEnvironmentId}-namespace`} />
                  </label>
                  <label>
                    <span>Deployment target</span>
                    <input name="deployment" defaultValue={environmentDefaults.deployment} key={`${selectedEnvironmentId}-deployment`} />
                  </label>
                  <label>
                    <span>Stable fallback floor (%)</span>
                    <input
                      name="stableTrafficFloorPct"
                      defaultValue={environmentDefaults.stableTrafficFloorPct}
                      key={`${selectedEnvironmentId}-stable-floor`}
                    />
                  </label>
                  <label>
                    <span>Prometheus URL</span>
                    <input name="prometheusUrl" defaultValue={environmentDefaults.prometheusUrl} key={`${selectedEnvironmentId}-prom`} />
                  </label>
                  <label>
                    <span>Loki URL</span>
                    <input name="lokiUrl" defaultValue={environmentDefaults.lokiUrl} key={`${selectedEnvironmentId}-loki`} />
                  </label>
                  <label>
                    <span>Tempo URL</span>
                    <input name="tempoUrl" defaultValue={environmentDefaults.tempoUrl} key={`${selectedEnvironmentId}-tempo`} />
                  </label>
                </div>

                <div className="form-footer">
                  <button className="primary-button" type="submit" disabled={isEnvironmentPending}>
                    {isEnvironmentPending ? 'Saving…' : 'Save environment'}
                  </button>
                  {environmentState.message ? (
                    <p className={`form-feedback form-feedback--${environmentState.status}`}>{environmentState.message}</p>
                  ) : (
                    <p className="muted">Sentra will update the environment, keep the stable fallback floor on record, and revalidate telemetry access.</p>
                  )}
                </div>
              </form>
            )}
          </section>
        </aside>
      </section>
    </main>
  )
}
