from fastapi import FastAPI

from .advisor import build_ai_advisor
from .models import (
    Envelope,
    HealthResponse,
    RolloutAdvisorBatchRequest,
    RolloutAdvisorBatchResponseData,
    RolloutAdvisorResult,
)

app = FastAPI(
    title="Sentra AI Advisor",
    version="0.1.0",
    summary="Shadow-mode rollout advisory service for Sentra.",
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.post("/advisories/rollouts", response_model=Envelope)
def advise_rollouts(request: RolloutAdvisorBatchRequest) -> Envelope:
    items = [
        RolloutAdvisorResult(
            deploymentId=context.deploymentId,
            advisor=build_ai_advisor(context),
        )
        for context in request.items
    ]

    return Envelope(
        data=RolloutAdvisorBatchResponseData(
            items=items,
            count=len(items),
        )
    )
