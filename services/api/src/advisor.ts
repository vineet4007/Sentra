export type GateLike = {
  name?: string
  signalStatus?: string
  passed?: boolean
  severe?: boolean
  value?: number
  unit?: string
  reason?: string
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
}

export function buildAiAdvisor(input: AiAdvisorInput): AiAdvisor {
  let riskScore = 24
  let confidencePct = 52
  let recommendation: AiAdvisor['recommendation'] = 'investigate'
  const signals: AiAdvisorSignal[] = []
  const rationales: string[] = []

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
  } else if (passedGates.length > 0) {
    riskScore -= 14 + Math.min(passedGates.length * 3, 10)
    confidencePct += 14
    if (recommendation === 'investigate') {
      recommendation = input.currentWeight >= 100 ? 'continue' : 'continue'
    }
    rationales.push(`${passedGates.length} telemetry gate${passedGates.length === 1 ? '' : 's'} are currently healthy.`)
    signals.push({
      label: 'Telemetry gates',
      tone: 'good',
      value: `${passedGates.length} passing`,
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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim() !== '')))
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)))
}
