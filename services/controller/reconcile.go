package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type rolloutReconciler struct {
	config     controllerConfig
	store      *controllerStore
	stateStore *rolloutStateStore
	decisions  *decisionEngine
}

type reconcileRequest struct {
	DeploymentID      int64                     `json:"deploymentId"`
	TelemetrySnapshot *rolloutTelemetrySnapshot `json:"telemetrySnapshot,omitempty"`
}

type reconcileResponse struct {
	DeploymentID int64               `json:"deploymentId"`
	Phase        string              `json:"phase"`
	Deployment   deploymentRuntime   `json:"deployment"`
	Action       rolloutAction       `json:"action"`
	Evaluation   *evaluationResponse `json:"evaluation,omitempty"`
	Warning      string              `json:"warning,omitempty"`
}

type deploymentRuntime struct {
	ID                 int64      `json:"id"`
	ServiceName        string     `json:"serviceName"`
	EnvironmentName    string     `json:"environmentName"`
	Revision           string     `json:"revision"`
	Status             string     `json:"status"`
	CurrentWeight      int        `json:"currentWeight"`
	LastDecision       string     `json:"lastDecision"`
	LastDecisionReason string     `json:"lastDecisionReason"`
	CurrentStepIndex   int        `json:"currentStepIndex"`
	RolloutStepID      int64      `json:"rolloutStepId"`
	CompletedAt        *time.Time `json:"completedAt,omitempty"`
}

func newRolloutReconciler(
	config controllerConfig,
	store *controllerStore,
	stateStore *rolloutStateStore,
	decisions *decisionEngine,
) *rolloutReconciler {
	return &rolloutReconciler{
		config:     config,
		store:      store,
		stateStore: stateStore,
		decisions:  decisions,
	}
}

func (r *rolloutReconciler) handleReconcile(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{
			"ok": false,
			"error": map[string]string{
				"message": "method not allowed",
			},
		})
		return
	}

	var request reconcileRequest
	decoder := json.NewDecoder(req.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false,
			"error": map[string]string{
				"message": fmt.Sprintf("invalid JSON request body: %v", err),
			},
		})
		return
	}
	if err := ensureNoTrailingJSON(decoder); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false,
			"error": map[string]string{
				"message": err.Error(),
			},
		})
		return
	}
	if request.DeploymentID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false,
			"error": map[string]string{
				"message": "deploymentId must be a positive integer",
			},
		})
		return
	}

	ctx, cancel := context.WithTimeout(req.Context(), r.config.ReconcileTimeout)
	defer cancel()

	response, err := r.reconcile(ctx, request)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false,
			"error": map[string]string{
				"message": err.Error(),
			},
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": response,
	})
}

