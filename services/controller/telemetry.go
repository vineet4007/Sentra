package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

var (
	telemetrySourceUp = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "sentra_controller_telemetry_source_up",
		Help: "Reachability of telemetry backends used by the controller (1=reachable)",
	}, []string{"source"})
	telemetrySourceLatency = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sentra_controller_telemetry_request_duration_seconds",
		Help:    "Latency of controller telemetry requests.",
		Buckets: []float64{0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5},
	}, []string{"source", "operation"})
	telemetryLastValidation = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "sentra_controller_telemetry_last_validation_timestamp_seconds",
		Help: "Unix timestamp of the last telemetry validation per source.",
	}, []string{"source"})
)

type signalStatus string

const (
	signalStatusOK     signalStatus = "ok"
	signalStatusNoData signalStatus = "no_data"
	signalStatusError  signalStatus = "error"
)

type telemetryLabels struct {
	Project     string `json:"project,omitempty"`
	Service     string `json:"service,omitempty"`
	Environment string `json:"environment,omitempty"`
	Version     string `json:"version,omitempty"`
	Region      string `json:"region,omitempty"`
	Cluster     string `json:"cluster,omitempty"`
	Cloud       string `json:"cloud,omitempty"`
}

type telemetryLabelMap struct {
	Project     string `json:"project"`
	Service     string `json:"service"`
	Environment string `json:"environment"`
	Version     string `json:"version"`
	Region      string `json:"region"`
	Cluster     string `json:"cluster"`
	Cloud       string `json:"cloud"`
}

type telemetryWindow struct {
	Start    time.Time `json:"start"`
	End      time.Time `json:"end"`
	RangeSec int64     `json:"rangeSec"`
	StepSec  int64     `json:"stepSec"`
}

type telemetrySignal struct {
	Name        string       `json:"name"`
	Source      string       `json:"source"`
	Query       string       `json:"query"`
	Unit        string       `json:"unit,omitempty"`
	Status      signalStatus `json:"status"`
	Value       *float64     `json:"value,omitempty"`
	Timestamp   *time.Time   `json:"timestamp,omitempty"`
	SampleCount int          `json:"sampleCount,omitempty"`
	Error       string       `json:"error,omitempty"`
}

type telemetrySourceValidation struct {
	Source          string `json:"source"`
	URL             string `json:"url"`
	ValidationQuery string `json:"validationQuery,omitempty"`
	Status          string `json:"status"`
	DurationMs      int64  `json:"durationMs"`
	Error           string `json:"error,omitempty"`
}

type rolloutTelemetrySnapshot struct {
	GeneratedAt time.Time                   `json:"generatedAt"`
	Window      telemetryWindow             `json:"window"`
	Labels      telemetryLabels             `json:"labels"`
	LabelMap    telemetryLabelMap           `json:"labelMap"`
	Validation  []telemetrySourceValidation `json:"validation"`
	Metrics     map[string]telemetrySignal  `json:"metrics"`
	Logs        map[string]telemetrySignal  `json:"logs"`
	Traces      map[string]telemetrySignal  `json:"traces"`
}

type telemetryQueryOptions struct {
	Labels   telemetryLabels
	LabelMap telemetryLabelMap
	Window   telemetryWindow
	Limit    int
}

type telemetryService struct {
	config     controllerConfig
	httpClient *http.Client
	prom       *prometheusClient
	loki       *lokiClient
	tempo      *tempoClient
}

type prometheusClient struct {
	baseURL    string
	httpClient *http.Client
}

type lokiClient struct {
	baseURL    string
	tenantID   string
	httpClient *http.Client
}

type tempoClient struct {
	baseURL    string
	httpClient *http.Client
}

type instantSample struct {
	Timestamp time.Time
	Value     float64
}

type promQueryEnvelope struct {
	Status    string        `json:"status"`
	ErrorType string        `json:"errorType"`
	Error     string        `json:"error"`
	Data      promQueryData `json:"data"`
}

type promQueryData struct {
	ResultType string          `json:"resultType"`
	Result     json.RawMessage `json:"result"`
}

