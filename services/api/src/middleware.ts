import type { Request, RequestHandler } from 'express'
import { getClient } from './redis.js'

type CorsConfig = {
  allowedOrigins: string[]
  allowCredentials: boolean
}

type RateLimitBackend = 'memory' | 'redis'

type RateLimitConfig = {
  enabled: boolean
  backend: RateLimitBackend
  windowMs: number
  windowSec: number
  maxRequests: number
  redisKeyPrefix: string
  redisFailOpen: boolean
}

type RateLimitBucket = {
  count: number
  resetsAt: number
}

type RateLimitDecision = {
  allowed: boolean
  count: number
  retryAfterSec: number
}

type RateLimitRedisClient = {
  eval: (
    script: string,
    numberOfKeys: number,
    key: string,
    windowSec: number,
  ) => Promise<unknown>
}

type RateLimitMiddlewareDeps = {
  getRedisClient?: () => RateLimitRedisClient
}

const DEFAULT_CORS_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000']
const DEFAULT_RATE_LIMIT_WINDOW_SEC = 60
const DEFAULT_RATE_LIMIT_MAX = 600
const DEFAULT_RATE_LIMIT_REDIS_PREFIX = 'sentra:rate-limit'
const REDIS_RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return { current, ttl }
`

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
  return createRateLimitMiddlewareWithConfig(config)
}

export function createRateLimitMiddlewareForTest(
  deps: RateLimitMiddlewareDeps = {},
): RequestHandler {
  const config = loadRateLimitConfig()
  return createRateLimitMiddlewareWithConfig(config, deps)
}

function createRateLimitMiddlewareWithConfig(
  config: RateLimitConfig,
  deps: RateLimitMiddlewareDeps = {},
): RequestHandler {
  return (req, res, next) => {
    if (!config.enabled || shouldSkipRateLimit(req)) {
      next()
      return
    }

    const key = rateLimitKey(req)
    void applyRateLimit(config, key, deps)
      .then((decision) => {
        sendRateLimitHeaders(res, config, decision)

        if (!decision.allowed) {
          res.setHeader('Retry-After', String(decision.retryAfterSec))
          res.status(429).json({
            ok: false,
            error: {
              message: 'Too many requests',
              details: {
                retryAfterSec: decision.retryAfterSec,
              },
            },
          })
          return
        }

        next()
      })
      .catch((error) => {
        if (config.backend === 'redis' && config.redisFailOpen) {
          next()
          return
        }

        if (config.backend === 'redis') {
          res.status(503).json({
            ok: false,
            error: {
              message: 'Rate limit store unavailable',
            },
          })
          return
        }

        next(error)
      })
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
    backend: rateLimitBackendEnv(),
    windowMs: windowSec * 1000,
    windowSec,
    maxRequests: positiveIntEnv('SENTRA_RATE_LIMIT_MAX', DEFAULT_RATE_LIMIT_MAX),
    redisKeyPrefix: stringEnv('SENTRA_RATE_LIMIT_REDIS_PREFIX', DEFAULT_RATE_LIMIT_REDIS_PREFIX),
    redisFailOpen: boolEnv('SENTRA_RATE_LIMIT_REDIS_FAIL_OPEN', false),
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

async function applyRateLimit(
  config: RateLimitConfig,
  key: string,
  deps: RateLimitMiddlewareDeps,
): Promise<RateLimitDecision> {
  if (config.backend === 'redis') {
    return applyRedisRateLimit(config, key, deps)
  }

  return applyMemoryRateLimit(config, key)
}

function applyMemoryRateLimit(config: RateLimitConfig, key: string): RateLimitDecision {
  const now = Date.now()
  const current = buckets.get(key)
  const bucket =
    !current || current.resetsAt <= now
      ? { count: 0, resetsAt: now + config.windowMs }
      : current

  bucket.count += 1
  buckets.set(key, bucket)
  pruneExpiredBuckets(now)

  const retryAfterSec = Math.max(Math.ceil((bucket.resetsAt - now) / 1000), 1)
  return {
    allowed: bucket.count <= config.maxRequests,
    count: bucket.count,
    retryAfterSec,
  }
}

async function applyRedisRateLimit(
  config: RateLimitConfig,
  key: string,
  deps: RateLimitMiddlewareDeps,
): Promise<RateLimitDecision> {
  const redis = deps.getRedisClient ? deps.getRedisClient() : getClient()
  const redisKey = redisRateLimitKey(config, key)
  const result = await redis.eval(
    REDIS_RATE_LIMIT_SCRIPT,
    1,
    redisKey,
    config.windowSec,
  )
  const [count, ttl] = parseRedisRateLimitResult(result)
  const retryAfterSec = Math.max(ttl > 0 ? ttl : config.windowSec, 1)

  return {
    allowed: count <= config.maxRequests,
    count,
    retryAfterSec,
  }
}

function parseRedisRateLimitResult(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error('Unexpected Redis rate limit response')
  }

  const count = Number(value[0])
  const ttl = Number(value[1])
  if (!Number.isFinite(count) || !Number.isFinite(ttl)) {
    throw new Error('Unexpected Redis rate limit response')
  }

  return [count, ttl]
}

function sendRateLimitHeaders(
  res: Parameters<RequestHandler>[1],
  config: RateLimitConfig,
  decision: RateLimitDecision,
): void {
  const remaining = Math.max(config.maxRequests - decision.count, 0)
  res.setHeader('RateLimit-Limit', String(config.maxRequests))
  res.setHeader('RateLimit-Remaining', String(remaining))
  res.setHeader('RateLimit-Reset', String(decision.retryAfterSec))
}

function redisRateLimitKey(config: RateLimitConfig, key: string): string {
  return `${config.redisKeyPrefix}:v1:${config.windowSec}:${Buffer.from(key).toString('base64url')}`
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

function rateLimitBackendEnv(): RateLimitBackend {
  const value = process.env.SENTRA_RATE_LIMIT_BACKEND?.trim().toLowerCase()
  if (value === 'redis' || value === 'memory') {
    return value
  }

  return process.env.REDIS_URL ? 'redis' : 'memory'
}

function stringEnv(key: string, fallback: string): string {
  const value = process.env[key]
  if (!value) {
    return fallback
  }

  const trimmed = value.trim()
  return trimmed === '' ? fallback : trimmed
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
