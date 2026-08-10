import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import type { Request, RequestHandler } from 'express'
import { createPublicKey, createVerify, timingSafeEqual } from 'node:crypto'
import { queryRows } from './db.js'
import { ApiError } from './http.js'

declare module 'express-serve-static-core' {
  interface Request {
    sentraPrincipal?: AuthenticatedPrincipal
  }
}

type EffectiveRole = 'viewer' | 'operator' | 'admin'

export type AuthenticatedPrincipal = {
  authType: 'static-bearer' | 'oidc'
  subject: string
  actorId: string
  roles: string[]
  effectiveRoles: EffectiveRole[]
  tenantKey: string | null
  tenants: string[]
  claims?: Record<string, unknown>
}

type ApiSecurityConfig = {
  bearerToken: string | null
  requireTenant: boolean
  defaultTenant: string | null
  tenantHeader: string
  actionToken: string | null
  actionHeader: string
  actionActorHeader: string
  oidcIssuer: string | null
  oidcAudience: string | null
  oidcJwksUrl: string | null
  oidcDiscoveryUrl: string | null
  oidcClockToleranceSec: number
  oidcJwksCacheTtlSec: number
  oidcSubjectClaim: string
  oidcActorClaim: string
  oidcRolesClaim: string
  oidcTenantClaim: string
  oidcTenantsClaim: string
  rbacEnabled: boolean
  rbacActionTokenFallback: boolean
  rbacViewerRoles: string[]
  rbacOperatorRoles: string[]
  rbacAdminRoles: string[]
  staticBearerRoles: string[]
}

type Queryable = Pick<PoolConnection, 'query'>
type JwtHeader = {
  alg?: unknown
  kid?: unknown
  typ?: unknown
}
type JwtClaims = Record<string, unknown>
type JsonWebKeyRecord = Record<string, unknown> & {
  kid?: string
  alg?: string
  use?: string
}
type CachedJwks = {
  keys: JsonWebKeyRecord[]
  expiresAt: number
}
type CachedDiscovery = {
  jwksUrl: string
  expiresAt: number
}

const DEFAULT_TENANT = 'default'
const TENANT_HEADER = 'x-sentra-tenant'
const ACTION_HEADER = 'x-sentra-action-token'
const ACTION_ACTOR_HEADER = 'x-sentra-actor'
const DEFAULT_OIDC_ROLES_CLAIM = 'roles'
const DEFAULT_OIDC_TENANT_CLAIM = 'tenant'
const DEFAULT_OIDC_TENANTS_CLAIM = 'tenants'
const DEFAULT_OIDC_ACTOR_CLAIM = 'email'
const DEFAULT_OIDC_SUBJECT_CLAIM = 'sub'
const DEFAULT_OIDC_CLOCK_TOLERANCE_SEC = 60
const DEFAULT_OIDC_JWKS_CACHE_TTL_SEC = 300
const DEFAULT_VIEWER_ROLES = ['viewer', 'sentra:viewer']
const DEFAULT_OPERATOR_ROLES = ['operator', 'sentra:operator']
const DEFAULT_ADMIN_ROLES = ['admin', 'sentra:admin']
const DEFAULT_STATIC_BEARER_ROLES = ['viewer']

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
const oidcJwksCache = new Map<string, CachedJwks>()
const oidcDiscoveryCache = new Map<string, CachedDiscovery>()

type DeploymentIdRow = RowDataPacket & {
  id: number
}

export function getApiSecurityConfig(): ApiSecurityConfig {
  return securityConfig
}

