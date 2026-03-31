import Redis from 'ioredis'
import { getClient } from './redis.js'

export const ROLLOUT_EVENT_CHANNEL = 'sentra:rollout-events'
export const ROLLOUT_STATE_INDEX_KEY = 'sentra:rollout-state:index'
export const ROLLOUT_STATE_KEY_PREFIX = 'sentra:rollout-state:deployment:'

export type RolloutEvent = {
  type: string
  timestamp: string
  [key: string]: unknown
}

export type RolloutLiveState = {
  schemaVersion: number
  updatedAt: string
  deploymentId?: number
  rolloutStepId?: number
  decision: string
  summary: string
  traffic?: Record<string, unknown>
  labels?: Record<string, unknown>
  labelMap?: Record<string, unknown>
  evaluation?: Record<string, unknown>
  action?: Record<string, unknown>
}

type PublishableRolloutEvent = {
  type: string
  timestamp?: string
  [key: string]: unknown
}

export async function publishRolloutEvent(
  event: PublishableRolloutEvent,
): Promise<RolloutEvent> {
  const payload: RolloutEvent = {
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
  }

  await getClient().publish(ROLLOUT_EVENT_CHANNEL, JSON.stringify(payload))
  return payload
}

export async function createRolloutEventSubscriber(
  onEvent: (event: RolloutEvent) => void | Promise<void>,
): Promise<() => Promise<void>> {
  const url = process.env.REDIS_URL || 'redis://localhost:6379'
  const subscriber = new Redis(url)

  const handleMessage = (_channel: string, message: string) => {
    try {
      void Promise.resolve(onEvent(JSON.parse(message) as RolloutEvent)).catch((error) => {
        console.error('[api] rollout event handler failed:', error)
      })
    } catch {
      void Promise.resolve(
        onEvent({
          type: 'event.parse_error',
          timestamp: new Date().toISOString(),
          raw: message,
        }),
      ).catch((error) => {
        console.error('[api] rollout event handler failed:', error)
      })
    }
  }

  subscriber.on('message', handleMessage)
  await subscriber.subscribe(ROLLOUT_EVENT_CHANNEL)

  return async () => {
    subscriber.off('message', handleMessage)
    try {
      await subscriber.unsubscribe(ROLLOUT_EVENT_CHANNEL)
    } finally {
      await subscriber.quit()
    }
  }
}

export async function listRolloutLiveStates(): Promise<RolloutLiveState[]> {
  const keys = await getClient().smembers(ROLLOUT_STATE_INDEX_KEY)
  return readRolloutLiveStates(keys)
}

export async function getRolloutLiveStates(
  deploymentIds: number[],
): Promise<Map<number, RolloutLiveState>> {
  if (deploymentIds.length === 0) {
    return new Map()
  }

  const keys = deploymentIds.map((deploymentId) => rolloutStateKey(deploymentId))
  const states = await readRolloutLiveStates(keys)
  return new Map(
    states
      .filter((state) => typeof state.deploymentId === 'number')
      .map((state) => [state.deploymentId as number, state]),
  )
}

function rolloutStateKey(deploymentId: number): string {
  return `${ROLLOUT_STATE_KEY_PREFIX}${deploymentId}`
}

async function readRolloutLiveStates(keys: string[]): Promise<RolloutLiveState[]> {
  if (keys.length === 0) {
    return []
  }

  const values = await getClient().mget(keys)
  const states = values.flatMap((value) => parseRolloutLiveState(value))
  return states.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function parseRolloutLiveState(value: string | null): RolloutLiveState[] {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value) as RolloutLiveState
    if (!parsed || typeof parsed !== 'object') {
      return []
    }
    if (typeof parsed.updatedAt !== 'string' || typeof parsed.decision !== 'string') {
      return []
    }
    return [parsed]
  } catch {
    return []
  }
}
