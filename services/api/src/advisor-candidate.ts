import type { AiAdvisor } from './advisor.js'
import {
  findBucketRiskRate,
  findRiskRate,
  getCandidateRiskProfile,
} from './candidate-profile.js'

export function buildCandidateAiAdvisor(primary: AiAdvisor): AiAdvisor {
  const hasBaselineShift = primary.anomalies.some((anomaly) => anomaly.kind === 'baseline_shift')
  const hasTelemetryGap = primary.anomalies.some((anomaly) => anomaly.kind === 'telemetry_gap')
  const hasThresholdMargin = primary.anomalies.some((anomaly) => anomaly.kind === 'threshold_margin')
  const onlyHealthySignals =
    primary.anomalies.length > 0 && primary.anomalies.every((anomaly) => anomaly.kind === 'healthy_progress')

  let riskScore = primary.riskScore
  let confidencePct = clamp(primary.confidencePct - 4, 38, 98)
  let rollbackProbabilityPct = primary.prediction.rollbackProbabilityPct
  let nextStepRiskPct = primary.prediction.nextStepRiskPct
  let recommendation = primary.recommendation

  if (hasBaselineShift) {
    riskScore += 6
    rollbackProbabilityPct += 8
    nextStepRiskPct += 10
    if (recommendation === 'continue') {
      recommendation = 'investigate'
    }
  }

  if (hasThresholdMargin) {
    riskScore += 4
    nextStepRiskPct += 8
    if (recommendation === 'continue') {
      recommendation = 'investigate'
    }
  }

  if (hasTelemetryGap) {
    riskScore += 5
    rollbackProbabilityPct += 4
    nextStepRiskPct += 6
    if (recommendation === 'continue') {
      recommendation = 'collect_more_data'
    }
  }

  if (primary.confidencePct < 75 && primary.prediction.rollbackProbabilityPct < 55) {
    rollbackProbabilityPct += 8
    nextStepRiskPct += 6
  }

  if (primary.prediction.rollbackProbabilityPct >= 75) {
    rollbackProbabilityPct += 4
    nextStepRiskPct += 4
  }

  if (onlyHealthySignals) {
    riskScore -= 4
    rollbackProbabilityPct -= 6
    nextStepRiskPct -= 8
    if (recommendation === 'investigate') {
      recommendation = 'continue'
    }
  }

  const profile = getCandidateRiskProfile()
  const profileCalibration = profile ? buildProfileCalibration(primary, profile, rollbackProbabilityPct) : null

  if (profileCalibration) {
    const blendRatio =
      profileCalibration.evidenceCount >= 4 ? 0.52 : profileCalibration.evidenceCount >= 2 ? 0.38 : 0.26
    rollbackProbabilityPct = blend(rollbackProbabilityPct, profileCalibration.empiricalRiskPct, blendRatio)
    riskScore = blend(riskScore, profileCalibration.empiricalRiskPct, Math.min(0.42, blendRatio))
    nextStepRiskPct = blend(
      nextStepRiskPct,
      Math.round((profileCalibration.empiricalRiskPct + nextStepRiskPct) / 2),
      Math.min(0.24, blendRatio),
    )
    confidencePct = clamp(confidencePct + Math.min(10, profileCalibration.evidenceCount * 2), 0, 100)

    if (profileCalibration.empiricalRiskPct >= 82) {
      recommendation = 'rollback'
    } else if (profileCalibration.empiricalRiskPct >= 65 && recommendation === 'continue') {
      recommendation = 'investigate'
    } else if (profileCalibration.empiricalRiskPct >= 55 && recommendation === 'continue') {
      recommendation = 'collect_more_data'
    }
  }

  riskScore = clamp(riskScore, 0, 100)
  confidencePct = clamp(confidencePct, 0, 100)
  rollbackProbabilityPct = clamp(rollbackProbabilityPct, 0, 100)
  nextStepRiskPct = clamp(nextStepRiskPct, 0, 100)

  const severity = severityForRisk(riskScore)
  const predictedOutcome = predictedOutcomeFor(recommendation, rollbackProbabilityPct, nextStepRiskPct)
  const shouldEscalate =
    recommendation === 'rollback' ||
    recommendation === 'pause' ||
    rollbackProbabilityPct >= 60 ||
    nextStepRiskPct >= 65

  const delta = rollbackProbabilityPct - primary.prediction.rollbackProbabilityPct
  const rationales = [
    ...(profileCalibration
      ? [
          `Candidate profile calibrated rollback risk to ${profileCalibration.empiricalRiskPct}% using ${profileCalibration.evidenceCount} matched signal group${profileCalibration.evidenceCount === 1 ? '' : 's'} from ${profileCalibration.resolvedSamples} resolved advisory sample${profileCalibration.resolvedSamples === 1 ? '' : 's'}.`,
        ]
      : []),
    `Candidate model recalibrates the primary advisor with a ${delta === 0 ? 'stable' : `${delta > 0 ? '+' : ''}${delta}%`} rollback-probability adjustment.`,
    ...primary.rationales,
  ]

  const signals = [
    ...(profileCalibration
      ? [
          {
            label: 'Empirical risk',
            tone:
              profileCalibration.empiricalRiskPct >= 70
                ? ('warn' as const)
                : profileCalibration.empiricalRiskPct <= 35
                  ? ('good' as const)
                  : ('accent' as const),
            value: `${profileCalibration.empiricalRiskPct}%`,
          },
          {
            label: 'Profile evidence',
            tone: 'accent' as const,
            value: `${profileCalibration.evidenceCount} groups`,
          },
        ]
      : []),
    {
      label: 'Model series',
      tone: 'accent' as const,
      value: profileCalibration ? 'candidate v3 profiled' : 'candidate v2',
    },
    {
      label: 'Calibration delta',
      tone: delta > 0 ? ('warn' as const) : delta < 0 ? ('good' as const) : ('accent' as const),
      value: `${delta > 0 ? '+' : ''}${delta}% rollback`,
    },
    ...primary.signals,
  ]

  return {
    ...primary,
    engine: profileCalibration ? 'candidate-shadow-v3-profiled' : 'candidate-shadow-v2',
    recommendation,
    severity,
    confidencePct,
    riskScore,
    headline: headlineFor(severity, recommendation),
    summary: summaryFor(recommendation, severity, rollbackProbabilityPct, nextStepRiskPct, delta),
    rationales,
    signals,
    prediction: {
      predictedOutcome,
      rollbackProbabilityPct,
      nextStepRiskPct,
      shouldEscalate,
    },
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function severityForRisk(riskScore: number): AiAdvisor['severity'] {
  if (riskScore >= 85) return 'critical'
  if (riskScore >= 65) return 'high'
  if (riskScore >= 38) return 'elevated'
  return 'low'
}

function predictedOutcomeFor(
  recommendation: AiAdvisor['recommendation'],
  rollbackProbabilityPct: number,
  nextStepRiskPct: number,
): AiAdvisor['prediction']['predictedOutcome'] {
  if (recommendation === 'collect_more_data') {
    return 'awaiting_data'
  }
  if (recommendation === 'rollback' || rollbackProbabilityPct >= 80) {
    return 'rollback_expected'
  }
  if (recommendation === 'pause' || rollbackProbabilityPct >= 55 || nextStepRiskPct >= 65) {
    return 'rollback_risk'
  }
  if (recommendation === 'investigate' || nextStepRiskPct >= 40) {
    return 'watch'
  }
  return 'stable'
}

function headlineFor(severity: AiAdvisor['severity'], recommendation: AiAdvisor['recommendation']) {
  if (recommendation === 'rollback') {
    return 'Candidate model would lean harder into rollback.'
  }
  if (recommendation === 'pause') {
    return 'Candidate model wants a slower handoff.'
  }
  if (recommendation === 'collect_more_data') {
    return 'Candidate model wants cleaner telemetry before trusting promotion.'
  }
  if (recommendation === 'investigate') {
    return `Candidate model sees ${severity} risk and wants a closer check.`
  }
  return 'Candidate model agrees the rollout looks healthy.'
}

function summaryFor(
  recommendation: AiAdvisor['recommendation'],
  severity: AiAdvisor['severity'],
  rollbackProbabilityPct: number,
  nextStepRiskPct: number,
  delta: number,
) {
  if (recommendation === 'rollback') {
    return `Compared with the primary advisor, the candidate model is more defensive and now sees ${rollbackProbabilityPct}% rollback probability.`
  }
  if (recommendation === 'pause') {
    return `The candidate model keeps the rollout in a caution state with ${nextStepRiskPct}% next-step risk and a ${delta > 0 ? 'higher' : 'similar'} rollback signal.`
  }
  if (recommendation === 'collect_more_data') {
    return 'The candidate model is less willing to trust thin telemetry and would wait for cleaner signal.'
  }
  if (recommendation === 'investigate') {
    return `The candidate model sees ${severity} risk and would ask for human review before trusting the next step.`
  }
  return `The candidate model still sees a healthy rollout, with ${rollbackProbabilityPct}% rollback probability and ${nextStepRiskPct}% next-step risk.`
}

function buildProfileCalibration(
  primary: AiAdvisor,
  profile: NonNullable<ReturnType<typeof getCandidateRiskProfile>>,
  rollbackProbabilityPct: number,
) {
  if (profile.resolvedRowCount < 6) {
    return null
  }

  const evidence = []
  const recommendationRate = findRiskRate(profile.recommendationRisk, primary.recommendation)
  if (recommendationRate) {
    evidence.push({
      label: `recommendation:${recommendationRate.key}`,
      pct: recommendationRate.riskyOutcomePct as number,
      sampleCount: recommendationRate.sampleCount,
      weight: 4,
    })
  }

  const outcomeRate = findRiskRate(profile.predictedOutcomeRisk, primary.prediction.predictedOutcome)
  if (outcomeRate) {
    evidence.push({
      label: `predicted:${outcomeRate.key}`,
      pct: outcomeRate.riskyOutcomePct as number,
      sampleCount: outcomeRate.sampleCount,
      weight: 3,
    })
  }

  const severityRate = findRiskRate(profile.severityRisk, primary.severity)
  if (severityRate) {
    evidence.push({
      label: `severity:${severityRate.key}`,
      pct: severityRate.riskyOutcomePct as number,
      sampleCount: severityRate.sampleCount,
      weight: 2,
    })
  }

  const rollbackBucket = findBucketRiskRate(profile.rollbackProbabilityBuckets, rollbackProbabilityPct)
  if (rollbackBucket) {
    evidence.push({
      label: `rollback_bucket:${rollbackBucket.bucket}`,
      pct: rollbackBucket.riskyOutcomePct as number,
      sampleCount: rollbackBucket.sampleCount,
      weight: 2,
    })
  }

  const confidenceBucket = findBucketRiskRate(profile.confidenceBuckets, primary.confidencePct)
  if (confidenceBucket) {
    evidence.push({
      label: `confidence_bucket:${confidenceBucket.bucket}`,
      pct: confidenceBucket.riskyOutcomePct as number,
      sampleCount: confidenceBucket.sampleCount,
      weight: 1,
    })
  }

  for (const anomaly of primary.anomalies.slice(0, 3)) {
    const anomalyRate = findRiskRate(profile.anomalyKindRisk, anomaly.kind)
    if (!anomalyRate) {
      continue
    }
    evidence.push({
      label: `anomaly:${anomalyRate.key}`,
      pct: anomalyRate.riskyOutcomePct as number,
      sampleCount: anomalyRate.sampleCount,
      weight: 1,
    })
  }

  if (evidence.length === 0) {
    return null
  }

  const weighted = evidence.reduce(
    (acc, item) => {
      const sampleWeight = Math.min(12, item.sampleCount)
      const weight = sampleWeight * item.weight
      acc.numerator += item.pct * weight
      acc.denominator += weight
      return acc
    },
    { numerator: 0, denominator: 0 },
  )

  if (weighted.denominator === 0) {
    return null
  }

  return {
    empiricalRiskPct: clamp(Math.round(weighted.numerator / weighted.denominator), 0, 100),
    evidenceCount: evidence.length,
    resolvedSamples: profile.resolvedRowCount,
  }
}

function blend(base: number, empirical: number, ratio: number) {
  const boundedRatio = Math.max(0, Math.min(1, ratio))
  return clamp(Math.round(base * (1 - boundedRatio) + empirical * boundedRatio), 0, 100)
}
