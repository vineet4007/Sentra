import { notFound } from 'next/navigation'
import { SatelliteDetailView } from '@/components/satellite-detail-view'
import { getSatellite, getSatelliteTasks } from '@/lib/api'

type SatelliteDetailPageProps = {
  params: Promise<{
    id: string
  }>
}

export default async function SatelliteDetailPage({ params }: SatelliteDetailPageProps) {
  const resolved = await params
  const satelliteId = Number(resolved.id)

  if (!Number.isInteger(satelliteId) || satelliteId <= 0) {
    notFound()
  }

  const [satellite, tasks] = await Promise.all([getSatellite(satelliteId), getSatelliteTasks(satelliteId, 30)])
  if (!satellite) {
    notFound()
  }

  return <SatelliteDetailView satellite={satellite} tasks={tasks} />
}
