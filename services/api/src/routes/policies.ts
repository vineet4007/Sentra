import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { fromDbJson, queryRows, toDbJson, toIsoString, withTransaction, type SqlParam } from '../db.js'
import {
  ApiError,
  asyncHandler,
  getOptionalArray,
  getOptionalBoolean,
  getOptionalPositiveInt,
  getRequiredPositiveInt,
  getRequiredString,
  ok,
  parseOptionalPositiveIntQuery,
  requireBodyObject,
  requireObjectField,
} from '../http.js'
import {
  readStableTrafficFloorPct,
  validateRolloutStepsAgainstStableFloor,
} from '../rollout-safety.js'
import { assertServiceEnvironmentTenantAccess, getRequestTenantKey } from '../security.js'

const r = Router()

type PolicyRow = RowDataPacket & {
  id: number
  serviceId: number
  environmentId: number
  sloConfig: string
  rolloutSteps: string
  evaluationWindowSec: number
  pollIntervalSec: number
  warmupSec: number
  requiredPasses: number
  failureMode: string
  enabled: number
  createdAt: Date
  updatedAt: Date
}

type EnvironmentConfigRow = RowDataPacket & {
  deploymentTargetConfig: string | null
}

function normalizeRolloutSteps(values: unknown[]): number[] {
  if (values.length === 0) {
    throw new ApiError(400, '"rolloutSteps" must contain at least one step')
  }

  return values.map((value, index) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
      throw new ApiError(400, `"rolloutSteps[${index}]" must be an integer between 1 and 100`)
    }
    return value
  })
}

function mapPolicyRow(row: PolicyRow) {
  return {
    id: row.id,
    serviceId: row.serviceId,
    environmentId: row.environmentId,
    sloConfig: fromDbJson<Record<string, unknown>>(row.sloConfig),
    rolloutSteps: fromDbJson<number[]>(row.rolloutSteps),
    evaluationWindowSec: row.evaluationWindowSec,
    pollIntervalSec: row.pollIntervalSec,
    warmupSec: row.warmupSec,
    requiredPasses: row.requiredPasses,
    failureMode: row.failureMode,
    enabled: Boolean(row.enabled),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  }
}

r.get(
  '/',
  asyncHandler(async (req, res) => {
    const serviceId = parseOptionalPositiveIntQuery(req.query.serviceId, 'serviceId')
    const environmentId = parseOptionalPositiveIntQuery(req.query.environmentId, 'environmentId')
    const tenantKey = getRequestTenantKey(req)

    const where: string[] = []
    const params: SqlParam[] = []

    if (serviceId) {
      where.push('pol.service_id = ?')
      params.push(serviceId)
    }
    if (environmentId) {
      where.push('pol.environment_id = ?')
      params.push(environmentId)
    }
    if (tenantKey) {
      where.push('p.tenant_key = ?')
      params.push(tenantKey)
    }

    const rows = await queryRows<PolicyRow[]>(
      `SELECT
         pol.id,
         pol.service_id AS serviceId,
         pol.environment_id AS environmentId,
         pol.slo_config AS sloConfig,
         pol.rollout_steps AS rolloutSteps,
         pol.evaluation_window_sec AS evaluationWindowSec,
         pol.poll_interval_sec AS pollIntervalSec,
         pol.warmup_sec AS warmupSec,
         pol.required_passes AS requiredPasses,
         pol.failure_mode AS failureMode,
         pol.enabled,
         pol.created_at AS createdAt,
         pol.updated_at AS updatedAt
       FROM policies pol
       INNER JOIN services s ON s.id = pol.service_id
       INNER JOIN projects p ON p.id = s.project_id
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY pol.updated_at DESC`,
      params,
    )

    ok(res, {
      items: rows.map(mapPolicyRow),
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
    const sloConfig = requireObjectField(body, 'sloConfig')
    const rolloutStepsInput = getOptionalArray(body, 'rolloutSteps')
    const rolloutSteps = normalizeRolloutSteps(rolloutStepsInput || [])
    const evaluationWindowSec = getOptionalPositiveInt(body, 'evaluationWindowSec') || 60
    const pollIntervalSec = getOptionalPositiveInt(body, 'pollIntervalSec') || 5
    const warmupSec = getOptionalPositiveInt(body, 'warmupSec') || 30
    const requiredPasses = getOptionalPositiveInt(body, 'requiredPasses') || 3
    const failureMode = getRequiredString(
      { failureMode: body.failureMode || 'rollback' },
      'failureMode',
    )
    const enabled = getOptionalBoolean(body, 'enabled')
    const tenantKey = getRequestTenantKey(req)

    const saved = await withTransaction(async (connection) => {
      await assertServiceEnvironmentTenantAccess(connection, serviceId, environmentId, tenantKey)

      const [environmentRows] = await connection.query<EnvironmentConfigRow[]>(
        `SELECT deployment_target_config AS deploymentTargetConfig
         FROM environments
         WHERE id = ?
         LIMIT 1`,
        [environmentId],
      )

      if (environmentRows.length === 0) {
        throw new ApiError(400, 'The selected environment does not exist')
      }

      const stableTrafficFloorPct = readStableTrafficFloorPct(
        fromDbJson<Record<string, unknown>>(environmentRows[0].deploymentTargetConfig),
      )
      validateRolloutStepsAgainstStableFloor(rolloutSteps, stableTrafficFloorPct)

      const [existingRows] = await connection.query<RowDataPacket[]>(
        `SELECT id FROM policies WHERE service_id = ? AND environment_id = ?`,
        [serviceId, environmentId],
      )

      let policyId: number

      if (existingRows.length === 0) {
        const [insertResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO policies (
             service_id,
             environment_id,
             slo_config,
             rollout_steps,
             evaluation_window_sec,
             poll_interval_sec,
             warmup_sec,
             required_passes,
             failure_mode,
             enabled
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            serviceId,
            environmentId,
            toDbJson(sloConfig),
            toDbJson(rolloutSteps),
            evaluationWindowSec,
            pollIntervalSec,
            warmupSec,
            requiredPasses,
            failureMode,
            enabled === null ? 1 : Number(enabled),
          ],
        )
        policyId = insertResult.insertId
      } else {
        policyId = Number(existingRows[0].id)
        await connection.execute(
          `UPDATE policies
           SET slo_config = ?,
               rollout_steps = ?,
               evaluation_window_sec = ?,
               poll_interval_sec = ?,
               warmup_sec = ?,
               required_passes = ?,
               failure_mode = ?,
               enabled = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            toDbJson(sloConfig),
            toDbJson(rolloutSteps),
            evaluationWindowSec,
            pollIntervalSec,
            warmupSec,
            requiredPasses,
            failureMode,
            enabled === null ? 1 : Number(enabled),
            policyId,
          ],
        )
      }

      const [policyRows] = await connection.query<PolicyRow[]>(
        `SELECT
           id,
           service_id AS serviceId,
           environment_id AS environmentId,
           slo_config AS sloConfig,
           rollout_steps AS rolloutSteps,
           evaluation_window_sec AS evaluationWindowSec,
           poll_interval_sec AS pollIntervalSec,
           warmup_sec AS warmupSec,
           required_passes AS requiredPasses,
           failure_mode AS failureMode,
           enabled,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM policies
         WHERE id = ?`,
        [policyId],
      )

      if (policyRows.length === 0) {
        throw new ApiError(500, 'Failed to load saved policy')
      }

      return {
        created: existingRows.length === 0,
        policy: mapPolicyRow(policyRows[0]),
      }
    })

    ok(res, saved, saved.created ? 201 : 200)
  }),
)

export default r