export function createApiSecurityMiddleware(config: ApiSecurityConfig = securityConfig): RequestHandler {
  return (req, _res, next) => {
    void authorizeRequest(req, config)
      .then((principal) => {
        if (principal) {
          req.sentraPrincipal = principal
        }
        ensureReadRole(req, config)
        ensureTenantIfRequired(req, config)
        ensurePrincipalTenantAccess(req, config)
        next()
      })
      .catch(next)
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

  if (req.sentraPrincipal?.tenantKey) {
    return req.sentraPrincipal.tenantKey
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
  if (req.sentraPrincipal?.authType === 'oidc') {
    return req.sentraPrincipal.actorId
  }
  return headerValueString(req, config.actionActorHeader) || req.sentraPrincipal?.actorId || 'operator'
}

export function getAuthenticatedPrincipal(req: Request): AuthenticatedPrincipal | null {
  return req.sentraPrincipal || null
}

export function resetOidcSecurityCacheForTest(): void {
  if (process.env.NODE_ENV === 'production') {
    return
  }

  oidcJwksCache.clear()
  oidcDiscoveryCache.clear()
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
  const oidcIssuer = optionalEnv('SENTRA_OIDC_ISSUER')
  return {
    bearerToken: optionalEnv('SENTRA_API_BEARER_TOKEN'),
    requireTenant: boolEnv('SENTRA_REQUIRE_TENANT', false),
    defaultTenant: optionalEnv('SENTRA_DEFAULT_TENANT'),
    tenantHeader: optionalEnv('SENTRA_TENANT_HEADER') || TENANT_HEADER,
    actionToken: optionalEnv('SENTRA_ACTION_TOKEN'),
    actionHeader: optionalEnv('SENTRA_ACTION_HEADER') || ACTION_HEADER,
    actionActorHeader: optionalEnv('SENTRA_ACTION_ACTOR_HEADER') || ACTION_ACTOR_HEADER,
    oidcIssuer,
    oidcAudience: optionalEnv('SENTRA_OIDC_AUDIENCE'),
    oidcJwksUrl: optionalEnv('SENTRA_OIDC_JWKS_URL'),
    oidcDiscoveryUrl:
      optionalEnv('SENTRA_OIDC_DISCOVERY_URL') ||
      (oidcIssuer ? `${oidcIssuer.replace(/\/+$/, '')}/.well-known/openid-configuration` : null),
    oidcClockToleranceSec: positiveIntEnv(
      'SENTRA_OIDC_CLOCK_TOLERANCE_SEC',
      DEFAULT_OIDC_CLOCK_TOLERANCE_SEC,
    ),
    oidcJwksCacheTtlSec: positiveIntEnv(
      'SENTRA_OIDC_JWKS_CACHE_TTL_SEC',
      DEFAULT_OIDC_JWKS_CACHE_TTL_SEC,
    ),
    oidcSubjectClaim: optionalEnv('SENTRA_OIDC_SUBJECT_CLAIM') || DEFAULT_OIDC_SUBJECT_CLAIM,
    oidcActorClaim: optionalEnv('SENTRA_OIDC_ACTOR_CLAIM') || DEFAULT_OIDC_ACTOR_CLAIM,
    oidcRolesClaim: optionalEnv('SENTRA_OIDC_ROLES_CLAIM') || DEFAULT_OIDC_ROLES_CLAIM,
    oidcTenantClaim: optionalEnv('SENTRA_OIDC_TENANT_CLAIM') || DEFAULT_OIDC_TENANT_CLAIM,
    oidcTenantsClaim: optionalEnv('SENTRA_OIDC_TENANTS_CLAIM') || DEFAULT_OIDC_TENANTS_CLAIM,
    rbacEnabled: boolEnv('SENTRA_RBAC_ENABLED', false),
    rbacActionTokenFallback: boolEnv('SENTRA_RBAC_ACTION_TOKEN_FALLBACK', true),
    rbacViewerRoles: csvEnv('SENTRA_RBAC_VIEWER_ROLES', DEFAULT_VIEWER_ROLES),
    rbacOperatorRoles: csvEnv('SENTRA_RBAC_OPERATOR_ROLES', DEFAULT_OPERATOR_ROLES),
    rbacAdminRoles: csvEnv('SENTRA_RBAC_ADMIN_ROLES', DEFAULT_ADMIN_ROLES),
    staticBearerRoles: csvEnv('SENTRA_STATIC_BEARER_ROLES', DEFAULT_STATIC_BEARER_ROLES),
  }
}

async function authorizeRequest(
  req: Request,
  config: ApiSecurityConfig,
): Promise<AuthenticatedPrincipal | null> {
  if (!config.bearerToken && !isOidcConfigured(config)) {
    return null
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
  if (config.bearerToken && token === config.bearerToken) {
    return buildStaticBearerPrincipal(config)
  }

  if (isOidcConfigured(config)) {
    return verifyOidcBearerToken(token, config)
  }

  throw new ApiError(401, 'Invalid bearer token')
}

function ensureReadRole(req: Request, config: ApiSecurityConfig): void {
  if (!config.rbacEnabled) {
    return
  }

  if (!principalHasAnyRole(req.sentraPrincipal, ['viewer', 'operator', 'admin'])) {
    throw new ApiError(403, 'Sentra RBAC role required: viewer, operator, or admin')
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

function ensurePrincipalTenantAccess(req: Request, config: ApiSecurityConfig): void {
  if (!config.rbacEnabled) {
    return
  }

  const tenantKey = getRequestTenantKey(req, config)
  const allowedTenants = req.sentraPrincipal?.tenants || []
  if (!tenantKey || allowedTenants.length === 0) {
    return
  }

  if (!allowedTenants.includes(tenantKey)) {
    throw new ApiError(403, `Authenticated principal is not allowed to access tenant "${tenantKey}"`)
  }
}

function authorizeActionRequest(req: Request, config: ApiSecurityConfig): void {
  if (!requiresActionAuthority(req)) {
    return
  }

  if (config.rbacEnabled) {
    if (principalHasAnyRole(req.sentraPrincipal, ['operator', 'admin'])) {
      return
    }
    if (!config.rbacActionTokenFallback) {
      throw new ApiError(403, 'Sentra operator or admin role is required for this operation')
    }
  }

  if (!config.actionToken) {
    if (config.rbacEnabled) {
      throw new ApiError(403, 'Sentra operator or admin role is required for this operation')
    }
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

function buildStaticBearerPrincipal(config: ApiSecurityConfig): AuthenticatedPrincipal {
  const roles = uniqueStrings(config.staticBearerRoles)
  return {
    authType: 'static-bearer',
    subject: 'static-bearer',
    actorId: 'static-bearer',
    roles,
    effectiveRoles: deriveEffectiveRoles(roles, config),
    tenantKey: null,
    tenants: [],
  }
}

async function verifyOidcBearerToken(
  token: string,
  config: ApiSecurityConfig,
): Promise<AuthenticatedPrincipal> {
  if (!config.oidcIssuer || !config.oidcAudience) {
    throw new ApiError(500, 'OIDC authentication is enabled but issuer or audience is missing')
  }

  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new ApiError(401, 'Bearer token is not a valid OIDC JWT')
  }

  const header = decodeJwtPart<JwtHeader>(parts[0], 'JWT header')
  const claims = decodeJwtPart<JwtClaims>(parts[1], 'JWT claims')
  const alg = typeof header.alg === 'string' ? header.alg : ''
  const kid = typeof header.kid === 'string' ? header.kid : null
  if (!alg || alg.toLowerCase() === 'none') {
    throw new ApiError(401, 'OIDC JWT must use a signed algorithm')
  }

  validateOidcClaims(claims, config)

  const jwksUrl = await resolveOidcJwksUrl(config)
  const keys = await loadOidcJwks(jwksUrl, config)
  const key = selectOidcKey(keys, kid, alg)
  if (!verifyJwtSignature(`${parts[0]}.${parts[1]}`, parts[2], alg, key)) {
    throw new ApiError(401, 'OIDC JWT signature verification failed')
  }

  return buildOidcPrincipal(claims, config)
}

function validateOidcClaims(claims: JwtClaims, config: ApiSecurityConfig): void {
  if (claims.iss !== config.oidcIssuer) {
    throw new ApiError(401, 'OIDC JWT issuer is not trusted')
  }

  if (!claimAudienceIncludes(claims.aud, config.oidcAudience || '')) {
    throw new ApiError(401, 'OIDC JWT audience is not allowed')
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const tolerance = config.oidcClockToleranceSec
  const exp = numberClaim(claims.exp)
  if (exp === null || exp + tolerance < nowSec) {
    throw new ApiError(401, 'OIDC JWT is expired')
  }

  const nbf = numberClaim(claims.nbf)
  if (nbf !== null && nbf - tolerance > nowSec) {
    throw new ApiError(401, 'OIDC JWT is not active yet')
  }
}

function buildOidcPrincipal(
  claims: JwtClaims,
  config: ApiSecurityConfig,
): AuthenticatedPrincipal {
  const subject = claimStringAtPath(claims, config.oidcSubjectClaim) || claimStringAtPath(claims, 'sub')
  if (!subject) {
    throw new ApiError(401, 'OIDC JWT is missing a subject')
  }

  const actorId =
    claimStringAtPath(claims, config.oidcActorClaim) ||
    claimStringAtPath(claims, 'preferred_username') ||
    claimStringAtPath(claims, 'email') ||
    subject
  const roleClaims = [
    ...claimStringListAtPath(claims, config.oidcRolesClaim),
    ...claimStringListAtPath(claims, 'scope'),
    ...claimStringListAtPath(claims, 'scp'),
  ]
  const tenantClaims = uniqueStrings([
    ...claimStringListAtPath(claims, config.oidcTenantClaim),
    ...claimStringListAtPath(claims, config.oidcTenantsClaim),
  ])

  return {
    authType: 'oidc',
    subject,
    actorId,
    roles: uniqueStrings(roleClaims),
    effectiveRoles: deriveEffectiveRoles(roleClaims, config),
    tenantKey: tenantClaims[0] || null,
    tenants: tenantClaims,
    claims,
  }
}

function deriveEffectiveRoles(
  roles: string[],
  config: ApiSecurityConfig,
): EffectiveRole[] {
  const normalized = new Set(roles.map(normalizeRole))
  const effective = new Set<EffectiveRole>()

  if (matchesConfiguredRole(normalized, config.rbacAdminRoles)) {
    effective.add('admin')
    effective.add('operator')
    effective.add('viewer')
  }
  if (matchesConfiguredRole(normalized, config.rbacOperatorRoles)) {
    effective.add('operator')
    effective.add('viewer')
  }
  if (matchesConfiguredRole(normalized, config.rbacViewerRoles)) {
    effective.add('viewer')
  }

  return Array.from(effective)
}

function principalHasAnyRole(
  principal: AuthenticatedPrincipal | undefined,
  roles: EffectiveRole[],
): boolean {
  if (!principal) {
    return false
  }
  return roles.some((role) => principal.effectiveRoles.includes(role))
}

function matchesConfiguredRole(actualRoles: Set<string>, configuredRoles: string[]): boolean {
  return configuredRoles.some((role) => actualRoles.has(normalizeRole(role)))
}

function normalizeRole(role: string): string {
  return role.trim().toLowerCase()
}

async function resolveOidcJwksUrl(config: ApiSecurityConfig): Promise<string> {
  if (config.oidcJwksUrl) {
    return config.oidcJwksUrl
  }

  if (!config.oidcDiscoveryUrl) {
    throw new ApiError(500, 'OIDC authentication is enabled but JWKS URL is missing')
  }

  const now = Date.now()
  const cached = oidcDiscoveryCache.get(config.oidcDiscoveryUrl)
  if (cached && cached.expiresAt > now) {
    return cached.jwksUrl
  }

  const discovery = await fetchJson<Record<string, unknown>>(
    config.oidcDiscoveryUrl,
    'OIDC discovery document',
  )
  const jwksUrl = typeof discovery.jwks_uri === 'string' ? discovery.jwks_uri : null
  if (!jwksUrl) {
    throw new ApiError(503, 'OIDC discovery document did not include jwks_uri')
  }

  oidcDiscoveryCache.set(config.oidcDiscoveryUrl, {
    jwksUrl,
    expiresAt: now + config.oidcJwksCacheTtlSec * 1000,
  })
  return jwksUrl
}

async function loadOidcJwks(
  jwksUrl: string,
  config: ApiSecurityConfig,
): Promise<JsonWebKeyRecord[]> {
  const now = Date.now()
  const cached = oidcJwksCache.get(jwksUrl)
  if (cached && cached.expiresAt > now) {
    return cached.keys
  }

  const jwks = await fetchJson<Record<string, unknown>>(jwksUrl, 'OIDC JWKS')
  const keys = Array.isArray(jwks.keys) ? jwks.keys.filter(isJsonWebKeyRecord) : []
  if (keys.length === 0) {
    throw new ApiError(503, 'OIDC JWKS did not include usable signing keys')
  }

  oidcJwksCache.set(jwksUrl, {
    keys,
    expiresAt: now + config.oidcJwksCacheTtlSec * 1000,
  })
  return keys
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    })
  } catch {
    throw new ApiError(503, `${label} could not be fetched`)
  }

  if (!response.ok) {
    throw new ApiError(503, `${label} could not be fetched`)
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError(503, `${label} was not valid JSON`)
  }
}

function selectOidcKey(
  keys: JsonWebKeyRecord[],
  kid: string | null,
  alg: string,
): JsonWebKeyRecord {
  const candidates = keys.filter((key) => {
    if (key.use && key.use !== 'sig') {
      return false
    }
    if (key.alg && key.alg !== alg) {
      return false
    }
    return kid ? key.kid === kid : true
  })

  const selected = candidates[0]
  if (!selected) {
    throw new ApiError(401, 'OIDC JWT signing key was not found')
  }
  return selected
}

function verifyJwtSignature(
  signingInput: string,
  encodedSignature: string,
  alg: string,
  key: JsonWebKeyRecord,
): boolean {
  const verifyAlg = nodeVerifyAlgorithm(alg)
  const publicKey = createPublicKey({
    key: key as unknown as JsonWebKey,
    format: 'jwk',
  })
  const verifier = createVerify(verifyAlg)
  verifier.update(signingInput)
  verifier.end()
  return verifier.verify(publicKey, Buffer.from(encodedSignature, 'base64url'))
}

function nodeVerifyAlgorithm(alg: string): string {
  switch (alg) {
    case 'RS256':
      return 'RSA-SHA256'
    case 'RS384':
      return 'RSA-SHA384'
    case 'RS512':
      return 'RSA-SHA512'
    default:
      throw new ApiError(401, `Unsupported OIDC JWT algorithm: ${alg}`)
  }
}

function decodeJwtPart<T>(value: string, label: string): T {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T
  } catch {
    throw new ApiError(401, `${label} was not valid JSON`)
  }
}

function claimAudienceIncludes(value: unknown, expected: string): boolean {
  if (typeof value === 'string') {
    return value === expected
  }
  if (Array.isArray(value)) {
    return value.includes(expected)
  }
  return false
}

function claimStringAtPath(claims: JwtClaims, path: string): string | null {
  const value = valueAtPath(claims, path)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function claimStringListAtPath(claims: JwtClaims, path: string): string[] {
  const value = valueAtPath(claims, path)
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .flatMap(splitClaimString)
  }
  if (typeof value === 'string') {
    return splitClaimString(value)
  }
  return []
}

function splitClaimString(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function valueAtPath(value: Record<string, unknown>, path: string): unknown {
  if (!path) {
    return undefined
  }

  let current: unknown = value
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function numberClaim(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isOidcConfigured(config: ApiSecurityConfig): boolean {
  return Boolean(config.oidcIssuer || config.oidcAudience || config.oidcJwksUrl || config.oidcDiscoveryUrl)
}

function isJsonWebKeyRecord(value: unknown): value is JsonWebKeyRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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

function positiveIntEnv(key: string, fallback: number): number {
  const value = optionalEnv(key)
  if (value === null) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function csvEnv(key: string, fallback: string[]): string[] {
  const value = optionalEnv(key)
  if (value === null) {
    return fallback
  }

  const parsed = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return parsed.length > 0 ? parsed : fallback
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
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
