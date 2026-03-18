import { Router } from 'express'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { fromDbJson, queryRows, toDbJson, toIsoString, withTransaction } from '../db.js'
import { publishRolloutEvent } from '../events.js'
import {
  ApiError,
  asyncHandler,
  getOptionalJson,
  getOptionalObject,
  getOptionalPositiveInt,
  getOptionalString,
  hasField,
  isRecord,
  ok,
  parseOptionalPositiveIntQuery,
  parsePositiveInt,
  requireBodyObject,
} from '../http.js'
import {
  deploymentBelongsToTenant,
  getRequestTenantKey,
  getTenantKeyForWrite,
} from '../security.js'

const r = Router()

const TASK_TYPE_RECONCILE_DEPLOYMENT = 'reconcile.deployment'

type SatelliteRow = RowDataPacket & {
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
  heartbeatIntervalSec: number
  capabilities: string | null
  labels: string | null
  summary: string | null
  lastSeenAt: Date | null
  registeredAt: Date
  createdAt: Date
  updatedAt: Date
}

type SatelliteTaskRow = RowDataPacket & {
  id: number
  tenantKey: string
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

function mapSatelliteRow(row: SatelliteRow) {
  const lastSeenAt = toIsoString(row.lastSeenAt)
  const heartbeatIntervalSec = row.heartbeatIntervalSec
  const staleAfterSec = Math.max(heartbeatIntervalSec * 2, 60)
  const heartbeatAgeSec =
    row.lastSeenAt instanceof Date ? Math.max(0, Math.round((Date.now() - row.lastSeenAt.getTime()) / 1000)) : null

  let healthStatus = row.status || 'unknown'
  let stale = false

  if (!row.lastSeenAt) {
    healthStatus = 'unknown'
  } else if (heartbeatAgeSec !== null && heartbeatAgeSec > staleAfterSec) {
    healthStatus = 'stale'
    stale = true
  }

  return {
    id: row.id,
    tenantKey: row.tenantKey,
    name: row.name,
    mode: row.mode,
    cloud: row.cloud,
    region: row.region,
    clusterName: row.clusterName,
    endpointUrl: row.endpointUrl,
    version: row.version,
    status: row.status,
    healthStatus,
    heartbeatIntervalSec,
    heartbeatAgeSec,
    staleAfterSec,
    stale,
    capabilities: fromDbJson<Record<string, unknown>>(row.capabilities),
    labels: fromDbJson<Record<string, unknown>>(row.labels),
    summary: fromDbJson<Record<string, unknown>>(row.summary),
    lastSeenAt,
    registeredAt: toIsoString(row.registeredAt),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  }
}

function mapSatelliteTaskRow(row: SatelliteTaskRow) {
  return {
    id: row.id,
    tenantKey: row.tenantKey,
    satelliteId: row.satelliteId,
    satelliteName: row.satelliteName,
    deploymentId: row.deploymentId,
    taskType: row.taskType,
    status: row.status,
    payload: fromDbJson<Record<string, unknown>>(row.payload) || {},
    result: fromDbJson<Record<string, unknown>>(row.result),
    errorMessage: row.errorMessage,
    createdBy: row.createdBy,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: toIsoString(row.leaseExpiresAt),
    attempts: row.attempts,
    claimedAt: toIsoString(row.claimedAt),
    completedAt: toIsoString(row.completedAt),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  }
}

function satelliteSelectSql(whereClause = '', suffix = '') {
  return `SELECT
      id,
      tenant_key AS tenantKey,
      name,
      mode,
      cloud,
      region,
      cluster_name AS clusterName,
      endpoint_url AS endpointUrl,
      version,
      status,
      heartbeat_interval_sec AS heartbeatIntervalSec,
      capabilities,
      labels,
      summary,
      last_seen_at AS lastSeenAt,
      registered_at AS registeredAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM satellites
    ${whereClause}
    ORDER BY updated_at DESC, id DESC
    ${suffix}`
}

function satelliteTaskSelectSql(
  whereClause = '',
  suffix = '',
  orderClause = 'ORDER BY t.created_at DESC, t.id DESC',
) {
  return `SELECT
      t.id,
      t.tenant_key AS tenantKey,
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
    ${whereClause}
    ${orderClause}
    ${suffix}`
}

async function loadSatelliteById(satelliteId: number, tenantKey: string | null) {
  const params: Array<string | number> = [satelliteId]
  let tenantClause = ''

  if (tenantKey) {
    tenantClause = ' AND tenant_key = ?'
    params.push(tenantKey)
  }

  const rows = await queryRows<SatelliteRow[]>(
    satelliteSelectSql(`WHERE id = ?${tenantClause}`, 'LIMIT 1'),
    params,
  )

  if (rows.length === 0) {
    throw new ApiError(404, 'Satellite not found')
  }

  return mapSatelliteRow(rows[0])
}

async function loadSatelliteTaskById(
  connection: PoolConnection,
  taskId: number,
  tenantKey: string,
) {
  const [rows] = await connection.query<SatelliteTaskRow[]>(
    satelliteTaskSelectSql('WHERE t.id = ? AND t.tenant_key = ?', 'LIMIT 1'),
    [taskId, tenantKey],
  )

  if (rows.length === 0) {
    throw new ApiError(404, 'Satellite task not found')
  }

  return rows[0]
}

async function buildTaskPayload(
  body: Record<string, unknown>,
  tenantKey: string,
) {
  const taskType = getOptionalString(body, 'taskType') || TASK_TYPE_RECONCILE_DEPLOYMENT
  if (taskType !== TASK_TYPE_RECONCILE_DEPLOYMENT) {
    throw new ApiError(400, `Unsupported taskType "${taskType}"`)
  }

  const payloadInput = getOptionalObject(body, 'payload') || {}
  const rawDeploymentId = hasField(payloadInput, 'deploymentId')
    ? payloadInput.deploymentId
    : body.deploymentId
  const deploymentId = parsePositiveInt(rawDeploymentId, 'deploymentId')

  if (!(await deploymentBelongsToTenant(deploymentId, tenantKey))) {
    throw new ApiError(404, 'Deployment not found')
  }

  const payload: Record<string, unknown> = { deploymentId }
  if (hasField(payloadInput, 'telemetrySnapshot')) {
    const telemetrySnapshot = payloadInput.telemetrySnapshot
    if (!isRecord(telemetrySnapshot) || Array.isArray(telemetrySnapshot)) {
      throw new ApiError(400, '"payload.telemetrySnapshot" must be an object')
    }
    payload.telemetrySnapshot = telemetrySnapshot
  }

  return { deploymentId, payload, taskType }
}

r.get(
  '/',
  asyncHandler(async (req, res) => {
    const tenantKey = getRequestTenantKey(req)
    const rows = await queryRows<SatelliteRow[]>(
      satelliteSelectSql(tenantKey ? 'WHERE tenant_key = ?' : ''),
      tenantKey ? [tenantKey] : [],
    )

    ok(res, {
      items: rows.map(mapSatelliteRow),
      count: rows.length,
    })
  }),
)

r.post(
  '/tasks/claim',
  asyncHandler(async (req, res) => {
    const body = requireBodyObject(req.body)
    const tenantKey = getTenantKeyForWrite(req)
    const satelliteName = getOptionalString(body, 'satelliteName') || getOptionalString(body, 'name')
    const leaseDurationSec = getOptionalPositiveInt(body, 'leaseDurationSec') || 30

    if (!satelliteName) {
      throw new ApiError(400, '"satelliteName" must be a non-empty string')
    }

    const task = await withTransaction(async (connection) => {
      const [rows] = await connection.query<SatelliteTaskRow[]>(
        satelliteTaskSelectSql(
          `WHERE t.tenant_key = ?
             AND s.name = ?
             AND (
               t.status = 'queued'
               OR (
                 t.status = 'claimed'
                 AND t.lease_expires_at IS NOT NULL
                 AND t.lease_expires_at <= CURRENT_TIMESTAMP
               )
             )`,
          'LIMIT 1 FOR UPDATE',
          `ORDER BY
             CASE WHEN t.status = 'queued' THEN 0 ELSE 1 END,
             t.created_at ASC,
             t.id ASC`,
        ),
        [tenantKey, satelliteName],
      )

      if (rows.length === 0) {
        return null
      }

      const taskRow = rows[0]
      await connection.execute(
        `UPDATE satellite_tasks
         SET status = 'claimed',
             lease_owner = ?,
             lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND),
             attempts = attempts + 1,
             claimed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [satelliteName, leaseDurationSec, taskRow.id],
      )

      const claimedTask = await loadSatelliteTaskById(connection, taskRow.id, tenantKey)
      return mapSatelliteTaskRow(claimedTask)
    })

    if (task) {
      await publishRolloutEvent({
        type: 'satellite.task.claimed',
        satelliteId: task.satelliteId,
        satelliteName: task.satelliteName,
        taskId: task.id,
        taskType: task.taskType,
        status: task.status,
        deploymentId: task.deploymentId,
      })
    }

    ok(res, { task })
  }),
)

r.post(
  '/tasks/:taskId/report',
  asyncHandler(async (req, res) => {
    const taskId = parsePositiveInt(req.params.taskId, 'taskId')
    const body = requireBodyObject(req.body)
    const tenantKey = getTenantKeyForWrite(req)
    const satelliteName = getOptionalString(body, 'satelliteName') || getOptionalString(body, 'name')
    const status = getOptionalString(body, 'status')
    const result = getOptionalJson(body, 'result')
    const errorMessage = getOptionalString(body, 'error')

    if (status !== 'completed' && status !== 'failed') {
      throw new ApiError(400, '"status" must be either "completed" or "failed"')
    }

    const task = await withTransaction(async (connection) => {
      const taskRow = await loadSatelliteTaskById(connection, taskId, tenantKey)
      if (taskRow.status !== 'claimed') {
        throw new ApiError(409, `Satellite task ${taskId} is not currently claimed`)
      }
      if (satelliteName && taskRow.satelliteName !== satelliteName) {
        throw new ApiError(409, 'Satellite task belongs to a different satellite')
      }

      await connection.execute(
        `UPDATE satellite_tasks
         SET status = ?,
             result = ?,
             error_message = ?,
             lease_owner = NULL,
             lease_expires_at = NULL,
             completed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [status, toDbJson(result), errorMessage, taskId],
      )

      const updatedTask = await loadSatelliteTaskById(connection, taskId, tenantKey)
      return mapSatelliteTaskRow(updatedTask)
    })

    await publishRolloutEvent({
      type: `satellite.task.${task.status}`,
      satelliteId: task.satelliteId,
      satelliteName: task.satelliteName,
      taskId: task.id,
      taskType: task.taskType,
      status: task.status,
      deploymentId: task.deploymentId,
      errorMessage: task.errorMessage,
    })

    ok(res, { task })
  }),
)

r.post(
  '/heartbeat',
  asyncHandler(async (req, res) => {
    const body = requireBodyObject(req.body)
    const tenantKey = getTenantKeyForWrite(req)
    const name = getOptionalString(body, 'name')
    if (!name) {
      throw new ApiError(400, '"name" must be a non-empty string')
    }

    const mode = getOptionalString(body, 'mode') || 'satellite'
    const cloud = getOptionalString(body, 'cloud')
    const region = getOptionalString(body, 'region')
    const clusterName = getOptionalString(body, 'clusterName') || getOptionalString(body, 'cluster')
    const endpointUrl = getOptionalString(body, 'endpointUrl')
    const version = getOptionalString(body, 'version')
    const status = getOptionalString(body, 'status') || 'online'
    const heartbeatIntervalSec = getOptionalPositiveInt(body, 'heartbeatIntervalSec') || 30
    const capabilities = getOptionalJson(body, 'capabilities')
    const labels = getOptionalJson(body, 'labels')
    const summary = getOptionalJson(body, 'summary')

    const satellite = await withTransaction(async (connection) => {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO satellites (
           tenant_key,
           name,
           mode,
           cloud,
           region,
           cluster_name,
           endpoint_url,
           version,
           status,
           heartbeat_interval_sec,
           capabilities,
           labels,
           summary,
           last_seen_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
           mode = VALUES(mode),
           cloud = VALUES(cloud),
           region = VALUES(region),
           cluster_name = VALUES(cluster_name),
           endpoint_url = VALUES(endpoint_url),
           version = VALUES(version),
           status = VALUES(status),
           heartbeat_interval_sec = VALUES(heartbeat_interval_sec),
           capabilities = VALUES(capabilities),
           labels = VALUES(labels),
           summary = VALUES(summary),
           last_seen_at = VALUES(last_seen_at),
           updated_at = CURRENT_TIMESTAMP`,
        [
          tenantKey,
          name,
          mode,
          cloud,
          region,
          clusterName,
          endpointUrl,
          version,
          status,
          heartbeatIntervalSec,
          toDbJson(capabilities),
          toDbJson(labels),
          toDbJson(summary),
        ],
      )

      const [rows] = await connection.query<SatelliteRow[]>(
        satelliteSelectSql('WHERE tenant_key = ? AND name = ?', 'LIMIT 1'),
        [tenantKey, name],
      )

      if (rows.length === 0) {
        throw new ApiError(500, 'Failed to load satellite heartbeat record')
      }

      return mapSatelliteRow(rows[0])
    })

    ok(res, { satellite }, 201)
  }),
)

r.get(
  '/:id/tasks',
  asyncHandler(async (req, res) => {
    const satelliteId = parsePositiveInt(req.params.id, 'satelliteId')
    const tenantKey = getRequestTenantKey(req)
    const limit = parseOptionalPositiveIntQuery(req.query.limit, 'limit') || 20
    const deploymentId = parseOptionalPositiveIntQuery(req.query.deploymentId, 'deploymentId')
    const status =
      typeof req.query.status === 'string' && req.query.status.trim() !== ''
        ? req.query.status.trim()
        : null

    await loadSatelliteById(satelliteId, tenantKey)

    const where = ['t.satellite_id = ?']
    const params: Array<string | number> = [satelliteId]

    if (tenantKey) {
      where.push('t.tenant_key = ?')
      params.push(tenantKey)
    }
    if (deploymentId) {
      where.push('t.deployment_id = ?')
      params.push(deploymentId)
    }
    if (status) {
      where.push('t.status = ?')
      params.push(status)
    }
    params.push(limit)

    const rows = await queryRows<SatelliteTaskRow[]>(
      satelliteTaskSelectSql(`WHERE ${where.join(' AND ')}`, 'LIMIT ?'),
      params,
    )

    ok(res, {
      items: rows.map(mapSatelliteTaskRow),
      count: rows.length,
    })
  }),
)

r.post(
  '/:id/tasks',
  asyncHandler(async (req, res) => {
    const satelliteId = parsePositiveInt(req.params.id, 'satelliteId')
    const body = requireBodyObject(req.body)
    const tenantKey = getTenantKeyForWrite(req)
    const createdBy = getOptionalString(body, 'createdBy')
    const { deploymentId, payload, taskType } = await buildTaskPayload(body, tenantKey)

    const task = await withTransaction(async (connection) => {
      const [satelliteRows] = await connection.query<SatelliteRow[]>(
        satelliteSelectSql('WHERE id = ? AND tenant_key = ?', 'LIMIT 1'),
        [satelliteId, tenantKey],
      )

      if (satelliteRows.length === 0) {
        throw new ApiError(404, 'Satellite not found')
      }

      const capabilities = fromDbJson<Record<string, unknown>>(satelliteRows[0].capabilities)
      if (capabilities?.taskWorker !== true) {
        throw new ApiError(
          409,
          'This satellite is reporting heartbeat status only and is not available for delegated task execution',
        )
      }

      const [insertResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO satellite_tasks (
           tenant_key,
           satellite_id,
           deployment_id,
           task_type,
           status,
           payload,
           created_by
         ) VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
        [tenantKey, satelliteId, deploymentId, taskType, toDbJson(payload), createdBy],
      )

      const taskRow = await loadSatelliteTaskById(connection, insertResult.insertId, tenantKey)
      return mapSatelliteTaskRow(taskRow)
    })

    await publishRolloutEvent({
      type: 'satellite.task.queued',
      satelliteId: task.satelliteId,
      satelliteName: task.satelliteName,
      taskId: task.id,
      taskType: task.taskType,
      status: task.status,
      deploymentId: task.deploymentId,
    })

    ok(res, { task }, 201)
  }),
)

r.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const satelliteId = parsePositiveInt(req.params.id, 'satelliteId')
    const tenantKey = getRequestTenantKey(req)
    const satellite = await loadSatelliteById(satelliteId, tenantKey)
    ok(res, { satellite })
  }),
)

export default r
