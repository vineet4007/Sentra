import pino, { type Logger as PinoLogger } from 'pino'

interface LoggerContext {
  deploymentId?: number
  serviceId?: number
  environmentId?: number
  tenantKey?: string
  requestId?: string
  userId?: string
}

/**
 * Logger wraps pino with structured logging for Sentra API
 */
export class Logger {
  private logger: PinoLogger
  private context: LoggerContext = {}

  constructor() {
    // Configure log level from environment
    const level = (process.env.SENTRA_LOG_LEVEL || 'info').toLowerCase()
    const transport =
      process.env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined

    this.logger = pino(
      {
        level,
        transport,
      },
      // Write to stdout
      process.stdout,
    )
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LoggerContext): Logger {
    const childLogger = new Logger()
    childLogger.logger = this.logger.child(context)
    childLogger.context = { ...this.context, ...context }
    return childLogger
  }

  /**
   * Add context to this logger (mutating)
   */
  withContext(context: Partial<LoggerContext>): Logger {
    this.context = { ...this.context, ...context }
    this.logger = this.logger.child(context)
    return this
  }

  /**
   * Create a child logger for a specific deployment
   */
  withDeployment(deploymentId: number, serviceId: number, environmentId: number): Logger {
    return this.child({ deploymentId, serviceId, environmentId })
  }

  /**
   * Create a child logger for a specific tenant
   */
  withTenant(tenantKey: string): Logger {
    return this.child({ tenantKey })
  }

  /**
   * Create a child logger for a request
   */
  withRequest(requestId: string, userId?: string): Logger {
    return this.child({ requestId, userId })
  }

  /**
   * Log an info message
   */
  info(msg: string, data?: Record<string, any>): void {
    this.logger.info(data || {}, msg)
  }

  /**
   * Log a debug message
   */
  debug(msg: string, data?: Record<string, any>): void {
    this.logger.debug(data || {}, msg)
  }

  /**
   * Log a warning message
   */
  warn(msg: string, data?: Record<string, any>): void {
    this.logger.warn(data || {}, msg)
  }

  /**
   * Log an error message
   */
  error(msg: string, err: Error | Record<string, any>, data?: Record<string, any>): void {
    if (err instanceof Error) {
      this.logger.error(
        {
          ...data,
          err: {
            message: err.message,
            stack: err.stack,
          },
        },
        msg,
      )
    } else {
      this.logger.error({ ...err, ...data }, msg)
    }
  }

  /**
   * Log a fatal error and exit
   */
  fatal(msg: string, err: Error | Record<string, any>, data?: Record<string, any>): never {
    if (err instanceof Error) {
      this.logger.fatal(
        {
          ...data,
          err: {
            message: err.message,
            stack: err.stack,
          },
        },
        msg,
      )
    } else {
      this.logger.fatal({ ...err, ...data }, msg)
    }
    process.exit(1)
  }

  /**
   * Log an API request
   */
  logRequest(method: string, path: string, statusCode: number, duration: number, data?: Record<string, any>): void {
    this.logger.info(
      {
        method,
        path,
        statusCode,
        duration,
        ...data,
      },
      'API request',
    )
  }

  /**
   * Log a database query
   */
  logQuery(sql: string, params?: any[], duration?: number, data?: Record<string, any>): void {
    const sanitizedSql = sanitizeSql(sql, params)
    this.logger.debug(
      {
        sql: sanitizedSql,
        duration,
        ...data,
      },
      'Database query',
    )
  }

  /**
   * Log a telemetry event
   */
  logTelemetry(sourceType: string, sourceId: number, signal: string, value: number, data?: Record<string, any>): void {
    this.logger.info(
      {
        telemetryType: sourceType,
        telemetrySourceId: sourceId,
        signal,
        value,
        ...data,
      },
      'Telemetry event',
    )
  }

  /**
   * Log a deployment decision
   */
  logDecision(deploymentId: number, decision: string, reason: string, data?: Record<string, any>): void {
    this.logger.info(
      {
        deploymentId,
        decision,
        reason,
        ...data,
      },
      'Deployment decision',
    )
  }

  /**
   * Log authentication event
   */
  logAuth(action: string, token: string, success: boolean, data?: Record<string, any>): void {
    this.logger.info(
      {
        action,
        tokenHash: hashToken(token),
        success,
        ...data,
      },
      'Auth event',
    )
  }

  /**
   * Log a metric
   */
  logMetric(name: string, value: number, unit: string, data?: Record<string, any>): void {
    this.logger.info(
      {
        metricName: name,
        value,
        unit,
        ...data,
      },
      'Metric',
    )
  }
}

/**
 * Global logger instance
 */
export const logger = new Logger()

/**
 * Sanitize SQL for logging (remove sensitive values)
 */
function sanitizeSql(sql: string, params?: any[]): string {
  if (!params || params.length === 0) {
    return sql
  }
  let sanitized = sql
  for (let i = 0; i < params.length; i++) {
    const value = params[i]
    const param = String(value)
    if (isLikelySecret(param)) {
      sanitized = sanitized.replace('?', '[REDACTED]')
    } else {
      sanitized = sanitized.replace('?', param.length > 50 ? `'${param.slice(0, 50)}...'` : `'${param}'`)
    }
  }
  return sanitized
}

/**
 * Hash a token for logging (without revealing the full token)
 */
function hashToken(token: string): string {
  if (token.length <= 10) {
    return '***'
  }
  return token.slice(0, 4) + '***' + token.slice(-4)
}

/**
 * Detect if a value is likely a secret
 */
function isLikelySecret(value: string): boolean {
  const secretPatterns = [
    /^sk-/i, // API key pattern
    /^auth/i, // Bearer token
    /^secret/i, // Named secret
    /^password/i, // Password
    /^token/i, // Token
    /^api[_-]?key/i, // API key variants
  ]
  return secretPatterns.some((pattern) => pattern.test(value))
}
