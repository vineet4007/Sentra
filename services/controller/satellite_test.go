package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSatelliteCoordinatorBuildHeartbeatPayload(t *testing.T) {
	coordinator := &satelliteCoordinator{
		config: controllerConfig{
			SatelliteName:              "regional-west",
			SatelliteMode:              "satellite",
			SatelliteCloud:             "aws",
			SatelliteRegion:            "us-west-2",
			SatelliteCluster:           "prod-west",
			SatelliteVersion:           "2026.03.18",
			SatelliteHeartbeatInterval: 45 * time.Second,
			ReconcileTimeout:           10 * time.Second,
			TelemetryPollInterval:      15 * time.Second,
			KubernetesApplyEnabled:     true,
			CloudRunApplyEnabled:       false,
			LambdaApplyEnabled:         true,
			ContainerAppsApplyEnabled:  false,
		},
		validateSources: func(context.Context) []telemetrySourceValidation {
			return []telemetrySourceValidation{
				{Source: "prometheus", Status: "ok"},
				{Source: "loki", Status: "error", Error: "timeout"},
			}
		},
	}

	payload := coordinator.buildHeartbeatPayload(context.Background())

	if payload.Name != "regional-west" {
		t.Fatalf("expected satellite name, got %q", payload.Name)
	}
	if payload.Status != "degraded" {
		t.Fatalf("expected degraded status, got %q", payload.Status)
	}
	if payload.HeartbeatIntervalSec != 45 {
		t.Fatalf("expected heartbeat interval 45, got %d", payload.HeartbeatIntervalSec)
	}
	if payload.Labels["cloud"] != "aws" || payload.Labels["cluster"] != "prod-west" {
		t.Fatalf("expected cloud and cluster labels, got %#v", payload.Labels)
	}

	directApply, ok := payload.Capabilities["directApply"].(map[string]bool)
	if !ok {
		t.Fatalf("expected directApply capability map, got %#v", payload.Capabilities["directApply"])
	}
	if !directApply["kubernetes"] || !directApply["lambda"] {
		t.Fatalf("expected kubernetes and lambda direct apply flags, got %#v", directApply)
	}
}

func TestSatelliteCoordinatorSendHeartbeat(t *testing.T) {
	var (
		gotPath      string
		gotAuth      string
		gotTenant    string
		gotPayload   satelliteHeartbeatPayload
		requestCount int
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotTenant = r.Header.Get("x-sentra-tenant")

		defer r.Body.Close()
		if err := json.NewDecoder(r.Body).Decode(&gotPayload); err != nil {
			t.Fatalf("failed to decode request body: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	coordinator := &satelliteCoordinator{
		config: controllerConfig{
			SatelliteName:               "regional-west",
			SatelliteMode:               "satellite",
			SatelliteCoordinatorURL:     server.URL,
			SatelliteCoordinatorToken:   "secret-token",
			SatelliteTenantKey:          "tenant-a",
			SatelliteTenantHeader:       "x-sentra-tenant",
			SatelliteHeartbeatInterval:  30 * time.Second,
			SatelliteCoordinatorTimeout: 2 * time.Second,
		},
		httpClient: server.Client(),
		validateSources: func(context.Context) []telemetrySourceValidation {
			return []telemetrySourceValidation{
				{Source: "prometheus", Status: "ok"},
				{Source: "loki", Status: "ok"},
				{Source: "tempo", Status: "ok"},
			}
		},
	}

	if err := coordinator.sendHeartbeat(context.Background()); err != nil {
		t.Fatalf("expected heartbeat to succeed, got %v", err)
	}

	if requestCount != 1 {
		t.Fatalf("expected one heartbeat request, got %d", requestCount)
	}
	if gotPath != "/satellites/heartbeat" {
		t.Fatalf("expected heartbeat path, got %q", gotPath)
	}
	if gotAuth != "Bearer secret-token" {
		t.Fatalf("expected bearer token, got %q", gotAuth)
	}
	if gotTenant != "tenant-a" {
		t.Fatalf("expected tenant header, got %q", gotTenant)
	}
	if gotPayload.Name != "regional-west" {
		t.Fatalf("expected payload name, got %q", gotPayload.Name)
	}
	if gotPayload.Status != "online" {
		t.Fatalf("expected online status, got %q", gotPayload.Status)
	}
}

func TestSatelliteCoordinatorRejectsCoordinatorError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":"denied"}`, http.StatusUnauthorized)
	}))
	defer server.Close()

	coordinator := &satelliteCoordinator{
		config: controllerConfig{
			SatelliteName:               "regional-west",
			SatelliteMode:               "satellite",
			SatelliteCoordinatorURL:     server.URL,
			SatelliteHeartbeatInterval:  30 * time.Second,
			SatelliteCoordinatorTimeout: 2 * time.Second,
		},
		httpClient: server.Client(),
		validateSources: func(context.Context) []telemetrySourceValidation {
			return []telemetrySourceValidation{{Source: "prometheus", Status: "ok"}}
		},
	}

	err := coordinator.sendHeartbeat(context.Background())
	if err == nil {
		t.Fatal("expected heartbeat error")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Fatalf("expected status code in error, got %v", err)
	}
}
