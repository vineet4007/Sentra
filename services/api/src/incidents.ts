/**
 * Automated Incident Detection
 * Analyzes rollout failures and generates structured incidents
 */

export interface IncidentEvent {
  type: 'rollout_failure' | 'gate_failure' | 'telemetry_degradation' | 'timeout' | 'unknown'
  severity: 'critical' | 'high' | 'medium' | 'low'
  deploymentId: number
  timestamp: Date
  message: string
  rootCause?: string
  suggestedAction?: string
  context: Record<string, any>
}

export interface Incident {
  id: string
  deploymentId: number
  title: string
  description: string
  events: IncidentEvent[]
  status: 'open' | 'acknowledged' | 'resolved'
  severity: 'critical' | 'high' | 'medium' | 'low'
  createdAt: Date
  updatedAt: Date
  resolvedAt?: Date
  assignee?: string
  notes?: string[]
}

export interface IncidentDetectionConfig {
  enabled: boolean
  consecutiveFailureThreshold: number
  errorRateThreshold: number // percentage
  latencyThreshold: number // milliseconds
  timeWindowMs: number
}

/**
 * Incident detector that analyzes rollout telemetry
 */
export class IncidentDetector {
  private config: IncidentDetectionConfig
  private incidents: Map<number, Incident> = new Map()
  private recentFailures: Map<number, IncidentEvent[]> = new Map()

