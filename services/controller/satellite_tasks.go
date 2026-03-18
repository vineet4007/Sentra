package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

const satelliteTaskTypeReconcileDeployment = "reconcile.deployment"

var (
	satelliteTasksTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "sentra_controller_satellite_tasks_total",
		Help: "Total satellite task polling and execution results handled by this controller.",
	}, []string{"result"})
	satelliteTaskLastSuccess = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "sentra_controller_satellite_task_last_success_timestamp_seconds",
		Help: "Unix timestamp of the last successful federated satellite task execution.",
	})
)

type satelliteTaskWorker struct {
	config       controllerConfig
	httpClient   *http.Client
	runReconcile func(context.Context, reconcileRequest) (reconcileResponse, error)
}

type satelliteTask struct {
	ID            int64           `json:"id"`
	SatelliteID   int64           `json:"satelliteId"`
	SatelliteName string          `json:"satelliteName"`
	DeploymentID  *int64          `json:"deploymentId,omitempty"`
	TaskType      string          `json:"taskType"`
	Status        string          `json:"status"`
	Payload       json.RawMessage `json:"payload"`
}

type satelliteTaskClaimData struct {
	Task *satelliteTask `json:"task"`
}

type satelliteTaskResponseEnvelope[T any] struct {
	OK    bool `json:"ok"`
	Data  T    `json:"data"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type satelliteTaskReportRequest struct {
	SatelliteName string `json:"satelliteName"`
	Status        string `json:"status"`
	Result        any    `json:"result,omitempty"`
	Error         string `json:"error,omitempty"`
}

func newSatelliteTaskWorker(
	config controllerConfig,
	reconciler *rolloutReconciler,
) *satelliteTaskWorker {
	if !config.SatelliteEnabled || !config.SatelliteTasksEnabled {
		return nil
	}
	if strings.TrimSpace(config.SatelliteCoordinatorURL) == "" {
		return nil
	}
	if reconciler == nil {
		return nil
	}

	return &satelliteTaskWorker{
		config: config,
		httpClient: &http.Client{
			Timeout: config.SatelliteCoordinatorTimeout,
		},
		runReconcile: reconciler.reconcile,
	}
}

func (w *satelliteTaskWorker) start(ctx context.Context) {
	if w == nil {
		return
	}

	if err := w.pollOnce(ctx); err != nil {
		log.Printf("satellite task poll failed: %v", err)
	}

	ticker := time.NewTicker(w.pollInterval())
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := w.pollOnce(ctx); err != nil {
				log.Printf("satellite task poll failed: %v", err)
			}
		}
	}
}

func (w *satelliteTaskWorker) pollOnce(ctx context.Context) error {
	task, err := w.claimTask(ctx)
	if err != nil {
		satelliteTasksTotal.WithLabelValues("claim_error").Inc()
		return err
	}
	if task == nil {
		satelliteTasksTotal.WithLabelValues("no_task").Inc()
		return nil
	}

	satelliteTasksTotal.WithLabelValues("claimed").Inc()

	result, status, errMessage := w.executeTask(ctx, *task)
	reportErr := w.reportTask(ctx, task.ID, satelliteTaskReportRequest{
		SatelliteName: w.config.SatelliteName,
		Status:        status,
		Result:        result,
		Error:         errMessage,
	})
	if reportErr != nil {
		satelliteTasksTotal.WithLabelValues("report_error").Inc()
		if errMessage != "" {
			return fmt.Errorf("%s (failed to report task outcome: %w)", errMessage, reportErr)
		}
		return fmt.Errorf("failed to report task outcome: %w", reportErr)
	}

	satelliteTasksTotal.WithLabelValues(status).Inc()
	if status == "completed" {
		satelliteTaskLastSuccess.Set(float64(time.Now().Unix()))
	}

	return nil
}

func (w *satelliteTaskWorker) claimTask(ctx context.Context) (*satelliteTask, error) {
	requestBody := map[string]any{
		"satelliteName":    w.config.SatelliteName,
		"leaseDurationSec": int(w.leaseDuration().Seconds()),
	}

	req, err := w.newCoordinatorRequest(ctx, http.MethodPost, "/satellites/tasks/claim", requestBody)
	if err != nil {
		return nil, err
	}

	var envelope satelliteTaskResponseEnvelope[satelliteTaskClaimData]
	if err := w.doCoordinatorJSON(req, &envelope); err != nil {
		return nil, err
	}

	return envelope.Data.Task, nil
}

func (w *satelliteTaskWorker) reportTask(
	ctx context.Context,
	taskID int64,
	report satelliteTaskReportRequest,
) error {
	req, err := w.newCoordinatorRequest(
		ctx,
		http.MethodPost,
		fmt.Sprintf("/satellites/tasks/%d/report", taskID),
		report,
	)
	if err != nil {
		return err
	}

	var envelope satelliteTaskResponseEnvelope[map[string]any]
	return w.doCoordinatorJSON(req, &envelope)
}

func (w *satelliteTaskWorker) executeTask(
	ctx context.Context,
	task satelliteTask,
) (any, string, string) {
	switch task.TaskType {
	case satelliteTaskTypeReconcileDeployment:
		var payload struct {
			DeploymentID      int64                     `json:"deploymentId"`
			TelemetrySnapshot *rolloutTelemetrySnapshot `json:"telemetrySnapshot,omitempty"`
		}

		if len(task.Payload) == 0 {
			return nil, "failed", "task payload is empty"
		}
		if err := json.Unmarshal(task.Payload, &payload); err != nil {
			return nil, "failed", fmt.Sprintf("failed to decode reconcile task payload: %v", err)
		}
		if payload.DeploymentID <= 0 {
			return nil, "failed", "reconcile task payload must include a positive deploymentId"
		}

		result, err := w.runReconcile(ctx, reconcileRequest{
			DeploymentID:      payload.DeploymentID,
			TelemetrySnapshot: payload.TelemetrySnapshot,
		})
		if err != nil {
			return nil, "failed", err.Error()
		}
		return result, "completed", ""
	default:
		return nil, "failed", fmt.Sprintf("unsupported satellite task type %q", task.TaskType)
	}
}

func (w *satelliteTaskWorker) newCoordinatorRequest(
	ctx context.Context,
	method string,
	path string,
	payload any,
) (*http.Request, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("failed to encode coordinator request payload: %w", err)
		}
		body = bytes.NewReader(encoded)
	}

	url := strings.TrimRight(w.config.SatelliteCoordinatorURL, "/") + path
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, fmt.Errorf("failed to build coordinator request: %w", err)
	}

	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token := strings.TrimSpace(w.config.SatelliteCoordinatorToken); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if tenantKey := strings.TrimSpace(w.config.SatelliteTenantKey); tenantKey != "" {
		req.Header.Set(w.tenantHeader(), tenantKey)
	}

	return req, nil
}

func (w *satelliteTaskWorker) doCoordinatorJSON(req *http.Request, target any) error {
	resp, err := w.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("coordinator request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = resp.Status
		}
		return fmt.Errorf("coordinator returned %s: %s", resp.Status, message)
	}

	if target == nil {
		return nil
	}

	if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
		return fmt.Errorf("failed to decode coordinator response: %w", err)
	}
	return nil
}

func (w *satelliteTaskWorker) timeout() time.Duration {
	if w.config.SatelliteCoordinatorTimeout > 0 {
		return w.config.SatelliteCoordinatorTimeout
	}
	return 5 * time.Second
}

func (w *satelliteTaskWorker) pollInterval() time.Duration {
	if w.config.SatelliteTaskPollInterval > 0 {
		return w.config.SatelliteTaskPollInterval
	}
	return 5 * time.Second
}

func (w *satelliteTaskWorker) leaseDuration() time.Duration {
	if w.config.SatelliteTaskLeaseDuration > 0 {
		return w.config.SatelliteTaskLeaseDuration
	}
	return 30 * time.Second
}

func (w *satelliteTaskWorker) tenantHeader() string {
	if value := strings.TrimSpace(w.config.SatelliteTenantHeader); value != "" {
		return value
	}
	return "x-sentra-tenant"
}