type promVectorResult struct {
	Metric map[string]string `json:"metric"`
	Value  []any             `json:"value"`
}

type lokiQueryEnvelope struct {
	Status    string        `json:"status"`
	ErrorType string        `json:"errorType"`
	Error     string        `json:"error"`
	Data      lokiQueryData `json:"data"`
}

type lokiQueryData struct {
	ResultType string          `json:"resultType"`
	Result     json.RawMessage `json:"result"`
}

type lokiVectorResult struct {
	Metric map[string]string `json:"metric"`
	Stream map[string]string `json:"stream"`
	Value  []any             `json:"value"`
}

type tempoSearchResponse struct {
	Traces  []json.RawMessage `json:"traces"`
	Metrics struct {
		CompletedJobs int `json:"completedJobs"`
		TotalJobs     int `json:"totalJobs"`
	} `json:"metrics"`
}

func newTelemetryService(config controllerConfig) *telemetryService {
	httpClient := &http.Client{
		Timeout: config.TelemetryQueryTimeout,
	}

	return &telemetryService{
		config:     config,
		httpClient: httpClient,
		prom: &prometheusClient{
			baseURL:    config.PrometheusURL,
			httpClient: httpClient,
		},
		loki: &lokiClient{
			baseURL:    config.LokiURL,
			tenantID:   config.LokiTenantID,
			httpClient: httpClient,
		},
		tempo: &tempoClient{
			baseURL:    config.TempoURL,
			httpClient: httpClient,
		},
	}
}

func (s *telemetryService) startBackgroundValidation(ctx context.Context) {
	ticker := time.NewTicker(s.config.TelemetryPollInterval)
	defer ticker.Stop()

	s.runValidationCycle(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.runValidationCycle(ctx)
		}
	}
}

func (s *telemetryService) runValidationCycle(ctx context.Context) {
	validations := s.validateSources(ctx)
	for _, validation := range validations {
		value := 0.0
		if validation.Status == "ok" {
			value = 1
		}

		telemetrySourceUp.WithLabelValues(validation.Source).Set(value)
		telemetryLastValidation.WithLabelValues(validation.Source).Set(float64(time.Now().Unix()))

		if validation.Error != "" {
			log.Printf("telemetry validation failed for %s: %s", validation.Source, validation.Error)
		}
	}
}

func (s *telemetryService) handleValidate(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), s.config.TelemetryQueryTimeout)
	defer cancel()

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"sources": s.validateSources(ctx),
	})
}

func (s *telemetryService) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	options, err := telemetryQueryOptionsFromRequest(r, s.config)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false,
			"error": map[string]string{
				"message": err.Error(),
			},
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.config.TelemetryQueryTimeout)
	defer cancel()

	snapshot := s.buildSnapshot(ctx, options)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": snapshot,
	})
}

func (s *telemetryService) validateSources(ctx context.Context) []telemetrySourceValidation {
	validations := []telemetrySourceValidation{
		s.validatePrometheus(ctx),
		s.validateLoki(ctx),
		s.validateTempo(ctx),
	}
	return validations
}

func (s *telemetryService) buildSnapshot(ctx context.Context, options telemetryQueryOptions) rolloutTelemetrySnapshot {
	end := time.Now().UTC()
	options.Window.End = end
	options.Window.Start = end.Add(-time.Duration(options.Window.RangeSec) * time.Second)

	snapshot := rolloutTelemetrySnapshot{
		GeneratedAt: end,
		Window:      options.Window,
		Labels:      options.Labels,
		LabelMap:    options.LabelMap,
		Validation:  s.validateSources(ctx),
		Metrics: map[string]telemetrySignal{
			"errorRatePct": s.queryPrometheusSignal(ctx, "error_rate_pct", "pct", buildPrometheusErrorRateQuery(options)),
			"latencyP95Ms": s.queryPrometheusSignal(ctx, "latency_p95_ms", "ms", buildPrometheusLatencyQuery(options)),
		},
		Logs: map[string]telemetrySignal{
			"logErrorRatioPct": s.queryLokiErrorRatio(ctx, options),
		},
		Traces: map[string]telemetrySignal{
			"recentTraceCount": s.queryTempoTraceCount(ctx, options),
		},
	}

	return snapshot
}

