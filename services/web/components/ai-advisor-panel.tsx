import type { AiAdvisor } from '@/lib/types'
import { StatusPill } from '@/components/status-pill'

type AiAdvisorPanelProps = {
  advisor: AiAdvisor
  compact?: boolean
}

function toneForSeverity(severity: AiAdvisor['severity']): 'good' | 'accent' | 'warn' | 'critical' {
  switch (severity) {
    case 'low':
      return 'good'
    case 'elevated':
      return 'accent'
    case 'high':
      return 'warn'
    case 'critical':
      return 'critical'
  }
}

function labelForRecommendation(recommendation: AiAdvisor['recommendation']) {
  return recommendation.replace(/_/g, ' ')
}

export function AiAdvisorPanel({ advisor, compact = false }: AiAdvisorPanelProps) {
  return (
    <section className={`panel panel--advisor${compact ? ' panel--advisor-compact' : ''}`}>
      <header className="panel__header">
        <div>
          <p className="eyebrow">AI shadow mode</p>
          <h2>{advisor.headline}</h2>
          <p>{advisor.summary}</p>
        </div>
        <div className="advisor-stack">
          <StatusPill label={labelForRecommendation(advisor.recommendation)} tone={toneForSeverity(advisor.severity)} />
          <div className="metric-chip metric-chip--advisor">
            <strong>{advisor.riskScore}</strong>
            <span>{advisor.engine} / {advisor.confidencePct}% confidence</span>
          </div>
        </div>
      </header>

      <div className="advisor-grid">
        <div className="advisor-signals">
          {advisor.signals.map((signal) => (
            <article key={`${signal.label}-${signal.value}`} className="advisor-signal">
              <span>{signal.label}</span>
              <StatusPill label={signal.value} tone={signal.tone} />
            </article>
          ))}
        </div>

        {!compact ? (
          <div className="advisor-rationale">
            {advisor.rationales.map((reason) => (
              <article key={reason} className="advisor-rationale__item">
                <span className="advisor-rationale__index">shadow</span>
                <strong>{reason}</strong>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
