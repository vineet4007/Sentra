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

func TestBuildPrometheusErrorRateQuery(t *testing.T) {
	options := telemetryQueryOptions{
		Labels: telemetryLabels{
			Service:     "payments-api",
			Environment: "staging",
			Version:     "candidate",
		},
		LabelMap: telemetryLabelMap{
			Service:     "service",
			Environment: "env",
			Version:     "version",
		},
		Window: telemetryWindow{
			RangeSec: 60,
		},
	}

	query := buildPrometheusErrorRateQuery(options)

	for _, expected := range []string{
		`http_server_request_duration_seconds_count{service="payments-api", env="staging", version="candidate", status_code=~"5.."}`,
		`http_server_request_duration_seconds_count{service="payments-api", env="staging", version="candidate"}`,
		`[1m]`,
	} {
		if !strings.Contains(query, expected) {
			t.Fatalf("expected query to contain %q, got %q", expected, query)
		}
	}
}

func TestPrometheusClientInstantQueryParsesVector(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "success",
			"data": map[string]any{
				"resultType": "vector",
				"result": []any{
					map[string]any{
						"metric": map[string]string{"job": "controller"},
						"value":  []any{float64(1710000000), "1.25"},
					},
				},
			},
		})
	}))
	defer server.Close()

	client := &prometheusClient{
		baseURL:    server.URL,
		httpClient: server.Client(),
	}

	sample, count, err := client.instantQuery(context.Background(), "up", time.Now())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if count != 1 {
		t.Fatalf("expected 1 sample, got %d", count)
	}

	if sample.Value != 1.25 {
		t.Fatalf("expected parsed value 1.25, got %f", sample.Value)
	}
}

func TestLokiClientInstantQueryUsesTenantHeader(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-Scope-OrgID"); got != "local" {
			t.Fatalf("expected tenant header %q, got %q", "local", got)
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "success",
			"data": map[string]any{
				"resultType": "vector",
				"result":     []any{},
			},
		})
	}))
	defer server.Close()

	client := &lokiClient{
		baseURL:    server.URL,
		tenantID:   "local",
		httpClient: server.Client(),
	}

	_, count, err := client.instantQuery(context.Background(), `sum(count_over_time({job="varlogs"}[1m]))`, time.Now())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if count != 0 {
		t.Fatalf("expected no data, got %d samples", count)
	}
}

func TestTempoClientSearchParsesResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"traces": []any{
				map[string]any{"traceID": "abc"},
				map[string]any{"traceID": "def"},
			},
			"metrics": map[string]int{
				"completedJobs": 1,
				"totalJobs":     1,
			},
		})
	}))
	defer server.Close()

	client := &tempoClient{
		baseURL:    server.URL,
		httpClient: server.Client(),
	}

	response, err := client.search(context.Background(), `{resource.service.name="payments-api"}`, 5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(response.Traces) != 2 {
		t.Fatalf("expected 2 traces, got %d", len(response.Traces))
	}
}
