import { createHash } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import type { AiAdvisor, AuditLike, IncidentLike, LiveStateLike } from './advisor.js'
import { executeStatement, fromDbJson, queryRows, toDbJson, toIsoString } from './db.js'

type AiAdvisoryHistoryRow = RowDataPacket & {
  id: number
  deploymentId: number
  engine: string
  mode: string
  series: string
  recommendation: string
  severity: string
  predictedOutcome: string
  rollbackProbabilityPct: number
  nextStepRiskPct: number
  riskScore: number
  confidencePct: number
  summary: string
  payload: string
  createdAt: Date
  rowNum: number
}

export type AiAdvisoryHistoryEntry = {
  id: number
  deploymentId: number
  engine: string
  mode: string
  series: string
  recommendation: string
  severity: string
  predictedOutcome: string
  rollbackProbabilityPct: number
  nextStepRiskPct: number
  riskScore: number
  confidencePct: number
  summary: string
  payload: Record<string, unknown> | null
  createdAt: string | null
}

export type AiShadowReview = {
  status: 'pending' | 'matched' | 'early_warning' | 'false_positive' | 'false_negative' | 'informational'
  actualOutcome: 'running' | 'completed' | 'rolled_back' | 'paused' | 'degraded'
  predictedOutcome: AiAdvisor['prediction']['predictedOutcome']
  summary: string
  warningLeadSec: number | null
  lastAdvisoryAt: string | null
}

export type AiShadowBaseline = {
  sampleCount: number
  avgRiskScore: number | null
  avgRollbackProbabilityPct: number | null
  avgConfidencePct: number | null
  avgNextStepRiskPct: number | null
  currentRiskDrift: number | null
  currentRollbackDrift: number | null
}

export type AiShadowEvaluationOverview = {
  candidateDeployments: number
  evaluatedDeployments: number
  coveragePct: number | null
  resolvedReviews: number
  matched: number
  earlyWarnings: number
  falsePositives: number
  falseNegatives: number
  informational: number
  pending: number
  accuracyPct: number | null
  riskyOutcomeRecallPct: number | null
  warningPrecisionPct: number | null
  avgWarningLeadSec: number | null
  avgRiskScore: number | null
  avgConfidencePct: number | null
  brierScore: number | null
}

export type AiShadowServiceSummary = {
  serviceId: number
  serviceName: string
  deploymentCount: number
  resolvedReviews: number
  matched: number
  earlyWarnings: number
  falsePositives: number
  falseNegatives: number
  accuracyPct: number | null
  riskyOutcomeRecallPct: number | null
  warningPrecisionPct: number | null
  avgWarningLeadSec: number | null
  avgRiskScore: number | null
  avgConfidencePct: number | null
  latestAdvisoryAt: string | null
}

export type AiShadowEvaluationExample = {
  deploymentId: number
  serviceId: number
  serviceName: string
  environmentName: string
  reviewStatus: AiShadowReview['status']
  actualOutcome: AiShadowReview['actualOutcome']
  predictedOutcome: AiAdvisor['prediction']['predictedOutcome']
  summary: string
  warningLeadSec: number | null
  riskScore: number
  confidencePct: number
  lastAdvisoryAt: string | null
}

export type AiShadowEvaluationTimelineBucket = {
  bucketStartAt: string
  bucketLabel: string
  deploymentCount: number
  resolvedReviews: number
  matched: number
  earlyWarnings: number
  falsePositives: number
  falseNegatives: number
  accuracyPct: number | null
  avgRiskScore: number | null
}

export type AiShadowCalibrationBucket = {
  rangeLabel: string
  minProbability: number
  maxProbability: number
  sampleCount: number
  actualRiskRatePct: number | null
  avgPredictedRollbackPct: number | null
  avgConfidencePct: number | null
}

export type AiShadowEngineSummary = {
  engine: string
  deploymentCount: number
  resolvedReviews: number
  accuracyPct: number | null
  riskyOutcomeRecallPct: number | null
  warningPrecisionPct: number | null
  brierScore: number | null
  avgRiskScore: number | null
  avgConfidencePct: number | null
}

export type AiShadowEvaluationSummary = {
  overview: AiShadowEvaluationOverview
  services: AiShadowServiceSummary[]
  examples: AiShadowEvaluationExample[]
  timeline: AiShadowEvaluationTimelineBucket[]
  calibration: AiShadowCalibrationBucket[]
  engines: AiShadowEngineSummary[]
  comparison: AiShadowSeriesComparison | null
}

export type AiShadowComparisonSeriesSummary = {
  series: string
  label: string
  engine: string | null
  evaluatedDeployments: number
  resolvedReviews: number
  accuracyPct: number | null
  riskyOutcomeRecallPct: number | null
  warningPrecisionPct: number | null
  brierScore: number | null
  avgRiskScore: number | null
}

export type AiShadowSeriesComparison = {
  overlapDeployments: number
  primary: AiShadowComparisonSeriesSummary
  candidate: AiShadowComparisonSeriesSummary | null
  deltas: {
    accuracyPct: number | null
    riskyOutcomeRecallPct: number | null
    warningPrecisionPct: number | null
    brierImprovement: number | null
  }
  winner: 'primary' | 'candidate' | 'tie' | 'insufficient_data'
  summary: string
}

export type AiBenchmarkGate = {
  key: string
  label: string
  passed: boolean
  severity: 'warn' | 'critical'
  actual: string
  expected: string
  summary: string
}

export type AiBenchmarkReport = {
  generatedAt: string
  recommendation: 'candidate_ready' | 'hold' | 'insufficient_data' | 'regression_risk'
  summary: string
  overlapDeployments: number
  primary: AiShadowComparisonSeriesSummary
  candidate: AiShadowComparisonSeriesSummary | null
  deltas: AiShadowSeriesComparison['deltas']
  gates: AiBenchmarkGate[]
}

export type AiShadowEvaluationRollout = {
  deploymentId: number
  serviceId: number
  serviceName: string
  environmentName: string
  advisoryAt: string | null
  advisor: AiAdvisor
  review: AiShadowReview
}

