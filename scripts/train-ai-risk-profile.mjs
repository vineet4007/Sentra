import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const datasetPath =
  process.env.SENTRA_AI_DATASET_PATH ||
  resolve(rootDir, 'reports', 'ai', 'datasets', 'candidate-latest.jsonl')
const outputDir =
  process.env.SENTRA_AI_MODEL_DIR ||
  resolve(rootDir, 'reports', 'ai', 'models')
const runtimeProfilePath =
  process.env.SENTRA_AI_RUNTIME_PROFILE_PATH ||
  resolve(rootDir, 'services', 'api', 'config', 'ai', 'candidate-risk-profile.json')
const releaseVersion = readReleaseVersion()

function main() {
  const rows = readJsonl(datasetPath)
  const resolvedRows = rows.filter((row) => row.actualOutcome !== 'running')
  const riskyRows = resolvedRows.filter((row) => row.riskyOutcome === true)

  const profile = {
    generatedAt: new Date().toISOString(),
    releaseVersion,
    datasetPath,
    rowCount: rows.length,
    resolvedRowCount: resolvedRows.length,
    riskyRowCount: riskyRows.length,
    riskyOutcomePct: rate(riskyRows.length, resolvedRows.length),
    recommendationRisk: groupRate(resolvedRows, (row) => row.recommendation),
    predictedOutcomeRisk: groupRate(resolvedRows, (row) => row.predictedOutcome),
    severityRisk: groupRate(resolvedRows, (row) => row.severity),
    rollbackProbabilityBuckets: bucketRates(resolvedRows, (row) => row.rollbackProbabilityPct),
    confidenceBuckets: bucketRates(resolvedRows, (row) => row.confidencePct),
    anomalyKindRisk: multiValueRate(resolvedRows, (row) => row.anomalyKinds || []),
  }

  mkdirSync(outputDir, { recursive: true })
  writeFileSync(resolve(outputDir, 'candidate-risk-profile.json'), `${JSON.stringify(profile, null, 2)}\n`, 'utf8')
  writeFileSync(resolve(outputDir, 'candidate-risk-profile.md'), renderMarkdown(profile), 'utf8')
  mkdirSync(dirname(runtimeProfilePath), { recursive: true })
  writeFileSync(runtimeProfilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8')

  process.stdout.write(`Wrote candidate risk profile to ${outputDir}\n`)
  process.stdout.write(`Synced runtime candidate risk profile to ${runtimeProfilePath}\n`)
}

function readJsonl(path) {
  const raw = readFileSync(path, 'utf8').trim()
  if (!raw) {
    return []
  }
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function groupRate(rows, selector) {
  const counts = new Map()
  const risky = new Map()

  for (const row of rows) {
    const key = selector(row)
    counts.set(key, (counts.get(key) || 0) + 1)
    if (row.riskyOutcome === true) {
      risky.set(key, (risky.get(key) || 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .map(([key, count]) => ({
      key,
      sampleCount: count,
      riskyCount: risky.get(key) || 0,
      riskyOutcomePct: rate(risky.get(key) || 0, count),
    }))
    .sort((left, right) => right.sampleCount - left.sampleCount)
}

function multiValueRate(rows, selector) {
  const counts = new Map()
  const risky = new Map()

  for (const row of rows) {
    const values = Array.isArray(selector(row)) ? selector(row) : []
    for (const value of values) {
      counts.set(value, (counts.get(value) || 0) + 1)
      if (row.riskyOutcome === true) {
        risky.set(value, (risky.get(value) || 0) + 1)
      }
    }
  }

  return Array.from(counts.entries())
    .map(([key, count]) => ({
      key,
      sampleCount: count,
      riskyCount: risky.get(key) || 0,
      riskyOutcomePct: rate(risky.get(key) || 0, count),
    }))
    .sort((left, right) => right.sampleCount - left.sampleCount)
}

function bucketRates(rows, selector) {
  const buckets = [
    { label: '0-24', min: 0, max: 24 },
    { label: '25-49', min: 25, max: 49 },
    { label: '50-74', min: 50, max: 74 },
    { label: '75-100', min: 75, max: 100 },
  ]

  return buckets.map((bucket) => {
    const items = rows.filter((row) => {
      const value = selector(row)
      return typeof value === 'number' && value >= bucket.min && value <= bucket.max
    })
    const riskyCount = items.filter((row) => row.riskyOutcome === true).length
    return {
      bucket: bucket.label,
      sampleCount: items.length,
      riskyCount,
      riskyOutcomePct: rate(riskyCount, items.length),
    }
  })
}

function rate(part, whole) {
  if (!whole) {
    return null
  }
  return Math.round((part / whole) * 1000) / 10
}

function renderMarkdown(profile) {
  return `# Candidate Risk Profile

Generated: ${profile.generatedAt}
Release: ${profile.releaseVersion || 'unlocked'}
Dataset: ${profile.datasetPath}

## Summary

- Rows: ${profile.rowCount}
- Resolved rows: ${profile.resolvedRowCount}
- Risky rows: ${profile.riskyRowCount}
- Risky outcome rate: ${profile.riskyOutcomePct ?? 'n/a'}%

## Recommendation Risk

${renderTable(profile.recommendationRisk)}

## Predicted Outcome Risk

${renderTable(profile.predictedOutcomeRisk)}

## Severity Risk

${renderTable(profile.severityRisk)}

## Anomaly Kind Risk

${renderTable(profile.anomalyKindRisk.slice(0, 10))}
`
}

function readReleaseVersion() {
  try {
    return readFileSync(resolve(rootDir, 'VERSION'), 'utf8').trim() || null
  } catch {
    return null
  }
}

function renderTable(rows) {
  if (!rows.length) {
    return '_No rows_'
  }

  const header = '| Key | Samples | Risky | Risk % |\n| --- | ---: | ---: | ---: |'
  const body = rows
    .map((row) => `| ${row.key || row.bucket} | ${row.sampleCount} | ${row.riskyCount} | ${row.riskyOutcomePct ?? 'n/a'} |`)
    .join('\n')

  return `${header}\n${body}`
}

main()
