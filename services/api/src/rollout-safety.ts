import { ApiError } from './http.js'

const MAX_STABLE_TRAFFIC_FLOOR_PCT = 50

export function normalizeDeploymentTargetConfigSafety(
  config: Record<string, unknown> | null,
  fieldPath = 'deploymentTargetConfig',
): Record<string, unknown> | null {
  if (!config) {
    return config
  }

  if (Array.isArray(config)) {
    throw new ApiError(400, `"${fieldPath}" must be an object`)
  }

  const next = { ...config }
  if (Object.prototype.hasOwnProperty.call(next, 'stableTrafficFloorPct')) {
    next.stableTrafficFloorPct = normalizeStableTrafficFloorPct(
      next.stableTrafficFloorPct,
      `${fieldPath}.stableTrafficFloorPct`,
    )
  }

  return next
}

export function readStableTrafficFloorPct(config: Record<string, unknown> | null): number {
  if (!config || !Object.prototype.hasOwnProperty.call(config, 'stableTrafficFloorPct')) {
    return 0
  }

  return normalizeStableTrafficFloorPct(
    config.stableTrafficFloorPct,
    'deploymentTargetConfig.stableTrafficFloorPct',
  )
}

export function validateRolloutStepsAgainstStableFloor(
  rolloutSteps: number[],
  stableTrafficFloorPct: number,
): void {
  if (stableTrafficFloorPct <= 0) {
    return
  }

  const maxCandidateTrafficPct = 100 - stableTrafficFloorPct
  const invalidStep = rolloutSteps.find((step) => step > maxCandidateTrafficPct)
  if (invalidStep === undefined) {
    return
  }

  throw new ApiError(
    400,
    `rolloutSteps cannot exceed ${maxCandidateTrafficPct}% while stableTrafficFloorPct is ${stableTrafficFloorPct}%`,
    {
      stableTrafficFloorPct,
      maxCandidateTrafficPct,
      invalidStep,
    },
  )
}

function normalizeStableTrafficFloorPct(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_STABLE_TRAFFIC_FLOOR_PCT) {
    return value
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value)
    if (parsed >= 0 && parsed <= MAX_STABLE_TRAFFIC_FLOOR_PCT) {
      return parsed
    }
  }

  throw new ApiError(
    400,
    `"${label}" must be an integer between 0 and ${MAX_STABLE_TRAFFIC_FLOOR_PCT}`,
  )
}
