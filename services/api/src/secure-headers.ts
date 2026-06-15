import type { Request, Response, NextFunction } from 'express'

/**
 * Secure Headers Middleware
 * Adds security-related HTTP headers to responses
 */
export function createSecureHeadersMiddleware() {
  return (_req: Request, res: Response, next: NextFunction) => {
    // Prevent clickjacking attacks
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')

    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff')

    // Enable XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block')

    // Control referrer information
    res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade')

    // Content Security Policy
    const csp = process.env.SENTRA_CSP_DIRECTIVES || "default-src 'self' https:; script-src 'self' https:; style-src 'self' https: 'unsafe-inline';"
    res.setHeader('Content-Security-Policy', csp)

    // Strict Transport Security (HSTS)
    if (process.env.SENTRA_HTTPS_ENFORCE?.toLowerCase() === 'true') {
      const maxAge = process.env.SENTRA_HSTS_MAX_AGE || '31536000'
      res.setHeader('Strict-Transport-Security', `max-age=${maxAge}; includeSubDomains; preload`)
    }

    // Additional security headers
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), payment=()')
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none')

    next()
  }
}
