import { Router } from 'express'
import type { RowDataPacket } from 'mysql2/promise'
import { fromDbJson, executeStatement, queryRows, toDbJson, toIsoString, type SqlParam } from '../db.js'
import { asyncHandler, getOptionalBoolean, getOptionalJson, ok, parseOptionalPositiveIntQuery, parsePositiveInt, requireBodyObject, hasField, ApiError } from '../http.js'
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
    deploymentTargetConfig: fromDbJson<Record<string, unknown>>(row.deploymentTargetConfig),
    telemetrySourceConfig: fromDbJson<Record<string, unknown>>(row.telemetrySourceConfig),
    telemetryLabelMap: fromDbJson<Record<string, unknown>>(row.telemetryLabelMap),
    secretRefs: fromDbJson<unknown>(row.secretRefs),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  }
}

r.get(
  '/',
  asyncHandler(async (req, res) => {
    const projectId = parseOptionalPositiveIntQuery(req.query.projectId, 'projectId')
    const limit = parseOptionalPositiveIntQuery(req.query.limit, 'limit') || 50

    const params: SqlParam[] = []
    let where = ''

    if (projectId) {
      where = 'WHERE project_id = ?'
      params.push(projectId)
    }

    params.push(limit)

    const rows = await queryRows<EnvironmentRow[]>(
      `SELECT
         id,
         project_id AS projectId,
         name,
         deployment_target_type AS deploymentTargetType,
         deployment_target_config AS deploymentTargetConfig,
         telemetry_source_config AS telemetrySourceConfig,
         telemetry_label_map AS telemetryLabelMap,
         secret_refs AS secretRefs,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM environments
       ${where}
       ORDER BY created_at DESC
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
      updates.push('deployment_target_config = ?')
      params.push(toDbJson(deploymentTargetConfig))
    }

    if (hasField(body, 'telemetrySourceConfig')) {
      const value = getOptionalJson(body, 'telemetrySourceConfig')
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        telemetrySourceConfig = value as Record<string, unknown>
      }
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
         id,
         project_id AS projectId,
         name,
         deployment_target_type AS deploymentTargetType,
         deployment_target_config AS deploymentTargetConfig,
         telemetry_source_config AS telemetrySourceConfig,
         telemetry_label_map AS telemetryLabelMap,
         secret_refs AS secretRefs,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM environments
       WHERE id = ?`,
      [environmentId],
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
