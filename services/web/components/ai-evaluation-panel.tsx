import Link from 'next/link'
import type { AiShadowEvaluationSummary } from '@/lib/types'
import { StatusPill } from '@/components/status-pill'

type AiEvaluationPanelProps = {
  evaluation: AiShadowEvaluationSummary
}

function toneForReviewStatus(status: AiShadowEvaluationSummary['examples'][number]['reviewStatus']) {
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
    case 'pending':
      return 'neutral'
  }
}

function labelize(value: string) {
  return value.replace(/_/g, ' ')
}

function formatPct(value: number | null) {
  return value === null ? 'n/a' : `${value}%`
}

function formatLead(value: number | null) {
  return value === null ? 'n/a' : `${value}s`
}

export function AiEvaluationPanel({ evaluation }: AiEvaluationPanelProps) {
  const { overview, services, examples, timeline, calibration, engines, comparison } = evaluation

  return (
    <section className="panel panel--ai-evaluation">
      <header className="panel__header">
        <div>
          <p className="eyebrow">AI evaluation</p>
          <h2>Shadow accuracy, recall, and warning quality across the rollout fleet.</h2>
          <p>
            This is the safety rail for the AI layer. Sentra keeps the model advisory-only, then measures how often it
            was early, aligned, noisy, or missed real rollout risk.
          </p>
        </div>
        <div className="advisor-stack">
          <StatusPill
            label={overview.coveragePct === null ? 'No AI coverage yet' : `${overview.coveragePct}% coverage`}
            tone={overview.coveragePct !== null && overview.coveragePct >= 80 ? 'good' : 'accent'}
          />
          <StatusPill
            label={overview.accuracyPct === null ? 'Awaiting outcomes' : `${overview.accuracyPct}% accuracy`}
            tone={overview.accuracyPct !== null && overview.accuracyPct >= 70 ? 'good' : 'warn'}
          />
        </div>
      </header>

      <div className="ai-eval-grid">
        <article className="metric-chip">
          <strong>{overview.evaluatedDeployments}</strong>
          <span>rollouts with AI advisory history</span>
        </article>
        <article className="metric-chip">
          <strong>{formatPct(overview.riskyOutcomeRecallPct)}</strong>
          <span>risky-outcome recall</span>
        </article>
        <article className="metric-chip">
          <strong>{formatPct(overview.warningPrecisionPct)}</strong>
          <span>warning precision</span>
        </article>
        <article className="metric-chip">
          <strong>{formatLead(overview.avgWarningLeadSec)}</strong>
          <span>average lead time before impact</span>
        </article>
        <article className="metric-chip">
          <strong>{overview.brierScore === null ? 'n/a' : overview.brierScore}</strong>
          <span>rollback probability Brier score</span>
        </article>
      </div>

      {comparison ? (
        <section className="ai-compare-shell">
          <div className="ai-eval-section__head">
            <h3>Model comparison</h3>
            <span>{comparison.overlapDeployments} overlapping rollout{comparison.overlapDeployments === 1 ? '' : 's'}</span>
          </div>
          <div className="ai-compare-grid">
            <article className="ai-engine-card">
              <div className="ai-engine-card__head">
                <strong>{comparison.primary.label}</strong>
                <StatusPill label={comparison.primary.engine || 'n/a'} tone="accent" />
              </div>
              <div className="ai-engine-card__stats">
                <div>
                  <span>Accuracy</span>
                  <strong>{formatPct(comparison.primary.accuracyPct)}</strong>
                </div>
                <div>
                  <span>Recall</span>
                  <strong>{formatPct(comparison.primary.riskyOutcomeRecallPct)}</strong>
                </div>
                <div>
                  <span>Precision</span>
                  <strong>{formatPct(comparison.primary.warningPrecisionPct)}</strong>
                </div>
                <div>
                  <span>Brier</span>
                  <strong>{comparison.primary.brierScore === null ? 'n/a' : comparison.primary.brierScore}</strong>
                </div>
              </div>
            </article>

            <article className="ai-engine-card">
              <div className="ai-engine-card__head">
                <strong>{comparison.candidate?.label || 'Candidate stream'}</strong>
                <StatusPill
                  label={comparison.candidate?.engine || 'awaiting data'}
                  tone={comparison.candidate ? 'accent' : 'neutral'}
                />
              </div>
              <div className="ai-engine-card__stats">
                <div>
                  <span>Accuracy</span>
                  <strong>{formatPct(comparison.candidate?.accuracyPct ?? null)}</strong>
                </div>
                <div>
                  <span>Recall</span>
                  <strong>{formatPct(comparison.candidate?.riskyOutcomeRecallPct ?? null)}</strong>
                </div>
                <div>
                  <span>Precision</span>
                  <strong>{formatPct(comparison.candidate?.warningPrecisionPct ?? null)}</strong>
                </div>
                <div>
                  <span>Brier</span>
                  <strong>{comparison.candidate?.brierScore === null || !comparison.candidate ? 'n/a' : comparison.candidate.brierScore}</strong>
                </div>
              </div>
            </article>

            <article className="ai-mini-card ai-mini-card--winner">
              <strong>{comparison.summary}</strong>
              <div className="ai-mini-card__stats">
                <span>Winner: {labelize(comparison.winner)}</span>
                <span>
                  Delta accuracy: {comparison.deltas.accuracyPct === null ? 'n/a' : `${comparison.deltas.accuracyPct > 0 ? '+' : ''}${comparison.deltas.accuracyPct}%`}
                </span>
                <span>
                  Delta recall: {comparison.deltas.riskyOutcomeRecallPct === null ? 'n/a' : `${comparison.deltas.riskyOutcomeRecallPct > 0 ? '+' : ''}${comparison.deltas.riskyOutcomeRecallPct}%`}
                </span>
                <span>
                  Brier improvement: {comparison.deltas.brierImprovement === null ? 'n/a' : `${comparison.deltas.brierImprovement > 0 ? '+' : ''}${comparison.deltas.brierImprovement}`}
                </span>
              </div>
            </article>
          </div>
        </section>
      ) : null}

      <div className="ai-eval-layout">
        <section className="ai-eval-section">
          <div className="ai-eval-section__head">
            <h3>Service scorecards</h3>
            <span>{services.length === 0 ? 'No service data yet' : `${services.length} service views`}</span>
          </div>
          <div className="ai-service-grid">
            {services.length === 0 ? (
              <p className="muted">Once more rollouts complete, service-level model scorecards will show up here.</p>
            ) : (
              services.slice(0, 6).map((service) => (
                <article key={service.serviceId} className="ai-service-card">
                  <div className="ai-service-card__head">
                    <strong>{service.serviceName}</strong>
                    <StatusPill
                      label={service.accuracyPct === null ? 'awaiting outcomes' : `${service.accuracyPct}% accuracy`}
                      tone={service.accuracyPct !== null && service.accuracyPct >= 70 ? 'good' : 'warn'}
                    />
                  </div>
                  <div className="ai-service-card__stats">
                    <div>
                      <span>Deployments</span>
                      <strong>{service.deploymentCount}</strong>
                    </div>
                    <div>
                      <span>Recall</span>
                      <strong>{formatPct(service.riskyOutcomeRecallPct)}</strong>
                    </div>
                    <div>
                      <span>Precision</span>
                      <strong>{formatPct(service.warningPrecisionPct)}</strong>
                    </div>
                    <div>
                      <span>Lead</span>
                      <strong>{formatLead(service.avgWarningLeadSec)}</strong>
                    </div>
                  </div>
                  <div className="ai-service-card__meta">
                    <span>
                      {service.falseNegatives} false negatives / {service.falsePositives} false positives
                    </span>
                    <span>
                      {service.latestAdvisoryAt
                        ? `Last advisory ${new Date(service.latestAdvisoryAt).toLocaleString()}`
                        : 'No advisory timestamp yet'}
                    </span>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="ai-eval-section">
          <div className="ai-eval-section__head">
            <h3>Recent examples</h3>
            <span>
              {overview.falseNegatives} misses / {overview.earlyWarnings} early warnings / {overview.falsePositives} noisy alerts
            </span>
          </div>
          <div className="timeline">
            {examples.length === 0 ? (
              <p className="muted">Sentra needs a few more advisory snapshots before the AI evaluation timeline fills in.</p>
            ) : (
              examples.map((example) => (
                <Link key={example.deploymentId} href={`/rollouts/${example.deploymentId}`} className="timeline__item timeline__item--link">
                  <StatusPill label={labelize(example.reviewStatus)} tone={toneForReviewStatus(example.reviewStatus)} />
                  <div>
                    <strong>
                      {example.serviceName} / {example.environmentName}
                    </strong>
                    <span>{example.summary}</span>
                    <span>
                      Predicted {labelize(example.predictedOutcome)} / actual {labelize(example.actualOutcome)} / risk{' '}
                      {example.riskScore} / confidence {example.confidencePct}% / lead {formatLead(example.warningLeadSec)}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="ai-eval-layout ai-eval-layout--secondary">
        <section className="ai-eval-section">
          <div className="ai-eval-section__head">
            <h3>Backtest timeline</h3>
            <span>{timeline.length === 0 ? 'No time buckets yet' : `${timeline.length} recent buckets`}</span>
          </div>
          <div className="ai-timeline-grid">
            {timeline.length === 0 ? (
              <p className="muted">Recent AI backtesting buckets will appear here once the advisory history grows.</p>
            ) : (
              timeline.map((bucket) => (
                <article key={bucket.bucketStartAt} className="ai-mini-card">
                  <strong>{bucket.bucketLabel}</strong>
                  <div className="ai-mini-card__stats">
                    <span>{bucket.deploymentCount} rollouts</span>
                    <span>{bucket.resolvedReviews} resolved</span>
                    <span>{bucket.accuracyPct === null ? 'n/a accuracy' : `${bucket.accuracyPct}% accuracy`}</span>
                    <span>{bucket.avgRiskScore === null ? 'n/a risk' : `${bucket.avgRiskScore} avg risk`}</span>
                  </div>
                  <div className="ai-mini-card__meta">
                    <span>{bucket.falseNegatives} misses</span>
                    <span>{bucket.falsePositives} noisy</span>
                    <span>{bucket.earlyWarnings} early</span>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="ai-eval-section">
          <div className="ai-eval-section__head">
            <h3>Calibration</h3>
            <span>Compare predicted rollback probability with actual risky outcomes</span>
          </div>
          <div className="ai-calibration-grid">
            {calibration.map((bucket) => (
              <article key={bucket.rangeLabel} className="ai-mini-card">
                <strong>{bucket.rangeLabel}</strong>
                <div className="ai-mini-card__stats">
                  <span>{bucket.sampleCount} samples</span>
                  <span>
                    {bucket.avgPredictedRollbackPct === null
                      ? 'n/a predicted'
                      : `${bucket.avgPredictedRollbackPct}% predicted`}
                  </span>
                  <span>
                    {bucket.actualRiskRatePct === null ? 'n/a actual' : `${bucket.actualRiskRatePct}% actual risk`}
                  </span>
                  <span>{bucket.avgConfidencePct === null ? 'n/a confidence' : `${bucket.avgConfidencePct}% confidence`}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="ai-eval-section ai-eval-section--engines">
        <div className="ai-eval-section__head">
          <h3>Engine breakdown</h3>
          <span>{engines.length === 0 ? 'No engine history yet' : `${engines.length} active engine views`}</span>
        </div>
        <div className="ai-engine-grid">
          {engines.length === 0 ? (
            <p className="muted">Once multiple advisor versions run, Sentra will compare them here.</p>
          ) : (
            engines.map((engine) => (
              <article key={engine.engine} className="ai-engine-card">
                <div className="ai-engine-card__head">
                  <strong>{engine.engine}</strong>
                  <StatusPill
                    label={engine.accuracyPct === null ? 'awaiting outcomes' : `${engine.accuracyPct}% accuracy`}
                    tone={engine.accuracyPct !== null && engine.accuracyPct >= 70 ? 'good' : 'warn'}
                  />
                </div>
                <div className="ai-engine-card__stats">
                  <div>
                    <span>Deployments</span>
                    <strong>{engine.deploymentCount}</strong>
                  </div>
                  <div>
                    <span>Brier</span>
                    <strong>{engine.brierScore === null ? 'n/a' : engine.brierScore}</strong>
                  </div>
                  <div>
                    <span>Recall</span>
                    <strong>{formatPct(engine.riskyOutcomeRecallPct)}</strong>
                  </div>
                  <div>
                    <span>Precision</span>
                    <strong>{formatPct(engine.warningPrecisionPct)}</strong>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </section>
  )
}
