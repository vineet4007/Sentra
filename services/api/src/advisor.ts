export type GateLike = {
  name?: string
  signalStatus?: string
  passed?: boolean
  severe?: boolean
  value?: number
  unit?: string
  reason?: string
  threshold?: Record<string, number | null | undefined>
}

export type IncidentLike = {
  severity?: string
  status?: string
  summary?: string
}

export type SatelliteTaskLike = {
  status?: string
  satelliteName?: string
  errorMessage?: string | null
}

export type LiveStateLike = {
  decision?: string
  evaluation?: {
    gateResults?: GateLike[]
    reasons?: string[]
    rolloutComplete?: boolean
  } | null
}

export type StepLike = {
  status?: string
}

export type AuditLike = {
  eventType?: string
  summary?: string
}

export type AiAdvisorSignal = {
  label: string
  tone: 'neutral' | 'good' | 'warn' | 'critical' | 'accent'
  value: string
}

export type AiAdvisorAnomaly = {
  kind:
    | 'incident_pressure'
    | 'telemetry_failure'
    | 'telemetry_gap'
    | 'threshold_margin'
    | 'federation_failure'
    | 'healthy_progress'
    | 'baseline_shift'
  severity: 'low' | 'medium' | 'high' | 'critical'
  label: string
  summary: string
}

export type AiAdvisorPrediction = {
  predictedOutcome: 'stable' | 'watch' | 'rollback_risk' | 'rollback_expected' | 'awaiting_data'
  rollbackProbabilityPct: number
  nextStepRiskPct: number
  shouldEscalate: boolean
}

export type AiAdvisor = {
  mode: 'shadow'
  engine: string
  recommendation: 'continue' | 'pause' | 'rollback' | 'investigate' | 'collect_more_data'
  severity: 'low' | 'elevated' | 'high' | 'critical'
  confidencePct: number
  riskScore: number
  headline: string
  summary: string
  rationales: string[]
  signals: AiAdvisorSignal[]
  anomalies: AiAdvisorAnomaly[]
  prediction: AiAdvisorPrediction
}

export type AiAdvisorInput = {
  status: string
  currentWeight: number
  lastDecision?: string | null
  lastDecisionReason?: string | null
  liveState?: LiveStateLike | null
  incidents: IncidentLike[]
  steps: StepLike[]
  auditEvents: AuditLike[]
  satelliteTasks: SatelliteTaskLike[]
  metadata?: Record<string, unknown> | null
}

