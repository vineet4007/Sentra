import { notFound } from 'next/navigation'
import { RolloutDetailView } from '@/components/rollout-detail-view'
import { getRollout } from '@/lib/api'

type RolloutDetailPageProps = {
  params: Promise<{
    id: string
  }>
}

export default async function RolloutDetailPage({ params }: RolloutDetailPageProps) {
  const resolved = await params
  const deploymentId = Number(resolved.id)

  if (!Number.isInteger(deploymentId) || deploymentId <= 0) {
    notFound()
  }

  const rollout = await getRollout(deploymentId)
  if (!rollout) {
    notFound()
  }

  return <RolloutDetailView rollout={rollout} />
}
