import Link from 'next/link'
import type { Rollout, Satellite } from '@/lib/types'
import { AiAdvisorPanel } from '@/components/ai-advisor-panel'
import { AiShadowReviewPanel } from '@/components/ai-shadow-review-panel'
import { DelegateTaskPanel } from '@/components/delegate-task-panel'
import { LiveEventStream } from '@/components/live-event-stream'
import { StatusPill } from '@/components/status-pill'
import { StepTrack } from '@/components/step-track'

type RolloutDetailViewProps = {
  rollout: Rollout
  satellites: Satellite[]
}

function toneForDecision(decision?: string | null): 'neutral' | 'good' | 'warn' | 'critical' | 'accent' {
  switch (decision) {
    case 'promote':
    case 'initialize':
      return 'good'
    case 'rollback':
      return 'critical'
    case 'pause':
      return 'warn'
    case 'hold':
      return 'accent'
    default:
      return 'neutral'
  }
}

export function RolloutDetailView({ rollout, satellites }: RolloutDetailViewProps) {
  const liveDecision = rollout.liveState?.decision || rollout.lastDecision || rollout.status
  const traffic = rollout.liveState?.traffic || rollout.traffic
  const gateResults = rollout.liveState?.evaluation?.gateResults || []
  const telemetryWindow = rollout.liveState?.evaluation?.telemetrySnapshot?.window

  return (
    <main className="detail-page">
      <section className="detail-header">
        <div>
          <Link href="/" className="back-link">
            Back to control room
          </Link>
          <p className="eyebrow">{rollout.environmentName}</p>
          <h1>{rollout.serviceName}</h1>
          <p>{rollout.liveState?.summary || rollout.lastDecisionReason || 'Sentra is waiting for the next action.'}</p>
        </div>
        <div className="detail-header__stack">
          <StatusPill label={liveDecision || 'idle'} tone={toneForDecision(liveDecision)} />
          <StatusPill label={`${traffic.candidateWeight}% candidate`} tone="accent" />
          <StatusPill label={`${traffic.stableWeight}% stable`} tone={traffic.recoveredToStable ? 'good' : 'neutral'} />
        </div>
      </section>

      <section className="detail-grid">
        <div className="detail-main">
          <AiAdvisorPanel advisor={rollout.aiAdvisor} />
          <AiShadowReviewPanel shadow={rollout.aiShadow} />

          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Rollout shape</p>
                <h2>
                  {traffic.candidateWeight}% candidate / {traffic.stableWeight}% stable
                </h2>
              </div>
            </header>
            <div className={`traffic-note traffic-note--detail${traffic.recoveredToStable ? ' traffic-note--recovered' : ''}`}>
              <strong>{traffic.recoveredToStable ? 'Stable restored' : 'Traffic posture'}</strong>
              <span>{traffic.summary}</span>
            </div>
            <StepTrack steps={rollout.steps} />
            <div className="detail-metrics">
              <article>
                <span>Status</span>
                <strong>{rollout.status}</strong>
              </article>
              <article>
                <span>Candidate</span>
                <strong>{traffic.candidateWeight}%</strong>
              </article>
              <article>
                <span>Stable</span>
                <strong>{traffic.stableWeight}%</strong>
              </article>
              <article>
                <span>Started</span>
                <strong>{rollout.startedAt ? new Date(rollout.startedAt).toLocaleString() : 'n/a'}</strong>
              </article>
              <article>
                <span>Telemetry window</span>
                <strong>
                  {telemetryWindow?.rangeSec ? `${telemetryWindow.rangeSec}s / ${telemetryWindow.stepSec}s` : 'Awaiting snapshot'}
                </strong>
              </article>
            </div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Gate readout</p>
                <h2>Every controller decision, with threshold context.</h2>
              </div>
            </header>
            <div className="gate-grid gate-grid--detail">
              {gateResults.length === 0 ? (
                <p className="muted">No gate evaluations have been published for this rollout yet.</p>
              ) : (
                gateResults.map((gate) => (
                  <article key={gate.name} className="gate-chip gate-chip--detail">
                    <div className="gate-chip__topline">
                      <StatusPill label={gate.name} tone={gate.passed ? 'good' : gate.signalStatus === 'no_data' ? 'warn' : 'critical'} />
                      <strong>
                        {typeof gate.value === 'number'
                          ? `${gate.value.toFixed(gate.unit === 'ms' ? 0 : 2)}${gate.unit ? ` ${gate.unit}` : ''}`
                          : gate.signalStatus}
                      </strong>
                    </div>
                    <span>{gate.reason}</span>
                    <code>{gate.query || 'No query recorded'}</code>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Audit history</p>
                <h2>What Sentra did, when, and why.</h2>
              </div>
            </header>
            <div className="timeline">
              {rollout.auditEvents.length === 0 ? (
                <p className="muted">No audit events recorded yet.</p>
              ) : (
                rollout.auditEvents.map((event) => (
                  <article key={event.id} className="timeline__item">
                    <StatusPill label={event.eventType} tone={toneForDecision(event.details?.decision as string | null)} />
                    <div>
                      <strong>{event.summary}</strong>
                      <span>{event.occurredAt ? new Date(event.occurredAt).toLocaleString() : 'Unknown time'}</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>

        <aside className="detail-side">
          <LiveEventStream deploymentId={rollout.id} />

          <DelegateTaskPanel rollout={rollout} satellites={satellites} />

          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Federated execution</p>
                <h2>Recent delegated work for this rollout.</h2>
              </div>
            </header>
            <div className="timeline">
              {rollout.satelliteTasks.length === 0 ? (
                <p className="muted">This rollout has not been delegated to a satellite yet.</p>
              ) : (
                rollout.satelliteTasks.map((task) => (
                  <article key={task.id} className="timeline__item timeline__item--task">
                    <StatusPill label={task.status} tone={task.status === 'completed' ? 'good' : task.status === 'failed' ? 'critical' : 'accent'} />
                    <div>
                      <strong>
                        {task.taskType} on {task.satelliteName}
                      </strong>
                      <span>
                        {task.completedAt
                          ? `Finished ${new Date(task.completedAt).toLocaleString()}`
                          : task.claimedAt
                            ? `Claimed ${new Date(task.claimedAt).toLocaleString()}`
                            : `Queued ${task.createdAt ? new Date(task.createdAt).toLocaleString() : 'recently'}`}
                      </span>
                      <Link href={`/satellites/${task.satelliteId}`} className="inline-link">
                        Open satellite
                      </Link>
                      {task.errorMessage ? <span className="task-error">{task.errorMessage}</span> : null}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Incidents</p>
                <h2>Rollback reasons and blocked telemetry.</h2>
              </div>
            </header>
            <div className="incident-list">
              {rollout.incidents.length === 0 ? (
                <p className="muted">No open incidents for this rollout.</p>
              ) : (
                rollout.incidents.map((incident) => (
                  <article key={incident.id} className="incident-card">
                    <StatusPill label={incident.severity} tone={incident.severity === 'critical' ? 'critical' : 'warn'} />
                    <strong>{incident.summary}</strong>
                    <span>{incident.incidentType}</span>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Current action</p>
                <h2>{rollout.liveState?.action?.summary || 'No live action recorded'}</h2>
              </div>
            </header>
            <div className="key-value">
              <div>
                <span>Adapter</span>
                <strong>{rollout.liveState?.action?.adapter || 'n/a'}</strong>
              </div>
              <div>
                <span>Mode</span>
                <strong>{rollout.liveState?.action?.mode || 'n/a'}</strong>
              </div>
              <div>
                <span>Traffic shift</span>
                <strong>
                  {rollout.liveState?.action
                    ? `${rollout.liveState.action.fromWeight}% -> ${rollout.liveState.action.toWeight}%`
                    : 'n/a'}
                </strong>
              </div>
            </div>
          </section>
        </aside>
      </section>
    </main>
  )
}
