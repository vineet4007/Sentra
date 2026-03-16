import { Router } from 'express'
import type { RowDataPacket } from 'mysql2/promise'
import { fromDbJson, queryRows, toIsoString, type SqlParam } from '../db.js'
import { asyncHandler, ok, parseOptionalPositiveIntQuery } from '../http.js'
import { getRolloutLiveStates, listRolloutLiveStates } from '../events.js'

const r = Router()

type DeploymentRolloutRow = RowDataPacket & {
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
  deploymentMetadata: string | null
  currentWeight: number
  lastDecision: string | null
  lastDecisionReason: string | null
  startedAt: Date
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type RolloutStepRow = RowDataPacket & {
  id: number
  deploymentId: number
  stepIndex: number
  targetWeight: number
  status: string
  decision: string | null
  decisionReason: string | null
  metricsSnapshot: string | null
  startedAt: Date | null
  evaluatedAt: Date | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type IncidentRow = RowDataPacket & {
  id: number
  deploymentId: number
  rolloutStepId: number | null
  incidentType: string
  severity: string
  status: string
  summary: string
  details: string | null
  detectedAt: Date
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type AuditEventRow = RowDataPacket & {
  id: number
  deploymentId: number | null
  rolloutStepId: number | null
  actorType: string
  actorId: string | null
  eventType: string
  summary: string
  details: string | null
  occurredAt: Date
}

r.get(
  '/live',
  asyncHandler(async (req, res) => {
    const deploymentId = parseOptionalPositiveIntQuery(req.query.deploymentId, 'deploymentId')

    const items =
      deploymentId !== null
        ? Array.from((await getRolloutLiveStates([deploymentId])).values())
        : await listRolloutLiveStates()

    ok(res, {
      items,
      count: items.length,
    })
  }),
)

r.get(
  '/',
  asyncHandler(async (req, res) => {
    const deploymentId = parseOptionalPositiveIntQuery(req.query.deploymentId, 'deploymentId')
    const serviceId = parseOptionalPositiveIntQuery(req.query.serviceId, 'serviceId')
    const environmentId = parseOptionalPositiveIntQuery(req.query.environmentId, 'environmentId')
    const limit = parseOptionalPositiveIntQuery(req.query.limit, 'limit') || 20
    const status =
      typeof req.query.status === 'string' && req.query.status.trim() !== ''
        ? req.query.status.trim()
        : null

    const where: string[] = []
    const params: SqlParam[] = []

    if (deploymentId) {
      where.push('d.id = ?')
      params.push(deploymentId)
    }
    if (serviceId) {
      where.push('d.service_id = ?')
      params.push(serviceId)
    }
    if (environmentId) {
      where.push('d.environment_id = ?')
      params.push(environmentId)
    }
    if (status) {
      where.push('d.status = ?')
      params.push(status)
    }

    params.push(limit)

    const deployments = await queryRows<DeploymentRolloutRow[]>(
      `SELECT
         d.id,
         d.service_id AS serviceId,
         s.name AS serviceName,
         d.environment_id AS environmentId,
         e.name AS environmentName,
         d.policy_id AS policyId,
         d.image_ref AS imageRef,
         d.revision,
         d.status,
         d.initiated_by AS initiatedBy,
         d.source,
         d.deployment_metadata AS deploymentMetadata,
         d.current_weight AS currentWeight,
         d.last_decision AS lastDecision,
         d.last_decision_reason AS lastDecisionReason,
         d.started_at AS startedAt,
         d.completed_at AS completedAt,
         d.created_at AS createdAt,
         d.updated_at AS updatedAt
       FROM deployments d
       INNER JOIN services s ON s.id = d.service_id
       INNER JOIN environments e ON e.id = d.environment_id
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY d.created_at DESC
       LIMIT ?`,
      params,
    )

    if (deployments.length === 0) {
      ok(res, { items: [], count: 0 })
      return
    }

    const deploymentIds = deployments.map((deployment) => deployment.id)
    const liveStateByDeployment = await getRolloutLiveStates(deploymentIds)
    const placeholders = deploymentIds.map(() => '?').join(', ')

    const stepRows = await queryRows<RolloutStepRow[]>(
      `SELECT
         id,
         deployment_id AS deploymentId,
         step_index AS stepIndex,
         target_weight AS targetWeight,
         status,
         decision,
         decision_reason AS decisionReason,
         metrics_snapshot AS metricsSnapshot,
         started_at AS startedAt,
         evaluated_at AS evaluatedAt,
         completed_at AS completedAt,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM rollout_steps
       WHERE deployment_id IN (${placeholders})
       ORDER BY step_index ASC`,
      deploymentIds,
    )

    const incidentRows = await queryRows<IncidentRow[]>(
      `SELECT
         id,
         deployment_id AS deploymentId,
         rollout_step_id AS rolloutStepId,
         incident_type AS incidentType,
         severity,
         status,
         summary,
         details,
         detected_at AS detectedAt,
         resolved_at AS resolvedAt,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM incidents
       WHERE deployment_id IN (${placeholders})
       ORDER BY detected_at DESC`,
      deploymentIds,
    )

    const auditRows = await queryRows<AuditEventRow[]>(
      `SELECT
         id,
         deployment_id AS deploymentId,
         rollout_step_id AS rolloutStepId,
         actor_type AS actorType,
         actor_id AS actorId,
         event_type AS eventType,
         summary,
         details,
         occurred_at AS occurredAt
       FROM audit_events
       WHERE deployment_id IN (${placeholders})
       ORDER BY occurred_at DESC`,
      deploymentIds,
    )

    const stepsByDeployment = new Map<number, RolloutStepRow[]>()
    for (const step of stepRows) {
      const current = stepsByDeployment.get(step.deploymentId) || []
      current.push(step)
      stepsByDeployment.set(step.deploymentId, current)
    }

    const incidentsByDeployment = new Map<number, IncidentRow[]>()
    for (const incident of incidentRows) {
      const current = incidentsByDeployment.get(incident.deploymentId) || []
      current.push(incident)
      incidentsByDeployment.set(incident.deploymentId, current)
    }

    const auditByDeployment = new Map<number, AuditEventRow[]>()
    for (const auditEvent of auditRows) {
      if (auditEvent.deploymentId === null) {
        continue
      }
      const current = auditByDeployment.get(auditEvent.deploymentId) || []
      current.push(auditEvent)
      auditByDeployment.set(auditEvent.deploymentId, current)
    }

    ok(res, {
      items: deployments.map((deployment) => ({
        id: deployment.id,
        serviceId: deployment.serviceId,
        serviceName: deployment.serviceName,
        environmentId: deployment.environmentId,
        environmentName: deployment.environmentName,
        policyId: deployment.policyId,
        imageRef: deployment.imageRef,
        revision: deployment.revision,
        status: deployment.status,
        initiatedBy: deployment.initiatedBy,
        source: deployment.source,
        deploymentMetadata: fromDbJson<Record<string, unknown>>(deployment.deploymentMetadata),
        currentWeight: deployment.currentWeight,
        lastDecision: deployment.lastDecision,
        lastDecisionReason: deployment.lastDecisionReason,
        startedAt: toIsoString(deployment.startedAt),
        completedAt: toIsoString(deployment.completedAt),
        createdAt: toIsoString(deployment.createdAt),
        updatedAt: toIsoString(deployment.updatedAt),
        liveState: liveStateByDeployment.get(deployment.id) || null,
        steps: (stepsByDeployment.get(deployment.id) || []).map((step) => ({
          id: step.id,
          deploymentId: step.deploymentId,
          stepIndex: step.stepIndex,
          targetWeight: step.targetWeight,
          status: step.status,
          decision: step.decision,
          decisionReason: step.decisionReason,
          metricsSnapshot: fromDbJson<Record<string, unknown>>(step.metricsSnapshot),
          startedAt: toIsoString(step.startedAt),
          evaluatedAt: toIsoString(step.evaluatedAt),
          completedAt: toIsoString(step.completedAt),
          createdAt: toIsoString(step.createdAt),
          updatedAt: toIsoString(step.updatedAt),
        })),
        incidents: (incidentsByDeployment.get(deployment.id) || []).map((incident) => ({
          id: incident.id,
          deploymentId: incident.deploymentId,
          rolloutStepId: incident.rolloutStepId,
          incidentType: incident.incidentType,
          severity: incident.severity,
          status: incident.status,
          summary: incident.summary,
          details: fromDbJson<Record<string, unknown>>(incident.details),
          detectedAt: toIsoString(incident.detectedAt),
          resolvedAt: toIsoString(incident.resolvedAt),
          createdAt: toIsoString(incident.createdAt),
          updatedAt: toIsoString(incident.updatedAt),
        })),
        auditEvents: (auditByDeployment.get(deployment.id) || []).map((auditEvent) => ({
          id: auditEvent.id,
          deploymentId: auditEvent.deploymentId,
          rolloutStepId: auditEvent.rolloutStepId,
          actorType: auditEvent.actorType,
          actorId: auditEvent.actorId,
          eventType: auditEvent.eventType,
          summary: auditEvent.summary,
          details: fromDbJson<Record<string, unknown>>(auditEvent.details),
          occurredAt: toIsoString(auditEvent.occurredAt),
        })),
      })),
      count: deployments.length,
    })
  }),
)

export default r
