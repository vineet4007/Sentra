package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

var (
	rolloutEvaluationsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "sentra_controller_rollout_evaluations_total",
		Help: "Number of rollout evaluations performed by the controller.",
	}, []string{"result"})
	rolloutDecisionsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "sentra_controller_rollout_decisions_total",
		Help: "Number of rollout decisions emitted by the controller.",
	}, []string{"decision"})
	rolloutGateFailuresTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "sentra_controller_rollout_gate_failures_total",
		Help: "Number of rollout gate failures by gate and outcome.",
	}, []string{"gate", "outcome"})
)

type rolloutDecision string

const (
	decisionInitialize rolloutDecision = "initialize"
	decisionHold       rolloutDecision = "hold"
	decisionPromote    rolloutDecision = "promote"
	decisionPause      rolloutDecision = "pause"
	decisionRollback   rolloutDecision = "rollback"
)

type decisionEngine struct {
	telemetry  *telemetryService
	stateStore *rolloutStateStore
}

type evaluationRequest struct {
	DeploymentID      int64                     `json:"deploymentId,omitempty"`
	RolloutStepID     int64                     `json:"rolloutStepId,omitempty"`
	Labels            telemetryLabels           `json:"labels"`
	LabelMap          telemetryLabelMap         `json:"labelMap"`
	Policy            rolloutPolicy             `json:"policy"`
	State             rolloutEvaluationState    `json:"state"`
	TelemetrySnapshot *rolloutTelemetrySnapshot `json:"telemetrySnapshot,omitempty"`
}

type rolloutPolicy struct {
	RolloutSteps        []int                     `json:"rolloutSteps"`
	EvaluationWindowSec int                       `json:"evaluationWindowSec"`
	PollIntervalSec     int                       `json:"pollIntervalSec"`
	WarmupSec           int                       `json:"warmupSec"`
	RequiredPasses      int                       `json:"requiredPasses"`
	FailureMode         string                    `json:"failureMode"`
	SLOConfig           map[string]policyGateSpec `json:"sloConfig"`
}

type policyGateSpec struct {
	Max           *float64 `json:"max,omitempty"`
	Min           *float64 `json:"min,omitempty"`
	RollbackAbove *float64 `json:"rollbackAbove,omitempty"`
	RollbackBelow *float64 `json:"rollbackBelow,omitempty"`
}

type rolloutEvaluationState struct {
	CurrentStepIndex    int       `json:"currentStepIndex"`
	CurrentWeight       int       `json:"currentWeight"`
	ConsecutivePasses   int       `json:"consecutivePasses"`
	ConsecutiveFailures int       `json:"consecutiveFailures"`
	StepStartedAt       time.Time `json:"stepStartedAt"`
	LastEvaluationAt    time.Time `json:"lastEvaluationAt,omitempty"`
	LastDecision        string    `json:"lastDecision,omitempty"`
	LastDecisionReason  string    `json:"lastDecisionReason,omitempty"`
}

type gateEvaluationResult struct {
	Name         string         `json:"name"`
	Source       string         `json:"source"`
	Query        string         `json:"query"`
	Unit         string         `json:"unit,omitempty"`
	SignalStatus signalStatus   `json:"signalStatus"`
	Passed       bool           `json:"passed"`
	Severe       bool           `json:"severe"`
	Value        *float64       `json:"value,omitempty"`
	Threshold    policyGateSpec `json:"threshold"`
	Reason       string         `json:"reason"`
}

type evaluationResponse struct {
	Decision           rolloutDecision          `json:"decision"`
	Summary            string                   `json:"summary"`
	Reasons            []string                 `json:"reasons"`
	RolloutComplete    bool                     `json:"rolloutComplete"`
	CurrentStepIndex   int                      `json:"currentStepIndex"`
	TargetStepIndex    int                      `json:"targetStepIndex"`
	CurrentWeight      int                      `json:"currentWeight"`
	TargetWeight       int                      `json:"targetWeight"`
	RequiredPasses     int                      `json:"requiredPasses"`
	WarmupRemainingSec int                      `json:"warmupRemainingSec"`
	NextState          rolloutEvaluationState   `json:"nextState"`
	GateResults        []gateEvaluationResult   `json:"gateResults"`
	TelemetrySnapshot  rolloutTelemetrySnapshot `json:"telemetrySnapshot"`
}

