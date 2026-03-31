export type Project = {
  id: number
  name: string
  repoUrl: string | null
  description: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type Environment = {
  id: number
  projectId: number
  name: string
  deploymentTargetType: string
  deploymentTargetConfig: Record<string, unknown> | null
  telemetrySourceConfig: Record<string, unknown> | null
  telemetryLabelMap: Record<string, unknown> | null
  secretRefs: Record<string, unknown> | null
  createdAt: string | null
  updatedAt: string | null
}

export type Service = {
  id: number
  projectId: number
  name: string
  adapterType: string
  serviceConfig: Record<string, unknown> | null
  createdAt: string | null
  updatedAt: string | null
}

export type ProjectDetails = {
  project: Project
  services: Service[]
  environments: Environment[]
}

export type Satellite = {
  id: number
  tenantKey: string
  name: string
  mode: string
  cloud: string | null
  region: string | null
  clusterName: string | null
  endpointUrl: string | null
  version: string | null
  status: string
  healthStatus: string
  heartbeatIntervalSec: number
  heartbeatAgeSec: number | null
  staleAfterSec: number
  stale: boolean
  capabilities: Record<string, unknown> | null
  labels: Record<string, unknown> | null
  summary: Record<string, unknown> | null
  lastSeenAt: string | null
  registeredAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type SatelliteTask = {
  id: number
  tenantKey: string
  satelliteId: number
  satelliteName: string
  deploymentId: number | null
  taskType: string
  status: string
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  errorMessage: string | null
  createdBy: string | null
  leaseOwner: string | null
  leaseExpiresAt: string | null
  attempts: number
  claimedAt: string | null
  completedAt: string | null
  createdAt: string | null
  updatedAt: string | null
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

export type AiAdvisoryHistoryEntry = {
  id: number
  deploymentId: number
  engine: string
  mode: string
  recommendation: string
  severity: string
  predictedOutcome: AiAdvisorPrediction['predictedOutcome']
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
  predictedOutcome: AiAdvisorPrediction['predictedOutcome']
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

export type AiShadow = {
  history: AiAdvisoryHistoryEntry[]
  baseline: AiShadowBaseline
  review: AiShadowReview
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
  predictedOutcome: AiAdvisorPrediction['predictedOutcome']
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

export type AiBenchmarkEnvelope = {
  report: AiBenchmarkReport
  evaluation: AiShadowEvaluationSummary
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

export type RolloutStep = {
  id: number
  deploymentId: number
  stepIndex: number
  targetWeight: number
  status: string
  decision: string | null
  decisionReason: string | null
  metricsSnapshot: Record<string, unknown> | null
  startedAt: string | null
  evaluatedAt: string | null
  completedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type Incident = {
  id: number
  deploymentId: number
  rolloutStepId: number | null
  incidentType: string
  severity: string
  status: string
  summary: string
  details: Record<string, unknown> | null
  detectedAt: string | null
  resolvedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type AuditEvent = {
  id: number
  deploymentId: number | null
  rolloutStepId: number | null
  actorType: string
  actorId: string | null
  eventType: string
  summary: string
  details: Record<string, unknown> | null
  occurredAt: string | null
}

export type GateResult = {
  name: string
  source?: string
  query?: string
  unit?: string
  signalStatus: string
  passed: boolean
  severe?: boolean
  value?: number
  threshold?: Record<string, number | undefined>
  reason: string
}

export type EvaluationState = {
  currentStepIndex: number
  currentWeight: number
  consecutivePasses: number
  consecutiveFailures: number
  stepStartedAt: string
  lastEvaluationAt?: string
  lastDecision?: string
  lastDecisionReason?: string
}

export type TelemetrySnapshot = {
  generatedAt?: string
  window?: {
    start?: string
    end?: string
    rangeSec?: number
    stepSec?: number
  }
  labels?: Record<string, string>
  labelMap?: Record<string, string>
  metrics?: Record<string, Record<string, unknown>>
  logs?: Record<string, Record<string, unknown>>
  traces?: Record<string, Record<string, unknown>>
  validation?: Array<Record<string, unknown>>
}

export type Evaluation = {
  decision: string
  summary: string
  reasons: string[]
  rolloutComplete: boolean
  currentStepIndex: number
  targetStepIndex: number
  currentWeight: number
  targetWeight: number
  requiredPasses: number
  warmupRemainingSec: number
  nextState?: EvaluationState
  gateResults?: GateResult[]
  telemetrySnapshot?: TelemetrySnapshot
}

export type RolloutAction = {
  type: string
  adapter: string
  mode: string
  applied: boolean
  summary: string
  decision: string
  fromWeight: number
  toWeight: number
  appliedAt: string
  details?: Record<string, unknown>
}

export type TrafficState = {
  candidateWeight: number
  stableWeight: number
  state: 'split' | 'stable_only' | 'stable_restored' | 'candidate_full' | string
  recoveredToStable: boolean
  summary: string
}

export type LiveState = {
  schemaVersion: number
  updatedAt: string
  deploymentId?: number
  rolloutStepId?: number
  decision: string
  summary: string
  traffic?: TrafficState
  labels?: Record<string, string>
  labelMap?: Record<string, string>
  evaluation?: Evaluation
  action?: RolloutAction
}

export type Rollout = {
  id: number
  serviceId: number
  serviceName: string
  environmentId: number
  environmentName: string
  policyId: number | null
  imageRef: string | null
  revision: string
  status: string
  initiatedBy: string | null
  source: string
  deploymentMetadata: Record<string, unknown> | null
  currentWeight: number
  traffic: TrafficState
  lastDecision: string | null
  lastDecisionReason: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string | null
  updatedAt: string | null
  liveState: LiveState | null
  steps: RolloutStep[]
  incidents: Incident[]
  auditEvents: AuditEvent[]
  satelliteTasks: SatelliteTask[]
  aiAdvisor: AiAdvisor
  aiShadow: AiShadow
}

export type RolloutEvent = {
  type: string
  timestamp: string
  summary?: string
  decision?: string
  deploymentId?: number
  rolloutStepId?: number
  action?: RolloutAction
  liveState?: LiveState
  [key: string]: unknown
}
