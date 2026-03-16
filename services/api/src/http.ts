import type { Request, RequestHandler, Response } from 'express'

type ObjectBody = Record<string, unknown>
type AsyncRouteHandler = (req: Request, res: Response) => Promise<void>

export class ApiError extends Error {
  status: number
  details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res) => {
    void handler(req, res).catch((error) => sendErrorResponse(res, error))
  }
}

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ ok: true, data })
}

export function sendErrorResponse(res: Response, error: unknown): void {
  if (res.headersSent) {
    res.end()
    return
  }

  if (error instanceof ApiError) {
    res.status(error.status).json({
      ok: false,
      error: {
        message: error.message,
        details: error.details ?? null,
      },
    })
    return
  }

  if (isRecord(error) && error.code === 'ER_DUP_ENTRY') {
    res.status(409).json({
      ok: false,
      error: {
        message: 'Resource already exists',
      },
    })
    return
  }

  if (isRecord(error) && error.code === 'ER_NO_REFERENCED_ROW_2') {
    res.status(400).json({
      ok: false,
      error: {
        message: 'Referenced record does not exist',
      },
    })
    return
  }

  console.error('[api] route error:', error)
  res.status(500).json({
    ok: false,
    error: {
      message: 'Internal server error',
    },
  })
}

export function requireBodyObject(value: unknown): ObjectBody {
  if (!isRecord(value) || Array.isArray(value)) {
    throw new ApiError(400, 'Request body must be an object')
  }
  return value
}

export function requireObjectField(obj: ObjectBody, key: string): ObjectBody {
  const value = obj[key]
  if (!isRecord(value) || Array.isArray(value)) {
    throw new ApiError(400, `"${key}" must be an object`)
  }
  return value
}

export function getRequiredString(obj: ObjectBody, key: string): string {
  const value = obj[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, `"${key}" must be a non-empty string`)
  }
  return value.trim()
}

export function getOptionalString(obj: ObjectBody, key: string): string | null {
  if (!hasField(obj, key) || obj[key] === null || obj[key] === undefined) {
    return null
  }

  const value = obj[key]
  if (typeof value !== 'string') {
    throw new ApiError(400, `"${key}" must be a string`)
  }

  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function getRequiredPositiveInt(obj: ObjectBody, key: string): number {
  return parsePositiveInt(obj[key], key)
}

export function getOptionalPositiveInt(obj: ObjectBody, key: string): number | null {
  if (!hasField(obj, key) || obj[key] === null || obj[key] === undefined) {
    return null
  }
  return parsePositiveInt(obj[key], key)
}

export function getOptionalBoolean(obj: ObjectBody, key: string): boolean | null {
  if (!hasField(obj, key) || obj[key] === null || obj[key] === undefined) {
    return null
  }

  const value = obj[key]
  if (typeof value !== 'boolean') {
    throw new ApiError(400, `"${key}" must be a boolean`)
  }
  return value
}

export function getOptionalObject(obj: ObjectBody, key: string): ObjectBody | null {
  if (!hasField(obj, key) || obj[key] === null || obj[key] === undefined) {
    return null
  }

  const value = obj[key]
  if (!isRecord(value) || Array.isArray(value)) {
    throw new ApiError(400, `"${key}" must be an object`)
  }
  return value
}

export function getOptionalJson(obj: ObjectBody, key: string): unknown | null {
  if (!hasField(obj, key) || obj[key] === null || obj[key] === undefined) {
    return null
  }

  const value = obj[key]
  if (typeof value !== 'object') {
    throw new ApiError(400, `"${key}" must be an object or array`)
  }
  return value
}

export function getOptionalArray(obj: ObjectBody, key: string): unknown[] | null {
  if (!hasField(obj, key) || obj[key] === null || obj[key] === undefined) {
    return null
  }

  const value = obj[key]
  if (!Array.isArray(value)) {
    throw new ApiError(400, `"${key}" must be an array`)
  }
  return value
}

export function parsePositiveInt(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) {
    return Number(value)
  }

  throw new ApiError(400, `"${label}" must be a positive integer`)
}

export function parseOptionalPositiveIntQuery(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (Array.isArray(value)) {
    return parsePositiveInt(value[0], label)
  }

  return parsePositiveInt(value, label)
}

export function hasField(obj: ObjectBody, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

export function isRecord(value: unknown): value is ObjectBody {
  return typeof value === 'object' && value !== null
}

