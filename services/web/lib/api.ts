import 'server-only'

import type { Project, ProjectDetails, Rollout } from '@/lib/types'

const sentraApiBaseUrl = process.env.SENTRA_API_URL || 'http://localhost:8080'

type Envelope<T> = {
  ok: boolean
  data: T
}

type ListEnvelope<T> = {
  items: T[]
  count: number
}

async function sentraFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${sentraApiBaseUrl}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  })

  const payload = (await response.json()) as Envelope<T> | { ok: false; error?: { message?: string } }
  if (!response.ok || !('ok' in payload) || payload.ok !== true) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      payload.error &&
      typeof payload.error === 'object' &&
      'message' in payload.error
        ? String(payload.error.message)
        : `Sentra API request failed for ${path}`
    throw new Error(message)
  }

  return payload.data
}

export async function getProjects(): Promise<Project[]> {
  const data = await sentraFetch<ListEnvelope<Project>>('/projects')
  return data.items
}

export async function getProjectDetails(projectId: number): Promise<ProjectDetails> {
  return sentraFetch<ProjectDetails>(`/projects/${projectId}`)
}

export async function getRollouts(limit = 12): Promise<Rollout[]> {
  const data = await sentraFetch<ListEnvelope<Rollout>>(`/rollouts?limit=${limit}`)
  return data.items
}

export async function getRollout(deploymentId: number): Promise<Rollout | null> {
  const data = await sentraFetch<ListEnvelope<Rollout>>(`/rollouts?deploymentId=${deploymentId}`)
  return data.items[0] || null
}
