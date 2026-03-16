package main

import (
	"context"
	"testing"
	"time"
)

func TestDecisionEngineWarmupHold(t *testing.T) {
	engine := newDecisionEngine(newTelemetryService(controllerConfig{}), nil)

	request := evaluationRequest{
		Policy: rolloutPolicy{
			RolloutSteps:        []int{5, 25, 50, 100},
			EvaluationWindowSec: 60,
			PollIntervalSec:     5,
			WarmupSec:           30,
			RequiredPasses:      3,
			FailureMode:         "rollback",
			SLOConfig: map[string]policyGateSpec{
				"errorRatePct": {Max: float64Ptr(2)},
			},
		},
		State: rolloutEvaluationState{
			CurrentStepIndex: 0,
			CurrentWeight:    5,
			StepStartedAt:    time.Now().Add(-10 * time.Second),
		},
		TelemetrySnapshot: &rolloutTelemetrySnapshot{
			Metrics: map[string]telemetrySignal{
				"errorRatePct": {
					Name:   "error_rate_pct",
					Source: "prometheus",
					Status: signalStatusOK,
					Value:  floatPointer(0.4),
				},
			},
		},
	}

	response, err := engine.evaluate(context.Background(), request)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if response.Decision != decisionHold {
		t.Fatalf("expected hold during warmup, got %s", response.Decision)
	}
	if response.WarmupRemainingSec <= 0 {
		t.Fatalf("expected positive warmup remaining, got %d", response.WarmupRemainingSec)
	}
}

func TestDecisionEnginePromotesAfterRequiredPasses(t *testing.T) {
	engine := newDecisionEngine(newTelemetryService(controllerConfig{}), nil)

	request := evaluationRequest{
		Policy: rolloutPolicy{
			RolloutSteps:        []int{5, 25, 50, 100},
			EvaluationWindowSec: 60,
			PollIntervalSec:     5,
			WarmupSec:           0,
			RequiredPasses:      3,
			FailureMode:         "pause",
			SLOConfig: map[string]policyGateSpec{
				"errorRatePct":     {Max: float64Ptr(2)},
				"latencyP95Ms":     {Max: float64Ptr(500)},
				"logErrorRatioPct": {Max: float64Ptr(1)},
			},
		},
		State: rolloutEvaluationState{
			CurrentStepIndex:  0,
			CurrentWeight:     5,
			ConsecutivePasses: 2,
			StepStartedAt:     time.Now().Add(-2 * time.Minute),
			LastEvaluationAt:  time.Now().Add(-5 * time.Second),
		},
		TelemetrySnapshot: passingSnapshot(),
	}

	response, err := engine.evaluate(context.Background(), request)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if response.Decision != decisionPromote {
		t.Fatalf("expected promote, got %s", response.Decision)
	}
	if response.TargetWeight != 25 {
		t.Fatalf("expected next target weight 25, got %d", response.TargetWeight)
	}
	if response.NextState.CurrentStepIndex != 1 {
		t.Fatalf("expected next step index 1, got %d", response.NextState.CurrentStepIndex)
	}
}

func TestDecisionEnginePausesOnGateFailureWhenConfigured(t *testing.T) {
	engine := newDecisionEngine(newTelemetryService(controllerConfig{}), nil)

	request := evaluationRequest{
		Policy: rolloutPolicy{
			RolloutSteps:        []int{5, 25, 50, 100},
			EvaluationWindowSec: 60,
			PollIntervalSec:     5,
			RequiredPasses:      2,
			FailureMode:         "pause",
			SLOConfig: map[string]policyGateSpec{
				"latencyP95Ms": {Max: float64Ptr(500)},
			},
		},
		State: rolloutEvaluationState{
			CurrentStepIndex: 0,
			CurrentWeight:    5,
			StepStartedAt:    time.Now().Add(-2 * time.Minute),
		},
		TelemetrySnapshot: &rolloutTelemetrySnapshot{
			Metrics: map[string]telemetrySignal{
				"latencyP95Ms": {
					Name:   "latency_p95_ms",
					Source: "prometheus",
					Status: signalStatusOK,
					Value:  floatPointer(840),
				},
			},
		},
	}

	response, err := engine.evaluate(context.Background(), request)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if response.Decision != decisionPause {
		t.Fatalf("expected pause, got %s", response.Decision)
	}
}

func TestDecisionEngineRollsBackOnCriticalGateFailure(t *testing.T) {
	engine := newDecisionEngine(newTelemetryService(controllerConfig{}), nil)

	request := evaluationRequest{
		Policy: rolloutPolicy{
			RolloutSteps:        []int{5, 25, 50, 100},
			EvaluationWindowSec: 60,
			PollIntervalSec:     5,
			RequiredPasses:      2,
			FailureMode:         "pause",
			SLOConfig: map[string]policyGateSpec{
				"errorRatePct": {
					Max:           float64Ptr(2),
					RollbackAbove: float64Ptr(5),
				},
			},
		},
		State: rolloutEvaluationState{
			CurrentStepIndex: 1,
			CurrentWeight:    25,
			StepStartedAt:    time.Now().Add(-2 * time.Minute),
		},
		TelemetrySnapshot: &rolloutTelemetrySnapshot{
			Metrics: map[string]telemetrySignal{
				"errorRatePct": {
					Name:   "error_rate_pct",
					Source: "prometheus",
					Status: signalStatusOK,
					Value:  floatPointer(9.2),
				},
			},
		},
	}

	response, err := engine.evaluate(context.Background(), request)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if response.Decision != decisionRollback {
		t.Fatalf("expected rollback, got %s", response.Decision)
	}
}

func TestDecisionEnginePausesOnNoData(t *testing.T) {
	engine := newDecisionEngine(newTelemetryService(controllerConfig{}), nil)

	request := evaluationRequest{
		Policy: rolloutPolicy{
			RolloutSteps:        []int{5, 25, 50, 100},
			EvaluationWindowSec: 60,
			PollIntervalSec:     5,
			RequiredPasses:      2,
			FailureMode:         "rollback",
			SLOConfig: map[string]policyGateSpec{
				"recentTraceCount": {Min: float64Ptr(1)},
			},
		},
		State: rolloutEvaluationState{
			CurrentStepIndex: 0,
			CurrentWeight:    5,
			StepStartedAt:    time.Now().Add(-2 * time.Minute),
		},
		TelemetrySnapshot: &rolloutTelemetrySnapshot{
			Traces: map[string]telemetrySignal{
				"recentTraceCount": {
					Name:   "recent_trace_count",
					Source: "tempo",
					Status: signalStatusNoData,
				},
			},
		},
	}

	response, err := engine.evaluate(context.Background(), request)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if response.Decision != decisionPause {
		t.Fatalf("expected pause on no data, got %s", response.Decision)
	}
}

func passingSnapshot() *rolloutTelemetrySnapshot {
	return &rolloutTelemetrySnapshot{
		Metrics: map[string]telemetrySignal{
			"errorRatePct": {
				Name:   "error_rate_pct",
				Source: "prometheus",
				Status: signalStatusOK,
				Value:  floatPointer(0.4),
			},
			"latencyP95Ms": {
				Name:   "latency_p95_ms",
				Source: "prometheus",
				Status: signalStatusOK,
				Value:  floatPointer(182),
			},
		},
		Logs: map[string]telemetrySignal{
			"logErrorRatioPct": {
				Name:   "log_error_ratio_pct",
				Source: "loki",
				Status: signalStatusOK,
				Value:  floatPointer(0.2),
			},
		},
	}
}

func float64Ptr(value float64) *float64 {
	return &value
}
