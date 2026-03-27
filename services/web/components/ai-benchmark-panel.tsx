import type { AiBenchmarkReport } from '@/lib/types'
import { StatusPill } from '@/components/status-pill'

type AiBenchmarkPanelProps = {
  report: AiBenchmarkReport
}

function toneForRecommendation(
  recommendation: AiBenchmarkReport['recommendation'],
): 'good' | 'accent' | 'warn' | 'critical' {
  switch (recommendation) {
    case 'candidate_ready':
      return 'good'
    case 'hold':
      return 'accent'
    case 'insufficient_data':
      return 'warn'
    case 'regression_risk':
      return 'critical'
  }
}

function labelize(value: string) {
  return value.replace(/_/g, ' ')
}

export function AiBenchmarkPanel({ report }: AiBenchmarkPanelProps) {
  return (
    <section className="panel panel--ai-benchmark">
      <header className="panel__header">
        <div>
          <p className="eyebrow">Benchmark readiness</p>
          <h2>{report.summary}</h2>
          <p>
            Sentra keeps the candidate model advisory-only until it clears these offline gates against the current
            shadow stream.
          </p>
        </div>
        <div className="advisor-stack">
          <StatusPill label={labelize(report.recommendation)} tone={toneForRecommendation(report.recommendation)} />
          <StatusPill label={`${report.overlapDeployments} overlap`} tone="accent" />
        </div>
      </header>

      <div className="ai-benchmark-grid">
        {report.gates.map((gate) => (
          <article key={gate.key} className="ai-mini-card">
            <div className="ai-benchmark-card__head">
              <strong>{gate.label}</strong>
              <StatusPill label={gate.passed ? 'pass' : 'check'} tone={gate.passed ? 'good' : gate.severity === 'critical' ? 'critical' : 'warn'} />
            </div>
            <div className="ai-mini-card__stats">
              <span>Actual: {gate.actual}</span>
              <span>Expected: {gate.expected}</span>
            </div>
            <span>{gate.summary}</span>
          </article>
        ))}
      </div>
    </section>
  )
}