func (r *rolloutReconciler) reconcile(
	ctx context.Context,
	request reconcileRequest,
) (reconcileResponse, error) {
	execution, err := r.store.loadDeploymentContext(ctx, request.DeploymentID)
	if err != nil {
		return reconcileResponse{}, err
	}

	adapter, target, err := newDeploymentAdapter(r.config, execution)
	if err != nil {
		return reconcileResponse{}, err
	}

	labels := buildDeploymentLabels(execution)
	labelMap := normalizeStoredLabelMap(execution.Environment.TelemetryLabelMap, labels)

	var liveState *rolloutLiveState
	if r.stateStore != nil {
		liveState, err = r.stateStore.loadLiveState(ctx, execution.Deployment.ID)
		if err != nil {
			return reconcileResponse{}, fmt.Errorf("failed to load rollout state from Redis: %w", err)
		}
	}

	state, currentStep, initialize, err := deriveRuntimeState(execution, liveState)
	if err != nil {
		return reconcileResponse{}, err
	}

	now := time.Now().UTC()
	if initialize {
		intent := rolloutActionIntent{
			Decision:       decisionInitialize,
			Summary:        "Initialize rollout",
			FromWeight:     execution.Deployment.CurrentWeight,
			ToWeight:       currentStep.TargetWeight,
			Revision:       execution.Deployment.Revision,
			Initialization: true,
		}
		action, err := adapter.Apply(ctx, target, intent)
		if err != nil {
			return reconcileResponse{}, err
		}

		stepID := currentStep.ID
		deploymentSummary := action.Summary
		plan := persistencePlan{
			DeploymentID:              execution.Deployment.ID,
			DeploymentStatus:          "running",
			CurrentWeight:             currentStep.TargetWeight,
			LastDecision:              string(decisionInitialize),
			LastDecisionReason:        deploymentSummary,
			CurrentStepID:             currentStep.ID,
			CurrentStepIndex:          currentStep.StepIndex,
			CurrentStepStatus:         "in_progress",
			CurrentStepDecision:       string(decisionInitialize),
			CurrentStepDecisionReason: deploymentSummary,
			CurrentStepStartedAt:      &now,
			ResolveOpenIncidents:      true,
			AuditEvent: auditEventPlan{
				RolloutStepID: &stepID,
				EventType:     "rollout.started",
				Summary:       deploymentSummary,
				Details: map[string]any{
					"labels": labels,
					"action": action,
				},
			},
		}

		if err := r.store.persistPlan(ctx, plan); err != nil {
			return reconcileResponse{}, err
		}

		warning := r.publishActionState(ctx, "rollout.started", rolloutLiveState{
			SchemaVersion: 1,
			UpdatedAt:     now,
			DeploymentID:  &execution.Deployment.ID,
			RolloutStepID: &stepID,
			Labels:        labels,
			LabelMap:      labelMap,
			Decision:      decisionInitialize,
			Summary:       deploymentSummary,
			Action:        &action,
		})

		return reconcileResponse{
			DeploymentID: execution.Deployment.ID,
			Phase:        "initialized",
			Deployment: deploymentRuntime{
				ID:                 execution.Deployment.ID,
				ServiceName:        execution.Service.Name,
				EnvironmentName:    execution.Environment.Name,
				Revision:           execution.Deployment.Revision,
				Status:             "running",
				CurrentWeight:      currentStep.TargetWeight,
				LastDecision:       string(decisionInitialize),
				LastDecisionReason: deploymentSummary,
				CurrentStepIndex:   currentStep.StepIndex,
				RolloutStepID:      currentStep.ID,
			},
			Action:  action,
			Warning: warning,
		}, nil
	}

	evaluationRequest := evaluationRequest{
		DeploymentID:      execution.Deployment.ID,
		RolloutStepID:     currentStep.ID,
		Labels:            labels,
		LabelMap:          labelMap,
		Policy:            execution.Policy,
		State:             state,
		TelemetrySnapshot: request.TelemetrySnapshot,
	}

	evaluation, err := r.decisions.evaluate(ctx, evaluationRequest)
	if err != nil {
		return reconcileResponse{}, err
	}

	intent := rolloutActionIntent{
		Decision:        evaluation.Decision,
		Summary:         evaluation.Summary,
		FromWeight:      execution.Deployment.CurrentWeight,
		ToWeight:        nextActionWeight(execution, evaluation),
		Revision:        execution.Deployment.Revision,
		RolloutComplete: evaluation.RolloutComplete,
	}
	action, err := adapter.Apply(ctx, target, intent)
	if err != nil {
		return reconcileResponse{}, err
	}

	plan, activeStepID, runtime := buildPersistencePlan(execution, currentStep, evaluation, action, now)
	if err := r.store.persistPlan(ctx, plan); err != nil {
		return reconcileResponse{}, err
	}

	warning := r.publishActionState(ctx, "rollout.action_applied", rolloutLiveState{
		SchemaVersion: 1,
		UpdatedAt:     now,
		DeploymentID:  &execution.Deployment.ID,
		RolloutStepID: &activeStepID,
		Labels:        labels,
		LabelMap:      labelMap,
		Decision:      evaluation.Decision,
		Summary:       evaluation.Summary,
		Evaluation:    &evaluation,
		Action:        &action,
	})

	return reconcileResponse{
		DeploymentID: execution.Deployment.ID,
		Phase:        "evaluated",
		Deployment:   runtime,
		Action:       action,
		Evaluation:   &evaluation,
		Warning:      warning,
	}, nil
}

