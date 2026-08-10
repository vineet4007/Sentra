import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { Server } from 'node:http'
import express, { type Express } from 'express'
import { createCorsMiddleware, createRateLimitMiddleware, resetRateLimitBucketsForTest } from './middleware.js'
import {
  createApiSecurityMiddleware,
  createActionAuthorityMiddleware,
  getRequestTenantKey,
} from './security.js'
import { sendErrorResponse } from './http.js'
import { createSecureHeadersMiddleware } from './secure-headers.js'
import { createIncidentRouter, type IncidentRouterDependencies } from './routes/incidents.js'

type StartedApp = {
  baseUrl: string
  server: Server
  close: () => Promise<void>
}

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  resetRateLimitBucketsForTest()
})

const defaultSecurityConfig = {
  bearerToken: null as string | null,
  requireTenant: false,
  defaultTenant: null as string | null,
  tenantHeader: 'x-sentra-tenant',
  actionToken: null as string | null,
  actionHeader: 'x-sentra-action-token',
  actionActorHeader: 'x-sentra-actor',
  oidcIssuer: null as string | null,
  oidcAudience: null as string | null,
  oidcJwksUrl: null as string | null,
  oidcDiscoveryUrl: null as string | null,
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

type FakeIncidentRow = {
  id: number
  deploymentId: number
  rolloutStepId: number | null
  incidentType: string
  severity: string
  status: string
  summary: string
  details: string | null
  detectedAt: Date
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type FakeIncidentActionRow = {
  id: number
  incidentId: number
  deploymentId: number
  actionType: string
  actorId: string | null
  note: string | null
  details: string | null
  createdAt: Date
}

function createFakeIncidentDeps(
  incidents: FakeIncidentRow[],
  actions: FakeIncidentActionRow[] = [],
) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  let nextActionId = actions.reduce((max, action) => Math.max(max, action.id), 0) + 1

  const selectRows = (sql: string, params: unknown[]) => {
    if (sql.includes('FROM incident_actions')) {
      const ids = new Set(params.map(Number))
      return actions.filter((action) => ids.has(action.incidentId))
    }
    if (sql.includes('FROM incidents')) {
      const incidentId = Number(params[0])
      if (sql.includes('WHERE i.id = ?')) {
        return incidents.filter((incident) => incident.id === incidentId)
      }
      return incidents
    }
    return []
  }

  const connection = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      return [selectRows(sql, params), []]
    },
    execute: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })

      if (sql.includes("SET status = 'acknowledged'")) {
        const incident = incidents.find((candidate) => candidate.id === Number(params[0]))
        if (incident) {
          incident.status = 'acknowledged'
          incident.updatedAt = new Date('2026-08-10T12:10:00.000Z')
        }
      }

      if (sql.includes("SET status = 'resolved'")) {
        const incident = incidents.find((candidate) => candidate.id === Number(params[0]))
        if (incident) {
          incident.status = 'resolved'
          incident.resolvedAt = new Date('2026-08-10T12:11:00.000Z')
          incident.updatedAt = new Date('2026-08-10T12:11:00.000Z')
        }
      }

      if (sql.includes('INSERT INTO incident_actions')) {
        actions.push({
          id: nextActionId++,
          incidentId: Number(params[0]),
          deploymentId: Number(params[1]),
          actionType: String(params[2]),
          actorId: params[3] === null ? null : String(params[3]),
          note: params[4] === null ? null : String(params[4]),
          details: params[5] === null ? null : String(params[5]),
          createdAt: new Date('2026-08-10T12:12:00.000Z'),
        })
      }

      return [{ affectedRows: 1, insertId: nextActionId - 1 }, []]
    },
  }

  const deps: IncidentRouterDependencies = {
    queryRows: async (sql, params = []) => {
      calls.push({ sql, params })
      return selectRows(sql, params) as never
    },
    withTransaction: async (fn) => fn(connection as never),
  }

  return { deps, calls, actions }
}

