from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


Tone = Literal["neutral", "good", "warn", "critical", "accent"]
Recommendation = Literal["continue", "pause", "rollback", "investigate", "collect_more_data"]
Severity = Literal["low", "elevated", "high", "critical"]
AnomalySeverity = Literal["low", "medium", "high", "critical"]
PredictedOutcome = Literal["stable", "watch", "rollback_risk", "rollback_expected", "awaiting_data"]


class GateLike(BaseModel):
    name: str | None = None
    signalStatus: str | None = None
    passed: bool | None = None
    severe: bool | None = None
    value: float | None = None
    unit: str | None = None
    reason: str | None = None
    threshold: dict[str, float | None] | None = None


class IncidentLike(BaseModel):
    severity: str | None = None
    status: str | None = None
    summary: str | None = None


class SatelliteTaskLike(BaseModel):
    status: str | None = None
    satelliteName: str | None = None
    errorMessage: str | None = None


class EvaluationLike(BaseModel):
    gateResults: list[GateLike] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)
    rolloutComplete: bool | None = None


class LiveStateLike(BaseModel):
    decision: str | None = None
    evaluation: EvaluationLike | None = None


class StepLike(BaseModel):
    status: str | None = None


class AuditLike(BaseModel):
    eventType: str | None = None
    summary: str | None = None


class AiAdvisorSignal(BaseModel):
    label: str
    tone: Tone
    value: str


class AiAdvisorAnomaly(BaseModel):
    kind: Literal[
        "incident_pressure",
        "telemetry_failure",
        "telemetry_gap",
        "threshold_margin",
        "federation_failure",
        "healthy_progress",
        "baseline_shift",
    ]
    severity: AnomalySeverity
    label: str
    summary: str


class AiAdvisorPrediction(BaseModel):
    predictedOutcome: PredictedOutcome
    rollbackProbabilityPct: int
    nextStepRiskPct: int
    shouldEscalate: bool


class AiAdvisor(BaseModel):
    mode: Literal["shadow"] = "shadow"
    engine: str = "fastapi-shadow-v1"
    recommendation: Recommendation
    severity: Severity
    confidencePct: int
    riskScore: int
    headline: str
    summary: str
    rationales: list[str]
    signals: list[AiAdvisorSignal]
    anomalies: list[AiAdvisorAnomaly]
    prediction: AiAdvisorPrediction


class RolloutAdvisorContext(BaseModel):
    deploymentId: int
    status: str
    currentWeight: int
    lastDecision: str | None = None
    lastDecisionReason: str | None = None
    liveState: LiveStateLike | None = None
    incidents: list[IncidentLike] = Field(default_factory=list)
    steps: list[StepLike] = Field(default_factory=list)
    auditEvents: list[AuditLike] = Field(default_factory=list)
    satelliteTasks: list[SatelliteTaskLike] = Field(default_factory=list)
    metadata: dict[str, Any] | None = None


class RolloutAdvisorResult(BaseModel):
    deploymentId: int
    advisor: AiAdvisor


class RolloutAdvisorBatchRequest(BaseModel):
    items: list[RolloutAdvisorContext] = Field(default_factory=list)


class RolloutAdvisorBatchResponseData(BaseModel):
    items: list[RolloutAdvisorResult]
    count: int


class Envelope(BaseModel):
    ok: bool = True
    data: RolloutAdvisorBatchResponseData


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    mode: Literal["shadow"] = "shadow"
    engine: str = "fastapi-shadow-v1"
