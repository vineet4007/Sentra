import Link from 'next/link'
import type { Satellite, SatelliteTask } from '@/lib/types'
import { StatusPill } from '@/components/status-pill'

type SatelliteDetailViewProps = {
  satellite: Satellite
  tasks: SatelliteTask[]
}

function toneForHealth(status: string): 'neutral' | 'good' | 'warn' | 'critical' | 'accent' {
  if (status === 'online') return 'good'
  if (status === 'stale') return 'warn'
  if (status === 'degraded') return 'critical'
  return 'accent'
}

function toneForTask(status: string): 'neutral' | 'good' | 'warn' | 'critical' | 'accent' {
  if (status === 'completed') return 'good'
  if (status === 'queued' || status === 'claimed') return 'accent'
  if (status === 'failed') return 'critical'
  return 'neutral'
}

function listFromValue(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

function boolFromRecord(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const entry = (value as Record<string, unknown>)[key]
  return entry === true
}

export function SatelliteDetailView({ satellite, tasks }: SatelliteDetailViewProps) {
  const adapters = listFromValue(satellite.capabilities?.adapters)
  const telemetrySources = listFromValue(satellite.capabilities?.telemetrySources)
  const taskTypes = listFromValue(satellite.capabilities?.taskTypes)
  const taskWorkerEnabled = boolFromRecord(satellite.capabilities, 'taskWorker')
  const summary = satellite.summary || {}
  const validation = Array.isArray(summary.telemetryValidation) ? summary.telemetryValidation : []

  return (
    <main className="detail-page">
      <section className="detail-header detail-header--satellite">
        <div>
          <Link href="/" className="back-link">
            Back to control room
          </Link>
          <p className="eyebrow">Federated satellite</p>
          <h1>{satellite.name}</h1>
          <p>
            {[satellite.cloud, satellite.region, satellite.clusterName].filter(Boolean).join(' / ') ||
              'Location not reported'}
          </p>
        </div>
        <div className="detail-header__stack">
          <StatusPill label={satellite.healthStatus} tone={toneForHealth(satellite.healthStatus)} />
          <StatusPill label={taskWorkerEnabled ? 'task worker ready' : 'heartbeat only'} tone={taskWorkerEnabled ? 'good' : 'accent'} />
        </div>
      </section>

      <section className="detail-grid">
        <div className="detail-main">
          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Satellite profile</p>
                <h2>Coordinator identity, task capability, and timing.</h2>
              </div>
            </header>
            <div className="detail-metrics detail-metrics--satellite">
              <article>
                <span>Heartbeat</span>
                <strong>
                  {satellite.heartbeatAgeSec === null
                    ? 'No heartbeat yet'
                    : `${satellite.heartbeatAgeSec}s ago / ${satellite.heartbeatIntervalSec}s cadence`}
                </strong>
              </article>
              <article>
                <span>Version</span>
                <strong>{satellite.version || 'n/a'}</strong>
              </article>
              <article>
                <span>Endpoint</span>
                <strong>{satellite.endpointUrl || 'not reported'}</strong>
              </article>
            </div>

            <div className="capability-grid">
              <article className="capability-card">
                <span>Adapters</span>
                <strong>{adapters.length > 0 ? adapters.join(', ') : 'None reported'}</strong>
              </article>
              <article className="capability-card">
                <span>Telemetry</span>
                <strong>{telemetrySources.length > 0 ? telemetrySources.join(', ') : 'None reported'}</strong>
              </article>
              <article className="capability-card">
                <span>Task types</span>
                <strong>{taskTypes.length > 0 ? taskTypes.join(', ') : 'Heartbeat only'}</strong>
              </article>
            </div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Delegated task history</p>
                <h2>What the coordinator asked this satellite to do.</h2>
              </div>
            </header>
            <div className="timeline">
              {tasks.length === 0 ? (
                <p className="muted">No delegated tasks have been recorded for this satellite yet.</p>
              ) : (
                tasks.map((task) => (
                  <article key={task.id} className="timeline__item timeline__item--task">
                    <StatusPill label={task.status} tone={toneForTask(task.status)} />
                    <div>
                      <strong>
                        {task.taskType}
                        {task.deploymentId ? ` on rollout ${task.deploymentId}` : ''}
                      </strong>
                      <span>
                        {task.completedAt
                          ? `Finished ${new Date(task.completedAt).toLocaleString()}`
                          : task.claimedAt
                            ? `Claimed ${new Date(task.claimedAt).toLocaleString()}`
                            : `Queued ${task.createdAt ? new Date(task.createdAt).toLocaleString() : 'recently'}`}
                      </span>
                      {task.deploymentId ? (
                        <Link href={`/rollouts/${task.deploymentId}`} className="inline-link">
                          Open rollout {task.deploymentId}
                        </Link>
                      ) : null}
                      {task.errorMessage ? <span className="task-error">{task.errorMessage}</span> : null}
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
                <p className="eyebrow">Telemetry validation</p>
                <h2>How healthy the satellite’s local observability inputs look.</h2>
              </div>
            </header>
            <div className="incident-list">
              {validation.length === 0 ? (
                <p className="muted">No telemetry validation summary has been published yet.</p>
              ) : (
                validation.map((entry, index) => {
                  const row = entry as Record<string, unknown>
                  const status = String(row.status || 'unknown')
                  return (
                    <article key={`${row.source || 'source'}-${index}`} className="incident-card">
                      <StatusPill
                        label={String(row.source || 'source')}
                        tone={status === 'ok' ? 'good' : status === 'error' ? 'critical' : 'warn'}
                      />
                      <strong>{String(row.url || 'No URL recorded')}</strong>
                      <span>{status === 'ok' ? 'Healthy' : String(row.error || status)}</span>
                    </article>
                  )
                })
              )}
            </div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Coordinator summary</p>
                <h2>Latest satellite posture from the control plane.</h2>
              </div>
            </header>
            <div className="key-value">
              <div>
                <span>Mode</span>
                <strong>{satellite.mode}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{satellite.status}</strong>
              </div>
              <div>
                <span>Task worker</span>
                <strong>{taskWorkerEnabled ? 'enabled' : 'disabled'}</strong>
              </div>
              <div>
                <span>Registered</span>
                <strong>{satellite.registeredAt ? new Date(satellite.registeredAt).toLocaleString() : 'n/a'}</strong>
              </div>
            </div>
          </section>
        </aside>
      </section>
    </main>
  )
}
