import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

type RiskRate = {
  key: string
  sampleCount: number
  riskyCount: number
  riskyOutcomePct: number | null
}

type BucketRiskRate = {
  bucket: string
  sampleCount: number
  riskyCount: number
  riskyOutcomePct: number | null
}

export type CandidateRiskProfile = {
  generatedAt: string
  releaseVersion?: string | null
  datasetPath: string
  rowCount: number
  resolvedRowCount: number
  riskyRowCount: number
  riskyOutcomePct: number | null
  recommendationRisk: RiskRate[]
  predictedOutcomeRisk: RiskRate[]
  severityRisk: RiskRate[]
  rollbackProbabilityBuckets: BucketRiskRate[]
  confidenceBuckets: BucketRiskRate[]
  anomalyKindRisk: RiskRate[]
}

type CandidateProfileCache = {
  path: string
  mtimeMs: number
  profile: CandidateRiskProfile | null
}

const DEFAULT_PROFILE_PATH = resolve(process.cwd(), 'config', 'ai', 'candidate-risk-profile.json')

let cache: CandidateProfileCache | null = null

export function getCandidateRiskProfile(): CandidateRiskProfile | null {
  const path = (process.env.SENTRA_AI_CANDIDATE_PROFILE_PATH || DEFAULT_PROFILE_PATH).trim()

  try {
    const stat = statSync(path)
    if (cache && cache.path === path && cache.mtimeMs === stat.mtimeMs) {
      return cache.profile
    }

    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CandidateRiskProfile
    const profile = isCandidateRiskProfile(parsed) ? parsed : null
    cache = { path, mtimeMs: stat.mtimeMs, profile }
    return profile
  } catch {
    cache = { path, mtimeMs: -1, profile: null }
    return null
  }
}

export function findRiskRate(
  rates: RiskRate[],
  key: string,
  minimumSamples = 3,
): RiskRate | null {
  const match = rates.find((rate) => rate.key === key)
  if (!match || match.sampleCount < minimumSamples || match.riskyOutcomePct === null) {
    return null
  }
  return match
}

export function findBucketRiskRate(
  rates: BucketRiskRate[],
  value: number,
  minimumSamples = 3,
): BucketRiskRate | null {
  const bucket = valueToBucket(value)
  const match = rates.find((rate) => rate.bucket === bucket)
  if (!match || match.sampleCount < minimumSamples || match.riskyOutcomePct === null) {
    return null
  }
  return match
}

function valueToBucket(value: number) {
  if (value < 25) return '0-24'
  if (value < 50) return '25-49'
  if (value < 75) return '50-74'
  return '75-100'
}

function isCandidateRiskProfile(value: unknown): value is CandidateRiskProfile {
  if (!value || typeof value !== 'object') {
    return false
  }

  const profile = value as Partial<CandidateRiskProfile>
  return (
    typeof profile.generatedAt === 'string' &&
    typeof profile.datasetPath === 'string' &&
    typeof profile.rowCount === 'number' &&
    typeof profile.resolvedRowCount === 'number' &&
    typeof profile.riskyRowCount === 'number' &&
    Array.isArray(profile.recommendationRisk) &&
    Array.isArray(profile.predictedOutcomeRisk) &&
    Array.isArray(profile.severityRisk) &&
    Array.isArray(profile.rollbackProbabilityBuckets) &&
    Array.isArray(profile.confidenceBuckets) &&
    Array.isArray(profile.anomalyKindRisk)
  )
}