function fakeIncident(overrides: Partial<FakeIncidentRow> = {}): FakeIncidentRow {
  return {
    id: 11,
    deploymentId: 3,
    rolloutStepId: 22,
    incidentType: 'slo_breach',
    severity: 'critical',
    status: 'open',
    summary: 'Candidate error rate breached rollback threshold',
    details: JSON.stringify({
      title: 'Rollback threshold breached',
      description: 'Candidate crossed the configured error-rate SLO.',
      events: [{ type: 'gate_failure', message: 'error_rate too high' }],
    }),
    detectedAt: new Date('2026-08-10T12:00:00.000Z'),
    resolvedAt: null,
    createdAt: new Date('2026-08-10T12:00:00.000Z'),
    updatedAt: new Date('2026-08-10T12:00:00.000Z'),
    ...overrides,
  }
}

async function startApp(
  configurer: (app: Express) => void,
  securityConfig: typeof defaultSecurityConfig = defaultSecurityConfig,
): Promise<StartedApp> {
  const app = express()

  if (process.env.SENTRA_TRUST_PROXY?.trim().toLowerCase() === 'true') {
    app.set('trust proxy', 1)
  }

  app.disable('x-powered-by')
  app.use(createSecureHeadersMiddleware())
  app.use(createCorsMiddleware())
  app.get('/health', (_req, res) => res.json({ status: 'ok' }))
  app.use(createRateLimitMiddleware())
  app.use(express.json({ limit: process.env.SENTRA_JSON_BODY_LIMIT || '1mb' }))
  app.use(createApiSecurityMiddleware(securityConfig))
  app.use(createActionAuthorityMiddleware(securityConfig))

  configurer(app)
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    sendErrorResponse(res, error)
  })

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get server address'))
        return
      }
      const baseUrl = `http://localhost:${addr.port}`
      resolve({
        baseUrl,
        server,
        close: async () => {
          return new Promise((closeResolve, closeReject) => {
            server.close((err) => {
              if (err) closeReject(err)
              else closeResolve(undefined)
            })
          })
        },
      })
    })
  })
}

test('GET /health returns ok status', async () => {
  const app = await startApp(() => {})
  try {
    const response = await fetch(`${app.baseUrl}/health`)
    assert.equal(response.status, 200)
    const json = (await response.json()) as Record<string, any>
    assert.equal(json.status, 'ok')
  } finally {
    await app.close()
  }
})

test('protected routes require bearer authentication when configured', async () => {
  const app = await startApp(
    (candidate) => {
      candidate.get('/protected', (_req, res) => res.json({ ok: true }))
    },
    {
      ...defaultSecurityConfig,
      bearerToken: 'test-token',
    },
  )
  try {
    const response = await fetch(`${app.baseUrl}/protected`)
    assert.equal(response.status, 401)
    const json = (await response.json()) as Record<string, any>
    assert.equal(json.error.message, 'Missing bearer token')
  } finally {
    await app.close()
  }
})

