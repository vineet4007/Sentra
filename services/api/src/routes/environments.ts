import { Router } from 'express'
import type { RowDataPacket } from 'mysql2/promise'
import { fromDbJson, executeStatement, queryRows, toDbJson, toIsoString, type SqlParam } from '../db.js'
import {
  ApiError,
  asyncHandler,
  getOptionalBoolean,
  getOptionalJson,
  hasField,
  ok,
  parseOptionalPositiveIntQuery,
  parsePositiveInt,
  requireBodyObject,
} from '../http.js'
import {
  assertEnvironmentTenantAccess,
  assertNoSensitiveKeys,
  getRequestTenantKey,
  redactSecretRefs,
  redactStoredConfig,
} from '../security.js'
import { validateTelemetryConfig } from '../telemetry.js'

const r = Router()

type EnvironmentRow = RowDataPacket & {
  id: number
  projectId: number
  name: string
  deploymentTargetType: string
  deploymentTargetConfig: string | null
  telemetrySourceConfig: string | null
  telemetryLabelMap: string | null
  secretRefs: string | null
  createdAt: Date
  updatedAt: Date
}

function mapEnvironmentRow(row: EnvironmentRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    deploymentTargetType: row.deploymentTargetType,
    deploymentTargetConfig: redactStoredConfig(
      fromDbJson<Record<string, unknown>>(row.deploymentTargetConfig),
    ),
    telemetrySourceConfig: redactStoredConfig(
      fromDbJson<Record<string, unknown>>(row.telemetrySourceConfig),
    ),
    telemetryLabelMap: fromDbJson<Record<string, unknown>>(row.telemetryLabelMap),
    secretRefs: redactSecretRefs(fromDbJson<unknown>(row.secretRefs)),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  }
}

r.get(
  '/',
  asyncHandler(async (req, res) => {
    const projectId = parseOptionalPositiveIntQuery(req.query.projectId, 'projectId')
    const limit = parseOptionalPositiveIntQuery(req.query.limit, 'limit') || 50
    const tenantKey = getRequestTenantKey(req)

    const params: SqlParam[] = []
    const where: string[] = []

    if (projectId) {
      where.push('e.project_id = ?')
      params.push(projectId)
    }
    if (tenantKey) {
      where.push('p.tenant_key = ?')
      params.push(tenantKey)
    }

    params.push(limit)

    const rows = await queryRows<EnvironmentRow[]>(
      `SELECT
         e.id,
         e.project_id AS projectId,
         e.name,
         e.deployment_target_type AS deploymentTargetType,
         e.deployment_target_config AS deploymentTargetConfig,
         e.telemetry_source_config AS telemetrySourceConfig,
         e.telemetry_label_map AS telemetryLabelMap,
         e.secret_refs AS secretRefs,
         e.created_at AS createdAt,
         e.updated_at AS updatedAt
       FROM environments e
       INNER JOIN projects p ON p.id = e.project_id
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY e.created_at DESC
       LIMIT ?`,
      params,
    )

    ok(res, {
      items: rows.map(mapEnvironmentRow),
      count: rows.length,
    })
  }),
)

r.put(
  '/:id/integrations',
  asyncHandler(async (req, res) => {
    const environmentId = parsePositiveInt(req.params.id, 'environmentId')
    const body = requireBodyObject(req.body)
    const validateTelemetry = getOptionalBoolean(body, 'validateTelemetry') || false
    const tenantKey = getRequestTenantKey(req)

    await assertEnvironmentTenantAccess(environmentId, tenantKey)

    const updates: string[] = []
    const params: SqlParam[] = []

    let telemetrySourceConfig: Record<string, unknown> | null = null
    let telemetryValidation: Awaited<ReturnType<typeof validateTelemetryConfig>> | null = null

    if (hasField(body, 'deploymentTargetType')) {
      const deploymentTargetType = body.deploymentTargetType
      if (typeof deploymentTargetType !== 'string' || deploymentTargetType.trim() === '') {
        throw new ApiError(400, '"deploymentTargetType" must be a non-empty string')
      }
      updates.push('deployment_target_type = ?')
      params.push(deploymentTargetType.trim())
    }

    if (hasField(body, 'deploymentTargetConfig')) {
      const deploymentTargetConfig = getOptionalJson(body, 'deploymentTargetConfig')
      assertNoSensitiveKeys(deploymentTargetConfig, 'deploymentTargetConfig')
      updates.push('deployment_target_config = ?')
      params.push(toDbJson(deploymentTargetConfig))
    }

    if (hasField(body, 'telemetrySourceConfig')) {
      const value = getOptionalJson(body, 'telemetrySourceConfig')
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        telemetrySourceConfig = value as Record<string, unknown>
      }
      assertNoSensitiveKeys(value, 'telemetrySourceConfig')
      updates.push('telemetry_source_config = ?')
      params.push(toDbJson(value))
    }

    if (hasField(body, 'telemetryLabelMap')) {
      const telemetryLabelMap = getOptionalJson(body, 'telemetryLabelMap')
      updates.push('telemetry_label_map = ?')
      params.push(toDbJson(telemetryLabelMap))
    }

    if (hasField(body, 'secretRefs')) {
      const secretRefs = getOptionalJson(body, 'secretRefs')
      updates.push('secret_refs = ?')
      params.push(toDbJson(secretRefs))
    }

    if (updates.length === 0) {
      throw new ApiError(400, 'No integration fields were provided to update')
    }

    if (validateTelemetry && telemetrySourceConfig) {
      telemetryValidation = await validateTelemetryConfig(telemetrySourceConfig)
      if (!telemetryValidation.ok) {
        throw new ApiError(400, 'Telemetry validation failed', telemetryValidation)
      }
    }

    params.push(environmentId)
    const updateResult = await executeStatement(
      `UPDATE environments
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      params,
    )

    if (updateResult.affectedRows === 0) {
      throw new ApiError(404, 'Environment not found')
    }

    const rows = await queryRows<EnvironmentRow[]>(
      `SELECT
         e.id,
         e.project_id AS projectId,
         e.name,
         e.deployment_target_type AS deploymentTargetType,
         e.deployment_target_config AS deploymentTargetConfig,
         e.telemetry_source_config AS telemetrySourceConfig,
         e.telemetry_label_map AS telemetryLabelMap,
         e.secret_refs AS secretRefs,
         e.created_at AS createdAt,
         e.updated_at AS updatedAt
       FROM environments e
       INNER JOIN projects p ON p.id = e.project_id
       WHERE e.id = ?${tenantKey ? ' AND p.tenant_key = ?' : ''}`,
      tenantKey ? [environmentId, tenantKey] : [environmentId],
    )

    if (rows.length === 0) {
      throw new ApiError(404, 'Environment not found after update')
    }

    ok(res, {
      environment: mapEnvironmentRow(rows[0]),
      telemetryValidation,
    })
  }),
)

export default r
