import { Router } from 'express'
import type { RowDataPacket } from 'mysql2/promise'
import { buildCandidateAiAdvisor } from '../advisor-candidate.js'
import {
  advisoryEntryToAdvisor,
  buildAiBenchmarkReport,
  buildAiShadowEvaluationSummary,
  buildAiShadowSeriesComparison,
  buildAiShadowReview,
  type AiShadowEvaluationSummary,
  listAiAdvisoryHistory,
  persistAiAdvisories,
} from '../ai-shadow.js'
import { fromDbJson, queryRows, type SqlParam, toIsoString } from '../db.js'
import { asyncHandler, ok, parseOptionalPositiveIntQuery } from '../http.js'
import { getRequestTenantKey } from '../security.js'

const r = Router()

type DeploymentAiRow = RowDataPacket & {
  id: number
  serviceId: number
  serviceName: string
  environmentName: string
  status: string
  lastDecision: string | null
  completedAt: Date | null
  createdAt: Date
}

type IncidentAiRow = RowDataPacket & {
  id: number
  deploymentId: number
  severity: string
  status: string
  summary: string
  details: string | null
  detectedAt: Date
}

type AuditAiRow = RowDataPacket & {
  id: number
  deploymentId: number | null
  eventType: string
  summary: string
  details: string | null
  occurredAt: Date
}

type AdvisoryDatasetRow = RowDataPacket & {
  id: number
  deploymentId: number
  serviceId: number
  serviceName: string
  environmentId: number
  environmentName: string
  deploymentStatus: string
  lastDecision: string | null
  completedAt: Date | null
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
}

type EvaluationQuery = {
  serviceId: number | null
  limit: number
  tenantKey: string | null
}

function advisorySeriesQuery(value: unknown): 'primary' | 'candidate' {
  if (typeof value !== 'string') {
    return 'primary'
  }

  const normalized = value.trim().toLowerCase()
  return normalized === 'candidate' ? 'candidate' : 'primary'
}

