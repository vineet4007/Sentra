import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const apiBaseUrl = process.env.SENTRA_API_URL || 'http://localhost:8080'
const reportDir =
  process.env.SENTRA_AI_DATASET_DIR ||
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'reports', 'ai', 'datasets')
const limit = Number(process.env.SENTRA_AI_DATASET_LIMIT || 1000)

async function main() {
  const primary = await fetchDataset('primary')
  const candidate = await fetchDataset('candidate')

  mkdirSync(reportDir, { recursive: true })

  writeJsonl(resolve(reportDir, 'primary-latest.jsonl'), primary.items)
  writeJsonl(resolve(reportDir, 'candidate-latest.jsonl'), candidate.items)

  const summary = {
    generatedAt: new Date().toISOString(),
    primary: primary.summary,
    candidate: candidate.summary,
    schema: primary.schema,
  }

  writeFileSync(resolve(reportDir, 'latest-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  writeFileSync(resolve(reportDir, 'latest-summary.md'), renderMarkdown(summary), 'utf8')

  process.stdout.write(`Wrote AI dataset files under ${reportDir}\n`)
}

async function fetchDataset(series) {
  const path = `${apiBaseUrl}/ai/dataset?series=${series}&limit=${limit}`

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(path, {
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Dataset API returned ${response.status}`)
      }
      const payload = await response.json()
      if (!payload?.ok || !payload?.data?.items || !payload?.data?.summary) {
        throw new Error('Dataset API returned an invalid payload')
      }
      return payload.data
    } catch {
      try {
        const output = execFileSync('curl', ['-fsS', path], { encoding: 'utf8' })
        const payload = JSON.parse(output)
        if (!payload?.ok || !payload?.data?.items || !payload?.data?.summary) {
          throw new Error('Dataset API returned an invalid payload')
        }
        return payload.data
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
    ['compose', 'exec', '-T', 'api', 'sh', '-lc', `wget -qO- 'http://localhost:8080/ai/dataset?series=${series}&limit=${limit}'`],
    { encoding: 'utf8' },
  )
  const payload = JSON.parse(output)
  if (!payload?.ok || !payload?.data?.items || !payload?.data?.summary) {
    throw new Error('Dataset API returned an invalid payload')
  }
  return payload.data
}

function writeJsonl(path, rows) {
  const body = rows.map((row) => JSON.stringify(row)).join('\n')
  writeFileSync(path, `${body}${rows.length > 0 ? '\n' : ''}`, 'utf8')
}

function renderMarkdown(summary) {
  return `# Sentra AI Training Dataset\n
Generated: ${summary.generatedAt}

## Primary

- Rows: ${summary.primary.rowCount}
- Resolved rows: ${summary.primary.resolvedRows}
- Risky rows: ${summary.primary.riskyRows}
- Risky outcome rate: ${summary.primary.riskyOutcomePct ?? 'n/a'}%

## Candidate

- Rows: ${summary.candidate.rowCount}
- Resolved rows: ${summary.candidate.resolvedRows}
- Risky rows: ${summary.candidate.riskyRows}
- Risky outcome rate: ${summary.candidate.riskyOutcomePct ?? 'n/a'}%

## Schema

${summary.schema.map((field) => `- ${field}`).join('\n')}
`
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
