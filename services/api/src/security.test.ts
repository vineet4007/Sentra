import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Server } from 'node:http'
import express, { type Express } from 'express'
import { sendErrorResponse } from './http.js'
import {
  createActionAuthorityMiddleware,
  createApiSecurityMiddleware,
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