test('protected routes accept a valid bearer token', async () => {
  const app = await startApp(
    (candidate) => {
      candidate.get('/protected', (_req, res) => res.json({ ok: true }))
    },
    {
      ...defaultSecurityConfig,
      bearerToken: 'test-token',
    },
  )
  try {
    const response = await fetch(`${app.baseUrl}/protected`, {
      headers: {
        Authorization: 'Bearer test-token',
      },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  } finally {
    await app.close()
  }
})

test('mutating operator routes require action authority token', async () => {
  const app = await startApp(
    (candidate) => {
      candidate.post('/write', (_req, res) => res.json({ ok: true }))
    },
    {
      ...defaultSecurityConfig,
      bearerToken: 'test-token',
      actionToken: 'action-token',
    },
  )
  try {
    const response = await fetch(`${app.baseUrl}/write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        name: 'new-project',
      }),
    })
    assert.equal(response.status, 403)
    const json = (await response.json()) as Record<string, any>
    assert.match(json.error.message, /action authority/)
  } finally {
    await app.close()
  }
})

test('mutating operator routes accept action authority token', async () => {
  const app = await startApp(
    (candidate) => {
      candidate.post('/write', (_req, res) => res.json({ ok: true }))
    },
    {
      ...defaultSecurityConfig,
      bearerToken: 'test-token',
      actionToken: 'action-token',
    },
  )
  try {
    const response = await fetch(`${app.baseUrl}/write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
        'x-sentra-action-token': 'action-token',
      },
      body: JSON.stringify({
        name: 'new-project',
      }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  } finally {
    await app.close()
  }
})

test('bearer token auth validates token format', async () => {
  const app = await startApp(
    (candidate) => {
      candidate.get('/protected', (_req, res) => res.json({ ok: true }))
    },
    {
      ...defaultSecurityConfig,
      bearerToken: 'valid-token',
    },
  )
  try {
    const response = await fetch(`${app.baseUrl}/protected`, {
      headers: {
        Authorization: 'InvalidFormat token-value',
      },
    })
    assert.equal(response.status, 401)
  } finally {
    await app.close()
  }
})

test('Rate limiter enforces request limits', async () => {
  process.env.SENTRA_RATE_LIMIT_WINDOW_SEC = '60'
  process.env.SENTRA_RATE_LIMIT_MAX = '3'
  const app = await startApp((candidate) => {
    candidate.get('/test', (_req, res) => res.json({ ok: true }))
  })
  try {
    // Make 3 requests (should pass)
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${app.baseUrl}/test`)
      assert.equal(response.status, 200)
    }
    // 4th request should fail
    const response = await fetch(`${app.baseUrl}/test`)
    assert.equal(response.status, 429)
  } finally {
    await app.close()
  }
})

test('API enforces JSON body size limit', async () => {
  process.env.SENTRA_JSON_BODY_LIMIT = '100b'
  const app = await startApp((candidate) => {
    candidate.post('/echo', (_req, res) => res.json({ ok: true }))
  })
  try {
    const largeBody = JSON.stringify({
      projectName: 'test-project',
      services: [{ name: 'service', config: 'x'.repeat(500) }],
    })
    const response = await fetch(`${app.baseUrl}/echo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: largeBody,
    })
    assert.equal(response.status, 413) // Payload Too Large
  } finally {
    await app.close()
  }
})

test('CORS middleware validates origin', async () => {
  process.env.SENTRA_CORS_ORIGINS = 'https://allowed.example.com'
  const app = await startApp((candidate) => {
    candidate.get('/test', (_req, res) => res.json({ ok: true }))
  })
  try {
    const response = await fetch(`${app.baseUrl}/test`, {
      headers: {
        Origin: 'https://allowed.example.com',
      },
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://allowed.example.com')
  } finally {
    await app.close()
  }
})

test('CORS middleware blocks unapproved origins', async () => {
  process.env.SENTRA_CORS_ORIGINS = 'https://allowed.example.com'
  const app = await startApp((candidate) => {
    candidate.post('/write', (_req, res) => res.json({ ok: true }))
  })
  try {
    const response = await fetch(`${app.baseUrl}/write`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://blocked.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    })
    assert.equal(response.status, 403)
    assert(!response.headers.get('access-control-allow-origin'))
  } finally {
    await app.close()
  }
})

test('API validates request content type', async () => {
  const app = await startApp((candidate) => {
    candidate.post('/echo', (_req, res) => res.json({ ok: true }))
  })
  try {
    const response = await fetch(`${app.baseUrl}/echo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{"projectName":',
    })
    assert.equal(response.status, 400)
  } finally {
    await app.close()
  }
})

test('Successful response includes correct headers', async () => {
  const app = await startApp((candidate) => {
    candidate.get('/test', (_req, res) => res.json({ ok: true }))
  })
  try {
    const response = await fetch(`${app.baseUrl}/test`)
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.equal(response.headers.get('x-powered-by'), null) // Should be disabled
  } finally {
    await app.close()
  }
})

test('Tenant key extraction from auth header', async () => {
  const app = await startApp(
    (candidate) => {
      candidate.get('/tenant', (req, res) => res.json({ tenant: getRequestTenantKey(req) }))
    },
    {
      ...defaultSecurityConfig,
      bearerToken: 'test-token',
      requireTenant: true,
      tenantHeader: 'x-sentra-tenant',
    },
  )
  try {
    const response = await fetch(`${app.baseUrl}/tenant`, {
      headers: {
        Authorization: 'Bearer test-token',
        'x-sentra-tenant': 'tenant-123',
      },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { tenant: 'tenant-123' })
  } finally {
    await app.close()
  }
})

test('GET /incidents reads persisted incidents and action history', async () => {
  const incident = fakeIncident()
  const { deps, calls } = createFakeIncidentDeps(
    [incident],
    [
      {
        id: 40,
        incidentId: incident.id,
        deploymentId: incident.deploymentId,
        actionType: 'note_added',
        actorId: 'operator-a',
        note: 'Checking the deployment logs.',
        details: JSON.stringify({ noteLength: 29 }),
        createdAt: new Date('2026-08-10T12:05:00.000Z'),
      },
    ],
  )
  const securityConfig = {
    ...defaultSecurityConfig,
    requireTenant: true,
  }
  const app = await startApp((candidate) => {
    candidate.use('/incidents', createIncidentRouter(deps, securityConfig))
  }, securityConfig)

  try {
    const response = await fetch(`${app.baseUrl}/incidents?deploymentId=3&limit=2`, {
      headers: {
        'x-sentra-tenant': 'tenant-a',
      },
    })

    assert.equal(response.status, 200)
    const payload = (await response.json()) as Record<string, any>
    assert.equal(payload.ok, true)
    assert.equal(payload.data.count, 1)
    assert.equal(payload.data.items[0].id, incident.id)
    assert.equal(payload.data.items[0].title, 'Rollback threshold breached')
    assert.equal(payload.data.items[0].actions[0].actionType, 'note_added')
    assert.deepEqual(payload.data.items[0].notes, ['Checking the deployment logs.'])
    assert.deepEqual(calls[0].params, [3, 'tenant-a', 2])
  } finally {
    await app.close()
  }
})

test('POST /incidents/:id/acknowledge persists action and audit event', async () => {
  const incident = fakeIncident()
  const { deps, calls } = createFakeIncidentDeps([incident])
  const securityConfig = {
    ...defaultSecurityConfig,
    actionToken: 'action-token',
  }
  const app = await startApp((candidate) => {
    candidate.use('/incidents', createIncidentRouter(deps, securityConfig))
  }, securityConfig)

  try {
    const response = await fetch(`${app.baseUrl}/incidents/${incident.id}/acknowledge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sentra-action-token': 'action-token',
        'x-sentra-actor': 'ops-user',
      },
      body: JSON.stringify({
        assignee: 'primary-oncall',
      }),
    })

    assert.equal(response.status, 200)
    const payload = (await response.json()) as Record<string, any>
    assert.equal(payload.data.status, 'acknowledged')
    assert.equal(payload.data.assignee, 'primary-oncall')
    assert.equal(payload.data.acknowledgedBy, 'ops-user')
    assert.equal(payload.data.actions[0].actionType, 'acknowledged')

    const actionInsert = calls.find((call) => call.sql.includes('INSERT INTO incident_actions'))
    assert(actionInsert)
    assert.deepEqual(actionInsert.params.slice(0, 5), [
      incident.id,
      incident.deploymentId,
      'acknowledged',
      'ops-user',
      null,
    ])
    assert(calls.some((call) => call.sql.includes('INSERT INTO audit_events')))
  } finally {
    await app.close()
  }
})

test('POST /incidents/:id/notes validates note content', async () => {
  const { deps } = createFakeIncidentDeps([fakeIncident()])
  const securityConfig = {
    ...defaultSecurityConfig,
    actionToken: 'action-token',
  }
  const app = await startApp((candidate) => {
    candidate.use('/incidents', createIncidentRouter(deps, securityConfig))
  }, securityConfig)

  try {
    const response = await fetch(`${app.baseUrl}/incidents/11/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sentra-action-token': 'action-token',
      },
      body: JSON.stringify({ note: '' }),
    })

    assert.equal(response.status, 400)
    const payload = (await response.json()) as Record<string, any>
    assert.equal(payload.error.message, '"note" must be a non-empty string')
  } finally {
    await app.close()
  }
})

test('Health endpoint does not require authentication', async () => {
  const app = await startApp(() => {})
  try {
    const response = await fetch(`${app.baseUrl}/health`)
    assert.equal(response.status, 200)
  } finally {
    await app.close()
  }
})

test('Error response includes error message', async () => {
  const app = await startApp((candidate) => {
    candidate.get('/broken', () => {
      throw new Error('boom')
    })
  })
  try {
    const response = await fetch(`${app.baseUrl}/broken`)
    assert.equal(response.status, 500)
    const json = (await response.json()) as Record<string, any>
    assert.equal(json.error.message, 'Internal server error')
  } finally {
    await app.close()
  }
})