func (s *telemetryService) validatePrometheus(ctx context.Context) telemetrySourceValidation {
	query := "up"
	start := time.Now()
	_, _, err := s.prom.instantQuery(ctx, query, time.Now().UTC())
	return validationFromResult("prometheus", s.config.PrometheusURL, query, start, err)
}

func (s *telemetryService) validateLoki(ctx context.Context) telemetrySourceValidation {
	query := `sum(count_over_time({job="varlogs"}[1m]))`
	start := time.Now()
	_, _, err := s.loki.instantQuery(ctx, query, time.Now().UTC())
	return validationFromResult("loki", s.config.LokiURL, query, start, err)
}

func (s *telemetryService) validateTempo(ctx context.Context) telemetrySourceValidation {
	query := "{}"
	start := time.Now()
	_, err := s.tempo.search(ctx, query, 1)
	return validationFromResult("tempo", s.config.TempoURL, query, start, err)
}

func (s *telemetryService) queryPrometheusSignal(ctx context.Context, name, unit, query string) telemetrySignal {
	signal := telemetrySignal{
		Name:   name,
		Source: "prometheus",
		Query:  query,
		Unit:   unit,
	}

	sample, sampleCount, err := s.prom.instantQuery(ctx, query, time.Now().UTC())
	if err != nil {
		signal.Status = signalStatusError
		signal.Error = err.Error()
		return signal
	}

	if sampleCount == 0 {
		signal.Status = signalStatusNoData
		return signal
	}

	signal.Status = signalStatusOK
	signal.Value = floatPointer(sample.Value)
	signal.Timestamp = &sample.Timestamp
	signal.SampleCount = sampleCount
	return signal
}

func (s *telemetryService) queryLokiErrorRatio(ctx context.Context, options telemetryQueryOptions) telemetrySignal {
	errorQuery := buildLokiErrorCountQuery(options)
	totalQuery := buildLokiTotalCountQuery(options)

	signal := telemetrySignal{
		Name:   "log_error_ratio_pct",
		Source: "loki",
		Query:  fmt.Sprintf("100 * (%s / clamp_min(%s, 1))", errorQuery, totalQuery),
		Unit:   "pct",
	}

	errorSample, _, err := s.loki.instantQuery(ctx, errorQuery, time.Now().UTC())
	if err != nil {
		signal.Status = signalStatusError
		signal.Error = err.Error()
		return signal
	}

	totalSample, totalSampleCount, err := s.loki.instantQuery(ctx, totalQuery, time.Now().UTC())
	if err != nil {
		signal.Status = signalStatusError
		signal.Error = err.Error()
		return signal
	}

	if totalSampleCount == 0 || totalSample.Value <= 0 {
		signal.Status = signalStatusNoData
		return signal
	}

	value := (errorSample.Value / totalSample.Value) * 100
	signal.Status = signalStatusOK
	signal.Value = floatPointer(value)
	signal.Timestamp = &totalSample.Timestamp
	signal.SampleCount = totalSampleCount
	return signal
}

func (s *telemetryService) queryTempoTraceCount(ctx context.Context, options telemetryQueryOptions) telemetrySignal {
	query := buildTempoSearchQuery(options)
	signal := telemetrySignal{
		Name:   "recent_trace_count",
		Source: "tempo",
		Query:  query,
		Unit:   "count",
	}

	response, err := s.tempo.search(ctx, query, options.Limit)
	if err != nil {
		signal.Status = signalStatusError
		signal.Error = err.Error()
		return signal
	}

	if len(response.Traces) == 0 {
		signal.Status = signalStatusNoData
		return signal
	}

	value := float64(len(response.Traces))
	signal.Status = signalStatusOK
	signal.Value = floatPointer(value)
	signal.SampleCount = len(response.Traces)
	return signal
}