func newDecisionEngine(telemetry *telemetryService, stateStore *rolloutStateStore) *decisionEngine {
	return &decisionEngine{telemetry: telemetry, stateStore: stateStore}
}

func (e *decisionEngine) handleEvaluate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{
			"ok": false,
			"error": map[string]string{
				"message": "method not allowed",
			},
		})
		return
	}

	var request evaluationRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		rolloutEvaluationsTotal.WithLabelValues("invalid_request").Inc()
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false,
			"error": map[string]string{
				"message": fmt.Sprintf("invalid JSON request body: %v", err),
			},
		})
		return
	}

	if err := ensureNoTrailingJSON(decoder); err != nil {
		rolloutEvaluationsTotal.WithLabelValues("invalid_request").Inc()
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false,
			"error": map[string]string{
				"message": err.Error(),
			},
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), e.telemetry.config.TelemetryQueryTimeout)
	defer cancel()

	result, err := e.evaluate(ctx, request)
	if err != nil {
		rolloutEvaluationsTotal.WithLabelValues("invalid_request").Inc()
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false,
			"error": map[string]string{
				"message": err.Error(),
			},
		})
		return
	}

	if e.stateStore != nil {
		if err := e.stateStore.publishEvaluation(ctx, request, result); err != nil {
			rolloutEvaluationsTotal.WithLabelValues("publish_error").Inc()
			writeJSON(w, http.StatusBadGateway, map[string]any{
				"ok": false,
				"error": map[string]string{
					"message": fmt.Sprintf("failed to publish rollout state to Redis: %v", err),
				},
			})
			return
		}
	}

	rolloutEvaluationsTotal.WithLabelValues("ok").Inc()
	rolloutDecisionsTotal.WithLabelValues(string(result.Decision)).Inc()

	for _, gate := range result.GateResults {
		if gate.SignalStatus == signalStatusError {
			rolloutGateFailuresTotal.WithLabelValues(gate.Name, "error").Inc()
		} else if gate.SignalStatus == signalStatusNoData {
			rolloutGateFailuresTotal.WithLabelValues(gate.Name, "no_data").Inc()
		} else if !gate.Passed {
			rolloutGateFailuresTotal.WithLabelValues(gate.Name, "threshold").Inc()
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": result,
	})
}

