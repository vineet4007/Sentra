import { Router } from 'express'
import type { Request } from 'express'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import {
  fromDbJson,
  queryRows as defaultQueryRows,
  toDbJson,
  toIsoString,
  withTransaction as defaultWithTransaction,
  type SqlParam,
} from '../db.js'
import {
  ApiError,
  asyncHandler,
  getOptionalString,
  getRequiredString,
  ok,
  parseOptionalPositiveIntQuery,
  parsePositiveInt,
  requireBodyObject,
} from '../http.js'
import { getActionActor, getRequestTenantKey } from '../security.js'

type SecurityConfig = NonNullable<Parameters<typeof getRequestTenantKey>[1]>
type TransactionConnection = Pick<PoolConnection, 'execute' | 'query'>

export type IncidentRouterDependencies = {
  queryRows: typeof defaultQueryRows
  withTransaction: <T>(fn: (connection: TransactionConnection) => Promise<T>) => Promise<T>
}

type IncidentRow = RowDataPacket & {
  id: number
  deploymentId: number
  rolloutStepId: number | null
  incidentType: string
  severity: string
  status: string
  summary: string
  details: unknown
  detectedAt: Date | string
  resolvedAt: Date | string | null
  createdAt: Date | string
  updatedAt: Date | string
}

type IncidentActionRow = RowDataPacket & {
  id: number
  incidentId: number
  deploymentId: number
  actionType: string
  actorId: string | null
  note: string | null
  details: unknown
  createdAt: Date | string
}

type IncidentDetails = Record<string, unknown> & {
  title?: unknown
  description?: unknown
  events?: unknown
}

type IncidentActionInsert = {
  incidentId: number
  deploymentId: number
  actionType: string
  actorId: string
  note?: string | null
  details?: Record<string, unknown>
}

const MAX_INCIDENT_LIMIT = 500
const DEFAULT_INCIDENT_LIMIT = 100

const defaultDeps: IncidentRouterDependencies = {
  queryRows: defaultQueryRows,
  withTransaction: defaultWithTransaction as IncidentRouterDependencies['withTransaction'],
}

function bodyObjectOrEmpty(body: unknown): Record<string, unknown> {
  if (body === null || body === undefined || body === '') {
    return {}
  }
  return requireBodyObject(body)
}

function parseIncidentLimit(value: unknown): number {
  const parsed = parseOptionalPositiveIntQuery(value, 'limit') || DEFAULT_INCIDENT_LIMIT
  return Math.min(parsed, MAX_INCIDENT_LIMIT)
}

function mapIncidentActionRow(row: IncidentActionRow) {
  return {
    id: row.id,
    incidentId: row.incidentId,
    deploymentId: row.deploymentId,
    actionType: row.actionType,
    actorId: row.actorId,
    note: row.note,
    details: fromDbJson<Record<string, unknown>>(row.details),
    createdAt: toIsoString(row.createdAt),
  }
}

function mapIncidentRow(row: IncidentRow, actions: IncidentActionRow[] = []) {
  const details = fromDbJson<IncidentDetails>(row.details)
  const mappedActions = actions.map(mapIncidentActionRow)
  const acknowledgedAction = [...mappedActions]
    .reverse()
    .find((action) => action.actionType === 'acknowledged')
  const resolvedAction = [...mappedActions]
    .reverse()
    .find((action) => action.actionType === 'resolved')

  return {
    id: row.id,
    deploymentId: row.deploymentId,
    rolloutStepId: row.rolloutStepId,
    incidentType: row.incidentType,
    severity: row.severity,
    status: row.status,
    summary: row.summary,
    details,
    detectedAt: toIsoString(row.detectedAt),
    resolvedAt: toIsoString(row.resolvedAt),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    title: typeof details?.title === 'string' ? details.title : row.summary,
    description:
      typeof details?.description === 'string' ? details.description : row.summary,
    events: Array.isArray(details?.events) ? details.events : [],
    assignee:
      typeof acknowledgedAction?.details?.assignee === 'string'
        ? acknowledgedAction.details.assignee
        : null,
    acknowledgedBy: acknowledgedAction?.actorId || null,
    acknowledgedAt: acknowledgedAction?.createdAt || null,
    resolvedBy: resolvedAction?.actorId || null,
    notes: mappedActions
      .filter((action) => action.note)
      .map((action) => action.note as string),
    actions: mappedActions,
  }
}

