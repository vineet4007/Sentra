import { DashboardShell } from '@/components/dashboard-shell'
import { getProjects, getRollouts, getSatellites } from '@/lib/api'

export default async function HomePage() {
  const [projects, rollouts, satellites] = await Promise.all([getProjects(), getRollouts(12), getSatellites()])

  return <DashboardShell projects={projects} rollouts={rollouts} satellites={satellites} />
}