func (e *decisionEngine) evaluate(ctx context.Context, request evaluationRequest) (evaluationResponse, error) {
	policy, err := normalizeRolloutPolicy(request.Policy)
	if err != nil {
		return evaluationResponse{}, err
	}

	state, err := normalizeRolloutState(request.State, policy)
	if err != nil {
		return evaluationResponse{}, err
	}

	snapshot, err := e.resolveSnapshot(ctx, request, policy)
	if err != nil {
		return evaluationResponse{}, err
	}

	results, stats, reasons := evaluatePolicyGates(policy, snapshot)
	now := time.Now().UTC()

	if warmupRemaining := remainingWarmup(policy, state, now); warmupRemaining > 0 {
		summary := fmt.Sprintf(
			"Current rollout step is still warming up for %d more seconds before Sentra can evaluate promotion.",
			warmupRemaining,
		)
		reasons = append([]string{summary}, reasons...)
		return evaluationResponse{
			Decision:           decisionHold,
			Summary:            summary,
			Reasons:            reasons,
			CurrentStepIndex:   state.CurrentStepIndex,
			TargetStepIndex:    state.CurrentStepIndex,
			CurrentWeight:      state.CurrentWeight,
			TargetWeight:       state.CurrentWeight,
			RequiredPasses:     policy.RequiredPasses,
			WarmupRemainingSec: warmupRemaining,
			NextState:          state.withDecision(decisionHold, summary),
			GateResults:        results,
			TelemetrySnapshot:  snapshot,
		}, nil
	}

	if stats.Blocked > 0 {
		nextState := state
		nextState.ConsecutivePasses = 0
		nextState.ConsecutiveFailures++
		summary := "Telemetry is missing or unavailable for one or more required rollout gates, so Sentra is pausing the rollout."
		return evaluationResponse{
			Decision:          decisionPause,
			Summary:           summary,
			Reasons:           append([]string{summary}, reasons...),
			CurrentStepIndex:  state.CurrentStepIndex,
			TargetStepIndex:   state.CurrentStepIndex,
			CurrentWeight:     state.CurrentWeight,
			TargetWeight:      state.CurrentWeight,
			RequiredPasses:    policy.RequiredPasses,
			NextState:         nextState.withDecision(decisionPause, summary),
			GateResults:       results,
			TelemetrySnapshot: snapshot,
		}, nil
	}

	if stats.Failures > 0 {
		nextState := state
		nextState.ConsecutivePasses = 0
		nextState.ConsecutiveFailures++

		decision := decisionPause
		summary := "One or more rollout gates failed, so Sentra is pausing the rollout."
		if stats.Severe > 0 || policy.FailureMode == string(decisionRollback) {
			decision = decisionRollback
			summary = "One or more rollout gates failed critically, so Sentra is rolling the deployment back."
		}

		return evaluationResponse{
			Decision:          decision,
			Summary:           summary,
			Reasons:           append([]string{summary}, reasons...),
			CurrentStepIndex:  state.CurrentStepIndex,
			TargetStepIndex:   state.CurrentStepIndex,
			CurrentWeight:     state.CurrentWeight,
			TargetWeight:      state.CurrentWeight,
			RequiredPasses:    policy.RequiredPasses,
			NextState:         nextState.withDecision(decision, summary),
			GateResults:       results,
			TelemetrySnapshot: snapshot,
		}, nil
	}

	nextPasses := state.ConsecutivePasses + 1
	if nextPasses < policy.RequiredPasses {
		nextState := state
		nextState.ConsecutivePasses = nextPasses
		nextState.ConsecutiveFailures = 0

		summary := fmt.Sprintf(
			"All rollout gates passed, but Sentra needs %d consecutive healthy evaluations before promoting.",
			policy.RequiredPasses,
		)

		return evaluationResponse{
			Decision:          decisionHold,
			Summary:           summary,
			Reasons:           append([]string{summary}, reasons...),
			CurrentStepIndex:  state.CurrentStepIndex,
			TargetStepIndex:   state.CurrentStepIndex,
			CurrentWeight:     state.CurrentWeight,
			TargetWeight:      state.CurrentWeight,
			RequiredPasses:    policy.RequiredPasses,
			NextState:         nextState.withDecision(decisionHold, summary),
			GateResults:       results,
			TelemetrySnapshot: snapshot,
		}, nil
	}

	if state.CurrentStepIndex >= len(policy.RolloutSteps)-1 {
		nextState := state
		nextState.ConsecutivePasses = nextPasses
		nextState.ConsecutiveFailures = 0
		summary := "All rollout gates passed on the final step. Sentra considers the rollout healthy and complete."
		return evaluationResponse{
			Decision:          decisionPromote,
			Summary:           summary,
			Reasons:           append([]string{summary}, reasons...),
			RolloutComplete:   true,
			CurrentStepIndex:  state.CurrentStepIndex,
			TargetStepIndex:   state.CurrentStepIndex,
			CurrentWeight:     state.CurrentWeight,
			TargetWeight:      state.CurrentWeight,
			RequiredPasses:    policy.RequiredPasses,
			NextState:         nextState.withDecision(decisionPromote, summary),
			GateResults:       results,
			TelemetrySnapshot: snapshot,
		}, nil
	}

	targetStepIndex := state.CurrentStepIndex + 1
	targetWeight := policy.RolloutSteps[targetStepIndex]
	nextState := rolloutEvaluationState{
		CurrentStepIndex:    targetStepIndex,
		CurrentWeight:       targetWeight,
		ConsecutivePasses:   0,
		ConsecutiveFailures: 0,
		StepStartedAt:       now,
		LastEvaluationAt:    now,
		LastDecision:        string(decisionPromote),
		LastDecisionReason:  fmt.Sprintf("Promote to %d%% traffic after %d healthy evaluations.", targetWeight, nextPasses),
	}

	summary := fmt.Sprintf(
		"All rollout gates passed %d times in a row. Sentra is promoting traffic to %d%%.",
		nextPasses,
		targetWeight,
	)

	return evaluationResponse{
		Decision:          decisionPromote,
		Summary:           summary,
		Reasons:           append([]string{summary}, reasons...),
		CurrentStepIndex:  state.CurrentStepIndex,
		TargetStepIndex:   targetStepIndex,
		CurrentWeight:     state.CurrentWeight,
		TargetWeight:      targetWeight,
		RequiredPasses:    policy.RequiredPasses,
		NextState:         nextState,
		GateResults:       results,
		TelemetrySnapshot: snapshot,
	}, nil
}