async function loadAiEvaluationSummary(query: EvaluationQuery): Promise<AiShadowEvaluationSummary> {
  const { serviceId, limit, tenantKey } = query

  const where: string[] = []
  const params: SqlParam[] = []

  if (serviceId) {
    where.push('d.service_id = ?')
    params.push(serviceId)
  }
  if (tenantKey) {
    where.push('p.tenant_key = ?')
    params.push(tenantKey)
  }

  params.push(limit)

  const deployments = await queryRows<DeploymentAiRow[]>(
    `SELECT
       d.id,
       d.service_id AS serviceId,
       s.name AS serviceName,
       e.name AS environmentName,
       d.status,
       d.last_decision AS lastDecision,
       d.completed_at AS completedAt,
       d.created_at AS createdAt
     FROM deployments d
     INNER JOIN services s ON s.id = d.service_id
     INNER JOIN environments e ON e.id = d.environment_id
     INNER JOIN projects p ON p.id = s.project_id
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY d.created_at DESC
     LIMIT ?`,
    params,
  )

  if (deployments.length === 0) {
    return buildAiShadowEvaluationSummary([], 0)
  }

  const deploymentIds = deployments.map((deployment) => deployment.id)
  const placeholders = deploymentIds.map(() => '?').join(', ')

  const [incidentRows, auditRows, primaryAdvisoryHistoryByDeployment, candidateAdvisoryHistoryByDeployment] =
    await Promise.all([
      queryRows<IncidentAiRow[]>(
        `SELECT
           id,
           deployment_id AS deploymentId,
           severity,
           status,
           summary,
           details,
           detected_at AS detectedAt
         FROM incidents
         WHERE deployment_id IN (${placeholders})
         ORDER BY detected_at DESC`,
        deploymentIds,
      ),
      queryRows<AuditAiRow[]>(
        `SELECT
           id,
           deployment_id AS deploymentId,
           event_type AS eventType,
           summary,
           details,
           occurred_at AS occurredAt
         FROM audit_events
         WHERE deployment_id IN (${placeholders})
         ORDER BY occurred_at DESC`,
        deploymentIds,
      ),
      listAiAdvisoryHistory(deploymentIds, 12, { series: 'primary' }),
      listAiAdvisoryHistory(deploymentIds, 12, { series: 'candidate' }),
    ])

  const incidentsByDeployment = new Map<number, IncidentAiRow[]>()
  for (const incident of incidentRows) {
    const current = incidentsByDeployment.get(incident.deploymentId) || []
    current.push(incident)
    incidentsByDeployment.set(incident.deploymentId, current)
  }

  const auditByDeployment = new Map<number, AuditAiRow[]>()
  for (const auditEvent of auditRows) {
    if (auditEvent.deploymentId === null) {
      continue
    }
    const current = auditByDeployment.get(auditEvent.deploymentId) || []
    current.push(auditEvent)
    auditByDeployment.set(auditEvent.deploymentId, current)
  }

  const buildEvaluationItem = (
    deployment: DeploymentAiRow,
    history: ReturnType<typeof primaryAdvisoryHistoryByDeployment.get>,
  ) => {
    const latestAdvisory = history?.[0]
    if (!latestAdvisory) {
      return null
    }

    const advisor = advisoryEntryToAdvisor(latestAdvisory)
    const incidents = (incidentsByDeployment.get(deployment.id) || []).map((incident) => ({
      severity: incident.severity,
      status: incident.status,
      summary: incident.summary,
    }))
    const auditEvents = (auditByDeployment.get(deployment.id) || []).map((auditEvent) => ({
      eventType: auditEvent.eventType,
      summary: auditEvent.summary,
      details: fromDbJson<Record<string, unknown>>(auditEvent.details),
      occurredAt: toIsoString(auditEvent.occurredAt),
    }))
    const review = buildAiShadowReview(
      {
        status: deployment.status,
        lastDecision: deployment.lastDecision,
        completedAt: toIsoString(deployment.completedAt),
        incidents,
        auditEvents,
        liveState: null,
        aiAdvisor: advisor,
      },
      history,
    )

    return {
      deploymentId: deployment.id,
      serviceId: deployment.serviceId,
      serviceName: deployment.serviceName,
      environmentName: deployment.environmentName,
      advisoryAt: latestAdvisory.createdAt,
      advisor,
      review,
    }
  }

  const primaryItems = deployments
    .map((deployment) => buildEvaluationItem(deployment, primaryAdvisoryHistoryByDeployment.get(deployment.id)))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  const missingCandidateItems = primaryItems.filter(
    (item) => (candidateAdvisoryHistoryByDeployment.get(item.deploymentId) || []).length === 0,
  )

  if (missingCandidateItems.length > 0) {
    await persistAiAdvisories(
      missingCandidateItems.map((item) => ({
        deploymentId: item.deploymentId,
        advisor: buildCandidateAiAdvisor(item.advisor),
      })),
      { series: 'candidate' },
    )
    const refreshedCandidates = await listAiAdvisoryHistory(deploymentIds, 12, { series: 'candidate' })
    for (const [deploymentId, history] of refreshedCandidates.entries()) {
      candidateAdvisoryHistoryByDeployment.set(deploymentId, history)
    }
  }

  const candidateItems = deployments
    .map((deployment) => buildEvaluationItem(deployment, candidateAdvisoryHistoryByDeployment.get(deployment.id)))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  const comparison = buildAiShadowSeriesComparison(primaryItems, candidateItems)

  return buildAiShadowEvaluationSummary(primaryItems, deployments.length, comparison)
}

r.get(
  '/evaluation',
  asyncHandler(async (req, res) => {
    const serviceId = parseOptionalPositiveIntQuery(req.query.serviceId, 'serviceId')
    const requestedLimit = parseOptionalPositiveIntQuery(req.query.limit, 'limit') || 50
    const limit = Math.min(requestedLimit, 100)
    const tenantKey = getRequestTenantKey(req)
    ok(res, await loadAiEvaluationSummary({ serviceId, limit, tenantKey }))
  }),
)

