import type { Server } from 'node:http'
import express, { type ErrorRequestHandler, type Response } from 'express'
import { closeDatabasePool, createDatabasePool } from './db.js'
import { createRolloutEventSubscriber, listRolloutLiveStates } from './events.js'
import { asyncHandler, sendErrorResponse } from './http.js'
import { createCorsMiddleware, createRateLimitMiddleware } from './middleware.js'
import aiRouter from './routes/ai.js'
import deploymentRouter from './routes/deployments.js'
import environmentRouter from './routes/environments.js'
import { closeClient, createClient } from './redis.js'
import healthRouter from './routes/health.js'
import integrationRouter from './routes/integrations.js'
import policyRouter from './routes/policies.js'
import projectRouter from './routes/projects.js'
import rolloutRouter from './routes/rollouts.js'
import satelliteRouter from './routes/satellites.js'
import {
  createActionAuthorityMiddleware,
  createApiSecurityMiddleware,
  deploymentBelongsToTenant,
  getApiSecurityConfig,
  getRequestTenantKey,
  listTenantDeploymentIds,
} from './security.js'

const app = express()
const port = process.env.API_PORT ? Number(process.env.API_PORT) : 8080
const security = getApiSecurityConfig()
const activeStreams = new Set<Response>()

if (process.env.SENTRA_TRUST_PROXY?.trim().toLowerCase() === 'true') {
  app.set('trust proxy', 1)
}

app.disable('x-powered-by')
app.use(createCorsMiddleware())
app.use('/health', healthRouter)
app.use(createRateLimitMiddleware())
app.use(express.json({ limit: process.env.SENTRA_JSON_BODY_LIMIT || '1mb' }))
app.use(createApiSecurityMiddleware(security))
app.use(createActionAuthorityMiddleware(security))
app.use('/ai', aiRouter)
app.use('/projects', projectRouter)
app.use('/environments', environmentRouter)
app.use('/integrations', integrationRouter)
app.use('/policies', policyRouter)
app.use('/deployments', deploymentRouter)
app.use('/rollouts', rolloutRouter)
app.use('/satellites', satelliteRouter)

app.get('/events', asyncHandler(async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  // @ts-ignore
  res.flushHeaders?.()
  activeStreams.add(res)
  let unsubscribe: (() => Promise<void>) | null = null
  let heartbeat: NodeJS.Timeout | null = null
  res.on('close', () => {
    activeStreams.delete(res)
    if (heartbeat) {
      clearInterval(heartbeat)
    }
    if (unsubscribe) {
      void unsubscribe()
    }
  })
  res.write(`event: connected\ndata: {"status":"ok"}\n\n`)

  const tenantKey = getRequestTenantKey(req, security)
  let liveStates = await listRolloutLiveStates()
  if (tenantKey) {
    const deploymentIds = await listTenantDeploymentIds(tenantKey)
    const allowed = new Set(deploymentIds)
    liveStates = liveStates.filter(
      (state) => typeof state.deploymentId === 'number' && allowed.has(state.deploymentId),
    )
  }
  res.write(`event: rollout_snapshot\ndata: ${JSON.stringify({ count: liveStates.length, items: liveStates })}\n\n`)

  unsubscribe = await createRolloutEventSubscriber(async (event) => {
    if (
      tenantKey &&
      (typeof event.deploymentId !== 'number' ||
        !(await deploymentBelongsToTenant(event.deploymentId, tenantKey)))
    ) {
      return
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  })

  heartbeat = setInterval(() => {
    res.write(`event: ping\ndata: {"timestamp":"${new Date().toISOString()}"}\n\n`)
  }, 15000)
}))

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  sendErrorResponse(res, error)
}

app.use(errorHandler)

Promise.all([createClient(), createDatabasePool()])
  .then(() => {
    const server = app.listen(port, () => console.log(`[api] listening on :${port}`))
    installShutdownHandlers(server)
  })
  .catch((err) => {
    console.error('[api] startup init failed:', err)
    process.exit(1)
  })

function installShutdownHandlers(server: Server): void {
  let shuttingDown = false
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']

  for (const signal of signals) {
    process.once(signal, () => {
      if (shuttingDown) {
        return
      }
      shuttingDown = true
      void shutdown(signal, server)
    })
  }
}

async function shutdown(signal: NodeJS.Signals, server: Server): Promise<void> {
  const graceMs = positiveIntEnv('SENTRA_SHUTDOWN_GRACE_SEC', 10) * 1000
  console.log(`[api] received ${signal}; shutting down`)
  const timeout = setTimeout(() => {
    console.error('[api] shutdown grace period expired')
    process.exit(1)
  }, graceMs)
  timeout.unref()

  for (const stream of activeStreams) {
    stream.end()
  }

  try {
    await closeServer(server)
    const results = await Promise.allSettled([closeClient(), closeDatabasePool()])
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[api] shutdown cleanup failed:', result.reason)
      }
    }
    clearTimeout(timeout)
    process.exit(0)
  } catch (error) {
    clearTimeout(timeout)
    console.error('[api] shutdown failed:', error)
    process.exit(1)
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function positiveIntEnv(key: string, fallback: number): number {
  const value = process.env[key]
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
