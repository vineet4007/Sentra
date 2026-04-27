import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import type { Request, RequestHandler } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { queryRows } from './db.js'
import { ApiError } from './http.js'

type ApiSecurityConfig = {
  bearerToken: string | null
  requireTenant: boolean
  defaultTenant: string | null
  tenantHeader: string
  actionToken: string | null
  actionHeader: string
  actionActorHeader: string
}

type Queryable = Pick<PoolConnection, 'query'>

const DEFAULT_TENANT = 'default'
const TENANT_HEADER = 'x-sentra-tenant'
const ACTION_HEADER = 'x-sentra-action-token'
const ACTION_ACTOR_HEADER = 'x-sentra-actor'

const SENSITIVE_KEY_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'authorization',
  'authheader',
  'clientsecret',
  'accesskey',
  'secretkey',
  'privatekey',
  'credentials',
  'serviceaccountjson',
]

const securityConfig = loadApiSecurityConfig()

type DeploymentIdRow = RowDataPacket & {
  id: number
}

export function getApiSecurityConfig(): ApiSecurityConfig {
  return securityConfig
}

export function createApiSecurityMiddleware(config: ApiSecurityConfig = securityConfig): RequestHandler {
  return (req, _res, next) => {
    try {
      authorizeRequest(req, config)
      ensureTenantIfRequired(req, config)
      next()
    } catch (error) {
      next(error)
    }
  }
}

export function createActionAuthorityMiddleware(config: ApiSecurityConfig = securityConfig): RequestHandler {
  return (req, _res, next) => {
    try {
      authorizeActionRequest(req, config)
      next()
    } catch (error) {
      next(error)
    }
  }
}

export function getRequestTenantKey(
  req: Request,
  config: ApiSecurityConfig = securityConfig,
): string | null {
  const headerValue = headerValueString(req, config.tenantHeader)
  if (headerValue) {
    return headerValue
  }

  if (config.requireTenant && config.defaultTenant) {
    return config.defaultTenant
  }

  return null
}

export function getTenantKeyForWrite(
  req: Request,
  config: ApiSecurityConfig = securityConfig,
): string {
  return getRequestTenantKey(req, config) || config.defaultTenant || DEFAULT_TENANT
}

export function getActionActor(req: Request, config: ApiSecurityConfig = securityConfig): string {
  return headerValueString(req, config.actionActorHeader) || 'operator'
}

export function assertNoSensitiveKeys(value: unknown, label: string): void {
  const path = findSensitiveKeyPath(value, label)
  if (path) {
    throw new ApiError(
      400,
      `${label} contains sensitive credential material at "${path}". Store only secret references in "secretRefs".`,
    )
  }
}

export function redactStoredConfig<T>(value: T): T {
  return redactValue(value, false)
}

export function redactSecretRefs<T>(value: T): T {
  return redactValue(value, true)
}

export async function assertProjectTenantAccess(projectId: number, tenantKey: string | null): Promise<void> {
  if (!tenantKey) {
    return
  }

  const rows = await queryRows<RowDataPacket[]>(
    'SELECT id FROM projects WHERE id = ? AND tenant_key = ? LIMIT 1',
    [projectId, tenantKey],
  )
  if (rows.length === 0) {
    throw new ApiError(404, 'Project not found')
  }
}

export async function assertEnvironmentTenantAccess(
  environmentId: number,
  tenantKey: string | null,
): Promise<void> {
  if (!tenantKey) {
    return
  }

  const rows = await queryRows<RowDataPacket[]>(
    `SELECT e.id
     FROM environments e
     INNER JOIN projects p ON p.id = e.project_id
     WHERE e.id = ? AND p.tenant_key = ?
     LIMIT 1`,
    [environmentId, tenantKey],
  )
  if (rows.length === 0) {
    throw new ApiError(404, 'Environment not found')
  }
}

export async function deploymentBelongsToTenant(
  deploymentId: number,
  tenantKey: string,
): Promise<boolean> {
  const rows = await queryRows<RowDataPacket[]>(
    `SELECT d.id
     FROM deployments d
     INNER JOIN services s ON s.id = d.service_id
     INNER JOIN projects p ON p.id = s.project_id
     WHERE d.id = ? AND p.tenant_key = ?
     LIMIT 1`,
    [deploymentId, tenantKey],
  )
  return rows.length > 0
}

export async function listTenantDeploymentIds(tenantKey: string): Promise<number[]> {
  const rows = await queryRows<DeploymentIdRow[]>(
    `SELECT d.id AS id
     FROM deployments d
     INNER JOIN services s ON s.id = d.service_id
     INNER JOIN projects p ON p.id = s.project_id
     WHERE p.tenant_key = ?
     ORDER BY d.created_at DESC`,
    [tenantKey],
  )
  return rows.map((row) => row.id)
}

