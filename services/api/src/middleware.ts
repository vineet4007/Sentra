import type { Request, RequestHandler } from 'express'

type CorsConfig = {
  allowedOrigins: string[]
  allowCredentials: boolean
}

type RateLimitConfig = {
  enabled: boolean
  windowMs: number
  maxRequests: number
}

type RateLimitBucket = {
  count: number
  resetsAt: number
}

const DEFAULT_CORS_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000']
const DEFAULT_RATE_LIMIT_WINDOW_SEC = 60
const DEFAULT_RATE_LIMIT_MAX = 600

const buckets = new Map<string, RateLimitBucket>()

export function createCorsMiddleware(): RequestHandler {
  const config = loadCorsConfig()

  return (req, res, next) => {
    const origin = req.header('origin')
    const allowed = isOriginAllowed(origin, config.allowedOrigins)

    res.setHeader('Vary', 'Origin')

    if (origin && allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      if (config.allowCredentials) {
        res.setHeader('Access-Control-Allow-Credentials', 'true')
      }
    }

    if (req.method.toUpperCase() === 'OPTIONS') {
      if (origin && !allowed) {
        res.status(403).end()
        return
      }

      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
      res.setHeader(
        'Access-Control-Allow-Headers',
        req.header('access-control-request-headers') ||
          'authorization,content-type,x-sentra-action-token,x-sentra-actor,x-sentra-tenant',
      )
      res.setHeader('Access-Control-Max-Age', '600')
      res.status(204).end()
      return
    }

    next()
  }
}

export function createRateLimitMiddleware(): RequestHandler {
  const config = loadRateLimitConfig()

  return (req, res, next) => {
    if (!config.enabled || shouldSkipRateLimit(req)) {
      next()
      return
    }

    const now = Date.now()
    const key = rateLimitKey(req)
    const current = buckets.get(key)
    const bucket =
      !current || current.resetsAt <= now
        ? { count: 0, resetsAt: now + config.windowMs }
        : current

    bucket.count += 1
    buckets.set(key, bucket)
    pruneExpiredBuckets(now)

    const remaining = Math.max(config.maxRequests - bucket.count, 0)
    const retryAfterSec = Math.max(Math.ceil((bucket.resetsAt - now) / 1000), 1)
    res.setHeader('RateLimit-Limit', String(config.maxRequests))
    res.setHeader('RateLimit-Remaining', String(remaining))
    res.setHeader('RateLimit-Reset', String(retryAfterSec))

    if (bucket.count > config.maxRequests) {
      res.setHeader('Retry-After', String(retryAfterSec))
      res.status(429).json({
        ok: false,
        error: {
          message: 'Too many requests',
          details: {
            retryAfterSec,
          },
        },
      })
      return
    }

    next()
  }
}

export function resetRateLimitBucketsForTest(): void {
  if (process.env.NODE_ENV === 'production') {
    return
  }

  buckets.clear()
}

function loadCorsConfig(): CorsConfig {
  const configuredOrigins = csvEnv('SENTRA_CORS_ORIGINS')
  return {
    allowedOrigins: configuredOrigins.length > 0 ? configuredOrigins : DEFAULT_CORS_ORIGINS,
    allowCredentials: boolEnv('SENTRA_CORS_ALLOW_CREDENTIALS', true),
  }
}

function loadRateLimitConfig(): RateLimitConfig {
  const windowSec = positiveIntEnv('SENTRA_RATE_LIMIT_WINDOW_SEC', DEFAULT_RATE_LIMIT_WINDOW_SEC)
  return {
    enabled: boolEnv('SENTRA_RATE_LIMIT_ENABLED', true),
    windowMs: windowSec * 1000,
    maxRequests: positiveIntEnv('SENTRA_RATE_LIMIT_MAX', DEFAULT_RATE_LIMIT_MAX),
  }
}

function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) {
    return true
  }

  return allowedOrigins.includes('*') || allowedOrigins.includes(origin)
}

function shouldSkipRateLimit(req: Request): boolean {
  const method = req.method.toUpperCase()
  return method === 'OPTIONS' || req.path === '/health' || req.path.startsWith('/health/')
}

function rateLimitKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown'
}

function pruneExpiredBuckets(now: number): void {
  if (buckets.size < 1000) {
    return
  }

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetsAt <= now) {
      buckets.delete(key)
    }
  }
}

function csvEnv(key: string): string[] {
  const value = process.env[key]
  if (!value) {
    return []
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function boolEnv(key: string, fallback: boolean): boolean {
  const value = process.env[key]
  if (!value) {
    return fallback
  }

  return value.trim().toLowerCase() === 'true'
}

function positiveIntEnv(key: string, fallback: number): number {
  const value = process.env[key]
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
