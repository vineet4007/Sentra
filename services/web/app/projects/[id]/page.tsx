import { notFound } from 'next/navigation'
import { ProjectDetailView } from '@/components/project-detail-view'
import { getProjectDetails } from '@/lib/api'

type ProjectDetailPageProps = {
  params: Promise<{
    id: string
  }>
}

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const resolved = await params
  const projectId = Number(resolved.id)

  if (!Number.isInteger(projectId) || projectId <= 0) {
    notFound()
  }

  const projectDetails = await getProjectDetails(projectId).catch(() => null)
  if (!projectDetails) {
    notFound()
  }

  return <ProjectDetailView details={projectDetails} />
}
