package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

type controllerStore struct {
	db *sql.DB
}

type deploymentExecutionContext struct {
	ProjectName  string
	Service      controllerService
	Environment  controllerEnvironment
	Deployment   controllerDeployment
	Policy       rolloutPolicy
	RolloutSteps []controllerRolloutStep
}

type controllerService struct {
	ID            int64
	Name          string
	AdapterType   string
	ServiceConfig map[string]any
}

type controllerEnvironment struct {
	ID                     int64
	Name                   string
	DeploymentTargetType   string
	DeploymentTargetConfig map[string]any
	TelemetryLabelMap      telemetryLabelMap
}

type controllerDeployment struct {
	ID                 int64
	ServiceID          int64
	EnvironmentID      int64
	PolicyID           int64
	Revision           string
	Status             string
	CurrentWeight      int
	LastDecision       string
	LastDecisionReason string
	StartedAt          time.Time
	CompletedAt        *time.Time
	Metadata           map[string]any
}

type controllerRolloutStep struct {
	ID              int64
	StepIndex       int
	TargetWeight    int
	Status          string
	Decision        string
	DecisionReason  string
	MetricsSnapshot map[string]any
	StartedAt       *time.Time
	EvaluatedAt     *time.Time
	CompletedAt     *time.Time
}

type persistencePlan struct {
	DeploymentID               int64
	DeploymentStatus           string
	CurrentWeight              int
	LastDecision               string
	LastDecisionReason         string
	CompletedAt                *time.Time
	CurrentStepID              int64
	CurrentStepIndex           int
	CurrentStepStatus          string
	CurrentStepDecision        string
	CurrentStepDecisionReason  string
	CurrentStepStartedAt       *time.Time
	CurrentStepEvaluatedAt     *time.Time
	CurrentStepCompletedAt     *time.Time
	CurrentStepMetricsSnapshot any
	NextStepID                 *int64
	NextStepStatus             string
	NextStepStartedAt          *time.Time
	SkipPendingSteps           bool
	SkipPendingReason          string
	ResolveOpenIncidents       bool
	Incident                   *incidentPlan
	AuditEvent                 auditEventPlan
}

type incidentPlan struct {
	RolloutStepID *int64
	IncidentType  string
	Severity      string
	Summary       string
	Details       map[string]any
}

type auditEventPlan struct {
	RolloutStepID *int64
	EventType     string
	Summary       string
	Details       map[string]any
}

func newControllerStore(config controllerConfig) (*controllerStore, error) {
	db, err := sql.Open("mysql", config.MySQLDSN)
	if err != nil {
		return nil, err
	}

	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetMaxIdleConns(5)
	db.SetMaxOpenConns(10)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}

	return &controllerStore{db: db}, nil
}

