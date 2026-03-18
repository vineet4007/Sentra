import express from 'express'
import { createDatabasePool } from './db.js'
import { createRolloutEventSubscriber, listRolloutLiveStates } from './events.js'
import deploymentRouter from './routes/deployments.js'
import environmentRouter from './routes/environments.js'
import { createClient } from './redis.js'
import healthRouter from './routes/health.js'
import integrationRouter from './routes/integrations.js'
import policyRouter from './routes/policies.js'
import projectRouter from './routes/projects.js'
import rolloutRouter from './routes/rollouts.js'
import satelliteRouter from './routes/satellites.js'
import {
  createApiSecurityMiddleware,
  deploymentBelongsToTenant,
  getApiSecurityConfig,
  getRequestTenantKey,
  listTenantDeploymentIds,
} from './security.js'

const app = express()
const port = process.env.API_PORT ? Number(process.env.API_PORT) : 8080
const security = getApiSecurityConfig()

app.use(express.json())
app.use('/health', healthRouter)
app.use(createApiSecurityMiddleware(security))
app.use('/projects', projectRouter)
app.use('/environments', environmentRouter)
app.use('/integrations', integrationRouter)
app.use('/policies', policyRouter)
app.use('/deployments', deploymentRouter)
app.use('/rollouts', rolloutRouter)
app.use('/satellites', satelliteRouter)

app.get('/events', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  // @ts-ignore
  res.flushHeaders?.()
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

  const unsubscribe = await createRolloutEventSubscriber(async (event) => {
    if (
      tenantKey &&
      (typeof event.deploymentId !== 'number' ||
        !(await deploymentBelongsToTenant(event.deploymentId, tenantKey)))
    ) {
      return
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  })

  const heartbeat = setInterval(() => {
    res.write(`event: ping\ndata: {"timestamp":"${new Date().toISOString()}"}\n\n`)
  }, 15000)

  res.on('close', () => {
    clearInterval(heartbeat)
    void unsubscribe()
  })
})

Promise.all([createClient(), createDatabasePool()])
  .then(() => {
    app.listen(port, () => console.log(`[api] listening on :${port}`))
  })
  .catch((err) => {
    console.error('[api] startup init failed:', err)
    process.exit(1)
  })
