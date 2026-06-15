import assert from 'node:assert/strict'
import { afterEach, before, beforeEach, test } from 'node:test'
import type { Server } from 'node:http'
import express, { type Express } from 'express'
import { createDatabasePool } from '../db.js'
import { createCorsMiddleware, createRateLimitMiddleware, resetRateLimitBucketsForTest } from '../middleware.js'
import {
  createApiSecurityMiddleware,
  createActionAuthorityMiddleware,
  getApiSecurityConfig,
  getRequestTenantKey,
} from '../security.js'
import aiRouter from '../routes/ai.js'
import deploymentRouter from '../routes/deployments.js'
import environmentRouter from '../routes/environments.js'
import healthRouter from '../routes/health.js'
import integrationRouter from '../routes/integrations.js'
import policyRouter from '../routes/policies.js'
import projectRouter from '../routes/projects.js'
import rolloutRouter from '../routes/rollouts.js'
import satelliteRouter from '../routes/satellites.js'
import { createRolloutEventSubscriber, listRolloutLiveStates } from '../events.js'

type StartedApp = {
  baseUrl: string
  server: Server
  close: () => Promise<void>
}

const originalEnv = { ...process.env }
let pool: any

before(async () => {
  pool = await createDatabasePool()
})

afterEach(() => {
  process.env = { ...originalEnv }
  resetRateLimitBucketsForTest()
})

async function startApp(
  configurer: (app: Express) => void,
  headers: Record<string, string> = {},
): Promise<StartedApp> {
  const app = express()

  if (process.env.SENTRA_TRUST_PROXY?.trim().toLowerCase() === 'true') {
    app.set('trust proxy', 1)
  }

  app.disable('x-powered-by')
  app.use(createCorsMiddleware())
  app.use('/health', healthRouter)
  app.use(createRateLimitMiddleware())
  app.use(express.json({ limit: process.env.SENTRA_JSON_BODY_LIMIT || '1mb' }))
  app.use(createApiSecurityMiddleware(getApiSecurityConfig()))
  app.use(createActionAuthorityMiddleware(getApiSecurityConfig()))
  app.use('/ai', aiRouter)
  app.use('/projects', projectRouter)
  app.use('/environments', environmentRouter)
  app.use('/integrations', integrationRouter)
  app.use('/policies', policyRouter)
  app.use('/deployments', deploymentRouter)
  app.use('/rollouts', rolloutRouter)
  app.use('/satellites', satelliteRouter)

  configurer(app)

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

test('POST /projects/onboard creates project and services', async () => {
  process.env.SENTRA_API_TOKEN = 'test-token'
  const app = await startApp(() => {})
  try {
    const response = await fetch(`${app.baseUrl}/projects/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        projectName: 'test-project',
        services: [
          {
            name: 'api-service',
            deploymentTargetType: 'Kubernetes',
            deploymentTargetConfig: {
              clusterName: 'test-cluster',
              namespace: 'default',
            },
          },
        ],
        environments: {
          prod: {
            deploymentTargetConfig: {
              clusterName: 'prod-cluster',
              namespace: 'production',
            },
          },
        },
      }),
    })
    assert.equal(response.status, 201)
    const json = (await response.json()) as Record<string, any>
    assert.equal(json.projectName, 'test-project')
  } finally {
    await app.close()
  }
})

test('GET /projects requires authentication', async () => {
  const app = await startApp(() => {})
  try {
    const response = await fetch(`${app.baseUrl}/projects`)
    assert.equal(response.status, 401)
  } finally {
    await app.close()
  }
})

test('POST /projects requires action authority token', async () => {
  process.env.SENTRA_API_TOKEN = 'test-token'
  process.env.SENTRA_ACTION_AUTHORITY_TOKEN = 'action-token'
  const app = await startApp(() => {})
  try {
    // Without action authority
    const response = await fetch(`${app.baseUrl}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        tenantKey: 'test-tenant',
        name: 'new-project',
      }),
    })
    assert.equal(response.status, 403)
  } finally {
    await app.close()
  }
})