func deriveRuntimeState(
	execution deploymentExecutionContext,
	liveState *rolloutLiveState,
) (rolloutEvaluationState, controllerRolloutStep, bool, error) {
	if strings.EqualFold(execution.Deployment.Status, "pending") || execution.Deployment.CurrentWeight == 0 {
		if len(execution.RolloutSteps) == 0 {
			return rolloutEvaluationState{}, controllerRolloutStep{}, false, fmt.Errorf(
				"deployment %d has no rollout steps",
				execution.Deployment.ID,
			)
		}
		return rolloutEvaluationState{}, execution.RolloutSteps[0], true, nil
	}

	currentStep, err := findCurrentStep(execution)
	if err != nil {
		return rolloutEvaluationState{}, controllerRolloutStep{}, false, err
	}

	if liveState != nil && liveState.Evaluation != nil {
		state := liveState.Evaluation.NextState
		if state.StepStartedAt.IsZero() {
			state.StepStartedAt = fallbackStepStart(currentStep, execution.Deployment.StartedAt)
		}
		state.CurrentStepIndex = currentStep.StepIndex
		if state.CurrentWeight <= 0 {
			state.CurrentWeight = currentStep.TargetWeight
		}
		return state, currentStep, false, nil
	}

	return rolloutEvaluationState{
		CurrentStepIndex:    currentStep.StepIndex,
		CurrentWeight:       currentStep.TargetWeight,
		ConsecutivePasses:   0,
		ConsecutiveFailures: 0,
		StepStartedAt:       fallbackStepStart(currentStep, execution.Deployment.StartedAt),
		LastDecision:        execution.Deployment.LastDecision,
		LastDecisionReason:  execution.Deployment.LastDecisionReason,
	}, currentStep, false, nil
}

func findCurrentStep(execution deploymentExecutionContext) (controllerRolloutStep, error) {
	for _, step := range execution.RolloutSteps {
		if step.Status == "in_progress" || step.Status == "paused" {
			return step, nil
		}
	}
	for _, step := range execution.RolloutSteps {
		if step.TargetWeight == execution.Deployment.CurrentWeight {
			return step, nil
		}
	}
	for index := len(execution.RolloutSteps) - 1; index >= 0; index-- {
		step := execution.RolloutSteps[index]
		if step.StartedAt != nil {
			return step, nil
		}
	}
	return controllerRolloutStep{}, fmt.Errorf(
		"deployment %d has no active rollout step for current weight %d",
		execution.Deployment.ID,
		execution.Deployment.CurrentWeight,
	)
}

func buildDeploymentLabels(execution deploymentExecutionContext) telemetryLabels {
	overrideMap := nestedMap(execution.Deployment.Metadata, "telemetryLabels")

	return telemetryLabels{
		Project: firstNonEmpty(
			stringFromMap(overrideMap, "project"),
			stringFromMap(execution.Deployment.Metadata, "project"),
			execution.ProjectName,
		),
		Service: firstNonEmpty(
			stringFromMap(overrideMap, "service"),
			stringFromMap(execution.Deployment.Metadata, "service"),
			stringFromMap(execution.Service.ServiceConfig, "telemetryService"),
			execution.Service.Name,
		),
		Environment: firstNonEmpty(
			stringFromMap(overrideMap, "environment"),
			stringFromMap(execution.Deployment.Metadata, "environment"),
			execution.Environment.Name,
		),
		Version: firstNonEmpty(
			stringFromMap(overrideMap, "version"),
			stringFromMap(execution.Deployment.Metadata, "version"),
			execution.Deployment.Revision,
		),
		Region: firstNonEmpty(
			stringFromMap(overrideMap, "region"),
			stringFromMap(execution.Deployment.Metadata, "region"),
			stringFromMap(execution.Environment.DeploymentTargetConfig, "region"),
		),
		Cluster: firstNonEmpty(
			stringFromMap(overrideMap, "cluster"),
			stringFromMap(execution.Deployment.Metadata, "cluster"),
			stringFromMap(execution.Environment.DeploymentTargetConfig, "cluster"),
		),
		Cloud: firstNonEmpty(
			stringFromMap(overrideMap, "cloud"),
			stringFromMap(execution.Deployment.Metadata, "cloud"),
			stringFromMap(execution.Environment.DeploymentTargetConfig, "cloud"),
		),
	}
}

func normalizeStoredLabelMap(
	input telemetryLabelMap,
	labels telemetryLabels,
) telemetryLabelMap {
	output := mergeLabelMapDefaults(input)
	output.Project = normalizeLabelKey(output.Project, labels.Project, "project", []string{"project", "tenant", "app"})
	output.Service = normalizeLabelKey(output.Service, labels.Service, "service", []string{"service", "app", "workload", "job"})
	output.Environment = normalizeLabelKey(output.Environment, labels.Environment, "env", []string{"env", "environment", "stage"})
	output.Version = normalizeLabelKey(output.Version, labels.Version, "version", []string{"version", "revision", "release"})
	output.Region = normalizeLabelKey(output.Region, labels.Region, "region", []string{"region", "zone"})
	output.Cluster = normalizeLabelKey(output.Cluster, labels.Cluster, "cluster", []string{"cluster"})
	output.Cloud = normalizeLabelKey(output.Cloud, labels.Cloud, "cloud", []string{"cloud", "provider"})
	return output
}

