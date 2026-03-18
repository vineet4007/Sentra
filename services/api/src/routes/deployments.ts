import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { fromDbJson, queryRows, toDbJson, toIsoString, withTransaction, type SqlParam } from '../db.js'
import { publishRolloutEvent } from '../events.js'
import {
  ApiError,
  asyncHandler,
  getOptionalJson,
  getOptionalPositiveInt,
  getOptionalString,
  getRequiredPositiveInt,
  getRequiredString,
  ok,
  parseOptionalPositiveIntQuery,
  requireBodyObject,
} from '../http.js'
import {
  assertNoSensitiveKeys,
  assertServiceEnvironmentTenantAccess,
  getRequestTenantKey,
  redactStoredConfig,
} from '../security.js'

const r = Router()

type DeploymentRow = RowDataPacket & {
  id: number
  serviceId: number
  environmentId: number
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

type PolicySeedRow = RowDataPacket & {
  id: number
  rolloutSteps: string | null
}

function mapDeploymentRow(row: DeploymentRow) {
  return {
    id: row.id,
    serviceId: row.serviceId,
    environmentId: row.environmentId,
    policyId: row.policyId,
    imageRef: row.imageRef,
    revision: row.revision,
    status: row.status,
    initiatedBy: row.initiatedBy,
    source: row.source,
    deploymentMetadata: redactStoredConfig(
      fromDbJson<Record<string, unknown>>(row.deploymentMetadata),
    ),
    currentWeight: row.currentWeight,
    lastDecision: row.lastDecision,
    lastDecisionReason: row.lastDecisionReason,
    startedAt: toIsoString(row.startedAt),
    completedAt: toIsoString(row.completedAt),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  }
}

r.get(
  '/',
  asyncHandler(async (req, res) => {
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

    const rows = await queryRows<DeploymentRow[]>(
      `SELECT
         d.id,
         d.service_id AS serviceId,
         d.environment_id AS environmentId,
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
       INNER JOIN projects p ON p.id = s.project_id
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY d.created_at DESC
       LIMIT ?`,
      params,
    )

    ok(res, {
      items: rows.map(mapDeploymentRow),
      count: rows.length,
    })
  }),
)

r.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = requireBodyObject(req.body)
    const serviceId = getRequiredPositiveInt(body, 'serviceId')
    const environmentId = getRequiredPositiveInt(body, 'environmentId')
    const revision = getRequiredString(body, 'revision')
    const imageRef = getOptionalString(body, 'imageRef')
    const initiatedBy = getOptionalString(body, 'initiatedBy')
    const source = getOptionalString(body, 'source') || 'manual'
    const policyIdInput = getOptionalPositiveInt(body, 'policyId')
    const deploymentMetadata = getOptionalJson(body, 'deploymentMetadata')
    const tenantKey = getRequestTenantKey(req)

    assertNoSensitiveKeys(deploymentMetadata, 'deploymentMetadata')

    const created = await withTransaction(async (connection) => {
      await assertServiceEnvironmentTenantAccess(connection, serviceId, environmentId, tenantKey)

      let resolvedPolicyId = policyIdInput
      let rolloutSteps: number[] = []

      if (resolvedPolicyId) {
        const [policyRows] = await connection.query<PolicySeedRow[]>(
          `SELECT pol.id, pol.rollout_steps AS rolloutSteps
           FROM policies pol
           INNER JOIN services s ON s.id = pol.service_id
           INNER JOIN projects p ON p.id = s.project_id
           WHERE pol.id = ?
             AND pol.service_id = ?
             AND pol.environment_id = ?
             ${tenantKey ? 'AND p.tenant_key = ?' : ''}
           LIMIT 1`,
          tenantKey
            ? [resolvedPolicyId, serviceId, environmentId, tenantKey]
            : [resolvedPolicyId, serviceId, environmentId],
        )

        if (policyRows.length === 0) {
          throw new ApiError(
            400,
            'The provided policyId does not exist for this tenant-scoped service and environment',
          )
        }

        rolloutSteps = fromDbJson<number[]>(policyRows[0].rolloutSteps) || []
      } else {
        const [policyRows] = await connection.query<PolicySeedRow[]>(
          `SELECT pol.id, pol.rollout_steps AS rolloutSteps
           FROM policies pol
           INNER JOIN services s ON s.id = pol.service_id
           INNER JOIN projects p ON p.id = s.project_id
           WHERE pol.service_id = ? AND pol.environment_id = ?
             ${tenantKey ? 'AND p.tenant_key = ?' : ''}
           LIMIT 1`,
          tenantKey ? [serviceId, environmentId, tenantKey] : [serviceId, environmentId],
        )

        if (policyRows.length > 0) {
          resolvedPolicyId = policyRows[0].id
          rolloutSteps = fromDbJson<number[]>(policyRows[0].rolloutSteps) || []
        }
      }

      const [insertResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO deployments (
           service_id,
           environment_id,
           policy_id,
           image_ref,
           revision,
           status,
           initiated_by,
           source,
           deployment_metadata
         ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        [
          serviceId,
          environmentId,
          resolvedPolicyId,
          imageRef,
          revision,
          initiatedBy,
          source,
          toDbJson(deploymentMetadata),
        ],
      )

      const deploymentId = insertResult.insertId

      for (const [index, weight] of rolloutSteps.entries()) {
        await connection.execute(
          `INSERT INTO rollout_steps (
             deployment_id,
             step_index,
             target_weight,
             status
           ) VALUES (?, ?, ?, 'pending')`,
          [deploymentId, index, weight],
        )
      }

      const [deploymentRows] = await connection.query<DeploymentRow[]>(
        `SELECT
           id,
           service_id AS serviceId,
           environment_id AS environmentId,
           policy_id AS policyId,
           image_ref AS imageRef,
           revision,
           status,
           initiated_by AS initiatedBy,
           source,
           deployment_metadata AS deploymentMetadata,
           current_weight AS currentWeight,
           last_decision AS lastDecision,
           last_decision_reason AS lastDecisionReason,
           started_at AS startedAt,
           completed_at AS completedAt,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM deployments
         WHERE id = ?`,
        [deploymentId],
      )

      if (deploymentRows.length === 0) {
        throw new ApiError(500, 'Failed to load created deployment')
      }

      return {
        deployment: mapDeploymentRow(deploymentRows[0]),
        seededRolloutSteps: rolloutSteps,
      }
    })

    await publishRolloutEvent({
      type: 'deployment.created',
      deploymentId: created.deployment.id,
      serviceId: created.deployment.serviceId,
      environmentId: created.deployment.environmentId,
      revision: created.deployment.revision,
      status: created.deployment.status,
    })

    ok(res, created, 201)
  }),
)

export default r