async function listIncidentActions(
  deps: IncidentRouterDependencies,
  incidentIds: number[],
): Promise<Map<number, IncidentActionRow[]>> {
  if (incidentIds.length === 0) {
    return new Map()
  }

  const placeholders = incidentIds.map(() => '?').join(', ')
  const rows = await deps.queryRows<IncidentActionRow[]>(
    `SELECT
       id,
       incident_id AS incidentId,
       deployment_id AS deploymentId,
       action_type AS actionType,
       actor_id AS actorId,
       note,
       details,
       created_at AS createdAt
     FROM incident_actions
     WHERE incident_id IN (${placeholders})
     ORDER BY created_at ASC, id ASC`,
    incidentIds,
  )

  return groupActionsByIncident(rows)
}

async function listIncidentActionsFromConnection(
  connection: TransactionConnection,
  incidentIds: number[],
): Promise<Map<number, IncidentActionRow[]>> {
  if (incidentIds.length === 0) {
    return new Map()
  }

  const placeholders = incidentIds.map(() => '?').join(', ')
  const [rows] = await connection.query<IncidentActionRow[]>(
    `SELECT
       id,
       incident_id AS incidentId,
       deployment_id AS deploymentId,
       action_type AS actionType,
       actor_id AS actorId,
       note,
       details,
       created_at AS createdAt
     FROM incident_actions
     WHERE incident_id IN (${placeholders})
     ORDER BY created_at ASC, id ASC`,
    incidentIds,
  )

  return groupActionsByIncident(rows)
}

function groupActionsByIncident(rows: IncidentActionRow[]): Map<number, IncidentActionRow[]> {
  const byIncident = new Map<number, IncidentActionRow[]>()
  for (const row of rows) {
    const current = byIncident.get(row.incidentId) || []
    current.push(row)
    byIncident.set(row.incidentId, current)
  }
  return byIncident
}

async function loadIncidentForOperator(
  connection: TransactionConnection,
  incidentId: number,
  tenantKey: string | null,
  lock = false,
): Promise<IncidentRow | null> {
  const params: SqlParam[] = [incidentId]
  if (tenantKey) {
    params.push(tenantKey)
  }

  const [rows] = await connection.query<IncidentRow[]>(
    `SELECT
       i.id,
       i.deployment_id AS deploymentId,
       i.rollout_step_id AS rolloutStepId,
       i.incident_type AS incidentType,
       i.severity,
       i.status,
       i.summary,
       i.details,
       i.detected_at AS detectedAt,
       i.resolved_at AS resolvedAt,
       i.created_at AS createdAt,
       i.updated_at AS updatedAt
     FROM incidents i
     INNER JOIN deployments d ON d.id = i.deployment_id
     INNER JOIN services s ON s.id = d.service_id
     INNER JOIN projects p ON p.id = s.project_id
     WHERE i.id = ?
       ${tenantKey ? 'AND p.tenant_key = ?' : ''}
     LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    params,
  )

  return rows[0] || null
}

async function insertIncidentAction(
  connection: TransactionConnection,
  action: IncidentActionInsert,
): Promise<void> {
  await connection.execute<ResultSetHeader>(
    `INSERT INTO incident_actions (
       incident_id,
       deployment_id,
       action_type,
       actor_id,
       note,
       details
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      action.incidentId,
      action.deploymentId,
      action.actionType,
      action.actorId,
      action.note || null,
      toDbJson(action.details || {}),
    ],
  )
}