export function buildAiAdvisor(input: AiAdvisorInput): AiAdvisor {
  let riskScore = 24
  let confidencePct = 52
  let recommendation: AiAdvisor['recommendation'] = 'investigate'
  const signals: AiAdvisorSignal[] = []
  const rationales: string[] = []
  const anomalies: AiAdvisorAnomaly[] = []

  const openIncidents = input.incidents.filter((incident) => incident.status !== 'resolved')
  const criticalIncidents = openIncidents.filter((incident) => incident.severity === 'critical')
  const gateResults = input.liveState?.evaluation?.gateResults || []
  const failingGates = gateResults.filter((gate) => gate.passed === false && gate.signalStatus === 'ok')
  const severeGates = gateResults.filter((gate) => gate.severe)
  const noDataGates = gateResults.filter((gate) => gate.signalStatus === 'no_data')
  const errorGates = gateResults.filter((gate) => gate.signalStatus === 'error')
  const passedGates = gateResults.filter((gate) => gate.passed)
  const failedSatelliteTasks = input.satelliteTasks.filter((task) => task.status === 'failed')
  const completedSatelliteTasks = input.satelliteTasks.filter((task) => task.status === 'completed')
  const activeStep = input.steps.find((step) => step.status === 'in_progress')
  const completedSteps = input.steps.filter((step) => step.status === 'completed').length
  const marginAlerts = thresholdMarginAlerts(gateResults)
  const baseline = shadowBaselineFromMetadata(input.metadata)

  if (criticalIncidents.length > 0) {
    riskScore += 40 + Math.min(criticalIncidents.length * 8, 20)
    confidencePct += 18
    recommendation = 'rollback'
    rationales.push(`${criticalIncidents.length} critical incident${criticalIncidents.length === 1 ? '' : 's'} are still open.`)
    signals.push({
      label: 'Incidents',
      tone: 'critical',
      value: `${criticalIncidents.length} critical open`,
    })
    anomalies.push({
      kind: 'incident_pressure',
      severity: 'critical',
      label: 'Critical incidents',
      summary: `${criticalIncidents.length} critical incident${criticalIncidents.length === 1 ? '' : 's'} are still open.`,
    })
  } else if (openIncidents.length > 0) {
    riskScore += 22 + Math.min(openIncidents.length * 5, 14)
    confidencePct += 8
    recommendation = 'pause'
    rationales.push(`${openIncidents.length} incident${openIncidents.length === 1 ? '' : 's'} are still open and need attention.`)
    signals.push({
      label: 'Incidents',
      tone: 'warn',
      value: `${openIncidents.length} open`,
    })
    anomalies.push({
      kind: 'incident_pressure',
      severity: 'high',
      label: 'Open incidents',
      summary: `${openIncidents.length} incident${openIncidents.length === 1 ? '' : 's'} are still active.`,
    })
  } else {
    riskScore -= 8
    confidencePct += 6
    signals.push({
      label: 'Incidents',
      tone: 'good',
      value: 'none open',
    })
  }

  if (failingGates.length > 0 || severeGates.length > 0) {
    riskScore += 22 + failingGates.length * 7 + severeGates.length * 10
    confidencePct += 10
    if (recommendation !== 'rollback') {
      recommendation = severeGates.length > 0 ? 'rollback' : 'pause'
    }
    rationales.push(
      `${failingGates.length + severeGates.length} rollout gate${failingGates.length + severeGates.length === 1 ? '' : 's'} are outside the healthy threshold.`,
    )
    signals.push({
      label: 'Telemetry gates',
      tone: 'critical',
      value: `${failingGates.length + severeGates.length} failing`,
    })
    anomalies.push({
      kind: 'telemetry_failure',
      severity: severeGates.length > 0 ? 'critical' : 'high',
      label: 'Gate regressions',
      summary: `${failingGates.length + severeGates.length} telemetry gate${failingGates.length + severeGates.length === 1 ? '' : 's'} are failing or severe.`,
    })
  } else if (errorGates.length > 0 || noDataGates.length > 0) {
    riskScore += 10 + errorGates.length * 8 + noDataGates.length * 5
    if (recommendation !== 'rollback' && recommendation !== 'pause') {
      recommendation = 'collect_more_data'
    }
    rationales.push(
      errorGates.length > 0
        ? `Telemetry collection has ${errorGates.length} backend error${errorGates.length === 1 ? '' : 's'}, so confidence is lower.`
        : `${noDataGates.length} rollout gate${noDataGates.length === 1 ? '' : 's'} still have no data.`,
    )
    signals.push({
      label: 'Telemetry gates',
      tone: errorGates.length > 0 ? 'critical' : 'warn',
      value: errorGates.length > 0 ? `${errorGates.length} backend issues` : `${noDataGates.length} no-data`,
    })
    anomalies.push({
      kind: 'telemetry_gap',
      severity: errorGates.length > 0 ? 'high' : 'medium',
      label: errorGates.length > 0 ? 'Telemetry backend errors' : 'Telemetry gaps',
      summary:
        errorGates.length > 0
          ? `${errorGates.length} telemetry backend error${errorGates.length === 1 ? '' : 's'} are lowering confidence.`
          : `${noDataGates.length} rollout gate${noDataGates.length === 1 ? '' : 's'} still have no signal.`,
    })
  } else if (passedGates.length > 0) {
    riskScore -= 14 + Math.min(passedGates.length * 3, 10)
    confidencePct += 14
    if (recommendation === 'investigate') {
      recommendation = 'continue'
    }
    rationales.push(`${passedGates.length} telemetry gate${passedGates.length === 1 ? '' : 's'} are currently healthy.`)
    signals.push({
      label: 'Telemetry gates',
      tone: 'good',
      value: `${passedGates.length} passing`,
    })
    anomalies.push({
      kind: 'healthy_progress',
      severity: 'low',
      label: 'Healthy telemetry',
      summary: `${passedGates.length} telemetry gate${passedGates.length === 1 ? '' : 's'} are within the configured threshold.`,
    })
  } else {
    riskScore += 6
    recommendation = 'collect_more_data'
    rationales.push('The rollout does not have enough evaluation history yet for a confident advisory signal.')
    signals.push({
      label: 'Telemetry gates',
      tone: 'accent',
      value: 'awaiting data',
    })
  }

  if (marginAlerts.length > 0) {
    riskScore += Math.min(12, marginAlerts.length * 4)
    confidencePct += 3
    if (recommendation === 'continue') {
      recommendation = 'investigate'
    }
    rationales.push(
      `${marginAlerts.length} gate${marginAlerts.length === 1 ? '' : 's'} are close to the configured threshold, so promotion risk is rising.`,
    )
    signals.push({
      label: 'Threshold margin',
      tone: 'warn',
      value: 'narrow',
    })
    anomalies.push({
      kind: 'threshold_margin',
      severity: 'medium',
      label: 'Narrow threshold margin',
      summary: `${marginAlerts.length} passing gate${marginAlerts.length === 1 ? '' : 's'} are close to the configured limit.`,
    })
  }

  if (failedSatelliteTasks.length > 0) {
    riskScore += 10 + failedSatelliteTasks.length * 4
    confidencePct += 4
    if (recommendation === 'continue') {
      recommendation = 'investigate'
    }
    rationales.push(
      `${failedSatelliteTasks.length} delegated satellite task${failedSatelliteTasks.length === 1 ? '' : 's'} failed recently.`,
    )
    signals.push({
      label: 'Federation',
      tone: 'warn',
      value: `${failedSatelliteTasks.length} failed task${failedSatelliteTasks.length === 1 ? '' : 's'}`,
    })
    anomalies.push({
      kind: 'federation_failure',
      severity: 'medium',
      label: 'Federation task failures',
      summary: `${failedSatelliteTasks.length} delegated task${failedSatelliteTasks.length === 1 ? '' : 's'} failed recently.`,
    })
  } else if (completedSatelliteTasks.length > 0) {
    riskScore -= 4
    confidencePct += 4
    signals.push({
      label: 'Federation',
      tone: 'good',
      value: `${completedSatelliteTasks.length} delegated task${completedSatelliteTasks.length === 1 ? '' : 's'} completed`,
    })
  }

  const decision = String(input.liveState?.decision || input.lastDecision || input.status || '').toLowerCase()
  if (decision === 'rollback') {
    riskScore = Math.max(riskScore, 82)
    confidencePct = Math.max(confidencePct, 78)
    recommendation = 'rollback'
    rationales.push('The current control-plane decision is already rollback, so the advisor agrees with a defensive posture.')
  } else if (decision === 'pause') {
    riskScore = Math.max(riskScore, 68)
    confidencePct = Math.max(confidencePct, 72)
    if (recommendation !== 'rollback') {
      recommendation = 'pause'
    }
    rationales.push('The rollout is already paused, which usually means a signal needs operator review before promotion continues.')
  } else if (decision === 'promote' || decision === 'initialize') {
    riskScore -= 6
    confidencePct += 6
    rationales.push('The control plane has a healthy enough signal to keep traffic moving forward.')
  }

  if (input.currentWeight >= 50 && openIncidents.length === 0 && failingGates.length === 0 && noDataGates.length === 0) {
    riskScore -= 5
    confidencePct += 4
    rationales.push('The rollout has already crossed the higher-risk traffic bands without incident.')
  }

  if (activeStep) {
    signals.push({
      label: 'Rollout step',
      tone: 'accent',
      value: `${input.currentWeight}% live now`,
    })
  } else if (completedSteps === input.steps.length && input.steps.length > 0) {
    signals.push({
      label: 'Rollout step',
      tone: 'good',
      value: 'sequence finished',
    })
  }

  const recentAudit = input.auditEvents[0]
  if (recentAudit?.summary) {
    rationales.push(`Latest audit signal: ${recentAudit.summary}`)
  } else if (input.lastDecisionReason) {
    rationales.push(`Latest control-plane note: ${input.lastDecisionReason}`)
  }

  if (baseline && baseline.sampleCount >= 3) {
    const riskDrift = riskScore - baseline.avgRiskScore
    const confidenceDrift = confidencePct - baseline.avgConfidencePct
    if (riskDrift >= 18) {
      riskScore += 4
      confidencePct += 3
      if (recommendation === 'continue') {
        recommendation = 'investigate'
      }
      rationales.push(
        `Current risk is ${Math.round(riskDrift)} points above the recent advisory baseline, which suggests a fresh anomaly rather than normal rollout noise.`,
      )
      signals.push({
        label: 'Baseline drift',
        tone: 'warn',
        value: `+${Math.round(riskDrift)} risk`,
      })
      anomalies.push({
        kind: 'baseline_shift',
        severity: riskDrift >= 28 ? 'high' : 'medium',
        label: 'Risk above baseline',
        summary: `Current advisory risk is ${Math.round(riskDrift)} points above the recent baseline.`,
      })
    } else if (riskDrift <= -15) {
      signals.push({
        label: 'Baseline drift',
        tone: 'good',
        value: `${Math.round(riskDrift)} risk`,
      })
      anomalies.push({
        kind: 'baseline_shift',
        severity: 'low',
        label: 'Risk below baseline',
        summary: `Current advisory risk is ${Math.abs(Math.round(riskDrift))} points lower than the recent baseline.`,
      })
    }

    if (confidenceDrift <= -12) {
      confidencePct += 2
      if (recommendation === 'continue') {
        recommendation = 'investigate'
      }
      rationales.push(
        `Advisor confidence is ${Math.abs(Math.round(confidenceDrift))} points below the recent baseline, so this rollout deserves closer human review.`,
      )
      anomalies.push({
        kind: 'baseline_shift',
        severity: 'medium',
        label: 'Confidence below baseline',
        summary: `Advisor confidence is ${Math.abs(Math.round(confidenceDrift))} points below the recent baseline.`,
      })
    }
  }

  riskScore = clamp(riskScore, 4, 97)
  confidencePct = clamp(confidencePct, 28, 96)

  let severity: AiAdvisor['severity'] = 'low'
  if (riskScore >= 80) {
    severity = 'critical'
  } else if (riskScore >= 62) {
    severity = 'high'
  } else if (riskScore >= 36) {
    severity = 'elevated'
  }

  const headline = buildHeadline(recommendation, severity)
  const summary = buildSummary(recommendation, severity, input.currentWeight, completedSatelliteTasks.length)
  const prediction = buildPrediction({
    recommendation,
    riskScore,
    currentWeight: input.currentWeight,
    openIncidentCount: openIncidents.length,
    noDataGateCount: noDataGates.length,
    marginAlertCount: marginAlerts.length,
  })

  return {
    mode: 'shadow',
    engine: 'heuristic-v1',
    recommendation,
    severity,
    confidencePct,
    riskScore,
    headline,
    summary,
    rationales: uniqueStrings(rationales).slice(0, 5),
    signals: signals.slice(0, 5),
    anomalies: uniqueAnomalies(anomalies).slice(0, 4),
    prediction,
  }
}

