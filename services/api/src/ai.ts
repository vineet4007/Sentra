import { buildAiAdvisor, type AiAdvisor, type AiAdvisorInput } from './advisor.js'

type AiAdvisorConfig = {
  enabled: boolean
  baseUrl: string | null
  timeoutMs: number
}

type RolloutAdvisorContext = AiAdvisorInput & {
  deploymentId: number
}

type BatchRequest = {
  items: RolloutAdvisorContext[]
}

type BatchResponse = {
  ok: boolean
  data?: {
    items?: Array<{
      deploymentId: number
      advisor: AiAdvisor
    }>
  }
  error?: {
    message?: string
  }
}

const aiAdvisorConfig = loadAiAdvisorConfig()

export async function resolveAiAdvisors(
  contexts: RolloutAdvisorContext[],
): Promise<Map<number, AiAdvisor>> {
  if (contexts.length === 0) {
    return new Map()
  }

  const fallback = new Map(contexts.map((context) => [context.deploymentId, buildAiAdvisor(context)]))
  if (!aiAdvisorConfig.enabled || !aiAdvisorConfig.baseUrl) {
    return fallback
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), aiAdvisorConfig.timeoutMs)

  try {
    const response = await fetch(
      `${aiAdvisorConfig.baseUrl.replace(/\/+$/, '')}/advisories/rollouts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ items: contexts } satisfies BatchRequest),
        signal: controller.signal,
      },
    )

    if (!response.ok) {
      throw new Error(`AI service returned ${response.status}`)
    }

    const payload = (await response.json()) as BatchResponse
    if (!payload.ok || !Array.isArray(payload.data?.items)) {
      throw new Error(payload.error?.message || 'AI service returned an invalid response')
    }

    const resolved = new Map<number, AiAdvisor>()
    for (const item of payload.data.items) {
      if (typeof item?.deploymentId !== 'number' || !item.advisor || typeof item.advisor !== 'object') {
        continue
      }
      resolved.set(item.deploymentId, item.advisor)
    }

    if (resolved.size === 0) {
      return fallback
    }

    for (const [deploymentId, advisor] of fallback.entries()) {
      if (!resolved.has(deploymentId)) {
        resolved.set(deploymentId, advisor)
      }
    }

    return resolved
  } catch (error) {
    console.warn('[api] AI advisor service unavailable, falling back to local heuristic:', error)
    return fallback
  } finally {
    clearTimeout(timeout)
  }
}

function loadAiAdvisorConfig(): AiAdvisorConfig {
  const baseUrl = optionalEnv('SENTRA_AI_URL')
  return {
    enabled: boolEnv('SENTRA_AI_ENABLED', baseUrl !== null),
    baseUrl,
    timeoutMs: numberEnv('SENTRA_AI_TIMEOUT_SEC', 3) * 1000,
  }
}

function optionalEnv(key: string): string | null {
  const value = process.env[key]
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function boolEnv(key: string, fallback: boolean): boolean {
  const value = optionalEnv(key)
  if (value === null) {
    return fallback
  }
  return value.toLowerCase() === 'true'
}

function numberEnv(key: string, fallback: number): number {
  const value = optionalEnv(key)
  if (value === null) {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed
}
