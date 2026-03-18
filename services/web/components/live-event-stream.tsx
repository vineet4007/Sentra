'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { LiveState, RolloutEvent } from '@/lib/types'
import { StatusPill } from '@/components/status-pill'

type LiveEventStreamProps = {
  deploymentId?: number
}

function toneForEvent(event?: RolloutEvent | null): 'neutral' | 'good' | 'warn' | 'critical' | 'accent' {
  const type = String(event?.type || '').toLowerCase()
  const decision = String(event?.decision || event?.liveState?.decision || '').toLowerCase()
  if (type.includes('satellite.task.completed')) return 'good'
  if (type.includes('satellite.task.failed')) return 'critical'
  if (type.includes('satellite.task.claimed') || type.includes('satellite.task.queued')) return 'accent'
  if (decision === 'promote' || decision === 'initialize') return 'good'
  if (decision === 'rollback') return 'critical'
  if (decision === 'pause') return 'warn'
  if (decision === 'hold') return 'accent'
  return 'neutral'
}

function describeEvent(event: RolloutEvent) {
  if (event.summary) {
    return event.summary
  }

  const satelliteName = typeof event.satelliteName === 'string' ? event.satelliteName : 'satellite'
  const taskId = typeof event.taskId === 'number' ? `task ${event.taskId}` : 'task'

  switch (event.type) {
    case 'satellite.task.queued':
      return `${satelliteName} received ${taskId} from the coordinator.`
    case 'satellite.task.claimed':
      return `${satelliteName} claimed ${taskId} for execution.`
    case 'satellite.task.completed':
      return `${satelliteName} completed ${taskId}.`
    case 'satellite.task.failed':
      return `${satelliteName} failed ${taskId}.`
    default:
      return event.type
  }
}

function labelForEvent(event: RolloutEvent) {
  switch (event.type) {
    case 'satellite.task.queued':
      return 'task queued'
    case 'satellite.task.claimed':
      return 'task claimed'
    case 'satellite.task.completed':
      return 'task completed'
    case 'satellite.task.failed':
      return 'task failed'
    default:
      return String(event.decision || event.type)
  }
}

export function LiveEventStream({ deploymentId }: LiveEventStreamProps) {
  const router = useRouter()
  const [events, setEvents] = useState<RolloutEvent[]>([])
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const refreshTimer = useRef<number | null>(null)

  useEffect(() => {
    const source = new EventSource('/api/events')

    const queueRefresh = () => {
      if (refreshTimer.current !== null) {
        return
      }
      refreshTimer.current = window.setTimeout(() => {
        router.refresh()
        refreshTimer.current = null
      }, 350)
    }

    const acceptEvent = (payload: RolloutEvent) => {
      if (deploymentId && payload.deploymentId && payload.deploymentId !== deploymentId) {
        return
      }

      setEvents((current) => [payload, ...current].slice(0, 8))
      if (payload.type !== 'connected') {
        queueRefresh()
      }
    }

    const parse = (raw: MessageEvent<string>) => {
      try {
        return JSON.parse(raw.data) as RolloutEvent
      } catch {
        return {
          type: 'event.parse_error',
          timestamp: new Date().toISOString(),
          summary: raw.data,
        } satisfies RolloutEvent
      }
    }

    source.onopen = () => setStatus('live')
    source.onerror = () => setStatus('offline')
    source.onmessage = (event) => acceptEvent(parse(event))
    source.addEventListener('connected', (event) => acceptEvent(parse(event as MessageEvent<string>)))
    source.addEventListener('rollout_snapshot', (event) => {
      const parsed = JSON.parse((event as MessageEvent<string>).data) as {
        items?: LiveState[]
      }
      const items = Array.isArray(parsed.items) ? parsed.items : []
      setStatus('live')
      if (items.length > 0) {
        const normalized: RolloutEvent[] = items.map((item) => ({
          type: 'rollout.snapshot',
          timestamp: item.updatedAt,
          summary: item.summary,
          decision: item.decision,
          deploymentId: item.deploymentId,
          rolloutStepId: item.rolloutStepId,
          liveState: item,
        }))
        const filtered = deploymentId ? normalized.filter((item) => item.deploymentId === deploymentId) : normalized
        setEvents(filtered.slice(0, 8))
      }
    })

    return () => {
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current)
      }
      source.close()
    }
  }, [deploymentId, router])

  const headline = useMemo(() => {
    const latest = events[0]
    if (!latest) {
      return 'Waiting for rollout activity'
    }
    return latest.summary || latest.type
  }, [events])

  return (
    <section className="live-shell">
      <header className="live-shell__header">
        <div>
          <p className="eyebrow">Live control pulse</p>
          <h3>{headline}</h3>
        </div>
        <StatusPill
          label={status === 'live' ? 'SSE connected' : status === 'connecting' ? 'Connecting' : 'Offline'}
          tone={status === 'live' ? 'good' : status === 'connecting' ? 'accent' : 'critical'}
        />
      </header>

      <div className="live-shell__list">
        {events.length === 0 ? (
          <p className="muted">Sentra will start streaming rollout decisions here as soon as events arrive.</p>
        ) : (
          events.map((event) => (
            <article key={`${event.type}-${event.timestamp}`} className="event-row">
              <StatusPill label={labelForEvent(event)} tone={toneForEvent(event)} />
              <div className="event-row__body">
                <strong>{describeEvent(event)}</strong>
                <span>{new Date(event.timestamp).toLocaleString()}</span>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