  constructor(config: Partial<IncidentDetectionConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      consecutiveFailureThreshold: config.consecutiveFailureThreshold ?? 3,
      errorRateThreshold: config.errorRateThreshold ?? 5,
      latencyThreshold: config.latencyThreshold ?? 1000,
      timeWindowMs: config.timeWindowMs ?? 300000, // 5 minutes
    }
  }

  /**
   * Detect incidents from rollout gate failures
   */
  detectGateFailure(
    deploymentId: number,
    gateName: string,
    failureReason: string,
    context: Record<string, any>,
  ): IncidentEvent | null {
    const event: IncidentEvent = {
      type: 'gate_failure',
      severity: 'high',
      deploymentId,
      timestamp: new Date(),
      message: `Gate "${gateName}" failed: ${failureReason}`,
      context,
    }

    return this.analyzeEvent(event)
  }

  /**
   * Detect incidents from telemetry degradation
   */
  detectTelemetryDegradation(
    deploymentId: number,
    signal: string,
    previousValue: number,
    currentValue: number,
    threshold: number,
  ): IncidentEvent | null {
    const degradation = currentValue - previousValue
    const percentChange = (degradation / previousValue) * 100

    if (Math.abs(percentChange) < threshold) {
      return null
    }

    const event: IncidentEvent = {
      type: 'telemetry_degradation',
      severity: percentChange > 20 ? 'critical' : 'high',
      deploymentId,
      timestamp: new Date(),
      message: `Telemetry signal "${signal}" degraded by ${percentChange.toFixed(1)}%`,
      rootCause: this.analyzeRootCause(signal, previousValue, currentValue),
      suggestedAction: this.suggestAction(signal, percentChange),
      context: {
        signal,
        previousValue,
        currentValue,
        percentChange,
      },
    }

    return this.analyzeEvent(event)
  }

  /**
   * Detect timeout incidents
   */
  detectTimeout(deploymentId: number, operation: string, duration: number): IncidentEvent | null {
    const event: IncidentEvent = {
      type: 'timeout',
      severity: 'high',
      deploymentId,
      timestamp: new Date(),
      message: `Operation "${operation}" timed out after ${duration}ms`,
      suggestedAction: 'Check service health and consider increasing timeout thresholds',
      context: {
        operation,
        duration,
      },
    }

    return this.analyzeEvent(event)
  }

  /**
   * Detect rollout failures
   */
  detectRolloutFailure(
    deploymentId: number,
    reason: string,
    step: number,
    context: Record<string, any>,
  ): IncidentEvent | null {
    const event: IncidentEvent = {
      type: 'rollout_failure',
      severity: 'critical',
      deploymentId,
      timestamp: new Date(),
      message: `Rollout failed at step ${step}: ${reason}`,
      rootCause: this.analyzeRootCause('rollout', step, 0),
      suggestedAction: 'Review rollout logs and perform rollback if necessary',
      context: {
        step,
        reason,
        ...context,
      },
    }

    return this.analyzeEvent(event)
  }

  /**
   * Analyze an event and potentially create an incident
   */
  private analyzeEvent(event: IncidentEvent): IncidentEvent | null {
    if (!this.config.enabled) {
      return null
    }

    const deploymentFailures = this.recentFailures.get(event.deploymentId) || []
    deploymentFailures.push(event)

    // Keep only recent failures
    const cutoffTime = Date.now() - this.config.timeWindowMs
    const recentEvents = deploymentFailures.filter((e) => e.timestamp.getTime() > cutoffTime)
    this.recentFailures.set(event.deploymentId, recentEvents)

    // Create incident if threshold is exceeded
    if (
      recentEvents.length >= this.config.consecutiveFailureThreshold &&
      !this.hasOpenIncident(event.deploymentId)
    ) {
      this.createIncident(event.deploymentId, recentEvents)
    }

    return event
  }

  /**
   * Create a new incident
   */
  private createIncident(deploymentId: number, events: IncidentEvent[]): void {
    const id = `incident-${deploymentId}-${Date.now()}`
    const severity = this.determineSeverity(events)

    const incident: Incident = {
      id,
      deploymentId,
      title: this.generateTitle(events),
      description: this.generateDescription(events),
      events,
      status: 'open',
      severity,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    }

    this.incidents.set(deploymentId, incident)
  }

  /**
   * Check if an open incident exists for a deployment
   */
  private hasOpenIncident(deploymentId: number): boolean {
    const incident = this.incidents.get(deploymentId)
    return incident != null && incident.status === 'open'
  }

  /**
   * Determine incident severity from events
   */
  private determineSeverity(events: IncidentEvent[]): 'critical' | 'high' | 'medium' | 'low' {
    const hasRolloutFailure = events.some((e) => e.type === 'rollout_failure')
    const hasCritical = events.some((e) => e.severity === 'critical')

    if (hasRolloutFailure || hasCritical) {
      return 'critical'
    }
    return 'high'
  }

  /**
   * Generate incident title
   */
  private generateTitle(events: IncidentEvent[]): string {
    const failureTypes = new Set(events.map((e) => e.type))
    if (failureTypes.size === 1) {
      return `${events[0].type.replace(/_/g, ' ')}`
    }
    return `Multiple deployment failures detected`
  }

  /**
   * Generate incident description
   */
  private generateDescription(events: IncidentEvent[]): string {
    const messages = events.slice(0, 3).map((e) => `• ${e.message}`)
    if (events.length > 3) {
      messages.push(`• ${events.length - 3} more events...`)
    }
    return messages.join('\n')
  }

  /**
   * Analyze root cause
   */
  private analyzeRootCause(signal: string, previousValue: number, currentValue: number): string {
    if (signal === 'error_rate') {
      return 'Application errors increased significantly'
    }
    if (signal === 'latency') {
      return 'Service latency degraded'
    }
    if (signal === 'log_error_ratio') {
      return 'Increased error logs detected'
    }
    if (signal === 'trace_error_ratio') {
      return 'Trace analysis shows increased failures'
    }
    return 'Unknown root cause'
  }

  /**
   * Suggest action
   */
  private suggestAction(signal: string, percentChange: number): string {
    if (signal === 'error_rate') {
      return percentChange > 30 ? 'Immediately rollback deployment' : 'Pause rollout and investigate'
    }
    if (signal === 'latency') {
      return percentChange > 50 ? 'Consider rollback' : 'Monitor closely'
    }
    return 'Review metrics and logs'
  }

  /**
   * Get incident by ID
   */
  getIncident(id: string): Incident | undefined {
    for (const incident of this.incidents.values()) {
      if (incident.id === id) {
        return incident
      }
    }
    return undefined
  }

  /**
   * Get incidents for deployment
   */
  getIncidents(deploymentId?: number): Incident[] {
    if (deploymentId != null) {
      const incident = this.incidents.get(deploymentId)
      return incident ? [incident] : []
    }
    return Array.from(this.incidents.values())
  }

  /**
   * Acknowledge incident
   */
  acknowledgeIncident(id: string, assignee?: string): boolean {
    for (const incident of this.incidents.values()) {
      if (incident.id === id) {
        incident.status = 'acknowledged'
        incident.updatedAt = new Date()
        incident.assignee = assignee
        return true
      }
    }
    return false
  }

  /**
   * Resolve incident
   */
  resolveIncident(id: string, notes?: string): boolean {
    for (const incident of this.incidents.values()) {
      if (incident.id === id) {
        incident.status = 'resolved'
        incident.updatedAt = new Date()
        incident.resolvedAt = new Date()
        if (notes) {
          incident.notes?.push(notes)
        }
        return true
      }
    }
    return false
  }

  /**
   * Add notes to incident
   */
  addNote(id: string, note: string): boolean {
    for (const incident of this.incidents.values()) {
      if (incident.id === id) {
        incident.notes?.push(note)
        incident.updatedAt = new Date()
        return true
      }
    }
    return false
  }
}

/**
 * Create global incident detector
 */
export const globalIncidentDetector = new IncidentDetector({
  enabled: process.env.SENTRA_INCIDENT_DETECTION_ENABLED !== 'false',
  consecutiveFailureThreshold: Number.parseInt(process.env.SENTRA_INCIDENT_FAILURE_THRESHOLD || '3'),
  errorRateThreshold: Number.parseFloat(process.env.SENTRA_INCIDENT_ERROR_RATE_THRESHOLD || '5'),
  timeWindowMs: Number.parseInt(process.env.SENTRA_INCIDENT_TIME_WINDOW_MS || '300000'),
})