func looksLikeLabelValue(candidate, label string) bool {
	candidate = strings.TrimSpace(candidate)
	label = strings.TrimSpace(label)
	if candidate == "" || label == "" {
		return false
	}
	return strings.EqualFold(candidate, label)
}

func normalizeLabelKey(candidate, label, fallback string, keywords []string) string {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return fallback
	}
	if looksLikeLabelValue(candidate, label) {
		return fallback
	}
	lower := strings.ToLower(candidate)
	for _, keyword := range keywords {
		if strings.Contains(lower, keyword) {
			return candidate
		}
	}
	return fallback
}

func buildPersistencePlan(
	execution deploymentExecutionContext,
	currentStep controllerRolloutStep,
	evaluation evaluationResponse,
	action rolloutAction,
	now time.Time,
) (persistencePlan, int64, deploymentRuntime) {
	runtime := deploymentRuntime{
		ID:              execution.Deployment.ID,
		ServiceName:     execution.Service.Name,
		EnvironmentName: execution.Environment.Name,
		Revision:        execution.Deployment.Revision,
	}

	metricsSnapshot := map[string]any{
		"summary":           evaluation.Summary,
		"reasons":           evaluation.Reasons,
		"gateResults":       evaluation.GateResults,
		"telemetrySnapshot": evaluation.TelemetrySnapshot,
		"action":            action,
	}

	stepID := currentStep.ID
	plan := persistencePlan{
		DeploymentID:               execution.Deployment.ID,
		DeploymentStatus:           "running",
		CurrentWeight:              action.ToWeight,
		LastDecision:               string(evaluation.Decision),
		LastDecisionReason:         evaluation.Summary,
		CurrentStepID:              currentStep.ID,
		CurrentStepIndex:           currentStep.StepIndex,
		CurrentStepStatus:          "in_progress",
		CurrentStepDecision:        string(evaluation.Decision),
		CurrentStepDecisionReason:  evaluation.Summary,
		CurrentStepStartedAt:       currentStep.StartedAt,
		CurrentStepEvaluatedAt:     &now,
		CurrentStepMetricsSnapshot: metricsSnapshot,
		AuditEvent: auditEventPlan{
			RolloutStepID: &stepID,
			EventType:     "rollout.action_applied",
			Summary:       action.Summary,
			Details: map[string]any{
				"decision":   evaluation.Decision,
				"evaluation": evaluation,
				"action":     action,
			},
		},
	}

	switch evaluation.Decision {
	case decisionHold:
		plan.CurrentWeight = execution.Deployment.CurrentWeight
		plan.DeploymentStatus = "running"
		plan.CurrentStepStatus = "in_progress"
		runtime.Status = "running"
		runtime.CurrentWeight = execution.Deployment.CurrentWeight
		runtime.LastDecision = string(evaluation.Decision)
		runtime.LastDecisionReason = evaluation.Summary
		runtime.CurrentStepIndex = currentStep.StepIndex
		runtime.RolloutStepID = currentStep.ID
	case decisionPause:
		plan.CurrentWeight = execution.Deployment.CurrentWeight
		plan.DeploymentStatus = "paused"
		plan.CurrentStepStatus = "paused"
		plan.Incident = buildIncidentPlan(currentStep.ID, evaluation)
		runtime.Status = "paused"
		runtime.CurrentWeight = execution.Deployment.CurrentWeight
		runtime.LastDecision = string(evaluation.Decision)
		runtime.LastDecisionReason = evaluation.Summary
		runtime.CurrentStepIndex = currentStep.StepIndex
		runtime.RolloutStepID = currentStep.ID
	case decisionRollback:
		plan.CurrentWeight = 0
		plan.DeploymentStatus = "rolled_back"
		plan.CurrentStepStatus = "rolled_back"
		plan.CurrentStepCompletedAt = &now
		plan.CompletedAt = &now
		plan.SkipPendingSteps = true
		plan.SkipPendingReason = evaluation.Summary
		plan.Incident = buildIncidentPlan(currentStep.ID, evaluation)
		runtime.Status = "rolled_back"
		runtime.CurrentWeight = 0
		runtime.LastDecision = string(evaluation.Decision)
		runtime.LastDecisionReason = evaluation.Summary
		runtime.CurrentStepIndex = currentStep.StepIndex
		runtime.RolloutStepID = currentStep.ID
		runtime.CompletedAt = &now
	case decisionPromote:
		plan.ResolveOpenIncidents = true
		if evaluation.RolloutComplete {
			plan.DeploymentStatus = "completed"
			plan.CurrentWeight = evaluation.TargetWeight
			plan.CurrentStepStatus = "completed"
			plan.CurrentStepCompletedAt = &now
			plan.CompletedAt = &now
			plan.AuditEvent.EventType = "rollout.completed"
			runtime.Status = "completed"
			runtime.CurrentWeight = evaluation.TargetWeight
			runtime.LastDecision = string(evaluation.Decision)
			runtime.LastDecisionReason = evaluation.Summary
			runtime.CurrentStepIndex = currentStep.StepIndex
			runtime.RolloutStepID = currentStep.ID
			runtime.CompletedAt = &now
			break
		}

		nextStep := execution.RolloutSteps[evaluation.TargetStepIndex]
		plan.CurrentStepStatus = "completed"
		plan.CurrentStepCompletedAt = &now
		plan.NextStepID = &nextStep.ID
		plan.NextStepStatus = "in_progress"
		plan.NextStepStartedAt = &now
		plan.AuditEvent.EventType = "rollout.promoted"
		stepID = nextStep.ID

		runtime.Status = "running"
		runtime.CurrentWeight = evaluation.TargetWeight
		runtime.LastDecision = string(evaluation.Decision)
		runtime.LastDecisionReason = evaluation.Summary
		runtime.CurrentStepIndex = nextStep.StepIndex
		runtime.RolloutStepID = nextStep.ID
	default:
		runtime.Status = execution.Deployment.Status
		runtime.CurrentWeight = execution.Deployment.CurrentWeight
		runtime.LastDecision = string(evaluation.Decision)
		runtime.LastDecisionReason = evaluation.Summary
		runtime.CurrentStepIndex = currentStep.StepIndex
		runtime.RolloutStepID = currentStep.ID
	}

	return plan, stepID, runtime
}

