import { Router } from 'express'
import { asyncHandler, ok, requireBodyObject } from '../http.js'
import { validateTelemetryConfig } from '../telemetry.js'

const r = Router()

r.post(
  '/validate',
  asyncHandler(async (req, res) => {
    const body = requireBodyObject(req.body)
    const config =
      body.telemetrySourceConfig &&
      typeof body.telemetrySourceConfig === 'object' &&
      !Array.isArray(body.telemetrySourceConfig)
        ? (body.telemetrySourceConfig as Record<string, unknown>)
        : body

    const validation = await validateTelemetryConfig(config)
    ok(res, validation)
  }),
)

export default r