func (e *decisionEngine) resolveSnapshot(
	ctx context.Context,
	request evaluationRequest,
	policy rolloutPolicy,
) (rolloutTelemetrySnapshot, error) {
	if request.TelemetrySnapshot != nil {
		return *request.TelemetrySnapshot, nil
	}

	if request.Labels.Service == "" && request.Labels.Project == "" && request.Labels.Environment == "" {
		return rolloutTelemetrySnapshot{}, fmt.Errorf("labels are required when telemetrySnapshot is not provided")
	}

	options := telemetryQueryOptions{
		Labels:   request.Labels,
		LabelMap: mergeLabelMapDefaults(request.LabelMap),
		Window: telemetryWindow{
			RangeSec: int64(policy.EvaluationWindowSec),
			StepSec:  int64(policy.PollIntervalSec),
		},
		Limit: 20,
	}

	return e.telemetry.buildSnapshot(ctx, options), nil
}

func normalizeRolloutPolicy(policy rolloutPolicy) (rolloutPolicy, error) {
	if len(policy.RolloutSteps) == 0 {
		return rolloutPolicy{}, fmt.Errorf("policy.rolloutSteps must contain at least one step")
	}

	for index, step := range policy.RolloutSteps {
		if step < 1 || step > 100 {
			return rolloutPolicy{}, fmt.Errorf("policy.rolloutSteps[%d] must be between 1 and 100", index)
		}
	}

	if len(policy.SLOConfig) == 0 {
		return rolloutPolicy{}, fmt.Errorf("policy.sloConfig must define at least one rollout gate")
	}

	if policy.EvaluationWindowSec <= 0 {
		policy.EvaluationWindowSec = 60
	}
	if policy.PollIntervalSec <= 0 {
		policy.PollIntervalSec = 5
	}
	if policy.WarmupSec < 0 {
		return rolloutPolicy{}, fmt.Errorf("policy.warmupSec cannot be negative")
	}
	if policy.RequiredPasses <= 0 {
		policy.RequiredPasses = 3
	}

	policy.FailureMode = strings.ToLower(strings.TrimSpace(policy.FailureMode))
	if policy.FailureMode == "" {
		policy.FailureMode = string(decisionRollback)
	}
	if policy.FailureMode != string(decisionPause) && policy.FailureMode != string(decisionRollback) {
		return rolloutPolicy{}, fmt.Errorf("policy.failureMode must be either %q or %q", decisionPause, decisionRollback)
	}

	for name, gate := range policy.SLOConfig {
		if !isSupportedGate(name) {
			return rolloutPolicy{}, fmt.Errorf("policy.sloConfig.%s is not supported yet", name)
		}
		if gate.Max == nil && gate.Min == nil && gate.RollbackAbove == nil && gate.RollbackBelow == nil {
			return rolloutPolicy{}, fmt.Errorf("policy.sloConfig.%s must define at least one threshold", name)
		}
	}

	return policy, nil
}

