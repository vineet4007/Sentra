import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Server } from 'node:http'
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto'
import express, { type Express } from 'express'
import { sendErrorResponse } from './http.js'
import {
  createActionAuthorityMiddleware,
  createApiSecurityMiddleware,
  getActionActor,
  getAuthenticatedPrincipal,
  getRequestTenantKey,
  resetOidcSecurityCacheForTest,
} from './security.js'

type SecurityConfig = NonNullable<Parameters<typeof createApiSecurityMiddleware>[0]>

type StartedApp = {
  baseUrl: string
  close: () => Promise<void>
}

const baseConfig: SecurityConfig = {
  bearerToken: 'read-token',
  requireTenant: false,
  defaultTenant: null,
  tenantHeader: 'x-sentra-tenant',
  actionToken: 'write-token',
  actionHeader: 'x-sentra-action-token',
  actionActorHeader: 'x-sentra-actor',
  oidcIssuer: null,
  oidcAudience: null,
  oidcJwksUrl: null,
  oidcDiscoveryUrl: null,
  oidcClockToleranceSec: 60,
  oidcJwksCacheTtlSec: 300,
  oidcSubjectClaim: 'sub',
  oidcActorClaim: 'email',
  oidcRolesClaim: 'roles',
  oidcTenantClaim: 'tenant',
  oidcTenantsClaim: 'tenants',
  rbacEnabled: false,
  rbacActionTokenFallback: true,
  rbacViewerRoles: ['viewer', 'sentra:viewer'],
  rbacOperatorRoles: ['operator', 'sentra:operator'],
  rbacAdminRoles: ['admin', 'sentra:admin'],
  staticBearerRoles: ['admin'],
}

test('API security middleware rejects missing bearer tokens', async () => {
  const app = await startSecureApp(baseConfig)

  try {
    const response = await fetch(`${app.baseUrl}/projects`)

    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), {
      ok: false,
      error: {
        message: 'Missing bearer token',
        details: null,
      },
    })
  } finally {
    await app.close()
  }
})

test('API security middleware enforces tenant scope when required', async () => {
  const app = await startSecureApp({
    ...baseConfig,
    requireTenant: true,
    defaultTenant: null,
  })

  try {
    const response = await fetch(`${app.baseUrl}/projects`, {
      headers: {
        Authorization: 'Bearer read-token',
      },
    })

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
      ok: false,
      error: {
        message: 'Missing tenant scope. Provide x-sentra-tenant or configure SENTRA_DEFAULT_TENANT.',
        details: null,
      },
    })
  } finally {
    await app.close()
  }
})

test('action authority middleware protects mutating operator routes', async () => {
  const app = await startSecureApp(baseConfig)

  try {
    const denied = await fetch(`${app.baseUrl}/projects`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer read-token',
      },
    })

    assert.equal(denied.status, 403)
    assert.equal((await denied.json()).error.message, 'Sentra action authority is required for this operation. Provide x-sentra-action-token from a trusted operator session.')

    const allowed = await fetch(`${app.baseUrl}/projects`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer read-token',
        'X-Sentra-Action-Token': 'write-token',
      },
    })

    assert.equal(allowed.status, 200)
    assert.deepEqual(await allowed.json(), { ok: true })
  } finally {
    await app.close()
  }
})

test('action authority middleware leaves satellite machine routes available', async () => {
  const app = await startSecureApp(baseConfig)

  try {
    const response = await fetch(`${app.baseUrl}/satellites/heartbeat`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer read-token',
      },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  } finally {
    await app.close()
  }
})

