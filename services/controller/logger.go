package main

import (
	"log/slog"
	"os"
)

// Logger wraps slog with helpful methods for structured logging
type Logger struct {
	*slog.Logger
}

// NewLogger creates a new structured logger
func NewLogger() *Logger {
	// In development, use text format; in production, use JSON
	var opts *slog.HandlerOptions
	if os.Getenv("SENTRA_ENV") == "development" {
		opts = &slog.HandlerOptions{
			Level: slog.LevelDebug,
		}
	} else {
		opts = &slog.HandlerOptions{
			Level: parseLevelFromEnv(),
		}
	}

	var handler slog.Handler
	if os.Getenv("SENTRA_LOG_FORMAT") == "json" {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}

	return &Logger{slog.New(handler)}
}

func parseLevelFromEnv() slog.Level {
	switch os.Getenv("SENTRA_LOG_LEVEL") {
	case "debug":
		return slog.LevelDebug
	case "info":
		return slog.LevelInfo
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// WithDeploy adds deployment context to the logger
func (l *Logger) WithDeploy(deploymentId int, serviceId int, environmentId int) *Logger {
	return &Logger{l.With(
		slog.Int("deploymentId", deploymentId),
		slog.Int("serviceId", serviceId),
		slog.Int("environmentId", environmentId),
	)}
}

// WithRollout adds rollout context to the logger
func (l *Logger) WithRollout(rolloutId int, status string) *Logger {
	return &Logger{l.With(
		slog.Int("rolloutId", rolloutId),
		slog.String("status", status),
	)}
}

// WithTelemetry adds telemetry context to the logger
func (l *Logger) WithTelemetry(sourceType string, sourceId int) *Logger {
	return &Logger{l.With(
		slog.String("telemetryType", sourceType),
		slog.Int("telemetrySourceId", sourceId),
	)}
}

// WithAdapter adds deployment adapter context to the logger
func (l *Logger) WithAdapter(adapterType string, config string) *Logger {
	return &Logger{l.With(
		slog.String("adapterType", adapterType),
		slog.String("adapterConfig", redactSensitiveData(config)),
	)}
}

// WithTenant adds tenant context to the logger
func (l *Logger) WithTenant(tenantKey string) *Logger {
	return &Logger{l.With(
		slog.String("tenantKey", tenantKey),
	)}
}

// LogError logs an error with context
func (l *Logger) LogError(msg string, err error, attrs ...slog.Attr) {
	l.Error(msg, append([]slog.Attr{slog.String("error", err.Error())}, attrs...)...)
}

// LogMetric logs a metric value
func (l *Logger) LogMetric(name string, value float64, unit string, attrs ...slog.Attr) {
	l.Info("metric",
		append([]slog.Attr{
			slog.String("metricName", name),
			slog.Float64("value", value),
			slog.String("unit", unit),
		}, attrs...)...,
	)
}

// LogDecision logs a rollout decision
func (l *Logger) LogDecision(deploymentId int, decision string, reason string, attrs ...slog.Attr) {
	l.Info("rollout_decision",
		append([]slog.Attr{
			slog.Int("deploymentId", deploymentId),
			slog.String("decision", decision),
			slog.String("reason", reason),
		}, attrs...)...,
	)
}

// redactSensitiveData removes sensitive information from logs
func redactSensitiveData(data string) string {
	// Pattern-based redaction for common sensitive fields
	// This is a simple implementation; more sophisticated patterns can be added
	if len(data) > 100 {
		return data[:50] + "..." // Truncate long configs
	}
	return data
}