func (c *prometheusClient) instantQuery(ctx context.Context, query string, ts time.Time) (instantSample, int, error) {
	requestURL, err := queryURL(c.baseURL, "/api/v1/query", map[string]string{
		"query": query,
		"time":  ts.Format(time.RFC3339Nano),
	})
	if err != nil {
		return instantSample{}, 0, err
	}

	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return instantSample{}, 0, err
	}

	var response promQueryEnvelope
	if err := doJSONRequest(c.httpClient, req, &response); err != nil {
		return instantSample{}, 0, err
	}

	telemetrySourceLatency.WithLabelValues("prometheus", "instant_query").Observe(time.Since(start).Seconds())

	if response.Status != "success" {
		return instantSample{}, 0, fmt.Errorf("prometheus query failed: %s", response.Error)
	}

	return parseInstantSample(response.Data.ResultType, response.Data.Result)
}

func (c *lokiClient) instantQuery(ctx context.Context, query string, ts time.Time) (instantSample, int, error) {
	requestURL, err := queryURL(c.baseURL, "/loki/api/v1/query", map[string]string{
		"query": query,
		"time":  ts.Format(time.RFC3339Nano),
	})
	if err != nil {
		return instantSample{}, 0, err
	}

	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return instantSample{}, 0, err
	}
	if c.tenantID != "" {
		req.Header.Set("X-Scope-OrgID", c.tenantID)
	}

	var response lokiQueryEnvelope
	if err := doJSONRequest(c.httpClient, req, &response); err != nil {
		return instantSample{}, 0, err
	}

	telemetrySourceLatency.WithLabelValues("loki", "instant_query").Observe(time.Since(start).Seconds())

	if response.Status != "success" {
		return instantSample{}, 0, fmt.Errorf("loki query failed: %s", response.Error)
	}

	return parseInstantSample(response.Data.ResultType, response.Data.Result)
}

func (c *tempoClient) search(ctx context.Context, query string, limit int) (tempoSearchResponse, error) {
	requestURL, err := queryURL(c.baseURL, "/api/search", map[string]string{
		"q":     query,
		"limit": strconv.Itoa(limit),
	})
	if err != nil {
		return tempoSearchResponse{}, err
	}

	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return tempoSearchResponse{}, err
	}

	var response tempoSearchResponse
	if err := doJSONRequest(c.httpClient, req, &response); err != nil {
		return tempoSearchResponse{}, err
	}

	telemetrySourceLatency.WithLabelValues("tempo", "search").Observe(time.Since(start).Seconds())
	return response, nil
}

func telemetryQueryOptionsFromRequest(r *http.Request, config controllerConfig) (telemetryQueryOptions, error) {
	query := r.URL.Query()
	windowSec, err := positiveQueryInt(query.Get("windowSec"), int(config.TelemetryWindow/time.Second))
	if err != nil {
		return telemetryQueryOptions{}, err
	}

	stepSec, err := positiveQueryInt(query.Get("stepSec"), int(config.TelemetryStep/time.Second))
	if err != nil {
		return telemetryQueryOptions{}, err
	}

	limit, err := positiveQueryInt(query.Get("limit"), 20)
	if err != nil {
		return telemetryQueryOptions{}, err
	}

	return telemetryQueryOptions{
		Labels: telemetryLabels{
			Project:     strings.TrimSpace(query.Get("project")),
			Service:     strings.TrimSpace(query.Get("service")),
			Environment: strings.TrimSpace(query.Get("environment")),
			Version:     strings.TrimSpace(query.Get("version")),
			Region:      strings.TrimSpace(query.Get("region")),
			Cluster:     strings.TrimSpace(query.Get("cluster")),
			Cloud:       strings.TrimSpace(query.Get("cloud")),
		},
		LabelMap: telemetryLabelMap{
			Project:     stringOrFallback(query.Get("projectLabel"), "project"),
			Service:     stringOrFallback(query.Get("serviceLabel"), "service"),
			Environment: stringOrFallback(query.Get("environmentLabel"), "env"),
			Version:     stringOrFallback(query.Get("versionLabel"), "version"),
			Region:      stringOrFallback(query.Get("regionLabel"), "region"),
			Cluster:     stringOrFallback(query.Get("clusterLabel"), "cluster"),
			Cloud:       stringOrFallback(query.Get("cloudLabel"), "cloud"),
		},
		Window: telemetryWindow{
			RangeSec: int64(windowSec),
			StepSec:  int64(stepSec),
		},
		Limit: limit,
	}, nil
}

