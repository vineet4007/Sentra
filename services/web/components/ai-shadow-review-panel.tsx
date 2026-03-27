import type { AiShadow } from '@/lib/types'
import { StatusPill } from '@/components/status-pill'

type AiShadowReviewPanelProps = {
  shadow: AiShadow
}

function toneForReviewStatus(status: AiShadow['review']['status']): 'good' | 'accent' | 'warn' | 'critical' {
  switch (status) {
    case 'matched':
      return 'good'
    case 'early_warning':
      return 'accent'
    case 'false_positive':
      return 'warn'
    case 'false_negative':
      return 'critical'
    case 'informational':
      return 'accent'
    case 'pending':
      return 'accent'
  }
}

function toneForOutcome(outcome: AiShadow['review']['actualOutcome'] | AiShadow['review']['predictedOutcome']) {
  switch (outcome) {
    case 'completed':
    case 'stable':
      return 'good'
    case 'paused':
    case 'watch':
    case 'awaiting_data':
      return 'accent'
    case 'degraded':
    case 'rollback_risk':
      return 'warn'
    case 'rolled_back':
    case 'rollback_expected':
      return 'critical'
    case 'running':
      return 'accent'
  }
}

function labelize(value: string) {
  return value.replace(/_/g, ' ')
}

export function AiShadowReviewPanel({ shadow }: AiShadowReviewPanelProps) {
  return (
    <section className="panel panel--shadow-review">
      <header className="panel__header">
        <div>
          <p className="eyebrow">Shadow scorecard</p>
          <h2>{shadow.review.summary}</h2>
        </div>
        <div className="advisor-stack">
          <StatusPill label={labelize(shadow.review.status)} tone={toneForReviewStatus(shadow.review.status)} />
          <StatusPill label={labelize(shadow.review.actualOutcome)} tone={toneForOutcome(shadow.review.actualOutcome)} />
        </div>
      </header>

      <div className="key-value">
        <div>
          <span>Predicted outcome</span>
          <strong>{labelize(shadow.review.predictedOutcome)}</strong>
        </div>
        <div>
          <span>Warning lead</span>
          <strong>{shadow.review.warningLeadSec === null ? 'n/a' : `${shadow.review.warningLeadSec}s`}</strong>
        </div>
        <div>
          <span>Last advisory</span>
          <strong>{shadow.review.lastAdvisoryAt ? new Date(shadow.review.lastAdvisoryAt).toLocaleString() : 'n/a'}</strong>
        </div>
      </div>

      <div className="key-value">
        <div>
          <span>Baseline samples</span>
          <strong>{shadow.baseline.sampleCount}</strong>
        </div>
        <div>
          <span>Average risk</span>
          <strong>{shadow.baseline.avgRiskScore === null ? 'n/a' : shadow.baseline.avgRiskScore}</strong>
        </div>
        <div>
          <span>Risk drift</span>
          <strong>
            {shadow.baseline.currentRiskDrift === null
              ? 'n/a'
              : `${shadow.baseline.currentRiskDrift > 0 ? '+' : ''}${shadow.baseline.currentRiskDrift}`}
          </strong>
        </div>
        <div>
          <span>Rollback drift</span>
          <strong>
            {shadow.baseline.currentRollbackDrift === null
              ? 'n/a'
              : `${shadow.baseline.currentRollbackDrift > 0 ? '+' : ''}${shadow.baseline.currentRollbackDrift}%`}
          </strong>
        </div>
      </div>

      <div className="timeline">
        {shadow.history.length === 0 ? (
          <p className="muted">No persisted AI advisory snapshots yet.</p>
        ) : (
          shadow.history.map((entry) => (
            <article key={entry.id} className="timeline__item">
              <StatusPill label={labelize(entry.predictedOutcome)} tone={toneForOutcome(entry.predictedOutcome)} />
              <div>
                <strong>{entry.summary}</strong>
                <span>
                  {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Unknown time'} / {entry.rollbackProbabilityPct}% rollback
                  risk / {entry.nextStepRiskPct}% next-step risk
                </span>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