func buildIncidentPlan(stepID int64, evaluation evaluationResponse) *incidentPlan {
	incidentType := "rollout_gate_failed"
	severity := "warning"
	if evaluation.Decision == decisionRollback {
		severity = "critical"
	}
	for _, gate := range evaluation.GateResults {
		if gate.SignalStatus == signalStatusNoData || gate.SignalStatus == signalStatusError {
			incidentType = "telemetry_blocked"
			if severity != "critical" {
				severity = "warning"
			}
			break
		}
	}

	return &incidentPlan{
		RolloutStepID: &stepID,
		IncidentType:  incidentType,
		Severity:      severity,
		Summary:       evaluation.Summary,
		Details: map[string]any{
			"gateResults": evaluation.GateResults,
			"reasons":     evaluation.Reasons,
		},
	}
}

func nextActionWeight(execution deploymentExecutionContext, evaluation evaluationResponse) int {
	switch evaluation.Decision {
	case decisionRollback:
		return 0
	case decisionPause, decisionHold:
		return execution.Deployment.CurrentWeight
	default:
		return evaluation.TargetWeight
	}
}

func fallbackStepStart(step controllerRolloutStep, deploymentStartedAt time.Time) time.Time {
	if step.StartedAt != nil {
		return step.StartedAt.UTC()
	}
	return deploymentStartedAt.UTC()
}

func nestedMap(values map[string]any, key string) map[string]any {
	if values == nil {
		return nil
	}
	raw, ok := values[key]
	if !ok || raw == nil {
		return nil
	}
	result, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	return result
}

func (r *rolloutReconciler) publishActionState(
	ctx context.Context,
	eventType string,
	liveState rolloutLiveState,
) string {
	if r.stateStore == nil {
		return ""
	}
	if err := r.stateStore.publishActionState(ctx, liveState, eventType); err != nil {
		return fmt.Sprintf("action was applied, but Redis live-state publish failed: %v", err)
	}
	return ""
}
