import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { Server } from 'node:http'
import express, { type Express } from 'express'
import {
  createCorsMiddleware,
  createRateLimitMiddleware,
  resetRateLimitBucketsForTest,
} from './middleware.js'

type StartedApp = {
  baseUrl: string
  close: () => Promise<void>
}

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  resetRateLimitBucketsForTest()
})

test('cors middleware allows configured browser origins', async () => {
  process.env.SENTRA_CORS_ORIGINS = 'http://allowed.example'

  const app = await startApp((candidate) => {
    candidate.use(createCorsMiddleware())
    candidate.get('/ok', (_req, res) => res.json({ ok: true }))
  })

  try {
    const response = await fetch(`${app.baseUrl}/ok`, {
      headers: {
        Origin: 'http://allowed.example',
      },
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://allowed.example')
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
  } finally {
    await app.close()
  }
})

test('cors middleware rejects preflight requests from blocked origins', async () => {
  process.env.SENTRA_CORS_ORIGINS = 'http://allowed.example'

  const app = await startApp((candidate) => {
    candidate.use(createCorsMiddleware())
    candidate.post('/write', (_req, res) => res.json({ ok: true }))
  })

  try {
    const response = await fetch(`${app.baseUrl}/write`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://blocked.example',
        'Access-Control-Request-Method': 'POST',
      },
    })

    assert.equal(response.status, 403)
    assert.equal(response.headers.get('access-control-allow-origin'), null)
  } finally {
    await app.close()
  }
})

test('rate limiter returns 429 after the configured request cap', async () => {
  process.env.SENTRA_RATE_LIMIT_ENABLED = 'true'
  process.env.SENTRA_RATE_LIMIT_WINDOW_SEC = '60'
  process.env.SENTRA_RATE_LIMIT_MAX = '2'

  const app = await startApp((candidate) => {
    candidate.set('trust proxy', true)
    candidate.use(createRateLimitMiddleware())
    candidate.get('/limited', (_req, res) => res.json({ ok: true }))
  })

  try {
    const request = () =>
      fetch(`${app.baseUrl}/limited`, {
        headers: {
          'X-Forwarded-For': '203.0.113.42',
        },
      })

    assert.equal((await request()).status, 200)
    assert.equal((await request()).status, 200)

    const limited = await request()
    assert.equal(limited.status, 429)
    assert.equal(limited.headers.get('retry-after'), '60')
    assert.deepEqual(await limited.json(), {
      ok: false,
      error: {
        message: 'Too many requests',
        details: {
          retryAfterSec: 60,
        },
      },
    })
  } finally {
    await app.close()
  }
})

test('rate limiter skips health checks', async () => {
  process.env.SENTRA_RATE_LIMIT_ENABLED = 'true'
  process.env.SENTRA_RATE_LIMIT_MAX = '1'

  const app = await startApp((candidate) => {
    candidate.use(createRateLimitMiddleware())
    candidate.get('/health', (_req, res) => res.json({ status: 'ok' }))
  })

  try {
    assert.equal((await fetch(`${app.baseUrl}/health`)).status, 200)
    assert.equal((await fetch(`${app.baseUrl}/health`)).status, 200)
  } finally {
    await app.close()
  }
})

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
