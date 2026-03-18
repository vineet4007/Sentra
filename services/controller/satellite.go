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

var (
	satelliteHeartbeatsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "sentra_controller_satellite_heartbeats_total",
		Help: "Total satellite heartbeat attempts from this controller to the global coordinator.",
	}, []string{"result"})
	satelliteLastSuccess = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "sentra_controller_satellite_last_success_timestamp_seconds",
		Help: "Unix timestamp of the last successful satellite heartbeat to the global coordinator.",
	})
)

type satelliteCoordinator struct {
	config          controllerConfig
	httpClient      *http.Client
	validateSources func(context.Context) []telemetrySourceValidation
}

type satelliteHeartbeatPayload struct {
	Name                 string            `json:"name"`
	Mode                 string            `json:"mode"`
	Cloud                string            `json:"cloud,omitempty"`
	Region               string            `json:"region,omitempty"`
	ClusterName          string            `json:"clusterName,omitempty"`
	EndpointURL          string            `json:"endpointUrl,omitempty"`
	Version              string            `json:"version,omitempty"`
	Status               string            `json:"status"`
	HeartbeatIntervalSec int               `json:"heartbeatIntervalSec"`
	Capabilities         map[string]any    `json:"capabilities,omitempty"`
	Labels               map[string]string `json:"labels,omitempty"`
	Summary              map[string]any    `json:"summary,omitempty"`
}

func newSatelliteCoordinator(config controllerConfig, telemetry *telemetryService) *satelliteCoordinator {
	if !config.SatelliteEnabled || strings.TrimSpace(config.SatelliteCoordinatorURL) == "" {
		return nil
	}

	coordinator := &satelliteCoordinator{
		config: config,
		httpClient: &http.Client{
			Timeout: config.SatelliteCoordinatorTimeout,
		},
	}
	if telemetry != nil {
		coordinator.validateSources = telemetry.validateSources
	}

	return coordinator
}

func (c *satelliteCoordinator) start(ctx context.Context) {
	if c == nil {
		return
	}

	if err := c.sendHeartbeat(ctx); err != nil {
		log.Printf("satellite heartbeat failed: %v", err)
	}

	ticker := time.NewTicker(c.heartbeatInterval())
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := c.sendHeartbeat(ctx); err != nil {
				log.Printf("satellite heartbeat failed: %v", err)
			}
		}
	}
}

func (c *satelliteCoordinator) sendHeartbeat(ctx context.Context) error {
	payload := c.buildHeartbeatPayload(ctx)
	body, err := json.Marshal(payload)
	if err != nil {
		satelliteHeartbeatsTotal.WithLabelValues("error").Inc()
		return fmt.Errorf("failed to encode satellite heartbeat: %w", err)
	}

	requestCtx, cancel := context.WithTimeout(ctx, c.timeout())
	defer cancel()

	url := strings.TrimRight(c.config.SatelliteCoordinatorURL, "/") + "/satellites/heartbeat"
	req, err := http.NewRequestWithContext(requestCtx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		satelliteHeartbeatsTotal.WithLabelValues("error").Inc()
		return fmt.Errorf("failed to create satellite heartbeat request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if token := strings.TrimSpace(c.config.SatelliteCoordinatorToken); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if tenantKey := strings.TrimSpace(c.config.SatelliteTenantKey); tenantKey != "" {
		req.Header.Set(c.tenantHeader(), tenantKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		satelliteHeartbeatsTotal.WithLabelValues("error").Inc()
		return fmt.Errorf("failed to post satellite heartbeat: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		satelliteHeartbeatsTotal.WithLabelValues("error").Inc()
		payload, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		message := strings.TrimSpace(string(payload))
		if message == "" {
			message = resp.Status
		}
		return fmt.Errorf("coordinator rejected satellite heartbeat with %s: %s", resp.Status, message)
	}

	satelliteHeartbeatsTotal.WithLabelValues("success").Inc()
	satelliteLastSuccess.Set(float64(time.Now().Unix()))
	return nil
}

func (c *satelliteCoordinator) buildHeartbeatPayload(ctx context.Context) satelliteHeartbeatPayload {
	validations := c.currentValidations(ctx)
	status := "online"
	for _, validation := range validations {
		if validation.Status != "ok" {
			status = "degraded"
			break
		}
	}

	labels := map[string]string{}
	if value := strings.TrimSpace(c.config.SatelliteCloud); value != "" {
		labels["cloud"] = value
	}
	if value := strings.TrimSpace(c.config.SatelliteRegion); value != "" {
		labels["region"] = value
	}
	if value := strings.TrimSpace(c.config.SatelliteCluster); value != "" {
		labels["cluster"] = value
	}

	return satelliteHeartbeatPayload{
		Name:                 strings.TrimSpace(c.config.SatelliteName),
		Mode:                 strings.TrimSpace(c.config.SatelliteMode),
		Cloud:                strings.TrimSpace(c.config.SatelliteCloud),
		Region:               strings.TrimSpace(c.config.SatelliteRegion),
		ClusterName:          strings.TrimSpace(c.config.SatelliteCluster),
		EndpointURL:          strings.TrimSpace(c.config.SatelliteEndpointURL),
		Version:              strings.TrimSpace(c.config.SatelliteVersion),
		Status:               status,
		HeartbeatIntervalSec: int(c.heartbeatInterval().Seconds()),
		Capabilities: map[string]any{
			"adapters":         []string{"kubernetes", "cloudrun", "lambda", "containerapps"},
			"telemetrySources": []string{"prometheus", "loki", "tempo"},
			"taskTypes":        []string{satelliteTaskTypeReconcileDeployment},
			"taskWorker":       c.config.SatelliteTasksEnabled,
			"directApply": map[string]bool{
				"kubernetes":    c.config.KubernetesApplyEnabled,
				"cloudrun":      c.config.CloudRunApplyEnabled,
				"lambda":        c.config.LambdaApplyEnabled,
				"containerapps": c.config.ContainerAppsApplyEnabled,
			},
		},
		Labels: labels,
		Summary: map[string]any{
			"controllerReady":          true,
			"taskWorkerEnabled":        c.config.SatelliteTasksEnabled,
			"telemetryValidation":      validations,
			"reconcileTimeoutSec":      int(c.config.ReconcileTimeout.Seconds()),
			"telemetryPollIntervalSec": int(c.config.TelemetryPollInterval.Seconds()),
		},
	}
}

func (c *satelliteCoordinator) currentValidations(ctx context.Context) []telemetrySourceValidation {
	if c.validateSources == nil {
		return nil
	}
	return c.validateSources(ctx)
}

func (c *satelliteCoordinator) timeout() time.Duration {
	if c.config.SatelliteCoordinatorTimeout > 0 {
		return c.config.SatelliteCoordinatorTimeout
	}
	return 5 * time.Second
}

func (c *satelliteCoordinator) heartbeatInterval() time.Duration {
	if c.config.SatelliteHeartbeatInterval > 0 {
		return c.config.SatelliteHeartbeatInterval
	}
	return 30 * time.Second
}

func (c *satelliteCoordinator) tenantHeader() string {
	if value := strings.TrimSpace(c.config.SatelliteTenantHeader); value != "" {
		return value
	}
	return "x-sentra-tenant"
}