function buildHeadline(
  recommendation: AiAdvisor['recommendation'],
  severity: AiAdvisor['severity'],
) {
  switch (recommendation) {
    case 'rollback':
      return 'Shadow advisor sees rollback-level risk.'
    case 'pause':
      return 'Shadow advisor would slow the rollout down.'
    case 'collect_more_data':
      return 'Shadow advisor wants more telemetry before trusting the next step.'
    case 'continue':
      return severity === 'low'
        ? 'Shadow advisor agrees with the current rollout direction.'
        : 'Shadow advisor sees manageable risk, but wants close monitoring.'
    default:
      return 'Shadow advisor wants an operator review.'
  }
}

function buildSummary(
  recommendation: AiAdvisor['recommendation'],
  severity: AiAdvisor['severity'],
  currentWeight: number,
  delegatedTaskCount: number,
) {
  const federationNote =
    delegatedTaskCount > 0
      ? ` Delegated satellite execution is active with ${delegatedTaskCount} recent successful task${delegatedTaskCount === 1 ? '' : 's'}.`
      : ''

  switch (recommendation) {
    case 'rollback':
      return `Risk is ${severity} at ${currentWeight}% traffic, so the advisory layer would prefer an immediate defensive rollback.${federationNote}`
    case 'pause':
      return `Risk is ${severity} at ${currentWeight}% traffic, and the advisory layer would hold here until the failing signals are understood.${federationNote}`
    case 'collect_more_data':
      return `Sentra can keep observing, but the advisory layer does not yet see enough clean signal to make a confident promotion recommendation.${federationNote}`
    case 'continue':
      return `The advisory layer sees ${severity === 'low' ? 'low' : 'controlled'} risk at ${currentWeight}% traffic and is comfortable staying in shadow mode while the rollout progresses.${federationNote}`
    default:
      return `The advisory layer sees ${severity} risk and would ask for a human check before trusting the next rollout transition.${federationNote}`
  }
}