test('RBAC treats static bearer access as configured read-only roles', async () => {
  const config: SecurityConfig = {
    ...baseConfig,
    actionToken: null,
    rbacEnabled: true,
    rbacActionTokenFallback: false,
    staticBearerRoles: ['viewer'],
  }
  const app = await startSecureApp(config)

  try {
    const read = await fetch(`${app.baseUrl}/projects`, {
      headers: {
        Authorization: 'Bearer read-token',
      },
    })
    assert.equal(read.status, 200)

    const write = await fetch(`${app.baseUrl}/projects`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer read-token',
      },
    })
    assert.equal(write.status, 403)
    assert.equal((await write.json()).error.message, 'Sentra operator or admin role is required for this operation')
  } finally {
    await app.close()
  }
})

test('OIDC bearer token grants RBAC read access with tenant claim', async () => {
  const oidc = await startOidcFixture()
  const config: SecurityConfig = {
    ...baseConfig,
    bearerToken: null,
    actionToken: null,
    oidcIssuer: oidc.issuer,
    oidcAudience: oidc.audience,
    oidcJwksUrl: oidc.jwksUrl,
    oidcDiscoveryUrl: null,
    rbacEnabled: true,
    requireTenant: true,
    defaultTenant: null,
  }
  const app = await startApp((candidate) => {
    candidate.use(createApiSecurityMiddleware(config))
    candidate.get('/projects', (req, res) =>
      res.json({
        ok: true,
        actor: getActionActor(req, config),
        tenant: getRequestTenantKey(req, config),
        roles: getAuthenticatedPrincipal(req)?.effectiveRoles || [],
      }),
    )
    candidate.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      sendErrorResponse(res, error)
    })
  })

  try {
    const token = oidc.signToken({
      sub: 'user-1',
      email: 'reader@example.com',
      roles: ['sentra:viewer'],
      tenant: 'tenant-a',
    })
    const response = await fetch(`${app.baseUrl}/projects`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      ok: true,
      actor: 'reader@example.com',
      tenant: 'tenant-a',
      roles: ['viewer'],
    })
  } finally {
    await app.close()
    await oidc.close()
    resetOidcSecurityCacheForTest()
  }
})

test('RBAC rejects viewer tokens for mutating operator routes', async () => {
  const oidc = await startOidcFixture()
  const config: SecurityConfig = {
    ...baseConfig,
    bearerToken: null,
    actionToken: null,
    oidcIssuer: oidc.issuer,
    oidcAudience: oidc.audience,
    oidcJwksUrl: oidc.jwksUrl,
    oidcDiscoveryUrl: null,
    rbacEnabled: true,
    rbacActionTokenFallback: false,
  }
  const app = await startSecureApp(config)

  try {
    const token = oidc.signToken({
      sub: 'user-2',
      email: 'viewer@example.com',
      roles: ['sentra:viewer'],
    })
    const response = await fetch(`${app.baseUrl}/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    assert.equal(response.status, 403)
    assert.equal((await response.json()).error.message, 'Sentra operator or admin role is required for this operation')
  } finally {
    await app.close()
    await oidc.close()
    resetOidcSecurityCacheForTest()
  }
})

test('RBAC allows OIDC operator tokens to write without shared action token', async () => {
  const oidc = await startOidcFixture()
  const config: SecurityConfig = {
    ...baseConfig,
    bearerToken: null,
    actionToken: null,
    oidcIssuer: oidc.issuer,
    oidcAudience: oidc.audience,
    oidcJwksUrl: oidc.jwksUrl,
    oidcDiscoveryUrl: null,
    rbacEnabled: true,
    rbacActionTokenFallback: false,
  }
  const app = await startApp((candidate) => {
    candidate.use(createApiSecurityMiddleware(config))
    candidate.use(createActionAuthorityMiddleware(config))
    candidate.post('/projects', (req, res) =>
      res.json({
        ok: true,
        actor: getActionActor(req, config),
        roles: getAuthenticatedPrincipal(req)?.effectiveRoles || [],
      }),
    )
    candidate.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      sendErrorResponse(res, error)
    })
  })

  try {
    const token = oidc.signToken({
      sub: 'user-3',
      email: 'operator@example.com',
      roles: ['sentra:operator'],
    })
    const response = await fetch(`${app.baseUrl}/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      ok: true,
      actor: 'operator@example.com',
      roles: ['operator', 'viewer'],
    })
  } finally {
    await app.close()
    await oidc.close()
    resetOidcSecurityCacheForTest()
  }
})

