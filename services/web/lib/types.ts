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

export type LiveState = {
  schemaVersion: number
  updatedAt: string
  deploymentId?: number
  rolloutStepId?: number
  decision: string
  summary: string
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