func buildPrometheusErrorRateQuery(options telemetryQueryOptions) string {
	matchers := buildPrometheusMatchers(options.Labels, options.LabelMap)
	rangeSelector := promDuration(time.Duration(options.Window.RangeSec) * time.Second)
	countMetric := metricWithMatchers("http_server_request_duration_seconds_count", matchers)
	errorMetric := metricWithMatchers("http_server_request_duration_seconds_count", append(matchers, `status_code=~"5.."`))

	return fmt.Sprintf(
		"100 * (sum(rate(%s[%s])) / clamp_min(sum(rate(%s[%s])), 1))",
		errorMetric,
		rangeSelector,
		countMetric,
		rangeSelector,
	)
}

func buildPrometheusLatencyQuery(options telemetryQueryOptions) string {
	matchers := buildPrometheusMatchers(options.Labels, options.LabelMap)
	rangeSelector := promDuration(time.Duration(options.Window.RangeSec) * time.Second)
	bucketMetric := metricWithMatchers("http_server_request_duration_seconds_bucket", matchers)

	return fmt.Sprintf(
		"histogram_quantile(0.95, sum(rate(%s[%s])) by (le)) * 1000",
		bucketMetric,
		rangeSelector,
	)
}

func buildLokiErrorCountQuery(options telemetryQueryOptions) string {
	selector := buildLokiSelector(options.Labels, options.LabelMap)
	rangeSelector := promDuration(time.Duration(options.Window.RangeSec) * time.Second)
	return fmt.Sprintf(`sum(count_over_time(%s |= "error" [%s]))`, selector, rangeSelector)
}

func buildLokiTotalCountQuery(options telemetryQueryOptions) string {
	selector := buildLokiSelector(options.Labels, options.LabelMap)
	rangeSelector := promDuration(time.Duration(options.Window.RangeSec) * time.Second)
	return fmt.Sprintf(`sum(count_over_time(%s [%s]))`, selector, rangeSelector)
}

func buildTempoSearchQuery(options telemetryQueryOptions) string {
	clauses := []string{}

	if options.Labels.Service != "" {
		clauses = append(clauses, fmt.Sprintf(`resource.service.name="%s"`, escapeTraceQLValue(options.Labels.Service)))
	}
	if options.Labels.Environment != "" {
		clauses = append(clauses, fmt.Sprintf(`resource.deployment.environment="%s"`, escapeTraceQLValue(options.Labels.Environment)))
	}
	if options.Labels.Version != "" {
		clauses = append(clauses, fmt.Sprintf(`resource.service.version="%s"`, escapeTraceQLValue(options.Labels.Version)))
	}

	if len(clauses) == 0 {
		return "{}"
	}

	return fmt.Sprintf("{%s}", strings.Join(clauses, " && "))
}

func buildPrometheusMatchers(labels telemetryLabels, labelMap telemetryLabelMap) []string {
	matchers := []string{}
	appendMatcher := func(key, value string) {
		if key == "" || value == "" {
			return
		}
		matchers = append(matchers, fmt.Sprintf(`%s="%s"`, key, escapeLabelValue(value)))
	}

	appendMatcher(labelMap.Project, labels.Project)
	appendMatcher(labelMap.Service, labels.Service)
	appendMatcher(labelMap.Environment, labels.Environment)
	appendMatcher(labelMap.Version, labels.Version)
	appendMatcher(labelMap.Region, labels.Region)
	appendMatcher(labelMap.Cluster, labels.Cluster)
	appendMatcher(labelMap.Cloud, labels.Cloud)

	return matchers
}

func buildLokiSelector(labels telemetryLabels, labelMap telemetryLabelMap) string {
	matchers := buildPrometheusMatchers(labels, labelMap)
	if len(matchers) == 0 {
		return "{}"
	}
	return fmt.Sprintf("{%s}", strings.Join(matchers, ", "))
}