func normalizeRolloutState(state rolloutEvaluationState, policy rolloutPolicy) (rolloutEvaluationState, error) {
	if state.CurrentStepIndex < 0 || state.CurrentStepIndex >= len(policy.RolloutSteps) {
		return rolloutEvaluationState{}, fmt.Errorf("state.currentStepIndex must refer to a valid rollout step")
	}

	if state.CurrentWeight <= 0 {
		state.CurrentWeight = policy.RolloutSteps[state.CurrentStepIndex]
	}

	if state.ConsecutivePasses < 0 || state.ConsecutiveFailures < 0 {
		return rolloutEvaluationState{}, fmt.Errorf("state.consecutivePasses and state.consecutiveFailures cannot be negative")
	}

	if state.StepStartedAt.IsZero() {
		return rolloutEvaluationState{}, fmt.Errorf("state.stepStartedAt is required")
	}

	return state, nil
}

type gateEvaluationStats struct {
	Failures int
	Severe   int
	Blocked  int
}

func evaluatePolicyGates(
	policy rolloutPolicy,
	snapshot rolloutTelemetrySnapshot,
) ([]gateEvaluationResult, gateEvaluationStats, []string) {
	results := make([]gateEvaluationResult, 0, len(policy.SLOConfig))
	reasons := make([]string, 0, len(policy.SLOConfig))
	stats := gateEvaluationStats{}

	for _, gateName := range orderedGateNames(policy.SLOConfig) {
		spec := policy.SLOConfig[gateName]
		signal, ok := resolveSignal(snapshot, gateName)
		if !ok {
			result := gateEvaluationResult{
				Name:         gateName,
				SignalStatus: signalStatusError,
				Passed:       false,
				Threshold:    spec,
				Reason:       fmt.Sprintf("Sentra could not find a telemetry signal for gate %q.", gateName),
			}
			results = append(results, result)
			reasons = append(reasons, result.Reason)
			stats.Blocked++
			continue
		}

		result := gateEvaluationResult{
			Name:         gateName,
			Source:       signal.Source,
			Query:        signal.Query,
			Unit:         signal.Unit,
			SignalStatus: signal.Status,
			Value:        signal.Value,
			Threshold:    spec,
		}

		switch signal.Status {
		case signalStatusError:
			result.Passed = false
			result.Reason = fmt.Sprintf("%s is unavailable: %s", gateName, signal.Error)
			stats.Blocked++
		case signalStatusNoData:
			result.Passed = false
			result.Reason = fmt.Sprintf("%s has no data for the current evaluation window.", gateName)
			stats.Blocked++
		default:
			passed, severe, reason := evaluateThreshold(gateName, spec, signal)
			result.Passed = passed
			result.Severe = severe
			result.Reason = reason
			if !passed {
				stats.Failures++
				if severe {
					stats.Severe++
				}
			}
		}

		results = append(results, result)
		reasons = append(reasons, result.Reason)
	}

	return results, stats, reasons
}

func evaluateThreshold(name string, spec policyGateSpec, signal telemetrySignal) (bool, bool, string) {
	if signal.Value == nil {
		return false, false, fmt.Sprintf("%s did not provide a usable value.", name)
	}

	value := *signal.Value
	if spec.RollbackAbove != nil && value > *spec.RollbackAbove {
		return false, true, fmt.Sprintf("%s is %.3f, which exceeds the critical rollback threshold of %.3f.", name, value, *spec.RollbackAbove)
	}
	if spec.RollbackBelow != nil && value < *spec.RollbackBelow {
		return false, true, fmt.Sprintf("%s is %.3f, which is below the critical rollback threshold of %.3f.", name, value, *spec.RollbackBelow)
	}
	if spec.Max != nil && value > *spec.Max {
		return false, false, fmt.Sprintf("%s is %.3f, which is above the allowed maximum of %.3f.", name, value, *spec.Max)
	}
	if spec.Min != nil && value < *spec.Min {
		return false, false, fmt.Sprintf("%s is %.3f, which is below the allowed minimum of %.3f.", name, value, *spec.Min)
	}

	return true, false, fmt.Sprintf("%s is %.3f and within the configured threshold.", name, value)
}