function buildPrediction(input: {
  recommendation: AiAdvisor['recommendation']
  riskScore: number
  currentWeight: number
  openIncidentCount: number
  noDataGateCount: number
  marginAlertCount: number
}): AiAdvisorPrediction {
  const rollbackProbabilityPct = clamp(
    input.riskScore +
      (input.recommendation === 'rollback' ? 10 : 0) +
      (input.recommendation === 'pause' ? 6 : 0) +
      (input.noDataGateCount > 0 ? 4 : 0),
    5,
    98,
  )
  const nextStepRiskPct = clamp(
    input.riskScore +
      (input.currentWeight >= 50 ? 8 : 3) +
      input.marginAlertCount * 3 +
      (input.openIncidentCount > 0 ? 6 : 0),
    4,
    97,
  )

  let predictedOutcome: AiAdvisorPrediction['predictedOutcome'] = 'watch'
  switch (input.recommendation) {
    case 'rollback':
      predictedOutcome = 'rollback_expected'
      break
    case 'pause':
      predictedOutcome = 'rollback_risk'
      break
    case 'collect_more_data':
      predictedOutcome = 'awaiting_data'
      break
    case 'continue':
      predictedOutcome = input.riskScore < 36 ? 'stable' : 'watch'
      break
    default:
      predictedOutcome = input.riskScore >= 62 ? 'rollback_risk' : 'watch'
      break
  }

  return {
    predictedOutcome,
    rollbackProbabilityPct,
    nextStepRiskPct,
    shouldEscalate: predictedOutcome === 'rollback_expected' || predictedOutcome === 'rollback_risk',
  }
}

