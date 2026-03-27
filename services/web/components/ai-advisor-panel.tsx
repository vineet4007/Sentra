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

function toneForPrediction(predictedOutcome: AiAdvisor['prediction']['predictedOutcome']): 'good' | 'accent' | 'warn' | 'critical' {
  switch (predictedOutcome) {
    case 'stable':
      return 'good'
    case 'watch':
      return 'accent'
    case 'rollback_risk':
      return 'warn'
    case 'rollback_expected':
      return 'critical'
    case 'awaiting_data':
      return 'accent'
  }
}

function labelForPredictedOutcome(predictedOutcome: AiAdvisor['prediction']['predictedOutcome']) {
  return predictedOutcome.replace(/_/g, ' ')
}

function toneForAnomalySeverity(severity: AiAdvisor['anomalies'][number]['severity']): 'good' | 'accent' | 'warn' | 'critical' {
  switch (severity) {
    case 'low':
      return 'good'
    case 'medium':
      return 'accent'
    case 'high':
      return 'warn'
    case 'critical':
      return 'critical'
  }
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
            <span>
              {advisor.engine} / {advisor.confidencePct}% confidence / {advisor.prediction.rollbackProbabilityPct}%
              {' '}rollback risk
            </span>
          </div>
        </div>
      </header>

      <div className="advisor-grid">
        <div className="advisor-signals">
          <article className="advisor-signal">
            <span>Predicted outcome</span>
            <StatusPill label={labelForPredictedOutcome(advisor.prediction.predictedOutcome)} tone={toneForPrediction(advisor.prediction.predictedOutcome)} />
          </article>
          <article className="advisor-signal">
            <span>Next-step risk</span>
            <StatusPill
              label={`${advisor.prediction.nextStepRiskPct}%`}
              tone={advisor.prediction.nextStepRiskPct >= 70 ? 'critical' : advisor.prediction.nextStepRiskPct >= 50 ? 'warn' : 'accent'}
            />
          </article>
          {advisor.signals.map((signal) => (
            <article key={`${signal.label}-${signal.value}`} className="advisor-signal">
              <span>{signal.label}</span>
              <StatusPill label={signal.value} tone={signal.tone} />
            </article>
          ))}
        </div>

        {!compact ? (
          <div className="advisor-insights">
            <div className="advisor-rationale">
              {advisor.rationales.map((reason) => (
                <article key={reason} className="advisor-rationale__item">
                  <span className="advisor-rationale__index">shadow</span>
                  <strong>{reason}</strong>
                </article>
              ))}
            </div>
            {advisor.anomalies.length > 0 ? (
              <div className="advisor-anomalies">
                {advisor.anomalies.map((anomaly) => (
                  <article key={`${anomaly.kind}-${anomaly.label}`} className="advisor-anomaly">
                    <StatusPill label={anomaly.label} tone={toneForAnomalySeverity(anomaly.severity)} />
                    <strong>{anomaly.summary}</strong>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}
