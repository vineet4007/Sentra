'use client'

import type { Project, Rollout } from '@/lib/types'
import { OnboardingPanel } from '@/components/onboarding-panel'
import { LiveEventStream } from '@/components/live-event-stream'
import { RolloutCard } from '@/components/rollout-card'
import { StatusPill } from '@/components/status-pill'

type DashboardShellProps = {
  projects: Project[]
  rollouts: Rollout[]
}

function summarizeProjects(projects: Project[]) {
  if (projects.length === 0) {
    return 'No projects are connected yet.'
  }

  return `${projects.length} project${projects.length === 1 ? '' : 's'} connected to the control plane.`
}

export function DashboardShell({ projects, rollouts }: DashboardShellProps) {
  return (
    <main className="dashboard">
      <section className="hero-card">
        <div className="hero-card__copy">
          <p className="eyebrow">Sentra control room</p>
          <h1>One place to wire rollouts, read live health, and understand every promote, pause, or rollback.</h1>
          <p>
            Sentra is already evaluating telemetry and executing the first adapter loop in simulation mode. This
            screen turns that backend into something operators can actually use.
          </p>
        </div>
        <div className="hero-card__stats">
          <article>
            <strong>{projects.length}</strong>
            <span>projects</span>
          </article>
          <article>
            <strong>{rollouts.length}</strong>
            <span>active rollouts shown</span>
          </article>
          <article>
            <strong>{rollouts.filter((rollout) => rollout.incidents.length > 0).length}</strong>
            <span>rollouts with incidents</span>
          </article>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="dashboard-grid__left">
          <OnboardingPanel projectCount={projects.length} />
        </div>

        <div className="dashboard-grid__right">
          <LiveEventStream />

          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Connected projects</p>
                <h2>{summarizeProjects(projects)}</h2>
              </div>
              <StatusPill label="UI live" tone="accent" />
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

          <section className="panel">
            <header className="panel__header">
              <div>
                <p className="eyebrow">Rollout board</p>
                <h2>Live traffic steps, gate results, and audit context.</h2>
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
