type TelemetryValidationResult = {
  source: 'prometheus' | 'loki' | 'tempo'
  url: string
  probeUrl: string
  ok: boolean
  status: number | null
  error: string | null
}

type TelemetryValidationSummary = {
  ok: boolean
  results: TelemetryValidationResult[]
}

type TelemetryConfig = Record<string, unknown>

const TELEMETRY_PROBES = [
  { source: 'prometheus', key: 'prometheusUrl', path: '/-/ready' },
  { source: 'loki', key: 'lokiUrl', path: '/metrics' },
  { source: 'tempo', key: 'tempoUrl', path: '/metrics' },
] as const

export async function validateTelemetryConfig(
  config: TelemetryConfig,
): Promise<TelemetryValidationSummary> {
  const results: TelemetryValidationResult[] = []

  for (const probe of TELEMETRY_PROBES) {
    const rawValue = config[probe.key]
    if (typeof rawValue !== 'string' || rawValue.trim() === '') {
      continue
    }

    results.push(await probeTelemetryEndpoint(probe.source, rawValue.trim(), probe.path))
  }

  return {
    ok: results.every((result) => result.ok),
    results,
  }
}

async function probeTelemetryEndpoint(
  source: TelemetryValidationResult['source'],
  url: string,
  path: string,
): Promise<TelemetryValidationResult> {
  let probeUrl = url

  try {
    probeUrl = new URL(path, withTrailingSlash(url)).toString()
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)

    try {
      const response = await fetch(probeUrl, { signal: controller.signal })
      return {
        source,
        url,
        probeUrl,
        ok: response.ok,
        status: response.status,
        error: response.ok ? null : `HTTP ${response.status}`,
      }
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    return {
      source,
      url,
      probeUrl,
      ok: false,
      status: null,
      error: String(error),
    }
  }
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

