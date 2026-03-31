package main

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	redis "github.com/redis/go-redis/v9"
)

const (
	rolloutEventChannel       = "sentra:rollout-events"
	rolloutStateIndexKey      = "sentra:rollout-state:index"
	rolloutStateKeyPrefix     = "sentra:rollout-state:deployment:"
	rolloutStateSchemaVersion = 1
)

type rolloutStateStore struct {
	client *redis.Client
}

type rolloutLiveState struct {
	SchemaVersion int                 `json:"schemaVersion"`
	UpdatedAt     time.Time           `json:"updatedAt"`
	DeploymentID  *int64              `json:"deploymentId,omitempty"`
	RolloutStepID *int64              `json:"rolloutStepId,omitempty"`
	Labels        telemetryLabels     `json:"labels"`
	LabelMap      telemetryLabelMap   `json:"labelMap"`
	Decision      rolloutDecision     `json:"decision"`
	Summary       string              `json:"summary"`
	Traffic       rolloutTrafficState `json:"traffic"`
	Evaluation    *evaluationResponse `json:"evaluation,omitempty"`
	Action        *rolloutAction      `json:"action,omitempty"`
}

type rolloutEvent struct {
	Type          string            `json:"type"`
	Source        string            `json:"source"`
	Timestamp     time.Time         `json:"timestamp"`
	DeploymentID  *int64            `json:"deploymentId,omitempty"`
	RolloutStepID *int64            `json:"rolloutStepId,omitempty"`
	Decision      rolloutDecision   `json:"decision"`
	Summary       string            `json:"summary"`
	Labels        telemetryLabels   `json:"labels"`
	Action        *rolloutAction    `json:"action,omitempty"`
	LiveState     *rolloutLiveState `json:"liveState,omitempty"`
}

func newRolloutStateStore(config controllerConfig) (*rolloutStateStore, error) {
	options, err := redis.ParseURL(config.RedisURL)
	if err != nil {
		return nil, err
	}

	client := redis.NewClient(options)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, err
	}

	return &rolloutStateStore{client: client}, nil
}

func (s *rolloutStateStore) publishEvaluation(
	ctx context.Context,
	request evaluationRequest,
	result evaluationResponse,
) error {
	liveState := s.liveStateFromEvaluation(request, result)
	return s.publishLiveState(ctx, "rollout.evaluated", liveState)
}

func (s *rolloutStateStore) liveStateFromEvaluation(
	request evaluationRequest,
	result evaluationResponse,
) rolloutLiveState {
	labelMap := mergeLabelMapDefaults(request.LabelMap)
	liveState := rolloutLiveState{
		SchemaVersion: rolloutStateSchemaVersion,
		UpdatedAt:     time.Now().UTC(),
		Labels:        request.Labels,
		LabelMap:      labelMap,
		Decision:      result.Decision,
		Summary:       result.Summary,
		Traffic:       deriveTrafficState(result.CurrentWeight, result.Decision, result.RolloutComplete),
		Evaluation:    &result,
	}

	if request.DeploymentID > 0 {
		deploymentID := request.DeploymentID
		liveState.DeploymentID = &deploymentID
	}

	if request.RolloutStepID > 0 {
		rolloutStepID := request.RolloutStepID
		liveState.RolloutStepID = &rolloutStepID
	}

	return liveState
}

func (s *rolloutStateStore) loadLiveState(ctx context.Context, deploymentID int64) (*rolloutLiveState, error) {
	value, err := s.client.Get(ctx, rolloutStateKey(deploymentID)).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var state rolloutLiveState
	if err := json.Unmarshal([]byte(value), &state); err != nil {
		return nil, err
	}
	return &state, nil
}

func (s *rolloutStateStore) publishActionState(
	ctx context.Context,
	liveState rolloutLiveState,
	eventType string,
) error {
	if liveState.UpdatedAt.IsZero() {
		liveState.UpdatedAt = time.Now().UTC()
	}
	if liveState.SchemaVersion == 0 {
		liveState.SchemaVersion = rolloutStateSchemaVersion
	}
	return s.publishLiveState(ctx, eventType, liveState)
}

func (s *rolloutStateStore) publishLiveState(
	ctx context.Context,
	eventType string,
	liveState rolloutLiveState,
) error {
	event := rolloutEvent{
		Type:          eventType,
		Source:        "controller",
		Timestamp:     liveState.UpdatedAt,
		DeploymentID:  liveState.DeploymentID,
		RolloutStepID: liveState.RolloutStepID,
		Decision:      liveState.Decision,
		Summary:       liveState.Summary,
		Labels:        liveState.Labels,
		Action:        liveState.Action,
		LiveState:     &liveState,
	}

	eventPayload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	pipe := s.client.TxPipeline()
	if liveState.DeploymentID != nil && *liveState.DeploymentID > 0 {
		statePayload, err := json.Marshal(liveState)
		if err != nil {
			return err
		}

		key := rolloutStateKey(*liveState.DeploymentID)
		pipe.Set(ctx, key, statePayload, 0)
		pipe.SAdd(ctx, rolloutStateIndexKey, key)
	}

	pipe.Publish(ctx, rolloutEventChannel, string(eventPayload))
	_, err = pipe.Exec(ctx)
	return err
}

func rolloutStateKey(deploymentID int64) string {
	return fmt.Sprintf("%s%d", rolloutStateKeyPrefix, deploymentID)
}