func metricWithMatchers(metric string, matchers []string) string {
	if len(matchers) == 0 {
		return metric
	}
	return fmt.Sprintf("%s{%s}", metric, strings.Join(matchers, ", "))
}

func parseInstantSample(resultType string, raw json.RawMessage) (instantSample, int, error) {
	switch resultType {
	case "vector":
		var results []promVectorResult
		if err := json.Unmarshal(raw, &results); err != nil {
			return instantSample{}, 0, err
		}
		if len(results) == 0 {
			return instantSample{}, 0, nil
		}
		sample, err := sampleFromValue(results[0].Value)
		return sample, len(results), err
	case "scalar":
		var scalar []any
		if err := json.Unmarshal(raw, &scalar); err != nil {
			return instantSample{}, 0, err
		}
		sample, err := sampleFromValue(scalar)
		if err != nil {
			return instantSample{}, 0, err
		}
		return sample, 1, nil
	default:
		return instantSample{}, 0, fmt.Errorf("unsupported result type: %s", resultType)
	}
}

func sampleFromValue(value []any) (instantSample, error) {
	if len(value) != 2 {
		return instantSample{}, errors.New("unexpected sample value shape")
	}

	timestampFloat, err := interfaceToFloat(value[0])
	if err != nil {
		return instantSample{}, err
	}

	number, err := interfaceToFloat(value[1])
	if err != nil {
		return instantSample{}, err
	}

	if math.IsNaN(number) || math.IsInf(number, 0) {
		return instantSample{}, errors.New("sample value is not finite")
	}

	timestamp := time.Unix(0, int64(timestampFloat*float64(time.Second))).UTC()
	return instantSample{
		Timestamp: timestamp,
		Value:     number,
	}, nil
}

func interfaceToFloat(value any) (float64, error) {
	switch typed := value.(type) {
	case float64:
		return typed, nil
	case string:
		number, err := strconv.ParseFloat(typed, 64)
		if err != nil {
			return 0, err
		}
		return number, nil
	default:
		return 0, fmt.Errorf("unexpected numeric type %T", value)
	}
}

func queryURL(baseURL, path string, params map[string]string) (string, error) {
	base, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}

	relative, err := url.Parse(path)
	if err != nil {
		return "", err
	}

	resolved := base.ResolveReference(relative)
	values := resolved.Query()
	for key, value := range params {
		values.Set(key, value)
	}
	resolved.RawQuery = values.Encode()
	return resolved.String(), nil
}

func doJSONRequest(client *http.Client, req *http.Request, out any) error {
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode >= 400 {
		return fmt.Errorf("telemetry backend returned %s", response.Status)
	}

	return json.NewDecoder(response.Body).Decode(out)
}

func validationFromResult(source, baseURL, query string, started time.Time, err error) telemetrySourceValidation {
	validation := telemetrySourceValidation{
		Source:          source,
		URL:             baseURL,
		ValidationQuery: query,
		DurationMs:      time.Since(started).Milliseconds(),
		Status:          "ok",
	}

	if err != nil {
		validation.Status = "error"
		validation.Error = err.Error()
	}

	return validation
}

func positiveQueryInt(raw string, fallback int) (int, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return fallback, nil
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("query parameter must be a positive integer")
	}

	return parsed, nil
}

func stringOrFallback(value, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func floatPointer(value float64) *float64 {
	return &value
}

func escapeLabelValue(value string) string {
	escaped := strings.ReplaceAll(value, `\`, `\\`)
	return strings.ReplaceAll(escaped, `"`, `\"`)
}

func escapeTraceQLValue(value string) string {
	return escapeLabelValue(value)
}

func promDuration(value time.Duration) string {
	if value%(time.Hour) == 0 {
		return fmt.Sprintf("%dh", int(value/time.Hour))
	}
	if value%(time.Minute) == 0 {
		return fmt.Sprintf("%dm", int(value/time.Minute))
	}
	return fmt.Sprintf("%ds", int(value/time.Second))
}
