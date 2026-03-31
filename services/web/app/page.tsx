import { DashboardShell } from '@/components/dashboard-shell'
import {
  getAiBenchmarkReport,
  getAiEvaluationSummary,
  getProjectDetails,
  getProjects,
  getRollouts,
  getSatellites,
} from '@/lib/api'

export default async function HomePage() {
  const [projects, rollouts, satellites, aiEvaluation, aiBenchmark] = await Promise.all([
    getProjects(),
    getRollouts(12),
    getSatellites(),
    getAiEvaluationSummary(50),
    getAiBenchmarkReport(100),
  ])
  const projectDetails = await Promise.all(projects.map((project) => getProjectDetails(project.id)))

  return (
    <DashboardShell
      projects={projects}
      projectDetails={projectDetails}
      rollouts={rollouts}
      satellites={satellites}
      aiEvaluation={aiEvaluation}
      aiBenchmark={aiBenchmark.report}
    />
  )
}
