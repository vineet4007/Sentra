import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const apiBaseUrl = process.env.SENTRA_API_URL || 'http://localhost:8080'
const reportDir = process.env.SENTRA_AI_REPORT_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..', 'reports', 'ai')

async function main() {
  const payload = await fetchBenchmarkPayload()
  if (!payload?.ok || !payload?.data?.report) {
    throw new Error('Benchmark API returned an invalid payload')
  }

  const report = payload.data.report
  const evaluation = payload.data.evaluation

  mkdirSync(reportDir, { recursive: true })

  const jsonPath = resolve(reportDir, 'latest.json')
  const markdownPath = resolve(reportDir, 'latest.md')

  writeFileSync(jsonPath, `${JSON.stringify(payload.data, null, 2)}\n`, 'utf8')
  writeFileSync(markdownPath, renderMarkdown(report, evaluation), 'utf8')

  process.stdout.write(`Wrote AI benchmark report to ${markdownPath}\n`)
  process.stdout.write(`Wrote AI benchmark JSON to ${jsonPath}\n`)
}

async function fetchBenchmarkPayload() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${apiBaseUrl}/ai/benchmark?limit=100`, {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Benchmark API returned ${response.status}`)
      }

      return await response.json()
    } catch {
      try {
        const output = execFileSync('curl', ['-fsS', `${apiBaseUrl}/ai/benchmark?limit=100`], {
          encoding: 'utf8',
        })
        return JSON.parse(output)
      } catch {
        if (attempt < 3) {
          await delay(500)
          continue
        }
      }
    }
  }

  const output = execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'api', 'sh', '-lc', "wget -qO- 'http://localhost:8080/ai/benchmark?limit=100'"],
    {
      encoding: 'utf8',
    },
  )
  return JSON.parse(output)
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function renderMarkdown(report, evaluation) {
  const lines = [
    '# Sentra AI Benchmark Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Recommendation: ${report.recommendation}`,
    '',
    report.summary,
    '',
    '## Comparison',
    '',
    `- Overlapping rollouts: ${report.overlapDeployments}`,
    `- Primary engine: ${report.primary.engine || 'n/a'}`,
    `- Candidate engine: ${report.candidate?.engine || 'n/a'}`,
    `- Accuracy delta: ${formatDelta(report.deltas.accuracyPct, '%')}`,
    `- Recall delta: ${formatDelta(report.deltas.riskyOutcomeRecallPct, '%')}`,
    `- Precision delta: ${formatDelta(report.deltas.warningPrecisionPct, '%')}`,
    `- Brier improvement: ${formatDelta(report.deltas.brierImprovement, '')}`,
    '',
    '## Gates',
    '',
    ...report.gates.map(
      (gate) =>
        `- [${gate.passed ? 'x' : ' '}] ${gate.label}: actual ${gate.actual}, expected ${gate.expected}. ${gate.summary}`,
    ),
    '',
    '## Evaluation Snapshot',
    '',
    `- Coverage: ${formatMetric(evaluation.overview.coveragePct, '%')}`,
    `- Accuracy: ${formatMetric(evaluation.overview.accuracyPct, '%')}`,
    `- Risky-outcome recall: ${formatMetric(evaluation.overview.riskyOutcomeRecallPct, '%')}`,
    `- Warning precision: ${formatMetric(evaluation.overview.warningPrecisionPct, '%')}`,
    `- Brier score: ${formatMetric(evaluation.overview.brierScore, '')}`,
    '',
    '## Engines',
    '',
    ...evaluation.engines.map(
      (engine) =>
        `- ${engine.engine}: accuracy ${formatMetric(engine.accuracyPct, '%')}, recall ${formatMetric(engine.riskyOutcomeRecallPct, '%')}, precision ${formatMetric(engine.warningPrecisionPct, '%')}, Brier ${formatMetric(engine.brierScore, '')}`,
    ),
    '',
  ]

  return `${lines.join('\n')}\n`
}

function formatMetric(value, suffix) {
  return value === null || value === undefined ? 'n/a' : `${value}${suffix}`
}

function formatDelta(value, suffix) {
  if (value === null || value === undefined) {
    return 'n/a'
  }
  return `${value > 0 ? '+' : ''}${value}${suffix}`
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
