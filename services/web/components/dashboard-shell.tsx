'use client'

import Link from 'next/link'
import type { Project, Rollout, Satellite } from '@/lib/types'
import { AiAdvisorPanel } from '@/components/ai-advisor-panel'
import { LiveEventStream } from '@/components/live-event-stream'
import { OnboardingPanel } from '@/components/onboarding-panel'
import { RolloutCard } from '@/components/rollout-card'
import { StatusPill } from '@/components/status-pill'

type DashboardShellProps = {
  projects: Project[]
  rollouts: Rollout[]
  satellites: Satellite[]
}

function summarizeProjects(projects: Project[]) {
  if (projects.length === 0) {
    return 'No projects are connected yet.'
  }

  return `${projects.length} project${projects.length === 1 ? '' : 's'} connected to the control plane.`
}

function summarizeSatellites(satellites: Satellite[]) {
  if (satellites.length === 0) {
    return 'No satellites have reported to the coordinator yet.'
  }

  const staleCount = satellites.filter((satellite) => satellite.stale).length
  const taskWorkers = satellites.filter((satellite) => satellite.capabilities?.taskWorker === true).length
  if (staleCount === 0) {
    return `${satellites.length} satellite${satellites.length === 1 ? '' : 's'} online, ${taskWorkers} ready for delegated tasks.`
  }

  return `${satellites.length} satellites registered, ${taskWorkers} task workers, ${staleCount} stale.`
}

function toneForSatellite(satellite: Satellite): 'neutral' | 'good' | 'warn' | 'critical' | 'accent' {
  if (satellite.healthStatus === 'online') return 'good'
  if (satellite.healthStatus === 'stale') return 'warn'
  if (satellite.status === 'degraded') return 'critical'
  return 'accent'
}

export function DashboardShell({ projects, rollouts, satellites }: DashboardShellProps) {
  const staleSatellites = satellites.filter((satellite) => satellite.stale).length
  const taskWorkers = satellites.filter((satellite) => satellite.capabilities?.taskWorker === true).length
  const delegatedRollouts = rollouts.filter((rollout) => rollout.satelliteTasks.length > 0).length
  const riskyRollouts = rollouts.filter(
    (rollout) => rollout.aiAdvisor.severity === 'high' || rollout.aiAdvisor.severity === 'critical',
  ).length
  const featuredAdvisor =
    rollouts
      .slice()
      .sort((left, right) => right.aiAdvisor.riskScore - left.aiAdvisor.riskScore)[0]
      ?.aiAdvisor || null

  return (
    <main className="dashboard">
      <section className="hero-card">
        <div className="hero-card__copy">
          <p className="eyebrow">Sentra control room</p>
          <h1>One bright command center for rollout health, federation, and shadow-mode release intelligence.</h1>
          <p>
            Sentra now does more than show traffic shifts. It can evaluate rollout risk, delegate reconcile work to
            satellites, and keep operator context visible in one place.
          </p>
          <div className="hero-card__badges">
            <StatusPill label="AI shadow mode live" tone="accent" />
            <StatusPill label={`${taskWorkers} federation workers`} tone={taskWorkers > 0 ? 'good' : 'warn'} />
          </div>
        </div>
        <div className="hero-card__stats">
          <article>
            <strong>{projects.length}</strong>
            <span>projects</span>
          </article>
          <article>
            <strong>{rollouts.length}</strong>
            <span>rollouts in view</span>
          </article>
          <article>
            <strong>{delegatedRollouts}</strong>
            <span>with delegated execution</span>
          </article>
          <article>
            <strong>{riskyRollouts}</strong>
            <span>{riskyRollouts === 1 ? 'high-risk rollout' : 'high-risk rollouts'}</span>
          </article>
        </div>
      </section>

      <section className="overview-ribbon">
        <article className="overview-ribbon__card">
          <span>Coordinator posture</span>
          <strong>{satellites.length === 0 ? 'local only' : `${satellites.length} regions visible`}</strong>
          <p>{staleSatellites === 0 ? 'All known satellites are fresh.' : `${staleSatellites} satellites need attention.`}</p>
        </article>
        <article className="overview-ribbon__card">
          <span>AI posture</span>
          <strong>{featuredAdvisor ? `${featuredAdvisor.riskScore}/100 risk ceiling` : 'waiting for rollouts'}</strong>
          <p>{featuredAdvisor ? featuredAdvisor.headline : 'Once rollouts evaluate, the shadow advisor will show up here.'}</p>
        </article>
        <article className="overview-ribbon__card">
          <span>Federation posture</span>
          <strong>{taskWorkers} task worker{taskWorkers === 1 ? '' : 's'}</strong>
          <p>{delegatedRollouts > 0 ? `${delegatedRollouts} rollouts already have satellite task history.` : 'No delegated execution yet.'}</p>
        </article>
      </section>

      <section className="dashboard-grid">
        <div className="dashboard-grid__left">
          <OnboardingPanel projectCount={projects.length} />
          {featuredAdvisor ? <AiAdvisorPanel advisor={featuredAdvisor} /> : null}
        </div>

        <div className="dashboard-grid__right">
          <LiveEventStream />

          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Connected projects</p>
                <h2>{summarizeProjects(projects)}</h2>
              </div>
              <StatusPill label="Control room live" tone="accent" />
            </header>
            <div className="project-strip">
              {projects.length === 0 ? (
                <p className="muted">Use the onboarding form to connect the first project.</p>
              ) : (
                projects.map((project) => (
                  <article key={project.id} className="project-tile">
                    <strong>{project.name}</strong>
                    <span>{project.repoUrl || 'No repo URL provided'}</span>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="panel panel--federation">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Federation</p>
                <h2>{summarizeSatellites(satellites)}</h2>
              </div>
              <StatusPill label="Coordinator view" tone="accent" />
            </header>
            <div className="project-strip">
              {satellites.length === 0 ? (
                <p className="muted">Enable satellite heartbeats to see regional controllers show up here.</p>
              ) : (
                satellites.map((satellite) => (
                  <Link key={satellite.id} href={`/satellites/${satellite.id}`} className="project-tile project-tile--satellite">
                    <div className="project-tile__head">
                      <strong>{satellite.name}</strong>
                      <StatusPill label={satellite.healthStatus} tone={toneForSatellite(satellite)} />
                    </div>
                    <span>
                      {[satellite.cloud, satellite.region, satellite.clusterName].filter(Boolean).join(' / ') || 'Location not reported'}
                    </span>
                    <span>
                      {satellite.heartbeatAgeSec === null
                        ? 'No heartbeat yet'
                        : `Seen ${satellite.heartbeatAgeSec}s ago, every ${satellite.heartbeatIntervalSec}s`}
                    </span>
                    <div className="project-tile__meta">
                      <StatusPill
                        label={satellite.capabilities?.taskWorker === true ? 'task worker' : 'heartbeat only'}
                        tone={satellite.capabilities?.taskWorker === true ? 'good' : 'accent'}
                      />
                      <span>Open details</span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </section>

          <section className="panel panel--rollouts">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Rollout board</p>
                <h2>Live traffic steps, AI shadow advice, federation tasks, and audit context.</h2>
              </div>
            </header>

            <div className="rollout-grid">
              {rollouts.length === 0 ? (
                <p className="muted">
                  No deployments yet. Onboard a project and include a revision to create the first rollout from this page.
                </p>
              ) : (
                rollouts.map((rollout) => <RolloutCard key={rollout.id} rollout={rollout} />)
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}