test('RBAC enforces tenant claims against requested tenant header', async () => {
  const oidc = await startOidcFixture()
  const config: SecurityConfig = {
    ...baseConfig,
    bearerToken: null,
    actionToken: null,
    oidcIssuer: oidc.issuer,
    oidcAudience: oidc.audience,
    oidcJwksUrl: oidc.jwksUrl,
    oidcDiscoveryUrl: null,
    rbacEnabled: true,
    requireTenant: true,
    defaultTenant: null,
  }
  const app = await startSecureApp(config)

  try {
    const token = oidc.signToken({
      sub: 'user-4',
      email: 'tenant-reader@example.com',
      roles: ['sentra:viewer'],
      tenants: ['tenant-a'],
    })
    const response = await fetch(`${app.baseUrl}/projects`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-sentra-tenant': 'tenant-b',
      },
    })

    assert.equal(response.status, 403)
    assert.equal(
      (await response.json()).error.message,
      'Authenticated principal is not allowed to access tenant "tenant-b"',
    )
  } finally {
    await app.close()
    await oidc.close()
    resetOidcSecurityCacheForTest()
  }
})

async function startSecureApp(config: SecurityConfig): Promise<StartedApp> {
  return startApp((candidate) => {
    candidate.use(createApiSecurityMiddleware(config))
    candidate.use(createActionAuthorityMiddleware(config))
    candidate.get('/projects', (_req, res) => res.json({ ok: true }))
    candidate.post('/projects', (_req, res) => res.json({ ok: true }))
    candidate.post('/satellites/heartbeat', (_req, res) => res.json({ ok: true }))
    candidate.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      sendErrorResponse(res, error)
    })
  })
}

type OidcFixture = {
  issuer: string
  audience: string
  jwksUrl: string
  signToken: (claims: Record<string, unknown>) => string
  close: () => Promise<void>
}

async function startOidcFixture(): Promise<OidcFixture> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })
  const kid = `test-key-${Math.random().toString(16).slice(2)}`
  const audience = 'sentra-api-test'
  const publicJwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>
  publicJwk.kid = kid
  publicJwk.alg = 'RS256'
  publicJwk.use = 'sig'

  let issuer = ''
  const app = await startApp((candidate) => {
    candidate.get('/.well-known/openid-configuration', (_req, res) => {
      res.json({
        issuer,
        jwks_uri: `${issuer}/jwks`,
      })
    })
    candidate.get('/jwks', (_req, res) => {
      res.json({
        keys: [publicJwk],
      })
    })
  })
  issuer = app.baseUrl

  return {
    issuer,
    audience,
    jwksUrl: `${issuer}/jwks`,
    signToken: (claims) => signOidcToken(privateKey, kid, issuer, audience, claims),
    close: app.close,
  }
}

function signOidcToken(
  privateKey: KeyObject,
  kid: string,
  issuer: string,
  audience: string,
  claims: Record<string, unknown>,
): string {
  const nowSec = Math.floor(Date.now() / 1000)
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid,
  }
  const payload = {
    iss: issuer,
    aud: audience,
    iat: nowSec,
    exp: nowSec + 300,
    ...claims,
  }
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  signer.end()
  return `${signingInput}.${signer.sign(privateKey).toString('base64url')}`
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

async function startApp(configure: (app: Express) => void): Promise<StartedApp> {
  const app = express()
  configure(app)

  const server = await new Promise<Server>((resolve, reject) => {
    const candidate = app.listen(0, '127.0.0.1', () => resolve(candidate))
    candidate.on('error', reject)
  })

  const address = server.address()
  assert(address && typeof address === 'object')

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      }),
  }
}
