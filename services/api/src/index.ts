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

const app = express()
const port = process.env.API_PORT ? Number(process.env.API_PORT) : 8080

app.use(express.json())
app.use('/health', healthRouter)
app.use('/projects', projectRouter)
app.use('/environments', environmentRouter)
app.use('/integrations', integrationRouter)
app.use('/policies', policyRouter)
app.use('/deployments', deploymentRouter)
app.use('/rollouts', rolloutRouter)

app.get('/events', async (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  // @ts-ignore
  res.flushHeaders?.()
  res.write(`event: connected\ndata: {"status":"ok"}\n\n`)

  const liveStates = await listRolloutLiveStates()
  res.write(`event: rollout_snapshot\ndata: ${JSON.stringify({ count: liveStates.length, items: liveStates })}\n\n`)

  const unsubscribe = await createRolloutEventSubscriber((event) => {
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