export async function assertServiceEnvironmentTenantAccess(
  connection: Queryable,
  serviceId: number,
  environmentId: number,
  tenantKey: string | null,
): Promise<number> {
  const params: Array<string | number> = [serviceId, environmentId]
  let tenantClause = ''
  if (tenantKey) {
    tenantClause = ' AND p.tenant_key = ?'
    params.push(tenantKey)
  }

  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT s.project_id AS projectId
     FROM services s
     INNER JOIN environments e ON e.id = ? AND e.project_id = s.project_id
     INNER JOIN projects p ON p.id = s.project_id
     WHERE s.id = ?${tenantClause}
     LIMIT 1`,
    [environmentId, serviceId, ...(tenantKey ? [tenantKey] : [])],
  )

  if (rows.length === 0) {
    throw new ApiError(
      400,
      'Service and environment must belong to the same tenant-scoped project',
    )
  }

  return Number(rows[0].projectId)
}

function loadApiSecurityConfig(): ApiSecurityConfig {
  return {
    bearerToken: optionalEnv('SENTRA_API_BEARER_TOKEN'),
    requireTenant: boolEnv('SENTRA_REQUIRE_TENANT', false),
    defaultTenant: optionalEnv('SENTRA_DEFAULT_TENANT'),
    tenantHeader: optionalEnv('SENTRA_TENANT_HEADER') || TENANT_HEADER,
    actionToken: optionalEnv('SENTRA_ACTION_TOKEN'),
    actionHeader: optionalEnv('SENTRA_ACTION_HEADER') || ACTION_HEADER,
    actionActorHeader: optionalEnv('SENTRA_ACTION_ACTOR_HEADER') || ACTION_ACTOR_HEADER,
  }
}

function authorizeRequest(req: Request, config: ApiSecurityConfig): void {
  if (!config.bearerToken) {
    return
  }

  const authorization = headerValueString(req, 'authorization')
  if (!authorization) {
    throw new ApiError(401, 'Missing bearer token')
  }

  const prefix = 'bearer '
  if (authorization.length <= prefix.length || authorization.slice(0, prefix.length).toLowerCase() !== prefix) {
    throw new ApiError(401, 'Authorization header must use the Bearer scheme')
  }

  const token = authorization.slice(prefix.length).trim()
  if (token !== config.bearerToken) {
    throw new ApiError(401, 'Invalid bearer token')
  }
}

function ensureTenantIfRequired(req: Request, config: ApiSecurityConfig): void {
  if (!config.requireTenant) {
    return
  }

  const tenantKey = getRequestTenantKey(req, config)
  if (!tenantKey) {
    throw new ApiError(
      400,
      `Missing tenant scope. Provide ${config.tenantHeader} or configure SENTRA_DEFAULT_TENANT.`,
    )
  }
}

function authorizeActionRequest(req: Request, config: ApiSecurityConfig): void {
  if (!requiresActionAuthority(req)) {
    return
  }
  if (!config.actionToken) {
    return
  }

  const token = headerValueString(req, config.actionHeader)
  if (!token) {
    throw new ApiError(
      403,
      `Sentra action authority is required for this operation. Provide ${config.actionHeader} from a trusted operator session.`,
    )
  }
  if (!constantTimeEqual(token, config.actionToken)) {
    throw new ApiError(403, 'Invalid Sentra action authority token')
  }
}

function requiresActionAuthority(req: Request): boolean {
  const method = req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return false
  }

  const path = normalizeRequestPath(req.path)
  if (path === '/satellites/heartbeat') {
    return false
  }
  if (path === '/satellites/tasks/claim') {
    return false
  }
  if (/^\/satellites\/tasks\/[^/]+\/report$/.test(path)) {
    return false
  }

  return true
}

function normalizeRequestPath(path: string): string {
  if (!path || path === '/') {
    return '/'
  }
  return path.endsWith('/') ? path.slice(0, -1) : path
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }
  return timingSafeEqual(leftBuffer, rightBuffer)
}

function headerValueString(req: Request, key: string): string | null {
  const value = req.header(key)
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function optionalEnv(key: string): string | null {
  const value = process.env[key]
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function boolEnv(key: string, fallback: boolean): boolean {
  const value = optionalEnv(key)
  if (value === null) {
    return fallback
  }
  return value.toLowerCase() === 'true'
}

function findSensitiveKeyPath(value: unknown, basePath: string): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const path = findSensitiveKeyPath(entry, `${basePath}[${index}]`)
      if (path) {
        return path
      }
    }
    return null
  }

  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${basePath}.${key}`
    if (isSensitiveKey(key)) {
      return nextPath
    }
    const nestedPath = findSensitiveKeyPath(entry, nextPath)
    if (nestedPath) {
      return nestedPath
    }
  }

  return null
}

function redactValue<T>(value: T, forceRedaction: boolean): T {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, forceRedaction)) as T
  }

  if (!value || typeof value !== 'object') {
    return (forceRedaction && value !== null && value !== undefined ? '[redacted]' : value) as T
  }

  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (forceRedaction || isSensitiveKey(key)) {
      output[key] = '[redacted]'
      continue
    }
    output[key] = redactValue(entry, false)
  }
  return output as T
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern))
}
