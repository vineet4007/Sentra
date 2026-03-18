import Link from 'next/link'
import type { Rollout } from '@/lib/types'
import { AiAdvisorPanel } from '@/components/ai-advisor-panel'
import { StatusPill } from '@/components/status-pill'
import { StepTrack } from '@/components/step-track'

type RolloutCardProps = {
  rollout: Rollout
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

function toneForGateStatus(status?: string): 'neutral' | 'good' | 'warn' | 'critical' {
  if (status === 'ok') return 'good'
  if (status === 'no_data') return 'warn'
  if (status === 'error') return 'critical'
  return 'neutral'
}

export function RolloutCard({ rollout }: RolloutCardProps) {
  const liveDecision = rollout.liveState?.decision || rollout.lastDecision || rollout.status
  const gateResults = rollout.liveState?.evaluation?.gateResults || []
  const latestAudit = rollout.auditEvents[0]

  return (
    <Link href={`/rollouts/${rollout.id}`} className="rollout-card">
      <div className="rollout-card__head">
        <div>
          <p className="eyebrow">{rollout.environmentName}</p>
          <h3>{rollout.serviceName}</h3>
        </div>
        <StatusPill label={liveDecision || 'idle'} tone={toneForDecision(liveDecision)} />
      </div>

      <div className="rollout-card__metrics">
        <div>
          <span>Current traffic</span>
          <strong>{rollout.currentWeight}%</strong>
        </div>
        <div>
          <span>Revision</span>
          <strong>{rollout.revision}</strong>
        </div>
        <div>
          <span>Incidents</span>
          <strong>{rollout.incidents.length}</strong>
        </div>
      </div>

      <StepTrack steps={rollout.steps} />

      <AiAdvisorPanel advisor={rollout.aiAdvisor} compact />

      <div className="gate-grid">
        {gateResults.length === 0 ? (
          <p className="muted">Telemetry gates will appear here after the controller evaluates this rollout.</p>
        ) : (
          gateResults.slice(0, 4).map((gate) => (
            <article key={gate.name} className="gate-chip">
              <StatusPill label={gate.name} tone={toneForGateStatus(gate.signalStatus)} />
              <strong>
                {typeof gate.value === 'number'
                  ? `${gate.value.toFixed(gate.unit === 'ms' ? 0 : 2)}${gate.unit ? ` ${gate.unit}` : ''}`
                  : gate.signalStatus}
              </strong>
              <span>{gate.reason}</span>
            </article>
          ))
        )}
      </div>

      <footer className="rollout-card__foot">
        <div>
          <span>Latest controller note</span>
          <strong>{rollout.liveState?.summary || rollout.lastDecisionReason || 'Waiting for the next reconcile.'}</strong>
        </div>
        <div>
          <span>Federation</span>
          <strong>
            {rollout.satelliteTasks[0]
              ? `${rollout.satelliteTasks[0].status} via ${rollout.satelliteTasks[0].satelliteName}`
              : latestAudit?.summary || 'No delegated task recorded yet.'}
          </strong>
        </div>
      </footer>
    </Link>
  )
}