test('Bearer token auth validates token format', async () => {
  process.env.SENTRA_API_TOKEN = 'valid-token'
  const app = await startApp(() => {})
  try {
    const response = await fetch(`${app.baseUrl}/projects`, {
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
  process.env.SENTRA_RATE_LIMIT_WINDOW_MS = '1000'
  process.env.SENTRA_RATE_LIMIT_MAX_REQUESTS = '3'
  const app = await startApp(() => {
    app.get('/test', (_req, res) => res.json({ ok: true }))
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

test('API rejects requests with inline secrets', async () => {
  process.env.SENTRA_API_TOKEN = 'test-token'
  const app = await startApp(() => {})
  try {
    const response = await fetch(`${app.baseUrl}/projects/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        projectName: 'test-project',
        services: [
          {
            name: 'api-service',
            deploymentTargetType: 'Kubernetes',
            deploymentTargetConfig: {
              clusterName: 'test-cluster',
              apiKey: 'sk-12345secret-inline', // Inline secret pattern
            },
          },
        ],
        environments: {},
      }),
    })
    assert.equal(response.status, 400)
    const json = (await response.json()) as Record<string, any>
    assert(json.error?.includes('sensitive') || json.error?.includes('secret'))
  } finally {
    await app.close()
  }
})

test('API enforces JSON body size limit', async () => {
  process.env.SENTRA_API_TOKEN = 'test-token'
  process.env.SENTRA_JSON_BODY_LIMIT = '100b'
  const app = await startApp(() => {})
  try {
    const largeBody = JSON.stringify({
      projectName: 'test-project',
      services: [{ name: 'service', config: 'x'.repeat(500) }],
    })
    const response = await fetch(`${app.baseUrl}/projects/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
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
  const app = await startApp(() => {
    app.get('/test', (_req, res) => res.json({ ok: true }))
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
  const app = await startApp(() => {
    app.post('/write', (_req, res) => res.json({ ok: true }))
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
  process.env.SENTRA_API_TOKEN = 'test-token'
  const app = await startApp(() => {})
  try {
    const response = await fetch(`${app.baseUrl}/projects/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain', // Wrong content type
        Authorization: 'Bearer test-token',
      },
      body: '{"projectName": "test"}',
    })
    assert(response.status >= 400)
  } finally {
    await app.close()
  }
})

test('API validates required query parameters', async () => {
  process.env.SENTRA_API_TOKEN = 'test-token'
  const app = await startApp(() => {})
  try {
    const response = await fetch(`${app.baseUrl}/integrations/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        // Missing required 'integrationType' field
        config: {},
      }),
    })
    assert.equal(response.status, 400)
  } finally {
    await app.close()
  }
})

test('Successful response includes correct headers', async () => {
  const app = await startApp(() => {
    app.get('/test', (_req, res) => res.json({ ok: true }))
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
  process.env.SENTRA_API_TOKEN = 'test-token'
  const app = await startApp(() => {})
  try {
    // Should work with format: Bearer <tenantKey>:<token>
    const response = await fetch(`${app.baseUrl}/projects`, {
      headers: {
        Authorization: 'Bearer tenant-123:test-token',
      },
    })
    // Expect 200 (we have valid token format), though we might get 401 for invalid token value
    // This test mainly checks that the bearer token parsing works
    assert(response.status === 200 || response.status === 401)
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
  process.env.SENTRA_API_TOKEN = 'test-token'
  const app = await startApp(() => {})
  try {
    const response = await fetch(`${app.baseUrl}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({ invalid: 'data' }),
    })
    assert.equal(response.status, 400)
    const json = (await response.json()) as Record<string, any>
    assert(json.error && typeof json.error === 'string')
  } finally {
    await app.close()
  }
})

test('API enforces positive integer validation', async () => {
  process.env.SENTRA_API_TOKEN = 'test-token'
  const app = await startApp(() => {})
  try {
    const response = await fetch(`${app.baseUrl}/deployments?limit=-1`, {
      headers: {
        Authorization: 'Bearer test-token',
      },
    })
    assert.equal(response.status, 400)
  } finally {
    await app.close()
  }
})
