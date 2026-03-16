import type { RolloutStep } from '@/lib/types'

type StepTrackProps = {
  steps: RolloutStep[]
}

function toneForStep(status: string) {
  switch (status) {
    case 'completed':
      return 'good'
    case 'in_progress':
      return 'accent'
    case 'paused':
      return 'warn'
    case 'rolled_back':
    case 'skipped':
      return 'critical'
    default:
      return 'neutral'
  }
}

export function StepTrack({ steps }: StepTrackProps) {
  return (
    <ol className="step-track" aria-label="Rollout progression">
      {steps.map((step) => (
        <li key={step.id} className={`step-chip step-chip--${toneForStep(step.status)}`}>
          <span className="step-chip__weight">{step.targetWeight}%</span>
          <span className="step-chip__status">{step.status.replace('_', ' ')}</span>
        </li>
      ))}
    </ol>
  )
}