func (s *controllerStore) loadDeploymentContext(
	ctx context.Context,
	deploymentID int64,
) (deploymentExecutionContext, error) {
	const deploymentSQL = `
SELECT
  p.name,
  s.id,
  s.name,
  s.adapter_type,
  s.service_config,
  e.id,
  e.name,
  e.deployment_target_type,
  e.deployment_target_config,
  e.telemetry_label_map,
  d.id,
  d.service_id,
  d.environment_id,
  d.policy_id,
  d.revision,
  d.status,
  d.current_weight,
  d.last_decision,
  d.last_decision_reason,
  d.started_at,
  d.completed_at,
  d.deployment_metadata,
  pol.rollout_steps,
  pol.slo_config,
  pol.evaluation_window_sec,
  pol.poll_interval_sec,
  pol.warmup_sec,
  pol.required_passes,
  pol.failure_mode,
  pol.enabled
FROM deployments d
INNER JOIN services s ON s.id = d.service_id
INNER JOIN projects p ON p.id = s.project_id
INNER JOIN environments e ON e.id = d.environment_id
LEFT JOIN policies pol ON pol.id = d.policy_id
WHERE d.id = ?`

	var (
		projectName           string
		service               controllerService
		environment           controllerEnvironment
		deployment            controllerDeployment
		policy                rolloutPolicy
		serviceConfigRaw      []byte
		targetConfigRaw       []byte
		labelMapRaw           []byte
		deploymentMetadataRaw []byte
		rolloutStepsRaw       []byte
		sloConfigRaw          []byte
		completedAt           sql.NullTime
		policyID              sql.NullInt64
		lastDecision          sql.NullString
		lastDecisionReason    sql.NullString
		policyEnabled         sql.NullBool
	)

	row := s.db.QueryRowContext(ctx, deploymentSQL, deploymentID)
	if err := row.Scan(
		&projectName,
		&service.ID,
		&service.Name,
		&service.AdapterType,
		&serviceConfigRaw,
		&environment.ID,
		&environment.Name,
		&environment.DeploymentTargetType,
		&targetConfigRaw,
		&labelMapRaw,
		&deployment.ID,
		&deployment.ServiceID,
		&deployment.EnvironmentID,
		&policyID,
		&deployment.Revision,
		&deployment.Status,
		&deployment.CurrentWeight,
		&lastDecision,
		&lastDecisionReason,
		&deployment.StartedAt,
		&completedAt,
		&deploymentMetadataRaw,
		&rolloutStepsRaw,
		&sloConfigRaw,
		&policy.EvaluationWindowSec,
		&policy.PollIntervalSec,
		&policy.WarmupSec,
		&policy.RequiredPasses,
		&policy.FailureMode,
		&policyEnabled,
	); err != nil {
		if err == sql.ErrNoRows {
			return deploymentExecutionContext{}, fmt.Errorf("deployment %d was not found", deploymentID)
		}
		return deploymentExecutionContext{}, err
	}

	deployment.LastDecision = lastDecision.String
	deployment.LastDecisionReason = lastDecisionReason.String
	if !policyID.Valid {
		return deploymentExecutionContext{}, fmt.Errorf("deployment %d has no attached policy", deploymentID)
	}
	deployment.PolicyID = policyID.Int64
	if completedAt.Valid {
		value := completedAt.Time.UTC()
		deployment.CompletedAt = &value
	}

	if err := decodeJSONMap(serviceConfigRaw, &service.ServiceConfig); err != nil {
		return deploymentExecutionContext{}, fmt.Errorf("invalid service_config for deployment %d: %w", deploymentID, err)
	}
	if err := decodeJSONMap(targetConfigRaw, &environment.DeploymentTargetConfig); err != nil {
		return deploymentExecutionContext{}, fmt.Errorf("invalid deployment_target_config for deployment %d: %w", deploymentID, err)
	}
	if err := decodeJSONValue(labelMapRaw, &environment.TelemetryLabelMap); err != nil {
		return deploymentExecutionContext{}, fmt.Errorf("invalid telemetry_label_map for deployment %d: %w", deploymentID, err)
	}
	if err := decodeJSONMap(deploymentMetadataRaw, &deployment.Metadata); err != nil {
		return deploymentExecutionContext{}, fmt.Errorf("invalid deployment_metadata for deployment %d: %w", deploymentID, err)
	}

	if len(rolloutStepsRaw) == 0 || len(sloConfigRaw) == 0 {
		return deploymentExecutionContext{}, fmt.Errorf("deployment %d has no rollout policy attached", deploymentID)
	}
	if err := decodeJSONArray(rolloutStepsRaw, &policy.RolloutSteps); err != nil {
		return deploymentExecutionContext{}, fmt.Errorf("invalid rollout_steps for deployment %d: %w", deploymentID, err)
	}
	if err := decodeJSONValue(sloConfigRaw, &policy.SLOConfig); err != nil {
		return deploymentExecutionContext{}, fmt.Errorf("invalid slo_config for deployment %d: %w", deploymentID, err)
	}
	if !policyEnabled.Valid || !policyEnabled.Bool {
		return deploymentExecutionContext{}, fmt.Errorf("deployment %d policy is disabled", deploymentID)
	}

	steps, err := s.loadRolloutSteps(ctx, deploymentID)
	if err != nil {
		return deploymentExecutionContext{}, err
	}

	return deploymentExecutionContext{
		ProjectName:  projectName,
		Service:      service,
		Environment:  environment,
		Deployment:   deployment,
		Policy:       policy,
		RolloutSteps: steps,
	}, nil
}

