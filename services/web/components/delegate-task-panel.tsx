'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Rollout, Satellite } from '@/lib/types'
import { StatusPill } from '@/components/status-pill'

type DelegateTaskPanelProps = {
  rollout: Rollout
  satellites: Satellite[]
}

type SubmitState = {
  status: 'idle' | 'success' | 'error'
  message: string
}

type ApiEnvelope = {
  ok: boolean
  error?: {
    message?: string
  }
}

function canExecuteTasks(satellite: Satellite) {
  return satellite.capabilities?.taskWorker === true
}

export function DelegateTaskPanel({ rollout, satellites }: DelegateTaskPanelProps) {
  const router = useRouter()
  const capableSatellites = useMemo(
    () => satellites.filter((satellite) => canExecuteTasks(satellite) && !satellite.stale),
    [satellites],
  )
  const [selectedSatelliteId, setSelectedSatelliteId] = useState(String(capableSatellites[0]?.id || ''))
  const [isPending, setIsPending] = useState(false)
  const [state, setState] = useState<SubmitState>({ status: 'idle', message: '' })

  async function queueDelegatedReconcile() {
    if (!selectedSatelliteId) {
      setState({ status: 'error', message: 'Choose a live satellite task worker first.' })
      return
    }

    setIsPending(true)
    setState({ status: 'idle', message: '' })

    try {
      const response = await fetch(`/api/satellites/${selectedSatelliteId}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskType: 'reconcile.deployment',
          deploymentId: rollout.id,
          createdBy: 'sentra-web',
        }),
      })

      const payload = (await response.json()) as ApiEnvelope
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error?.message || 'Sentra could not queue the delegated task.')
      }

      setState({
        status: 'success',
        message: `Queued delegated reconcile for rollout ${rollout.id} on satellite ${selectedSatelliteId}.`,
      })
      router.refresh()
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Sentra could not queue the delegated task.',
      })
    } finally {
      setIsPending(false)
    }
  }

  return (
    <section className="panel panel--delegate">
      <header className="panel__header">
        <div>
          <p className="eyebrow">Federated control</p>
          <h2>Send the next reconcile through a regional satellite.</h2>
          <p>Use this when you want rollout decisions executed closer to the target environment.</p>
        </div>
        <StatusPill label={`${capableSatellites.length} ready`} tone={capableSatellites.length > 0 ? 'good' : 'warn'} />
      </header>

      {capableSatellites.length === 0 ? (
        <p className="muted">No live satellites with task-worker capability are available right now.</p>
      ) : (
        <div className="delegate-shell">
          <label className="delegate-field">
            <span>Target satellite</span>
            <select value={selectedSatelliteId} onChange={(event) => setSelectedSatelliteId(event.target.value)}>
              {capableSatellites.map((satellite) => (
                <option key={satellite.id} value={satellite.id}>
                  {satellite.name}
                  {satellite.region ? ` - ${satellite.region}` : ''}
                </option>
              ))}
            </select>
          </label>

          <button className="primary-button" type="button" disabled={isPending} onClick={queueDelegatedReconcile}>
            {isPending ? 'Queueing…' : 'Queue delegated reconcile'}
          </button>

          {state.message ? (
            <p className={`form-feedback form-feedback--${state.status}`}>{state.message}</p>
          ) : (
            <p className="muted">Sentra will enqueue a `reconcile.deployment` task and the satellite will claim it on its next poll.</p>
          )}
        </div>
      )}
    </section>
  )
}
