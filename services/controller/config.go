package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type controllerConfig struct {
	HTTPPort              string
	MySQLDSN              string
	RedisURL              string
	PrometheusURL         string
	LokiURL               string
	LokiTenantID          string
	TempoURL              string
	TelemetryWindow       time.Duration
	TelemetryStep         time.Duration
	TelemetryPollInterval time.Duration
	TelemetryQueryTimeout time.Duration
	ReconcileTimeout      time.Duration
}

func loadControllerConfig() (controllerConfig, error) {
	window, err := envDurationSeconds("TELEMETRY_WINDOW_SEC", 60)
	if err != nil {
		return controllerConfig{}, err
	}

	step, err := envDurationSeconds("TELEMETRY_STEP_SEC", 5)
	if err != nil {
		return controllerConfig{}, err
	}

	pollInterval, err := envDurationSeconds("TELEMETRY_POLL_INTERVAL_SEC", 15)
	if err != nil {
		return controllerConfig{}, err
	}

	queryTimeout, err := envDurationSeconds("TELEMETRY_QUERY_TIMEOUT_SEC", 5)
	if err != nil {
		return controllerConfig{}, err
	}

	reconcileTimeout, err := envDurationSeconds("RECONCILE_TIMEOUT_SEC", 10)
	if err != nil {
		return controllerConfig{}, err
	}

	return controllerConfig{
		HTTPPort:              controllerPort(),
		MySQLDSN:              envOrDefault("MYSQL_DSN", "sentra:sentra_pass@tcp(localhost:3306)/sentra?parseTime=true"),
		RedisURL:              envOrDefault("REDIS_URL", "redis://localhost:6379"),
		PrometheusURL:         envOrDefault("PROMETHEUS_URL", "http://localhost:9090"),
		LokiURL:               envOrDefault("LOKI_URL", "http://localhost:3100"),
		LokiTenantID:          envOrDefault("LOKI_TENANT_ID", "local"),
		TempoURL:              envOrDefault("TEMPO_URL", "http://localhost:3200"),
		TelemetryWindow:       window,
		TelemetryStep:         step,
		TelemetryPollInterval: pollInterval,
		TelemetryQueryTimeout: queryTimeout,
		ReconcileTimeout:      reconcileTimeout,
	}, nil
}

func envDurationSeconds(key string, fallbackSeconds int) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return time.Duration(fallbackSeconds) * time.Second, nil
	}

	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer number of seconds", key)
	}

	return time.Duration(value) * time.Second, nil
}

func envOrDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func controllerPort() string {
	value := strings.TrimSpace(os.Getenv("CONTROLLER_HTTP_PORT"))
	if value == "" {
		return ":8090"
	}
	if strings.HasPrefix(value, ":") {
		return value
	}
	return ":" + value
}
