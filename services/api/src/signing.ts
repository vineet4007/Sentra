import crypto from 'node:crypto'

/**
 * Request/Response signing utilities for Sentra
 * Implements HMAC-SHA256 signing for secure satellite-to-controller communication
 */

export interface SignatureHeaders {
  'x-sentra-signature': string
  'x-sentra-timestamp': string
  'x-sentra-nonce': string
}

/**
 * Configuration for request signing
 */
export interface SigningConfig {
  signingKey: string
  clockSkewTolerance: number // milliseconds
  nonceCache: Set<string>
}

/**
 * Generate a signing key (should be stored securely)
 */
export function generateSigningKey(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Create signature headers for a request
 */
export function createSignatureHeaders(
  method: string,
  path: string,
  body: string | Buffer,
  signingKey: string,
): SignatureHeaders {
  const timestamp = Date.now().toString()
  const nonce = crypto.randomBytes(16).toString('hex')

  const signature = computeSignature(method, path, body, timestamp, nonce, signingKey)

  return {
    'x-sentra-signature': signature,
    'x-sentra-timestamp': timestamp,
    'x-sentra-nonce': nonce,
  }
}

/**
 * Verify signature headers on a request
 */
export function verifySignatureHeaders(
  method: string,
  path: string,
  body: string | Buffer,
  headers: Record<string, string | string[] | undefined>,
  config: SigningConfig,
): { valid: boolean; error?: string } {
  const signature = getHeader(headers, 'x-sentra-signature')
  const timestamp = getHeader(headers, 'x-sentra-timestamp')
  const nonce = getHeader(headers, 'x-sentra-nonce')

  if (!signature || !timestamp || !nonce) {
    return { valid: false, error: 'Missing signature headers' }
  }

  // Check timestamp (prevent replay attacks)
  const requestTime = Number.parseInt(timestamp)
  const currentTime = Date.now()
  if (isNaN(requestTime)) {
    return { valid: false, error: 'Invalid timestamp' }
  }
  if (Math.abs(currentTime - requestTime) > config.clockSkewTolerance) {
    return { valid: false, error: 'Timestamp outside tolerance' }
  }

  // Check nonce (prevent replay attacks)
  if (config.nonceCache.has(nonce)) {
    return { valid: false, error: 'Nonce already used' }
  }
  config.nonceCache.add(nonce)

  // Verify signature
  const expectedSignature = computeSignature(method, path, body, timestamp, nonce, config.signingKey)
  if (!constantTimeEquals(signature, expectedSignature)) {
    return { valid: false, error: 'Invalid signature' }
  }

  return { valid: true }
}

/**
 * Compute HMAC-SHA256 signature
 */
function computeSignature(
  method: string,
  path: string,
  body: string | Buffer,
  timestamp: string,
  nonce: string,
  signingKey: string,
): string {
  const bodyString = typeof body === 'string' ? body : body.toString()
  const message = `${method}|${path}|${bodyString}|${timestamp}|${nonce}`
  return crypto.createHmac('sha256', signingKey).update(message).digest('hex')
}

/**
 * Constant-time string comparison (prevents timing attacks)
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Get header value (case-insensitive)
 */
function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name.toLowerCase()]
  if (!value) return undefined
  return typeof value === 'string' ? value : value[0]
}

/**
 * Sign response body for integrity verification
 */
export function signResponseBody(body: any, signingKey: string): string {
  const bodyString = JSON.stringify(body)
  return crypto.createHmac('sha256', signingKey).update(bodyString).digest('hex')
}

/**
 * Express middleware for verifying request signatures
 */
export function createSignatureVerificationMiddleware(config: SigningConfig) {
  return (req: any, res: any, next: any) => {
    // Skip signature verification for public endpoints
    if (req.path === '/health') {
      return next()
    }

    let bodyString = ''
    const originalWrite = res.write
    const originalEnd = res.end

    // Capture request body for signature verification
    req.on('data', (chunk: Buffer) => {
      bodyString += chunk.toString()
    })

    req.on('end', () => {
      const verification = verifySignatureHeaders(
        req.method,
        req.path,
        bodyString,
        req.headers,
        config,
      )

      if (!verification.valid) {
        return res.status(401).json({
          error: 'Signature verification failed',
          details: verification.error,
        })
      }

      next()
    })

    // Sign response
    const originalJson = res.json
    res.json = function(body: any) {
      const signature = signResponseBody(body, config.signingKey)
      res.setHeader('x-sentra-response-signature', signature)
      return originalJson.call(this, body)
    }
  }
}

/**
 * Cleanup old nonces from cache (should be called periodically)
 */
export function cleanupNonceCache(nonceCache: Map<string, number>, maxAge: number = 3600000): void {
  const now = Date.now()
  for (const [nonce, timestamp] of nonceCache.entries()) {
    if (now - timestamp > maxAge) {
      nonceCache.delete(nonce)
    }
  }
}

/**
 * Create a timestamp-aware nonce cache
 */
export function createTimestampAwareNonceCache(): Map<string, number> {
  return new Map()
}
