import { Router } from 'express'
import { pingDatabase } from '../db.js'
import { getClient } from '../redis.js'

const r = Router()

r.get('/', async (_req, res) => {
  try {
    const pong = await getClient().ping()
    await pingDatabase()
    res.json({ status: 'ok', redis: pong, mysql: 'ok' })
  } catch (e) {
    res.status(500).json({ status: 'error', error: String(e) })
  }
})

export default r