type RolloutLike = {
  status: string
  lastDecision?: string | null
  completedAt?: string | null
  liveState?: LiveStateLike | null
  incidents: Array<IncidentLike & { detectedAt?: string | null }>
  auditEvents: Array<
    AuditLike & {
      occurredAt?: string | null
      details?: Record<string, unknown> | null
    }
  >
  aiAdvisor: AiAdvisor
}

export async function persistAiAdvisories(
  items: Array<{ deploymentId: number; advisor: AiAdvisor }>,
  options?: { series?: string },
): Promise<void> {
  if (items.length === 0) {
    return
  }

  const series = options?.series?.trim() || 'primary'

  try {
    await Promise.all(
      items.map(async ({ deploymentId, advisor }) => {
        const payload = advisoryPayload(advisor)
        const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
        await executeStatement(
          `INSERT IGNORE INTO ai_advisories (
             deployment_id,
             engine,
             mode,
             series,
             recommendation,
             severity,
             predicted_outcome,
             rollback_probability_pct,
             next_step_risk_pct,
             risk_score,
             confidence_pct,
             summary,
             fingerprint,
             payload
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            deploymentId,
            advisor.engine,
            advisor.mode,
            series,
            advisor.recommendation,
            advisor.severity,
            advisor.prediction.predictedOutcome,
            advisor.prediction.rollbackProbabilityPct,
            advisor.prediction.nextStepRiskPct,
            advisor.riskScore,
            advisor.confidencePct,
            advisor.summary,
            fingerprint,
            toDbJson(payload),
          ],
        )
      }),
    )
  } catch (error) {
    console.warn('[api] Unable to persist AI advisory history, continuing without shadow history:', error)
  }
}

export async function listAiAdvisoryHistory(
  deploymentIds: number[],
  limitPerDeployment = 8,
  options?: { series?: string | string[] },
): Promise<Map<number, AiAdvisoryHistoryEntry[]>> {
  const items = new Map<number, AiAdvisoryHistoryEntry[]>()
  if (deploymentIds.length === 0) {
    return items
  }

  try {
    const placeholders = deploymentIds.map(() => '?').join(', ')
    const seriesValues = normalizeSeriesFilter(options?.series)
    const seriesPlaceholders = seriesValues.map(() => '?').join(', ')
    const rows = await queryRows<AiAdvisoryHistoryRow[]>(
      `SELECT
         ranked.id,
         ranked.deploymentId,
         ranked.engine,
         ranked.mode,
         ranked.series,
         ranked.recommendation,
         ranked.severity,
         ranked.predictedOutcome,
         ranked.rollbackProbabilityPct,
         ranked.nextStepRiskPct,
         ranked.riskScore,
         ranked.confidencePct,
         ranked.summary,
         ranked.payload,
         ranked.createdAt,
         ranked.rowNum
       FROM (
         SELECT
           id,
           deployment_id AS deploymentId,
           engine,
           mode,
           series,
           recommendation,
           severity,
           predicted_outcome AS predictedOutcome,
           rollback_probability_pct AS rollbackProbabilityPct,
           next_step_risk_pct AS nextStepRiskPct,
           risk_score AS riskScore,
           confidence_pct AS confidencePct,
           summary,
           payload,
           created_at AS createdAt,
           ROW_NUMBER() OVER (PARTITION BY deployment_id ORDER BY created_at DESC, id DESC) AS rowNum
         FROM ai_advisories
         WHERE deployment_id IN (${placeholders})
           AND series IN (${seriesPlaceholders})
       ) ranked
       WHERE ranked.rowNum <= ?
       ORDER BY ranked.deploymentId ASC, ranked.createdAt DESC, ranked.id DESC`,
      [...deploymentIds, ...seriesValues, limitPerDeployment],
    )

    for (const row of rows) {
      const current = items.get(row.deploymentId) || []
      current.push({
        id: row.id,
        deploymentId: row.deploymentId,
        engine: row.engine,
        mode: row.mode,
        series: row.series,
        recommendation: row.recommendation,
        severity: row.severity,
        predictedOutcome: row.predictedOutcome,
        rollbackProbabilityPct: row.rollbackProbabilityPct,
        nextStepRiskPct: row.nextStepRiskPct,
        riskScore: row.riskScore,
        confidencePct: row.confidencePct,
        summary: row.summary,
        payload: fromDbJson<Record<string, unknown>>(row.payload),
        createdAt: toIsoString(row.createdAt),
      })
      items.set(row.deploymentId, current)
    }
  } catch (error) {
    console.warn('[api] Unable to query AI advisory history, continuing without shadow history:', error)
  }

  return items
}

export function buildAiShadowReview(
  rollout: RolloutLike,
  history: AiAdvisoryHistoryEntry[],
): AiShadowReview {
  const actual = deriveActualOutcome(rollout)
  const predictedOutcome = rollout.aiAdvisor.prediction.predictedOutcome
  const latestAdvisoryAt = history[0]?.createdAt || null
  const warningHistory = history.filter((entry) => warningLike(entry.predictedOutcome, entry.recommendation))

  let warningLeadSec: number | null = null
  if (actual.outcomeAt) {
    const warningBeforeOutcome = warningHistory
      .slice()
      .reverse()
      .find((entry) => entry.createdAt && Date.parse(entry.createdAt) <= Date.parse(actual.outcomeAt as string))
    if (warningBeforeOutcome?.createdAt) {
      const deltaMs = Date.parse(actual.outcomeAt) - Date.parse(warningBeforeOutcome.createdAt)
      warningLeadSec = deltaMs >= 0 ? Math.round(deltaMs / 1000) : null
    }
  }

  if (actual.outcome === 'rolled_back') {
    if (warningLeadSec !== null && warningLeadSec > 0) {
      return {
        status: 'early_warning',
        actualOutcome: actual.outcome,
        predictedOutcome,
        summary: `The shadow advisor warned before rollback, giving operators about ${warningLeadSec}s of lead time.`,
        warningLeadSec,
        lastAdvisoryAt: latestAdvisoryAt,
      }
    }
    if (rollout.aiAdvisor.prediction.shouldEscalate || warningHistory.length > 0) {
      return {
        status: 'matched',
        actualOutcome: actual.outcome,
        predictedOutcome,
        summary: 'The shadow advisor and the control plane both converged on a defensive rollback posture.',
        warningLeadSec,
        lastAdvisoryAt: latestAdvisoryAt,
      }
    }
    return {
      status: 'false_negative',
      actualOutcome: actual.outcome,
      predictedOutcome,
      summary: 'The rollout rolled back without a prior strong AI warning, so this becomes a missed-risk example for the shadow layer.',
      warningLeadSec,
      lastAdvisoryAt: latestAdvisoryAt,
    }
  }

  if (actual.outcome === 'paused' || actual.outcome === 'degraded') {
    if (warningLeadSec !== null && warningLeadSec > 0) {
      return {
        status: 'early_warning',
        actualOutcome: actual.outcome,
        predictedOutcome,
        summary: `The shadow advisor raised risk before the rollout ${actual.outcome === 'paused' ? 'paused' : 'degraded'}, giving ${warningLeadSec}s of lead time.`,
        warningLeadSec,
        lastAdvisoryAt: latestAdvisoryAt,
      }
    }
    if (rollout.aiAdvisor.prediction.shouldEscalate || warningHistory.length > 0) {
      return {
        status: 'matched',
        actualOutcome: actual.outcome,
        predictedOutcome,
        summary: 'The shadow advisor is aligned with the degraded rollout posture, but the example is still non-terminal.',
        warningLeadSec,
        lastAdvisoryAt: latestAdvisoryAt,
      }
    }
    return {
      status: 'false_negative',
      actualOutcome: actual.outcome,
      predictedOutcome,
      summary: 'The rollout shows degraded behavior without a strong prior AI warning.',
      warningLeadSec,
      lastAdvisoryAt: latestAdvisoryAt,
    }
  }

  if (actual.outcome === 'completed') {
    if (rollout.aiAdvisor.prediction.shouldEscalate || warningHistory.length > 0) {
      return {
        status: 'false_positive',
        actualOutcome: actual.outcome,
        predictedOutcome,
        summary: 'The rollout completed successfully even though the shadow advisor warned about elevated rollback risk.',
        warningLeadSec,
        lastAdvisoryAt: latestAdvisoryAt,
      }
    }
    return {
      status: 'matched',
      actualOutcome: actual.outcome,
      predictedOutcome,
      summary: 'The rollout completed cleanly and the shadow advisor stayed in a healthy posture.',
      warningLeadSec,
      lastAdvisoryAt: latestAdvisoryAt,
    }
  }

  if (rollout.aiAdvisor.prediction.shouldEscalate) {
    return {
      status: 'informational',
      actualOutcome: actual.outcome,
      predictedOutcome,
      summary: 'The shadow advisor is currently warning about rollback risk, but the rollout has not reached a terminal outcome yet.',
      warningLeadSec,
      lastAdvisoryAt: latestAdvisoryAt,
    }
  }

  return {
    status: 'pending',
    actualOutcome: actual.outcome,
    predictedOutcome,
    summary: 'The rollout is still in flight, so the shadow advisor is being observed rather than scored.',
    warningLeadSec,
    lastAdvisoryAt: latestAdvisoryAt,
  }
}

export function advisoryEntryToAdvisor(entry: AiAdvisoryHistoryEntry): AiAdvisor {
  const payload = isRecord(entry.payload) ? entry.payload : null
  const predictionPayload = isRecord(payload?.prediction) ? payload.prediction : null
  const recommendation = advisoryRecommendation(entry.recommendation)
  const severity = advisorySeverity(entry.severity)
  const predictedOutcome = advisoryPredictedOutcome(entry.predictedOutcome)

  return {
    mode: 'shadow',
    engine: typeof payload?.engine === 'string' ? payload.engine : entry.engine,
    recommendation,
    severity,
    confidencePct: entry.confidencePct,
    riskScore: entry.riskScore,
    headline:
      typeof payload?.headline === 'string' && payload.headline.trim() !== ''
        ? payload.headline
        : `Shadow advisor sees ${severity} risk.`,
    summary:
      typeof payload?.summary === 'string' && payload.summary.trim() !== ''
        ? payload.summary
        : entry.summary,
    rationales: stringArray(payload?.rationales),
    signals: advisorSignals(payload?.signals),
    anomalies: advisorAnomalies(payload?.anomalies),
    prediction: {
      predictedOutcome,
      rollbackProbabilityPct:
        numberOr(entry.rollbackProbabilityPct, predictionPayload?.rollbackProbabilityPct),
      nextStepRiskPct:
        numberOr(entry.nextStepRiskPct, predictionPayload?.nextStepRiskPct),
      shouldEscalate:
        typeof predictionPayload?.shouldEscalate === 'boolean'
          ? predictionPayload.shouldEscalate
          : warningLike(predictedOutcome, recommendation),
    },
  }
}

export function buildAiShadowEvaluationSummary(
  items: AiShadowEvaluationRollout[],
  candidateDeployments = items.length,
  comparison: AiShadowSeriesComparison | null = null,
): AiShadowEvaluationSummary {
  const resolved = items.filter((item) => reviewResolved(item.review.status))
  const riskyOutcomes = resolved.filter((item) => riskyActualOutcome(item.review.actualOutcome))
  const warnings = resolved.filter((item) =>
    warningLike(item.advisor.prediction.predictedOutcome, item.advisor.recommendation),
  )

  const overview: AiShadowEvaluationOverview = {
    candidateDeployments,
    evaluatedDeployments: items.length,
    coveragePct: percent(items.length, candidateDeployments),
    resolvedReviews: resolved.length,
    matched: countByReviewStatus(items, 'matched'),
    earlyWarnings: countByReviewStatus(items, 'early_warning'),
    falsePositives: countByReviewStatus(items, 'false_positive'),
    falseNegatives: countByReviewStatus(items, 'false_negative'),
    informational: countByReviewStatus(items, 'informational'),
    pending: countByReviewStatus(items, 'pending'),
    accuracyPct: percent(
      items.filter((item) => item.review.status === 'matched' || item.review.status === 'early_warning').length,
      resolved.length,
    ),
    riskyOutcomeRecallPct: percent(
      riskyOutcomes.filter(
        (item) => item.review.status === 'matched' || item.review.status === 'early_warning',
      ).length,
      riskyOutcomes.length,
    ),
    warningPrecisionPct: percent(
      warnings.filter((item) => riskyActualOutcome(item.review.actualOutcome)).length,
      warnings.length,
    ),
    avgWarningLeadSec: average(
      items.flatMap((item) => (item.review.warningLeadSec === null ? [] : [item.review.warningLeadSec])),
    ),
    avgRiskScore: average(items.map((item) => item.advisor.riskScore)),
    avgConfidencePct: average(items.map((item) => item.advisor.confidencePct)),
    brierScore: averageBrierScore(resolved),
  }

  const serviceGroups = new Map<number, AiShadowEvaluationRollout[]>()
  for (const item of items) {
    const current = serviceGroups.get(item.serviceId) || []
    current.push(item)
    serviceGroups.set(item.serviceId, current)
  }

  const services = Array.from(serviceGroups.entries())
    .map(([serviceId, serviceItems]) => {
      const serviceResolved = serviceItems.filter((item) => reviewResolved(item.review.status))
      const serviceRisky = serviceResolved.filter((item) => riskyActualOutcome(item.review.actualOutcome))
      const serviceWarnings = serviceResolved.filter((item) =>
        warningLike(item.advisor.prediction.predictedOutcome, item.advisor.recommendation),
      )

      return {
        serviceId,
        serviceName: serviceItems[0]?.serviceName || `service-${serviceId}`,
        deploymentCount: serviceItems.length,
        resolvedReviews: serviceResolved.length,
        matched: countByReviewStatus(serviceItems, 'matched'),
        earlyWarnings: countByReviewStatus(serviceItems, 'early_warning'),
        falsePositives: countByReviewStatus(serviceItems, 'false_positive'),
        falseNegatives: countByReviewStatus(serviceItems, 'false_negative'),
        accuracyPct: percent(
          serviceItems.filter(
            (item) => item.review.status === 'matched' || item.review.status === 'early_warning',
          ).length,
          serviceResolved.length,
        ),
        riskyOutcomeRecallPct: percent(
          serviceRisky.filter(
            (item) => item.review.status === 'matched' || item.review.status === 'early_warning',
          ).length,
          serviceRisky.length,
        ),
        warningPrecisionPct: percent(
          serviceWarnings.filter((item) => riskyActualOutcome(item.review.actualOutcome)).length,
          serviceWarnings.length,
        ),
        avgWarningLeadSec: average(
          serviceItems.flatMap((item) =>
            item.review.warningLeadSec === null ? [] : [item.review.warningLeadSec],
          ),
        ),
        avgRiskScore: average(serviceItems.map((item) => item.advisor.riskScore)),
        avgConfidencePct: average(serviceItems.map((item) => item.advisor.confidencePct)),
        latestAdvisoryAt: mostRecentTimestamp(serviceItems.map((item) => item.review.lastAdvisoryAt)),
      }
    })
    .sort((left, right) => {
      if (right.falseNegatives !== left.falseNegatives) {
        return right.falseNegatives - left.falseNegatives
      }
      if (right.deploymentCount !== left.deploymentCount) {
        return right.deploymentCount - left.deploymentCount
      }
      return left.serviceName.localeCompare(right.serviceName)
    })

  const examples = items
    .slice()
    .sort((left, right) => examplePriority(right) - examplePriority(left) || right.advisor.riskScore - left.advisor.riskScore)
    .slice(0, 6)
    .map((item) => ({
      deploymentId: item.deploymentId,
      serviceId: item.serviceId,
      serviceName: item.serviceName,
      environmentName: item.environmentName,
      reviewStatus: item.review.status,
      actualOutcome: item.review.actualOutcome,
      predictedOutcome: item.review.predictedOutcome,
      summary: item.review.summary,
      warningLeadSec: item.review.warningLeadSec,
      riskScore: item.advisor.riskScore,
      confidencePct: item.advisor.confidencePct,
      lastAdvisoryAt: item.review.lastAdvisoryAt,
    }))

  const timelineGroups = new Map<string, AiShadowEvaluationRollout[]>()
  for (const item of items) {
    const bucketStartAt = advisoryHourBucket(item.advisoryAt)
    const current = timelineGroups.get(bucketStartAt) || []
    current.push(item)
    timelineGroups.set(bucketStartAt, current)
  }

  const timeline = Array.from(timelineGroups.entries())
    .map(([bucketStartAt, bucketItems]) => {
      const bucketResolved = bucketItems.filter((item) => reviewResolved(item.review.status))
      return {
        bucketStartAt,
        bucketLabel: bucketLabel(bucketStartAt),
        deploymentCount: bucketItems.length,
        resolvedReviews: bucketResolved.length,
        matched: countByReviewStatus(bucketItems, 'matched'),
        earlyWarnings: countByReviewStatus(bucketItems, 'early_warning'),
        falsePositives: countByReviewStatus(bucketItems, 'false_positive'),
        falseNegatives: countByReviewStatus(bucketItems, 'false_negative'),
        accuracyPct: percent(
          bucketItems.filter(
            (item) => item.review.status === 'matched' || item.review.status === 'early_warning',
          ).length,
          bucketResolved.length,
        ),
        avgRiskScore: average(bucketItems.map((item) => item.advisor.riskScore)),
      }
    })
    .sort((left, right) => bucketSortValue(right.bucketStartAt) - bucketSortValue(left.bucketStartAt))
    .slice(0, 8)

  const calibration = calibrationBuckets(resolved)

  const engineGroups = new Map<string, AiShadowEvaluationRollout[]>()
  for (const item of items) {
    const current = engineGroups.get(item.advisor.engine) || []
    current.push(item)
    engineGroups.set(item.advisor.engine, current)
  }

  const engines = Array.from(engineGroups.entries())
    .map(([engine, engineItems]) => {
      const engineResolved = engineItems.filter((item) => reviewResolved(item.review.status))
      const engineRisky = engineResolved.filter((item) => riskyActualOutcome(item.review.actualOutcome))
      const engineWarnings = engineResolved.filter((item) =>
        warningLike(item.advisor.prediction.predictedOutcome, item.advisor.recommendation),
      )

      return {
        engine,
        deploymentCount: engineItems.length,
        resolvedReviews: engineResolved.length,
        accuracyPct: percent(
          engineItems.filter(
            (item) => item.review.status === 'matched' || item.review.status === 'early_warning',
          ).length,
          engineResolved.length,
        ),
        riskyOutcomeRecallPct: percent(
          engineRisky.filter(
            (item) => item.review.status === 'matched' || item.review.status === 'early_warning',
          ).length,
          engineRisky.length,
        ),
        warningPrecisionPct: percent(
          engineWarnings.filter((item) => riskyActualOutcome(item.review.actualOutcome)).length,
          engineWarnings.length,
        ),
        brierScore: averageBrierScore(engineResolved),
        avgRiskScore: average(engineItems.map((item) => item.advisor.riskScore)),
        avgConfidencePct: average(engineItems.map((item) => item.advisor.confidencePct)),
      }
    })
    .sort((left, right) => {
      if (right.deploymentCount !== left.deploymentCount) {
        return right.deploymentCount - left.deploymentCount
      }
      return left.engine.localeCompare(right.engine)
    })

  return {
    overview,
    services,
    examples,
    timeline,
    calibration,
    engines,
    comparison,
  }
}

export function buildAiShadowSeriesComparison(
  primaryItems: AiShadowEvaluationRollout[],
  candidateItems: AiShadowEvaluationRollout[],
): AiShadowSeriesComparison {
  const primaryByDeployment = new Map(primaryItems.map((item) => [item.deploymentId, item]))
  const candidateByDeployment = new Map(candidateItems.map((item) => [item.deploymentId, item]))
  const overlapIds = Array.from(primaryByDeployment.keys()).filter((deploymentId) =>
    candidateByDeployment.has(deploymentId),
  )

  const primaryOverlap = overlapIds
    .map((deploymentId) => primaryByDeployment.get(deploymentId))
    .filter((item): item is AiShadowEvaluationRollout => Boolean(item))
  const candidateOverlap = overlapIds
    .map((deploymentId) => candidateByDeployment.get(deploymentId))
    .filter((item): item is AiShadowEvaluationRollout => Boolean(item))

  const primarySummary = buildAiShadowEvaluationSummary(primaryOverlap, overlapIds.length, null)
  const candidateSummary = buildAiShadowEvaluationSummary(candidateOverlap, overlapIds.length, null)

  const primary = compactSeriesSummary('primary', primarySummary, primaryOverlap)
  const candidate =
    candidateOverlap.length > 0
      ? compactSeriesSummary('candidate', candidateSummary, candidateOverlap)
      : null

  const deltas = {
    accuracyPct: subtract(candidate?.accuracyPct, primary.accuracyPct),
    riskyOutcomeRecallPct: subtract(candidate?.riskyOutcomeRecallPct, primary.riskyOutcomeRecallPct),
    warningPrecisionPct: subtract(candidate?.warningPrecisionPct, primary.warningPrecisionPct),
    brierImprovement:
      candidate === null || candidate.brierScore === null || primary.brierScore === null
        ? null
        : roundMetric(primary.brierScore - candidate.brierScore),
  }

  const winner = comparisonWinner(primary, candidate, deltas)

  return {
    overlapDeployments: overlapIds.length,
    primary,
    candidate,
    deltas,
    winner,
    summary: comparisonSummary(winner, primary, candidate, deltas),
  }
}

export function buildAiBenchmarkReport(comparison: AiShadowSeriesComparison | null): AiBenchmarkReport {
  const generatedAt = new Date().toISOString()

  const fallbackPrimary: AiShadowComparisonSeriesSummary = {
    series: 'primary',
    label: 'Current shadow stream',
    engine: null,
    evaluatedDeployments: 0,
    resolvedReviews: 0,
    accuracyPct: null,
    riskyOutcomeRecallPct: null,
    warningPrecisionPct: null,
    brierScore: null,
    avgRiskScore: null,
  }

  if (!comparison) {
    return {
      generatedAt,
      recommendation: 'insufficient_data',
      summary: 'No AI comparison data is available yet, so candidate promotion cannot be evaluated.',
      overlapDeployments: 0,
      primary: fallbackPrimary,
      candidate: null,
      deltas: {
        accuracyPct: null,
        riskyOutcomeRecallPct: null,
        warningPrecisionPct: null,
        brierImprovement: null,
      },
      gates: [],
    }
  }

  const primary = comparison.primary
  const candidate = comparison.candidate

  const gates: AiBenchmarkGate[] = [
    {
      key: 'overlap',
      label: 'Enough overlapping rollouts',
      passed: comparison.overlapDeployments >= 10,
      severity: 'warn',
      actual: String(comparison.overlapDeployments),
      expected: '>= 10',
      summary: 'The candidate model should be compared on a meaningful number of shared rollouts before any promotion.',
    },
    {
      key: 'resolved_reviews',
      label: 'Enough resolved rollout outcomes',
      passed: (candidate?.resolvedReviews ?? 0) >= 5,
      severity: 'warn',
      actual: String(candidate?.resolvedReviews ?? 0),
      expected: '>= 5',
      summary: 'A promotion decision needs enough completed or rolled-back examples to avoid overfitting on in-flight rollouts.',
    },
    {
      key: 'accuracy',
      label: 'Candidate accuracy holds up',
      passed: metricAtLeastWithTolerance(candidate?.accuracyPct ?? null, primary.accuracyPct, -2),
      severity: 'warn',
      actual: metricLabel(candidate?.accuracyPct),
      expected: `>= ${relativeFloor(primary.accuracyPct, -2)}`,
      summary: 'The candidate should not materially reduce overall shadow accuracy.',
    },
    {
      key: 'recall',
      label: 'Candidate risky-outcome recall is not worse',
      passed: metricAtLeastWithTolerance(candidate?.riskyOutcomeRecallPct ?? null, primary.riskyOutcomeRecallPct, 0),
      severity: 'critical',
      actual: metricLabel(candidate?.riskyOutcomeRecallPct),
      expected: `>= ${relativeFloor(primary.riskyOutcomeRecallPct, 0)}`,
      summary: 'The candidate must not miss more real rollout risk than the current production shadow stream.',
    },
    {
      key: 'precision',
      label: 'Candidate warning precision stays acceptable',
      passed: metricAtLeastWithTolerance(candidate?.warningPrecisionPct ?? null, primary.warningPrecisionPct, -5),
      severity: 'warn',
      actual: metricLabel(candidate?.warningPrecisionPct),
      expected: `>= ${relativeFloor(primary.warningPrecisionPct, -5)}`,
      summary: 'The candidate should not introduce too many noisy warnings.',
    },
    {
      key: 'brier',
      label: 'Candidate calibration does not regress',
      passed: brierAcceptable(candidate?.brierScore ?? null, primary.brierScore),
      severity: 'critical',
      actual: metricNumberLabel(candidate?.brierScore),
      expected: primary.brierScore === null ? 'n/a' : `<= ${(primary.brierScore + 0.02).toFixed(2)}`,
      summary: 'Rollback-probability calibration should stay at least as trustworthy as the current stream.',
    },
  ]

  let recommendation: AiBenchmarkReport['recommendation'] = 'hold'
  if (!candidate || !gates[0].passed || !gates[1].passed) {
    recommendation = 'insufficient_data'
  } else if (gates.some((gate) => gate.severity === 'critical' && !gate.passed)) {
    recommendation = 'regression_risk'
  } else if (gates.every((gate) => gate.passed)) {
    recommendation = 'candidate_ready'
  }

  return {
    generatedAt,
    recommendation,
    summary: benchmarkSummary(recommendation),
    overlapDeployments: comparison.overlapDeployments,
    primary,
    candidate,
    deltas: comparison.deltas,
    gates,
  }
}

export function buildAiShadowBaseline(
  history: AiAdvisoryHistoryEntry[],
  currentAdvisor?: AiAdvisor | null,
): AiShadowBaseline {
  if (history.length === 0) {
    return {
      sampleCount: 0,
      avgRiskScore: null,
      avgRollbackProbabilityPct: null,
      avgConfidencePct: null,
      avgNextStepRiskPct: null,
      currentRiskDrift: null,
      currentRollbackDrift: null,
    }
  }

  const sampleCount = history.length
  const avgRiskScore = average(history.map((entry) => entry.riskScore))
  const avgRollbackProbabilityPct = average(history.map((entry) => entry.rollbackProbabilityPct))
  const avgConfidencePct = average(history.map((entry) => entry.confidencePct))
  const avgNextStepRiskPct = average(history.map((entry) => entry.nextStepRiskPct))

  return {
    sampleCount,
    avgRiskScore,
    avgRollbackProbabilityPct,
    avgConfidencePct,
    avgNextStepRiskPct,
    currentRiskDrift:
      currentAdvisor && avgRiskScore !== null ? Math.round(currentAdvisor.riskScore - avgRiskScore) : null,
    currentRollbackDrift:
      currentAdvisor && avgRollbackProbabilityPct !== null
        ? Math.round(currentAdvisor.prediction.rollbackProbabilityPct - avgRollbackProbabilityPct)
        : null,
  }
}

export function buildAiAdvisorMetadata(history: AiAdvisoryHistoryEntry[]) {
  const baseline = buildAiShadowBaseline(history, null)
  const recentPredictedOutcomes = history.slice(0, 5).map((entry) => entry.predictedOutcome)
  return {
    shadowBaseline: {
      sampleCount: baseline.sampleCount,
      avgRiskScore: baseline.avgRiskScore,
      avgRollbackProbabilityPct: baseline.avgRollbackProbabilityPct,
      avgConfidencePct: baseline.avgConfidencePct,
      avgNextStepRiskPct: baseline.avgNextStepRiskPct,
    },
    recentPredictedOutcomes,
  }
}

function deriveActualOutcome(rollout: RolloutLike): {
  outcome: AiShadowReview['actualOutcome']
  outcomeAt: string | null
} {
  const rollbackAudit = rollout.auditEvents.find(
    (event) =>
      String(event.eventType || '').toLowerCase().includes('rollback') ||
      String(event.summary || '').toLowerCase().includes('rollback') ||
      String(event.details?.decision || '').toLowerCase() === 'rollback',
  )
  if (rollout.status === 'rolled_back' || String(rollout.lastDecision || '').toLowerCase() === 'rollback' || rollbackAudit) {
    return {
      outcome: 'rolled_back',
      outcomeAt: rollbackAudit?.occurredAt || rollout.completedAt || null,
    }
  }

  const completedAudit = rollout.auditEvents.find((event) => event.eventType === 'rollout.completed')
  if (rollout.status === 'completed' || rollout.liveState?.evaluation?.rolloutComplete === true || completedAudit) {
    return {
      outcome: 'completed',
      outcomeAt: completedAudit?.occurredAt || rollout.completedAt || null,
    }
  }

  const pausedAudit = rollout.auditEvents.find(
    (event) =>
      String(event.eventType || '').toLowerCase().includes('pause') ||
      String(event.details?.decision || '').toLowerCase() === 'pause',
  )
  if (rollout.status === 'paused' || String(rollout.lastDecision || '').toLowerCase() === 'pause' || pausedAudit) {
    return {
      outcome: 'paused',
      outcomeAt: pausedAudit?.occurredAt || null,
    }
  }

  const severeIncident = rollout.incidents.find(
    (incident) =>
      incident.status !== 'resolved' &&
      (incident.severity === 'critical' || incident.severity === 'high'),
  )
  if (severeIncident) {
    return {
      outcome: 'degraded',
      outcomeAt: severeIncident.detectedAt || null,
    }
  }

  return {
    outcome: 'running',
    outcomeAt: null,
  }
}

function warningLike(predictedOutcome: string, recommendation: string) {
  return (
    predictedOutcome === 'rollback_expected' ||
    predictedOutcome === 'rollback_risk' ||
    recommendation === 'rollback' ||
    recommendation === 'pause'
  )
}

function reviewResolved(status: AiShadowReview['status']) {
  return status !== 'pending' && status !== 'informational'
}

function riskyActualOutcome(outcome: AiShadowReview['actualOutcome']) {
  return outcome === 'rolled_back' || outcome === 'paused' || outcome === 'degraded'
}

function advisoryPayload(advisor: AiAdvisor) {
  return {
    mode: advisor.mode,
    engine: advisor.engine,
    recommendation: advisor.recommendation,
    severity: advisor.severity,
    confidencePct: advisor.confidencePct,
    riskScore: advisor.riskScore,
    headline: advisor.headline,
    summary: advisor.summary,
    rationales: advisor.rationales,
    signals: advisor.signals,
    anomalies: advisor.anomalies,
    prediction: advisor.prediction,
  }
}

function average(values: number[]) {
  if (values.length === 0) {
    return null
  }
  const total = values.reduce((sum, value) => sum + value, 0)
  return Math.round((total / values.length) * 100) / 100
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100
}

function averageBrierScore(items: AiShadowEvaluationRollout[]) {
  if (items.length === 0) {
    return null
  }

  const values = items.map((item) => {
    const predicted = item.advisor.prediction.rollbackProbabilityPct / 100
    const actual = riskyActualOutcome(item.review.actualOutcome) ? 1 : 0
    return Math.pow(predicted - actual, 2)
  })

  return average(values)
}

function compactSeriesSummary(
  series: string,
  summary: AiShadowEvaluationSummary,
  items: AiShadowEvaluationRollout[],
): AiShadowComparisonSeriesSummary {
  return {
    series,
    label: seriesLabel(series),
    engine: seriesEngine(items),
    evaluatedDeployments: summary.overview.evaluatedDeployments,
    resolvedReviews: summary.overview.resolvedReviews,
    accuracyPct: summary.overview.accuracyPct,
    riskyOutcomeRecallPct: summary.overview.riskyOutcomeRecallPct,
    warningPrecisionPct: summary.overview.warningPrecisionPct,
    brierScore: summary.overview.brierScore,
    avgRiskScore: summary.overview.avgRiskScore,
  }
}

function countByReviewStatus(items: AiShadowEvaluationRollout[], status: AiShadowReview['status']) {
  return items.filter((item) => item.review.status === status).length
}

function percent(part: number, whole: number) {
  if (whole <= 0) {
    return null
  }
  return Math.round((part / whole) * 1000) / 10
}

function examplePriority(item: AiShadowEvaluationRollout) {
  switch (item.review.status) {
    case 'false_negative':
      return 5
    case 'false_positive':
      return 4
    case 'early_warning':
      return 3
    case 'matched':
      return 2
    case 'informational':
      return 1
    case 'pending':
      return 0
  }
}

function advisoryHourBucket(value: string | null) {
  if (!value) {
    return 'unknown'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return 'unknown'
  }
  parsed.setUTCMinutes(0, 0, 0)
  return parsed.toISOString()
}

function bucketLabel(value: string) {
  if (value === 'unknown') {
    return 'Unknown time'
  }
  const parsed = new Date(value)
  return `${parsed.toISOString().slice(0, 13)}:00 UTC`
}

function bucketSortValue(value: string) {
  if (value === 'unknown') {
    return -1
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? -1 : parsed
}

function calibrationBuckets(items: AiShadowEvaluationRollout[]): AiShadowCalibrationBucket[] {
  const ranges = [
    { min: 0, max: 24 },
    { min: 25, max: 49 },
    { min: 50, max: 74 },
    { min: 75, max: 100 },
  ]

  return ranges.map((range) => {
    const bucketItems = items.filter(
      (item) =>
        item.advisor.prediction.rollbackProbabilityPct >= range.min &&
        item.advisor.prediction.rollbackProbabilityPct <= range.max,
    )

    return {
      rangeLabel: `${range.min}-${range.max}%`,
      minProbability: range.min,
      maxProbability: range.max,
      sampleCount: bucketItems.length,
      actualRiskRatePct: percent(
        bucketItems.filter((item) => riskyActualOutcome(item.review.actualOutcome)).length,
        bucketItems.length,
      ),
      avgPredictedRollbackPct: average(
        bucketItems.map((item) => item.advisor.prediction.rollbackProbabilityPct),
      ),
      avgConfidencePct: average(bucketItems.map((item) => item.advisor.confidencePct)),
    }
  })
}

function comparisonWinner(
  primary: AiShadowComparisonSeriesSummary,
  candidate: AiShadowComparisonSeriesSummary | null,
  deltas: AiShadowSeriesComparison['deltas'],
): AiShadowSeriesComparison['winner'] {
  if (!candidate || primary.resolvedReviews < 2 || candidate.resolvedReviews < 2) {
    return 'insufficient_data'
  }

  let primaryPoints = 0
  let candidatePoints = 0

  primaryPoints += betterHigher(primary.accuracyPct, candidate.accuracyPct)
  candidatePoints += betterHigher(candidate.accuracyPct, primary.accuracyPct)
  primaryPoints += betterHigher(primary.riskyOutcomeRecallPct, candidate.riskyOutcomeRecallPct)
  candidatePoints += betterHigher(candidate.riskyOutcomeRecallPct, primary.riskyOutcomeRecallPct)
  primaryPoints += betterHigher(primary.warningPrecisionPct, candidate.warningPrecisionPct)
  candidatePoints += betterHigher(candidate.warningPrecisionPct, primary.warningPrecisionPct)
  primaryPoints += betterLower(primary.brierScore, candidate.brierScore)
  candidatePoints += betterLower(candidate.brierScore, primary.brierScore)

  if (candidatePoints > primaryPoints && (deltas.brierImprovement ?? 0) >= -0.03) {
    return 'candidate'
  }
  if (primaryPoints > candidatePoints) {
    return 'primary'
  }
  return 'tie'
}

function comparisonSummary(
  winner: AiShadowSeriesComparison['winner'],
  primary: AiShadowComparisonSeriesSummary,
  candidate: AiShadowComparisonSeriesSummary | null,
  deltas: AiShadowSeriesComparison['deltas'],
) {
  if (!candidate) {
    return 'The candidate model has not produced persisted comparisons yet.'
  }
  if (winner === 'insufficient_data') {
    return 'Sentra has started persisting candidate model runs, but there are not enough resolved outcomes yet for a trustworthy winner.'
  }
  if (winner === 'candidate') {
    return `The candidate model is currently ahead with ${candidate.accuracyPct ?? 'n/a'}% accuracy and a ${deltas.brierImprovement ?? 'n/a'} Brier improvement over the primary stream.`
  }
  if (winner === 'primary') {
    return `The primary model is still leading, so the candidate stays advisory-only while more rollout outcomes accumulate.`
  }
  return `The primary and candidate models are effectively tied on the current overlap set.`
}

function subtract(left: number | null | undefined, right: number | null | undefined) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return null
  }
  return roundMetric(left - right)
}

function seriesLabel(series: string) {
  if (series === 'primary') {
    return 'Current shadow stream'
  }
  if (series === 'candidate') {
    return 'Candidate stream'
  }
  return series
}

function seriesEngine(items: AiShadowEvaluationRollout[]) {
  const engines = Array.from(new Set(items.map((item) => item.advisor.engine)))
  if (engines.length === 0) {
    return null
  }
  return engines.length === 1 ? engines[0] : 'mixed'
}

function betterHigher(left: number | null, right: number | null) {
  if (left === null || right === null) {
    return 0
  }
  return left > right + 1 ? 1 : 0
}

function betterLower(left: number | null, right: number | null) {
  if (left === null || right === null) {
    return 0
  }
  return left + 0.02 < right ? 1 : 0
}

function metricAtLeastWithTolerance(candidate: number | null, baseline: number | null, tolerance: number) {
  if (candidate === null || baseline === null) {
    return false
  }
  return candidate >= baseline + tolerance
}

function brierAcceptable(candidate: number | null, baseline: number | null) {
  if (candidate === null || baseline === null) {
    return false
  }
  return candidate <= baseline + 0.02
}

function metricLabel(value: number | null | undefined) {
  return value === null || value === undefined ? 'n/a' : `${value}%`
}

function metricNumberLabel(value: number | null | undefined) {
  return value === null || value === undefined ? 'n/a' : String(value)
}

function relativeFloor(value: number | null, delta: number) {
  if (value === null) {
    return 'n/a'
  }
  return `${roundMetric(value + delta)}%`
}

function benchmarkSummary(recommendation: AiBenchmarkReport['recommendation']) {
  if (recommendation === 'candidate_ready') {
    return `The candidate model has enough shared outcomes and is meeting the benchmark gates, so it is ready for a controlled shadow promotion review.`
  }
  if (recommendation === 'regression_risk') {
    return `The candidate model is currently failing one or more critical benchmark gates, so it should remain offline while the regression is investigated.`
  }
  if (recommendation === 'insufficient_data') {
    return `Sentra needs more shared rollout outcomes before a trustworthy promotion call can be made for the candidate stream.`
  }
  return `The candidate model is close enough to keep benchmarking, but it has not yet cleared every readiness gate against the current production stream.`
}

function mostRecentTimestamp(values: Array<string | null>) {
  const filtered = values.filter((value): value is string => typeof value === 'string' && value !== 'unknown')
  if (filtered.length === 0) {
    return null
  }
  return filtered.sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null
}

function normalizeSeriesFilter(series?: string | string[]) {
  const values = Array.isArray(series) ? series : series ? [series] : ['primary']
  const filtered = values
    .map((value) => value.trim())
    .filter((value): value is string => value.length > 0)

  return filtered.length > 0 ? filtered : ['primary']
}

function advisoryRecommendation(value: string): AiAdvisor['recommendation'] {
  switch (value) {
    case 'continue':
    case 'pause':
    case 'rollback':
    case 'investigate':
    case 'collect_more_data':
      return value
    default:
      return 'investigate'
  }
}

function advisorySeverity(value: string): AiAdvisor['severity'] {
  switch (value) {
    case 'low':
    case 'elevated':
    case 'high':
    case 'critical':
      return value
    default:
      return 'elevated'
  }
}

function advisoryPredictedOutcome(value: string): AiAdvisor['prediction']['predictedOutcome'] {
  switch (value) {
    case 'stable':
    case 'watch':
    case 'rollback_risk':
    case 'rollback_expected':
    case 'awaiting_data':
      return value
    default:
      return 'watch'
  }
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string')
}

function advisorSignals(value: unknown): AiAdvisor['signals'] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter(isRecord)
    .map((item) => ({
      label: typeof item.label === 'string' ? item.label : 'Signal',
      tone: advisoryTone(item.tone),
      value: typeof item.value === 'string' ? item.value : '',
    }))
}

function advisorAnomalies(value: unknown): AiAdvisor['anomalies'] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter(isRecord)
    .map((item) => ({
      kind: advisoryAnomalyKind(item.kind),
      severity: anomalySeverity(item.severity),
      label: typeof item.label === 'string' ? item.label : 'Anomaly',
      summary: typeof item.summary === 'string' ? item.summary : '',
    }))
}

function advisoryTone(value: unknown): AiAdvisor['signals'][number]['tone'] {
  switch (value) {
    case 'good':
    case 'warn':
    case 'critical':
    case 'accent':
    case 'neutral':
      return value
    default:
      return 'neutral'
  }
}

function advisoryAnomalyKind(value: unknown): AiAdvisor['anomalies'][number]['kind'] {
  switch (value) {
    case 'incident_pressure':
    case 'telemetry_failure':
    case 'telemetry_gap':
    case 'threshold_margin':
    case 'federation_failure':
    case 'healthy_progress':
    case 'baseline_shift':
      return value
    default:
      return 'healthy_progress'
  }
}

function anomalySeverity(value: unknown): AiAdvisor['anomalies'][number]['severity'] {
  switch (value) {
    case 'low':
    case 'medium':
    case 'high':
    case 'critical':
      return value
    default:
      return 'medium'
  }
}

function numberOr(primary: number, fallback: unknown) {
  if (typeof primary === 'number' && Number.isFinite(primary)) {
    return primary
  }
  return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