func (s *controllerStore) loadRolloutSteps(
	ctx context.Context,
	deploymentID int64,
) ([]controllerRolloutStep, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT
  id,
  step_index,
  target_weight,
  status,
  decision,
  decision_reason,
  metrics_snapshot,
  started_at,
  evaluated_at,
  completed_at
FROM rollout_steps
WHERE deployment_id = ?
ORDER BY step_index ASC`, deploymentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	steps := []controllerRolloutStep{}
	for rows.Next() {
		var (
			step            controllerRolloutStep
			decision        sql.NullString
			decisionReason  sql.NullString
			metricsSnapshot []byte
			startedAt       sql.NullTime
			evaluatedAt     sql.NullTime
			completedAt     sql.NullTime
		)
		if err := rows.Scan(
			&step.ID,
			&step.StepIndex,
			&step.TargetWeight,
			&step.Status,
			&decision,
			&decisionReason,
			&metricsSnapshot,
			&startedAt,
			&evaluatedAt,
			&completedAt,
		); err != nil {
			return nil, err
		}

		step.Decision = decision.String
		step.DecisionReason = decisionReason.String
		if err := decodeJSONMap(metricsSnapshot, &step.MetricsSnapshot); err != nil {
			return nil, fmt.Errorf("invalid metrics_snapshot for rollout step %d: %w", step.ID, err)
		}
		if startedAt.Valid {
			value := startedAt.Time.UTC()
			step.StartedAt = &value
		}
		if evaluatedAt.Valid {
			value := evaluatedAt.Time.UTC()
			step.EvaluatedAt = &value
		}
		if completedAt.Valid {
			value := completedAt.Time.UTC()
			step.CompletedAt = &value
		}
		steps = append(steps, step)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(steps) == 0 {
		return nil, fmt.Errorf("deployment %d has no rollout steps", deploymentID)
	}
	return steps, nil
}

func (s *controllerStore) persistPlan(ctx context.Context, plan persistencePlan) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}

	if err := s.persistPlanTx(ctx, tx, plan); err != nil {
		_ = tx.Rollback()
		return err
	}

	return tx.Commit()
}

func (s *controllerStore) persistPlanTx(ctx context.Context, tx *sql.Tx, plan persistencePlan) error {
	var completedAt any
	if plan.CompletedAt != nil {
		completedAt = *plan.CompletedAt
	}

	if _, err := tx.ExecContext(ctx, `
UPDATE deployments
SET status = ?,
    current_weight = ?,
    last_decision = ?,
    last_decision_reason = ?,
    completed_at = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?`,
		plan.DeploymentStatus,
		plan.CurrentWeight,
		plan.LastDecision,
		plan.LastDecisionReason,
		completedAt,
		plan.DeploymentID,
	); err != nil {
		return err
	}

	currentStepSnapshot, err := jsonValue(plan.CurrentStepMetricsSnapshot)
	if err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
UPDATE rollout_steps
SET status = ?,
    decision = ?,
    decision_reason = ?,
    metrics_snapshot = ?,
    started_at = ?,
    evaluated_at = ?,
    completed_at = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?`,
		plan.CurrentStepStatus,
		plan.CurrentStepDecision,
		plan.CurrentStepDecisionReason,
		currentStepSnapshot,
		timePointerValue(plan.CurrentStepStartedAt),
		timePointerValue(plan.CurrentStepEvaluatedAt),
		timePointerValue(plan.CurrentStepCompletedAt),
		plan.CurrentStepID,
	); err != nil {
		return err
	}

	if plan.NextStepID != nil {
		if _, err := tx.ExecContext(ctx, `
UPDATE rollout_steps
SET status = ?,
    started_at = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?`,
			plan.NextStepStatus,
			timePointerValue(plan.NextStepStartedAt),
			*plan.NextStepID,
		); err != nil {
			return err
		}
	}

	if plan.SkipPendingSteps {
		if _, err := tx.ExecContext(ctx, `
UPDATE rollout_steps
SET status = 'skipped',
    decision = 'rollback',
    decision_reason = ?,
    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP
WHERE deployment_id = ? AND step_index > ? AND status = 'pending'`,
			plan.SkipPendingReason,
			plan.DeploymentID,
			plan.CurrentStepIndex,
		); err != nil {
			return err
		}
	}

	if plan.ResolveOpenIncidents {
		if _, err := tx.ExecContext(ctx, `
UPDATE incidents
SET status = 'resolved',
    resolved_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE deployment_id = ? AND status = 'open'`,
			plan.DeploymentID,
		); err != nil {
			return err
		}
	}

	if plan.Incident != nil {
		details, err := jsonValue(plan.Incident.Details)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO incidents (
  deployment_id,
  rollout_step_id,
  incident_type,
  severity,
  status,
  summary,
  details
) VALUES (?, ?, ?, ?, 'open', ?, ?)`,
			plan.DeploymentID,
			nullInt64Value(plan.Incident.RolloutStepID),
			plan.Incident.IncidentType,
			plan.Incident.Severity,
			plan.Incident.Summary,
			details,
		); err != nil {
			return err
		}
	}

	auditDetails, err := jsonValue(plan.AuditEvent.Details)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO audit_events (
  deployment_id,
  rollout_step_id,
  actor_type,
  actor_id,
  event_type,
  summary,
  details
) VALUES (?, ?, 'system', 'controller', ?, ?, ?)`,
		plan.DeploymentID,
		nullInt64Value(plan.AuditEvent.RolloutStepID),
		plan.AuditEvent.EventType,
		plan.AuditEvent.Summary,
		auditDetails,
	); err != nil {
		return err
	}

	return nil
}

func decodeJSONMap(raw []byte, target *map[string]any) error {
	if len(raw) == 0 {
		*target = map[string]any{}
		return nil
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return err
	}
	if *target == nil {
		*target = map[string]any{}
	}
	return nil
}

func decodeJSONArray[T any](raw []byte, target *[]T) error {
	if len(raw) == 0 {
		*target = []T{}
		return nil
	}
	return json.Unmarshal(raw, target)
}

func decodeJSONValue[T any](raw []byte, target *T) error {
	if len(raw) == 0 {
		var zero T
		*target = zero
		return nil
	}
	return json.Unmarshal(raw, target)
}

func jsonValue(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return payload, nil
}

func timePointerValue(value *time.Time) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullInt64Value(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}
