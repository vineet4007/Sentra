import { Router } from 'express'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { fromDbJson, queryRows, toDbJson, toIsoString, withTransaction } from '../db.js'
import {
  ApiError,
  asyncHandler,
  getOptionalBoolean,
  getOptionalObject,
  getOptionalString,
  getRequiredString,
  ok,
  parsePositiveInt,
  requireBodyObject,
  requireObjectField,
} from '../http.js'
import { validateTelemetryConfig } from '../telemetry.js'

const r = Router()

type ProjectRow = RowDataPacket & {
  id: number
  name: string
  repoUrl: string | null
  description: string | null
  createdAt: Date
  updatedAt: Date
}

type ServiceRow = RowDataPacket & {
  id: number
  projectId: number
  name: string
  adapterType: string
  serviceConfig: string | null
  createdAt: Date
  updatedAt: Date
}

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

function mapProjectRow(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    repoUrl: row.repoUrl,
    description: row.description,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  }
}

function mapServiceRow(row: ServiceRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    adapterType: row.adapterType,
    serviceConfig: fromDbJson<Record<string, unknown>>(row.serviceConfig),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  }
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
  asyncHandler(async (_req, res) => {
    const rows = await queryRows<ProjectRow[]>(
      `SELECT
         id,
         name,
         repo_url AS repoUrl,
         description,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM projects
       ORDER BY created_at DESC`,
    )

    ok(res, {
      items: rows.map(mapProjectRow),
      count: rows.length,
    })
  }),
)

r.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const projectId = parsePositiveInt(req.params.id, 'projectId')

    const projectRows = await queryRows<ProjectRow[]>(
      `SELECT
         id,
         name,
         repo_url AS repoUrl,
         description,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM projects
       WHERE id = ?`,
      [projectId],
    )

    if (projectRows.length === 0) {
      throw new ApiError(404, 'Project not found')
    }

    const serviceRows = await queryRows<ServiceRow[]>(
      `SELECT
         id,
         project_id AS projectId,
         name,
         adapter_type AS adapterType,
         service_config AS serviceConfig,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM services
       WHERE project_id = ?
       ORDER BY created_at ASC`,
      [projectId],
    )

    const environmentRows = await queryRows<EnvironmentRow[]>(
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
       WHERE project_id = ?
       ORDER BY created_at ASC`,
      [projectId],
    )

    ok(res, {
      project: mapProjectRow(projectRows[0]),
      services: serviceRows.map(mapServiceRow),
      environments: environmentRows.map(mapEnvironmentRow),
    })
  }),
)

r.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = requireBodyObject(req.body)
    const name = getRequiredString(body, 'name')
    const repoUrl = getOptionalString(body, 'repoUrl')
    const description = getOptionalString(body, 'description')

    const created = await withTransaction(async (connection) => {
      const [insertResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO projects (name, repo_url, description)
         VALUES (?, ?, ?)`,
        [name, repoUrl, description],
      )

      const [rows] = await connection.query<ProjectRow[]>(
        `SELECT
           id,
           name,
           repo_url AS repoUrl,
           description,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM projects
         WHERE id = ?`,
        [insertResult.insertId],
      )

      if (rows.length === 0) {
        throw new ApiError(500, 'Failed to load created project')
      }

      return mapProjectRow(rows[0])
    })

    ok(res, { project: created }, 201)
  }),
)

r.post(
  '/onboard',
  asyncHandler(async (req, res) => {
    const body = requireBodyObject(req.body)
    const projectInput = requireObjectField(body, 'project')
    const serviceInput = requireObjectField(body, 'service')
    const environmentInput = requireObjectField(body, 'environment')
    const validateTelemetry = getOptionalBoolean(body, 'validateTelemetry') || false

    const projectName = getRequiredString(projectInput, 'name')
    const repoUrl = getOptionalString(projectInput, 'repoUrl')
    const description = getOptionalString(projectInput, 'description')

    const serviceName = getRequiredString(serviceInput, 'name')
    const adapterType = getOptionalString(serviceInput, 'adapterType') || 'kubernetes'
    const serviceConfig = getOptionalObject(serviceInput, 'serviceConfig')

    const environmentName = getRequiredString(environmentInput, 'name')
    const deploymentTargetType =
      getOptionalString(environmentInput, 'deploymentTargetType') || 'kubernetes'
    const deploymentTargetConfig = getOptionalObject(environmentInput, 'deploymentTargetConfig')
    const telemetrySourceConfig = getOptionalObject(environmentInput, 'telemetrySourceConfig')
    const telemetryLabelMap = getOptionalObject(environmentInput, 'telemetryLabelMap')
    const secretRefs = getOptionalObject(environmentInput, 'secretRefs')

    let telemetryValidation: Awaited<ReturnType<typeof validateTelemetryConfig>> | null = null
    if (validateTelemetry && telemetrySourceConfig) {
      telemetryValidation = await validateTelemetryConfig(telemetrySourceConfig)
      if (!telemetryValidation.ok) {
        throw new ApiError(400, 'Telemetry validation failed', telemetryValidation)
      }
    }

    const created = await withTransaction(async (connection) => {
      const [projectInsert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO projects (name, repo_url, description)
         VALUES (?, ?, ?)`,
        [projectName, repoUrl, description],
      )

      const projectId = projectInsert.insertId

      const [serviceInsert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO services (project_id, name, adapter_type, service_config)
         VALUES (?, ?, ?, ?)`,
        [projectId, serviceName, adapterType, toDbJson(serviceConfig)],
      )

      const [environmentInsert] = await connection.execute<ResultSetHeader>(
        `INSERT INTO environments (
           project_id,
           name,
           deployment_target_type,
           deployment_target_config,
           telemetry_source_config,
           telemetry_label_map,
           secret_refs
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          projectId,
          environmentName,
          deploymentTargetType,
          toDbJson(deploymentTargetConfig),
          toDbJson(telemetrySourceConfig),
          toDbJson(telemetryLabelMap),
          toDbJson(secretRefs),
        ],
      )

      return {
        project: {
          id: projectId,
          name: projectName,
          repoUrl,
          description,
        },
        service: {
          id: serviceInsert.insertId,
          projectId,
          name: serviceName,
          adapterType,
          serviceConfig,
        },
        environment: {
          id: environmentInsert.insertId,
          projectId,
          name: environmentName,
          deploymentTargetType,
          deploymentTargetConfig,
          telemetrySourceConfig,
          telemetryLabelMap,
          secretRefs,
        },
      }
    })

    ok(
      res,
      {
        ...created,
        telemetryValidation,
      },
      201,
    )
  }),
)

export default r

