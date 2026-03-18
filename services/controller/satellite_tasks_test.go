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

func TestSatelliteTaskWorkerPollOnceCompletesTask(t *testing.T) {
	var (
		gotAuth   string
		gotTenant string
		report    satelliteTaskReportRequest
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/satellites/tasks/claim":
			gotAuth = r.Header.Get("Authorization")
			gotTenant = r.Header.Get("x-sentra-tenant")
			_, _ = w.Write([]byte(`{"ok":true,"data":{"task":{"id":7,"satelliteId":2,"satelliteName":"regional-west","deploymentId":42,"taskType":"reconcile.deployment","status":"claimed","payload":{"deploymentId":42}}}}`))
		case "/satellites/tasks/7/report":
			defer r.Body.Close()
			if err := json.NewDecoder(r.Body).Decode(&report); err != nil {
				t.Fatalf("failed to decode report: %v", err)
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":{"task":{"id":7}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	worker := &satelliteTaskWorker{
		config: controllerConfig{
			SatelliteEnabled:            true,
			SatelliteTasksEnabled:       true,
			SatelliteName:               "regional-west",
			SatelliteCoordinatorURL:     server.URL,
			SatelliteCoordinatorToken:   "secret-token",
			SatelliteTenantKey:          "tenant-a",
			SatelliteTenantHeader:       "x-sentra-tenant",
			SatelliteCoordinatorTimeout: 2 * time.Second,
			SatelliteTaskLeaseDuration:  20 * time.Second,
		},
		httpClient: server.Client(),
		runReconcile: func(_ context.Context, request reconcileRequest) (reconcileResponse, error) {
			if request.DeploymentID != 42 {
				t.Fatalf("expected deployment ID 42, got %d", request.DeploymentID)
			}
			return reconcileResponse{
				DeploymentID: 42,
				Phase:        "initialized",
			}, nil
		},
	}

	if err := worker.pollOnce(context.Background()); err != nil {
		t.Fatalf("expected poll to succeed, got %v", err)
	}

	if gotAuth != "Bearer secret-token" {
		t.Fatalf("expected bearer auth header, got %q", gotAuth)
	}
	if gotTenant != "tenant-a" {
		t.Fatalf("expected tenant header, got %q", gotTenant)
	}
	if report.Status != "completed" {
		t.Fatalf("expected completed status, got %q", report.Status)
	}
	if report.SatelliteName != "regional-west" {
		t.Fatalf("expected satellite name in report, got %q", report.SatelliteName)
	}
	if report.Error != "" {
		t.Fatalf("expected no error message, got %q", report.Error)
	}
}

func TestSatelliteTaskWorkerPollOnceReportsFailure(t *testing.T) {
	var report satelliteTaskReportRequest

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/satellites/tasks/claim":
			_, _ = w.Write([]byte(`{"ok":true,"data":{"task":{"id":9,"satelliteId":3,"satelliteName":"regional-east","deploymentId":99,"taskType":"reconcile.deployment","status":"claimed","payload":{"deploymentId":99}}}}`))
		case "/satellites/tasks/9/report":
			defer r.Body.Close()
			if err := json.NewDecoder(r.Body).Decode(&report); err != nil {
				t.Fatalf("failed to decode report: %v", err)
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":{"task":{"id":9}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	worker := &satelliteTaskWorker{
		config: controllerConfig{
			SatelliteEnabled:            true,
			SatelliteTasksEnabled:       true,
			SatelliteName:               "regional-east",
			SatelliteCoordinatorURL:     server.URL,
			SatelliteCoordinatorTimeout: 2 * time.Second,
			SatelliteTaskLeaseDuration:  20 * time.Second,
		},
		httpClient: server.Client(),
		runReconcile: func(_ context.Context, _ reconcileRequest) (reconcileResponse, error) {
			return reconcileResponse{}, assertError("boom")
		},
	}

	if err := worker.pollOnce(context.Background()); err != nil {
		t.Fatalf("expected poll to report failure cleanly, got %v", err)
	}

	if report.Status != "failed" {
		t.Fatalf("expected failed status, got %q", report.Status)
	}
	if !strings.Contains(report.Error, "boom") {
		t.Fatalf("expected error message to include boom, got %q", report.Error)
	}
}

func TestSatelliteTaskWorkerPollOnceNoTask(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/satellites/tasks/claim" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true,"data":{"task":null}}`))
	}))
	defer server.Close()

	worker := &satelliteTaskWorker{
		config: controllerConfig{
			SatelliteEnabled:            true,
			SatelliteTasksEnabled:       true,
			SatelliteName:               "regional-north",
			SatelliteCoordinatorURL:     server.URL,
			SatelliteCoordinatorTimeout: 2 * time.Second,
		},
		httpClient: server.Client(),
		runReconcile: func(_ context.Context, _ reconcileRequest) (reconcileResponse, error) {
			t.Fatal("did not expect reconcile to run when no task is available")
			return reconcileResponse{}, nil
		},
	}

	if err := worker.pollOnce(context.Background()); err != nil {
		t.Fatalf("expected no-task poll to succeed, got %v", err)
	}
}

type assertError string

func (e assertError) Error() string {
	return string(e)
}