function thresholdMarginAlerts(gates: GateLike[]) {
  return gates.filter((gate) => {
    if (gate.passed !== true || typeof gate.value !== 'number' || !gate.threshold) {
      return false
    }

    const max = typeof gate.threshold.max === 'number' ? gate.threshold.max : null
    const min = typeof gate.threshold.min === 'number' ? gate.threshold.min : null
    if (max !== null && max > 0 && gate.value / max >= 0.85) {
      return true
    }
    if (min !== null && min > 0 && gate.value / min <= 1.15) {
      return true
    }
    return false
  })
}

function shadowBaselineFromMetadata(metadata: Record<string, unknown> | null | undefined) {
  const candidate = metadata?.shadowBaseline
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null
  }

  const record = candidate as Record<string, unknown>
  const sampleCount = asNumber(record.sampleCount)
  const avgRiskScore = asNumber(record.avgRiskScore)
  const avgConfidencePct = asNumber(record.avgConfidencePct)
  if (sampleCount === null || avgRiskScore === null || avgConfidencePct === null) {
    return null
  }

  return {
    sampleCount,
    avgRiskScore,
    avgConfidencePct,
  }
}

function asNumber(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return value
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim() !== '')))
}

function uniqueAnomalies(values: AiAdvisorAnomaly[]) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = `${value.kind}:${value.label}:${value.summary}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)))
}