async function insertIncidentAuditEvent(
  connection: TransactionConnection,
  incident: IncidentRow,
  actorId: string,
  eventType: string,
  summary: string,
  details: Record<string, unknown>,
): Promise<void> {
  await connection.execute(
    `INSERT INTO audit_events (
       deployment_id,
       rollout_step_id,
       actor_type,
       actor_id,
       event_type,
       summary,
       details
     ) VALUES (?, ?, 'operator', ?, ?, ?, ?)`,
    [
      incident.deploymentId,
      incident.rolloutStepId,
      actorId,
      eventType,
      summary,
      toDbJson({
        incidentId: incident.id,
        ...details,
      }),
    ],
  )
}

async function loadMappedIncident(
  connection: TransactionConnection,
  incidentId: number,
  tenantKey: string | null,
) {
  const row = await loadIncidentForOperator(connection, incidentId, tenantKey)
  if (!row) {
    throw new ApiError(404, 'Incident not found')
  }
  const actions = await listIncidentActionsFromConnection(connection, [incidentId])
  return mapIncidentRow(row, actions.get(incidentId) || [])
}

export function createIncidentRouter(
  deps: IncidentRouterDependencies = defaultDeps,
  securityConfig?: SecurityConfig,
) {
  const r = Router()

  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const deploymentId = parseOptionalPositiveIntQuery(req.query.deploymentId, 'deploymentId')
      const limit = parseIncidentLimit(req.query.limit)
      const status =
        typeof req.query.status === 'string' && req.query.status.trim() !== ''
          ? req.query.status.trim()
          : null
      const tenantKey = getRequestTenantKey(req, securityConfig)

      const where: string[] = []
      const params: SqlParam[] = []

      if (deploymentId) {
        where.push('i.deployment_id = ?')
        params.push(deploymentId)
      }
      if (status) {
        where.push('i.status = ?')
        params.push(status)
      }
      if (tenantKey) {
        where.push('p.tenant_key = ?')
        params.push(tenantKey)
      }

      params.push(limit)

      const rows = await deps.queryRows<IncidentRow[]>(
        `SELECT
           i.id,
           i.deployment_id AS deploymentId,
           i.rollout_step_id AS rolloutStepId,
           i.incident_type AS incidentType,
           i.severity,
           i.status,
           i.summary,
           i.details,
           i.detected_at AS detectedAt,
           i.resolved_at AS resolvedAt,
           i.created_at AS createdAt,
           i.updated_at AS updatedAt
         FROM incidents i
         INNER JOIN deployments d ON d.id = i.deployment_id
         INNER JOIN services s ON s.id = d.service_id
         INNER JOIN projects p ON p.id = s.project_id
         ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY i.detected_at DESC, i.id DESC
         LIMIT ?`,
        params,
      )

      const actionsByIncident = await listIncidentActions(deps, rows.map((row) => row.id))
      ok(res, {
        items: rows.map((row) => mapIncidentRow(row, actionsByIncident.get(row.id) || [])),
        count: rows.length,
      })
    }),
  )

  r.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const incidentId = parsePositiveInt(req.params.id, 'id')
      const tenantKey = getRequestTenantKey(req, securityConfig)

      const rows = await deps.queryRows<IncidentRow[]>(
        `SELECT
           i.id,
           i.deployment_id AS deploymentId,
           i.rollout_step_id AS rolloutStepId,
           i.incident_type AS incidentType,
           i.severity,
           i.status,
           i.summary,
           i.details,
           i.detected_at AS detectedAt,
           i.resolved_at AS resolvedAt,
           i.created_at AS createdAt,
           i.updated_at AS updatedAt
         FROM incidents i
         INNER JOIN deployments d ON d.id = i.deployment_id
         INNER JOIN services s ON s.id = d.service_id
         INNER JOIN projects p ON p.id = s.project_id
         WHERE i.id = ?
           ${tenantKey ? 'AND p.tenant_key = ?' : ''}
         LIMIT 1`,
        tenantKey ? [incidentId, tenantKey] : [incidentId],
      )

      if (rows.length === 0) {
        throw new ApiError(404, 'Incident not found')
      }

      const actionsByIncident = await listIncidentActions(deps, [incidentId])
      ok(res, mapIncidentRow(rows[0], actionsByIncident.get(incidentId) || []))
    }),
  )

  r.post(
    '/:id/acknowledge',
    asyncHandler(async (req, res) => {
      const incidentId = parsePositiveInt(req.params.id, 'id')
      const body = bodyObjectOrEmpty(req.body)
      const actorId = getActionActor(req, securityConfig)
      const assignee = getOptionalString(body, 'assignee') || actorId
      const tenantKey = getRequestTenantKey(req, securityConfig)

      const incident = await deps.withTransaction(async (connection) => {
        const current = await loadIncidentForOperator(connection, incidentId, tenantKey, true)
        if (!current) {
          throw new ApiError(404, 'Incident not found')
        }
        if (current.status === 'resolved') {
          throw new ApiError(400, 'Resolved incidents cannot be acknowledged')
        }

        await connection.execute(
          `UPDATE incidents
           SET status = 'acknowledged',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [incidentId],
        )
        await insertIncidentAction(connection, {
          incidentId,
          deploymentId: current.deploymentId,
          actionType: 'acknowledged',
          actorId,
          details: { assignee },
        })
        await insertIncidentAuditEvent(
          connection,
          current,
          actorId,
          'incident.acknowledged',
          `Incident ${incidentId} acknowledged by ${actorId}`,
          { assignee },
        )

        return loadMappedIncident(connection, incidentId, tenantKey)
      })

      ok(res, incident)
    }),
  )

  r.post(
    '/:id/resolve',
    asyncHandler(async (req, res) => {
      const incidentId = parsePositiveInt(req.params.id, 'id')
      const body = bodyObjectOrEmpty(req.body)
      const actorId = getActionActor(req, securityConfig)
      const resolution = getOptionalString(body, 'resolution') || 'resolved'
      const tenantKey = getRequestTenantKey(req, securityConfig)

      const incident = await deps.withTransaction(async (connection) => {
        const current = await loadIncidentForOperator(connection, incidentId, tenantKey, true)
        if (!current) {
          throw new ApiError(404, 'Incident not found')
        }

        await connection.execute(
          `UPDATE incidents
           SET status = 'resolved',
               resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [incidentId],
        )
        await insertIncidentAction(connection, {
          incidentId,
          deploymentId: current.deploymentId,
          actionType: 'resolved',
          actorId,
          note: resolution,
          details: { resolution },
        })
        await insertIncidentAuditEvent(
          connection,
          current,
          actorId,
          'incident.resolved',
          `Incident ${incidentId} resolved by ${actorId}`,
          { resolution },
        )

        return loadMappedIncident(connection, incidentId, tenantKey)
      })

      ok(res, incident)
    }),
  )

  r.post(
    '/:id/notes',
    asyncHandler(async (req, res) => {
      const incidentId = parsePositiveInt(req.params.id, 'id')
      const body = requireBodyObject(req.body)
      const note = getRequiredString(body, 'note')
      const actorId = getActionActor(req, securityConfig)
      const tenantKey = getRequestTenantKey(req, securityConfig)

      const incident = await deps.withTransaction(async (connection) => {
        const current = await loadIncidentForOperator(connection, incidentId, tenantKey, true)
        if (!current) {
          throw new ApiError(404, 'Incident not found')
        }

        await connection.execute(
          `UPDATE incidents
           SET updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [incidentId],
        )
        await insertIncidentAction(connection, {
          incidentId,
          deploymentId: current.deploymentId,
          actionType: 'note_added',
          actorId,
          note,
          details: { noteLength: note.length },
        })
        await insertIncidentAuditEvent(
          connection,
          current,
          actorId,
          'incident.note_added',
          `Incident ${incidentId} note added by ${actorId}`,
          { noteLength: note.length },
        )

        return loadMappedIncident(connection, incidentId, tenantKey)
      })

      ok(res, incident)
    }),
  )

  return r
}

export default createIncidentRouter()