r.get(
  '/benchmark',
  asyncHandler(async (req, res) => {
    const serviceId = parseOptionalPositiveIntQuery(req.query.serviceId, 'serviceId')
    const requestedLimit = parseOptionalPositiveIntQuery(req.query.limit, 'limit') || 100
    const limit = Math.min(requestedLimit, 200)
    const tenantKey = getRequestTenantKey(req)

    const evaluation = await loadAiEvaluationSummary({ serviceId, limit, tenantKey })
    ok(res, {
      report: buildAiBenchmarkReport(evaluation.comparison),
      evaluation,
    })
  }),
)

r.get(
  '/dataset',
  asyncHandler(async (req, res) => {
    const serviceId = parseOptionalPositiveIntQuery(req.query.serviceId, 'serviceId')
    const requestedLimit = parseOptionalPositiveIntQuery(req.query.limit, 'limit') || 500
    const limit = Math.min(requestedLimit, 2000)
    const series = advisorySeriesQuery(req.query.series)
    const tenantKey = getRequestTenantKey(req)

    const where: string[] = ['a.series = ?']
    const params: SqlParam[] = [series]

    if (serviceId) {
      where.push('d.service_id = ?')
      params.push(serviceId)
    }
    if (tenantKey) {
      where.push('p.tenant_key = ?')
      params.push(tenantKey)
    }

    params.push(limit)

    const advisoryRows = await queryRows<AdvisoryDatasetRow[]>(
      `SELECT
         a.id,
         a.deployment_id AS deploymentId,
         d.service_id AS serviceId,
         s.name AS serviceName,
         d.environment_id AS environmentId,
         e.name AS environmentName,
         d.status AS deploymentStatus,
         d.last_decision AS lastDecision,
         d.completed_at AS completedAt,
         a.engine,
         a.mode,
         a.series,
         a.recommendation,
         a.severity,
         a.predicted_outcome AS predictedOutcome,
         a.rollback_probability_pct AS rollbackProbabilityPct,
         a.next_step_risk_pct AS nextStepRiskPct,
         a.risk_score AS riskScore,
         a.confidence_pct AS confidencePct,
         a.summary,
         a.payload,
         a.created_at AS createdAt
       FROM ai_advisories a
       INNER JOIN deployments d ON d.id = a.deployment_id
       INNER JOIN services s ON s.id = d.service_id
       INNER JOIN environments e ON e.id = d.environment_id
       INNER JOIN projects p ON p.id = s.project_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`,
      params,
    )

    if (advisoryRows.length === 0) {
      ok(res, {
        summary: {
          generatedAt: new Date().toISOString(),
          series,
          rowCount: 0,
          resolvedRows: 0,
          riskyRows: 0,
          riskyOutcomePct: null,
          engineBreakdown: {},
          outcomeBreakdown: {},
          reviewStatusBreakdown: {},
        },
        schema: [],
        items: [],
        count: 0,
      })
      return
    }

    const deploymentIds = Array.from(new Set(advisoryRows.map((row) => row.deploymentId)))
    const placeholders = deploymentIds.map(() => '?').join(', ')

    const [incidentRows, auditRows] = await Promise.all([
      queryRows<IncidentAiRow[]>(
        `SELECT
           id,
           deployment_id AS deploymentId,
           severity,
           status,
           summary,
           details,
           detected_at AS detectedAt
         FROM incidents
         WHERE deployment_id IN (${placeholders})
         ORDER BY detected_at DESC`,
        deploymentIds,
      ),
      queryRows<AuditAiRow[]>(
        `SELECT
           id,
           deployment_id AS deploymentId,
           event_type AS eventType,
           summary,
           details,
           occurred_at AS occurredAt
         FROM audit_events
         WHERE deployment_id IN (${placeholders})
         ORDER BY occurred_at DESC`,
        deploymentIds,
      ),
    ])

    const incidentsByDeployment = new Map<number, IncidentAiRow[]>()
    for (const incident of incidentRows) {
      const current = incidentsByDeployment.get(incident.deploymentId) || []
      current.push(incident)
      incidentsByDeployment.set(incident.deploymentId, current)
    }

    const auditByDeployment = new Map<number, AuditAiRow[]>()
    for (const auditEvent of auditRows) {
      if (auditEvent.deploymentId === null) {
        continue
      }
      const current = auditByDeployment.get(auditEvent.deploymentId) || []
      current.push(auditEvent)
      auditByDeployment.set(auditEvent.deploymentId, current)
    }

    const items = advisoryRows.map((row) => {
      const entry = {
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
      }
      const advisor = advisoryEntryToAdvisor(entry)
      const review = buildAiShadowReview(
        {
          status: row.deploymentStatus,
          lastDecision: row.lastDecision,
          completedAt: toIsoString(row.completedAt),
          incidents: (incidentsByDeployment.get(row.deploymentId) || []).map((incident) => ({
            severity: incident.severity,
            status: incident.status,
            summary: incident.summary,
            detectedAt: toIsoString(incident.detectedAt),
          })),
          auditEvents: (auditByDeployment.get(row.deploymentId) || []).map((auditEvent) => ({
            eventType: auditEvent.eventType,
            summary: auditEvent.summary,
            details: fromDbJson<Record<string, unknown>>(auditEvent.details),
            occurredAt: toIsoString(auditEvent.occurredAt),
          })),
          liveState: null,
          aiAdvisor: advisor,
        },
        [entry],
      )

      const warningLike = advisor.prediction.shouldEscalate || advisor.recommendation === 'pause' || advisor.recommendation === 'rollback'
      const riskyOutcome =
        review.actualOutcome === 'rolled_back' ||
        review.actualOutcome === 'paused' ||
        review.actualOutcome === 'degraded'

      return {
        advisoryId: row.id,
        deploymentId: row.deploymentId,
        serviceId: row.serviceId,
        serviceName: row.serviceName,
        environmentId: row.environmentId,
        environmentName: row.environmentName,
        series: row.series,
        engine: row.engine,
        mode: row.mode,
        advisoryCreatedAt: toIsoString(row.createdAt),
        deploymentStatus: row.deploymentStatus,
        lastDecision: row.lastDecision,
        recommendation: advisor.recommendation,
        severity: advisor.severity,
        predictedOutcome: advisor.prediction.predictedOutcome,
        riskScore: advisor.riskScore,
        confidencePct: advisor.confidencePct,
        rollbackProbabilityPct: advisor.prediction.rollbackProbabilityPct,
        nextStepRiskPct: advisor.prediction.nextStepRiskPct,
        anomalyKinds: advisor.anomalies.map((anomaly) => anomaly.kind),
        anomalyCount: advisor.anomalies.length,
        signalLabels: advisor.signals.map((signal) => signal.label),
        signalCount: advisor.signals.length,
        actualOutcome: review.actualOutcome,
        reviewStatus: review.status,
        riskyOutcome,
        warningLike,
        warningLeadSec: review.warningLeadSec,
      }
    })

    const engineBreakdown = Object.fromEntries(countBy(items.map((item) => item.engine)))
    const outcomeBreakdown = Object.fromEntries(countBy(items.map((item) => item.actualOutcome)))
    const reviewStatusBreakdown = Object.fromEntries(countBy(items.map((item) => item.reviewStatus)))
    const riskyRows = items.filter((item) => item.riskyOutcome).length
    const resolvedRows = items.filter((item) => item.actualOutcome !== 'running').length

    ok(res, {
      summary: {
        generatedAt: new Date().toISOString(),
        series,
        rowCount: items.length,
        resolvedRows,
        riskyRows,
        riskyOutcomePct: items.length === 0 ? null : Math.round((riskyRows / items.length) * 1000) / 10,
        engineBreakdown,
        outcomeBreakdown,
        reviewStatusBreakdown,
      },
      schema: Object.keys(items[0] || {}),
      items,
      count: items.length,
    })
  }),
)

export default r

function countBy(values: string[]) {
  const counts = new Map<string, number>()
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return Array.from(counts.entries())
}
