'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type OnboardingPanelProps = {
  projectCount: number
}

type SubmissionState = {
  status: 'idle' | 'success' | 'error'
  message: string
}

const defaults = {
  projectName: 'control-room-demo',
  serviceName: 'payments-api',
  environmentName: 'staging',
  repoUrl: 'https://example.com/sentra',
  namespace: 'payments',
  deploymentName: 'payments-api',
  prometheusUrl: 'http://prometheus:9090',
  lokiUrl: 'http://loki:3100',
  tempoUrl: 'http://tempo:3200',
  rolloutSteps: '5,25,50,100',
  errorRateMax: '2',
  latencyMax: '500',
  requiredPasses: '3',
  warmupSec: '30',
  revision: '',
  imageRef: '',
}

function parseRolloutSteps(input: string) {
  return input
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
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

export function OnboardingPanel({ projectCount }: OnboardingPanelProps) {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [state, setState] = useState<SubmissionState>({ status: 'idle', message: '' })

  async function handleSubmit(formData: FormData) {
    const projectName = String(formData.get('projectName') || '').trim()
    const serviceName = String(formData.get('serviceName') || '').trim()
    const environmentName = String(formData.get('environmentName') || '').trim()
    const repoUrl = String(formData.get('repoUrl') || '').trim()
    const namespace = String(formData.get('namespace') || '').trim()
    const deploymentName = String(formData.get('deploymentName') || '').trim()
    const prometheusUrl = String(formData.get('prometheusUrl') || '').trim()
    const lokiUrl = String(formData.get('lokiUrl') || '').trim()
    const tempoUrl = String(formData.get('tempoUrl') || '').trim()
    const rolloutSteps = parseRolloutSteps(String(formData.get('rolloutSteps') || ''))
    const requiredPasses = Number(formData.get('requiredPasses') || 3)
    const warmupSec = Number(formData.get('warmupSec') || 30)
    const errorRateMax = Number(formData.get('errorRateMax') || 2)
    const latencyMax = Number(formData.get('latencyMax') || 500)
    const revision = String(formData.get('revision') || '').trim()
    const imageRef = String(formData.get('imageRef') || '').trim()

    if (!projectName || !serviceName || !environmentName) {
      setState({ status: 'error', message: 'Project, service, and environment names are required.' })
      return
    }
    if (rolloutSteps.length === 0) {
      setState({ status: 'error', message: 'Rollout steps must contain at least one traffic weight.' })
      return
    }

    setState({ status: 'idle', message: '' })
    setIsPending(true)

    try {
      const onboarded = await requestJson<{
        project: { id: number }
        service: { id: number }
        environment: { id: number }
      }>('/api/projects/onboard', {
        method: 'POST',
        body: JSON.stringify({
          validateTelemetry: true,
          project: {
            name: projectName,
            repoUrl: repoUrl || null,
          },
          service: {
            name: serviceName,
            adapterType: 'kubernetes',
            serviceConfig: {
              workload: deploymentName || serviceName,
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
              deployment: deploymentName || serviceName,
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
        }),
      })

      await requestJson<{ policy: { id: number } }>('/api/policies', {
        method: 'POST',
        body: JSON.stringify({
          serviceId: onboarded.service.id,
          environmentId: onboarded.environment.id,
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
            serviceId: onboarded.service.id,
            environmentId: onboarded.environment.id,
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

      setState({
        status: 'success',
        message: revision
          ? `Connected ${projectName} and launched ${revision}.`
          : `Connected ${projectName}. Add a deployment when you are ready.`,
      })

      router.refresh()
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Sentra could not complete onboarding.',
      })
    } finally {
      setIsPending(false)
    }
  }

  return (
    <section className="panel panel--form">
      <header className="panel__header">
        <div>
          <p className="eyebrow">Onboard a project</p>
          <h2>Connect delivery, telemetry, and rollout policy in one pass.</h2>
        </div>
        <div className="metric-chip">
          <strong>{projectCount}</strong>
          <span>projects wired</span>
        </div>
      </header>

      <form
        className="control-form"
        action={(formData) => {
          void handleSubmit(formData)
        }}
      >
        <div className="form-grid">
          <label>
            <span>Project</span>
            <input name="projectName" defaultValue={defaults.projectName} />
          </label>
          <label>
            <span>Repository URL</span>
            <input name="repoUrl" defaultValue={defaults.repoUrl} />
          </label>
          <label>
            <span>Service</span>
            <input name="serviceName" defaultValue={defaults.serviceName} />
          </label>
          <label>
            <span>Environment</span>
            <input name="environmentName" defaultValue={defaults.environmentName} />
          </label>
          <label>
            <span>Namespace</span>
            <input name="namespace" defaultValue={defaults.namespace} />
          </label>
          <label>
            <span>Deployment target</span>
            <input name="deploymentName" defaultValue={defaults.deploymentName} />
          </label>
        </div>

        <div className="form-callout">
          <strong>Telemetry setup</strong>
          <p>Use container-reachable URLs when Sentra runs inside Docker Compose.</p>
        </div>

        <div className="form-grid">
          <label>
            <span>Prometheus URL</span>
            <input name="prometheusUrl" defaultValue={defaults.prometheusUrl} />
          </label>
          <label>
            <span>Loki URL</span>
            <input name="lokiUrl" defaultValue={defaults.lokiUrl} />
          </label>
          <label>
            <span>Tempo URL</span>
            <input name="tempoUrl" defaultValue={defaults.tempoUrl} />
          </label>
          <label>
            <span>Rollout steps</span>
            <input name="rolloutSteps" defaultValue={defaults.rolloutSteps} />
          </label>
          <label>
            <span>Error rate max (%)</span>
            <input name="errorRateMax" defaultValue={defaults.errorRateMax} />
          </label>
          <label>
            <span>Latency p95 max (ms)</span>
            <input name="latencyMax" defaultValue={defaults.latencyMax} />
          </label>
          <label>
            <span>Required healthy passes</span>
            <input name="requiredPasses" defaultValue={defaults.requiredPasses} />
          </label>
          <label>
            <span>Warmup (sec)</span>
            <input name="warmupSec" defaultValue={defaults.warmupSec} />
          </label>
        </div>

        <div className="form-callout">
          <strong>Optional launch</strong>
          <p>Drop in a revision now if you want the control room to create the first deployment immediately.</p>
        </div>

        <div className="form-grid form-grid--compact">
          <label>
            <span>Revision</span>
            <input name="revision" placeholder="build-2026-03-13.1" defaultValue={defaults.revision} />
          </label>
          <label>
            <span>Image ref</span>
            <input name="imageRef" placeholder="ghcr.io/org/service:build-2026-03-13.1" defaultValue={defaults.imageRef} />
          </label>
        </div>

        <div className="form-footer">
          <button className="primary-button" type="submit" disabled={isPending}>
            {isPending ? 'Connecting…' : 'Connect to Sentra'}
          </button>
          {state.message ? (
            <p className={`form-feedback form-feedback--${state.status}`}>{state.message}</p>
          ) : (
            <p className="muted">Sentra will validate telemetry, save policy, and optionally seed a deployment.</p>
          )}
        </div>
      </form>
    </section>
  )
}
