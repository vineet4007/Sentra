import { DashboardShell } from '@/components/dashboard-shell'
import { getAiBenchmarkReport, getAiEvaluationSummary, getProjects, getRollouts, getSatellites } from '@/lib/api'

export default async function HomePage() {
  const [projects, rollouts, satellites, aiEvaluation, aiBenchmark] = await Promise.all([
    getProjects(),
    getRollouts(12),
    getSatellites(),
    getAiEvaluationSummary(50),
    getAiBenchmarkReport(100),
  ])

  return (
    <DashboardShell
      projects={projects}
      rollouts={rollouts}
      satellites={satellites}
      aiEvaluation={aiEvaluation}
      aiBenchmark={aiBenchmark.report}
    />
  )
}