func resolveSignal(snapshot rolloutTelemetrySnapshot, name string) (telemetrySignal, bool) {
	switch name {
	case "errorRatePct":
		signal, ok := snapshot.Metrics["errorRatePct"]
		return signal, ok
	case "latencyP95Ms":
		signal, ok := snapshot.Metrics["latencyP95Ms"]
		return signal, ok
	case "logErrorRatioPct":
		if signal, ok := snapshot.Logs["logErrorRatioPct"]; ok {
			return signal, true
		}
		signal, ok := snapshot.Logs["errorRatioPct"]
		return signal, ok
	case "recentTraceCount":
		signal, ok := snapshot.Traces["recentTraceCount"]
		return signal, ok
	default:
		return telemetrySignal{}, false
	}
}

func isSupportedGate(name string) bool {
	switch name {
	case "errorRatePct", "latencyP95Ms", "logErrorRatioPct", "recentTraceCount":
		return true
	default:
		return false
	}
}

func orderedGateNames(config map[string]policyGateSpec) []string {
	order := []string{"errorRatePct", "latencyP95Ms", "logErrorRatioPct", "recentTraceCount"}
	names := make([]string, 0, len(config))
	for _, candidate := range order {
		if _, ok := config[candidate]; ok {
			names = append(names, candidate)
		}
	}
	for name := range config {
		if !containsString(names, name) {
			names = append(names, name)
		}
	}
	return names
}

func remainingWarmup(policy rolloutPolicy, state rolloutEvaluationState, now time.Time) int {
	if policy.WarmupSec <= 0 {
		return 0
	}

	readyAt := state.StepStartedAt.Add(time.Duration(policy.WarmupSec) * time.Second)
	if !readyAt.After(now) {
		return 0
	}

	return int(readyAt.Sub(now).Seconds())
}

func mergeLabelMapDefaults(input telemetryLabelMap) telemetryLabelMap {
	defaults := telemetryLabelMap{
		Project:     "project",
		Service:     "service",
		Environment: "env",
		Version:     "version",
		Region:      "region",
		Cluster:     "cluster",
		Cloud:       "cloud",
	}

	if strings.TrimSpace(input.Project) != "" {
		defaults.Project = strings.TrimSpace(input.Project)
	}
	if strings.TrimSpace(input.Service) != "" {
		defaults.Service = strings.TrimSpace(input.Service)
	}
	if strings.TrimSpace(input.Environment) != "" {
		defaults.Environment = strings.TrimSpace(input.Environment)
	}
	if strings.TrimSpace(input.Version) != "" {
		defaults.Version = strings.TrimSpace(input.Version)
	}
	if strings.TrimSpace(input.Region) != "" {
		defaults.Region = strings.TrimSpace(input.Region)
	}
	if strings.TrimSpace(input.Cluster) != "" {
		defaults.Cluster = strings.TrimSpace(input.Cluster)
	}
	if strings.TrimSpace(input.Cloud) != "" {
		defaults.Cloud = strings.TrimSpace(input.Cloud)
	}

	return defaults
}

func (state rolloutEvaluationState) withDecision(decision rolloutDecision, reason string) rolloutEvaluationState {
	state.LastEvaluationAt = time.Now().UTC()
	state.LastDecision = string(decision)
	state.LastDecisionReason = reason
	return state
}

func ensureNoTrailingJSON(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err == nil {
		return fmt.Errorf("request body must contain exactly one JSON object")
	} else if err != io.EOF {
		return fmt.Errorf("failed to read request body: %v", err)
	}
	return nil
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
