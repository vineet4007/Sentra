import { DashboardShell } from '@/components/dashboard-shell'
import { getProjects, getRollouts } from '@/lib/api'

export default async function HomePage() {
  const [projects, rollouts] = await Promise.all([getProjects(), getRollouts(12)])

  return <DashboardShell projects={projects} rollouts={rollouts} />
}
