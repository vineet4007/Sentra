import { Router } from 'express'
import type { RowDataPacket } from 'mysql2/promise'
import { resolveAiAdvisors } from '../ai.js'
import { buildCandidateAiAdvisor } from '../advisor-candidate.js'
import {
  buildAiAdvisorMetadata,
  buildAiShadowBaseline,
  buildAiShadowReview,
  listAiAdvisoryHistory,
  persistAiAdvisories,
} from '../ai-shadow.js'
import { buildAiAdvisor } from '../advisor.js'
import { fromDbJson, queryRows, toIsoString, type SqlParam } from '../db.js'
import { asyncHandler, ok, parseOptionalPositiveIntQuery } from '../http.js'
import { getRolloutLiveStates, listRolloutLiveStates } from '../events.js'
import {
  deploymentBelongsToTenant,
  getRequestTenantKey,
  listTenantDeploymentIds,
  redactStoredConfig,
} from '../security.js'

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

type SatelliteTaskRow = RowDataPacket & {
  id: number
  satelliteId: number
  satelliteName: string
  deploymentId: number | null
  taskType: string
  status: string
  payload: string
  result: string | null
  errorMessage: string | null
  createdBy: string | null
  leaseOwner: string | null
  leaseExpiresAt: Date | null
  attempts: number
  claimedAt: Date | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

r.get(
  '/live',
  asyncHandler(async (req, res) => {
    const deploymentId = parseOptionalPositiveIntQuery(req.query.deploymentId, 'deploymentId')
    const tenantKey = getRequestTenantKey(req)

    let items
    if (tenantKey) {
      if (deploymentId !== null) {
        items = (await deploymentBelongsToTenant(deploymentId, tenantKey))
          ? Array.from((await getRolloutLiveStates([deploymentId])).values())
          : []
      } else {
        const deploymentIds = await listTenantDeploymentIds(tenantKey)
        items = Array.from((await getRolloutLiveStates(deploymentIds)).values())
      }
    } else {
      items =
        deploymentId !== null
          ? Array.from((await getRolloutLiveStates([deploymentId])).values())
          : await listRolloutLiveStates()
    }

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
    const tenantKey = getRequestTenantKey(req)

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
    if (tenantKey) {
      where.push('p.tenant_key = ?')
      params.push(tenantKey)
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
       INNER JOIN projects p ON p.id = s.project_id
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
    const priorAiAdvisoryHistoryByDeployment = await listAiAdvisoryHistory(deploymentIds)

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

    const satelliteTaskRows = await queryRows<SatelliteTaskRow[]>(
      `SELECT
         t.id,
         t.satellite_id AS satelliteId,
         s.name AS satelliteName,
         t.deployment_id AS deploymentId,
         t.task_type AS taskType,
         t.status,
         t.payload,
         t.result,
         t.error_message AS errorMessage,
         t.created_by AS createdBy,
         t.lease_owner AS leaseOwner,
         t.lease_expires_at AS leaseExpiresAt,
         t.attempts,
         t.claimed_at AS claimedAt,
         t.completed_at AS completedAt,
         t.created_at AS createdAt,
         t.updated_at AS updatedAt
       FROM satellite_tasks t
       INNER JOIN satellites s ON s.id = t.satellite_id
       WHERE t.deployment_id IN (${placeholders})
       ORDER BY t.created_at DESC`,
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

    const satelliteTasksByDeployment = new Map<number, SatelliteTaskRow[]>()
    for (const task of satelliteTaskRows) {
      if (task.deploymentId === null) {
        continue
      }
      const current = satelliteTasksByDeployment.get(task.deploymentId) || []
      current.push(task)
      satelliteTasksByDeployment.set(task.deploymentId, current)
    }

    const rolloutItems = deployments.map((deployment) => {
      const liveState = liveStateByDeployment.get(deployment.id) || null
      const steps = (stepsByDeployment.get(deployment.id) || []).map((step) => ({
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
      }))
      const incidents = (incidentsByDeployment.get(deployment.id) || []).map((incident) => ({
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
      }))
      const auditEvents = (auditByDeployment.get(deployment.id) || []).map((auditEvent) => ({
        id: auditEvent.id,
        deploymentId: auditEvent.deploymentId,
        rolloutStepId: auditEvent.rolloutStepId,
        actorType: auditEvent.actorType,
        actorId: auditEvent.actorId,
        eventType: auditEvent.eventType,
        summary: auditEvent.summary,
        details: fromDbJson<Record<string, unknown>>(auditEvent.details),
        occurredAt: toIsoString(auditEvent.occurredAt),
      }))
      const satelliteTasks = (satelliteTasksByDeployment.get(deployment.id) || []).map((task) => ({
        id: task.id,
        satelliteId: task.satelliteId,
        satelliteName: task.satelliteName,
        deploymentId: task.deploymentId,
        taskType: task.taskType,
        status: task.status,
        payload: fromDbJson<Record<string, unknown>>(task.payload),
        result: fromDbJson<Record<string, unknown>>(task.result),
        errorMessage: task.errorMessage,
        createdBy: task.createdBy,
        leaseOwner: task.leaseOwner,
        leaseExpiresAt: toIsoString(task.leaseExpiresAt),
        attempts: task.attempts,
        claimedAt: toIsoString(task.claimedAt),
        completedAt: toIsoString(task.completedAt),
        createdAt: toIsoString(task.createdAt),
        updatedAt: toIsoString(task.updatedAt),
      }))

      return {
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
        deploymentMetadata: redactStoredConfig(
          fromDbJson<Record<string, unknown>>(deployment.deploymentMetadata),
        ),
        currentWeight: deployment.currentWeight,
        lastDecision: deployment.lastDecision,
        lastDecisionReason: deployment.lastDecisionReason,
        startedAt: toIsoString(deployment.startedAt),
        completedAt: toIsoString(deployment.completedAt),
        createdAt: toIsoString(deployment.createdAt),
        updatedAt: toIsoString(deployment.updatedAt),
        liveState,
        steps,
        incidents,
        auditEvents,
        satelliteTasks,
      }
    })

    const advisorContexts = rolloutItems.map((rollout) => ({
      deploymentId: rollout.id,
      status: rollout.status,
      currentWeight: rollout.currentWeight,
      lastDecision: rollout.lastDecision,
      lastDecisionReason: rollout.lastDecisionReason,
      liveState: rollout.liveState,
      incidents: rollout.incidents,
      steps: rollout.steps,
      auditEvents: rollout.auditEvents,
      satelliteTasks: rollout.satelliteTasks,
      metadata: buildAiAdvisorMetadata(priorAiAdvisoryHistoryByDeployment.get(rollout.id) || []),
    }))
    const advisorContextByDeployment = new Map(advisorContexts.map((context) => [context.deploymentId, context]))
    const aiAdvisorByDeployment = await resolveAiAdvisors(advisorContexts)
    const aiAdvisories = advisorContexts.map((context) => ({
      deploymentId: context.deploymentId,
      advisor: aiAdvisorByDeployment.get(context.deploymentId) ?? buildAiAdvisor(context),
    }))
    await persistAiAdvisories(aiAdvisories)
    await persistAiAdvisories(
      aiAdvisories.map((item) => ({
        deploymentId: item.deploymentId,
        advisor: buildCandidateAiAdvisor(item.advisor),
      })),
      { series: 'candidate' },
    )
    const aiAdvisoryHistoryByDeployment = await listAiAdvisoryHistory(deploymentIds)

    ok(res, {
      items: rolloutItems.map((rollout) => {
        const fallbackContext = advisorContextByDeployment.get(rollout.id)
        const fallbackInput = fallbackContext
          ? {
              status: fallbackContext.status,
              currentWeight: fallbackContext.currentWeight,
              lastDecision: fallbackContext.lastDecision,
              lastDecisionReason: fallbackContext.lastDecisionReason,
              liveState: fallbackContext.liveState,
              incidents: fallbackContext.incidents,
              steps: fallbackContext.steps,
              auditEvents: fallbackContext.auditEvents,
              satelliteTasks: fallbackContext.satelliteTasks,
              metadata: fallbackContext.metadata,
            }
          : {
              status: rollout.status,
              currentWeight: rollout.currentWeight,
              lastDecision: rollout.lastDecision,
              lastDecisionReason: rollout.lastDecisionReason,
              liveState: rollout.liveState,
              incidents: rollout.incidents,
              steps: rollout.steps,
              auditEvents: rollout.auditEvents,
              satelliteTasks: rollout.satelliteTasks,
              metadata: buildAiAdvisorMetadata(priorAiAdvisoryHistoryByDeployment.get(rollout.id) || []),
            }
        const aiAdvisor =
          aiAdvisorByDeployment.get(rollout.id) ?? buildAiAdvisor(fallbackInput)
        const aiHistory = aiAdvisoryHistoryByDeployment.get(rollout.id) || []

        return {
          ...rollout,
          aiAdvisor,
          aiShadow: {
            history: aiHistory,
            baseline: buildAiShadowBaseline(aiHistory, aiAdvisor),
            review: buildAiShadowReview(
              {
                ...rollout,
                aiAdvisor,
              },
              aiHistory,
            ),
          },
        }
      }),
      count: deployments.length,
    })
  }),
)

export default r
