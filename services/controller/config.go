package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type controllerConfig struct {
	HTTPPort                           string
	MySQLDSN                           string
	RedisURL                           string
	PrometheusURL                      string
	LokiURL                            string
	LokiTenantID                       string
	TempoURL                           string
	TelemetryWindow                    time.Duration
	TelemetryStep                      time.Duration
	TelemetryPollInterval              time.Duration
	TelemetryQueryTimeout              time.Duration
	ReconcileTimeout                   time.Duration
	KubectlBin                         string
	KubernetesApplyEnabled             bool
	KubernetesAllowMutations           bool
	KubernetesAllowedContexts          map[string]struct{}
	KubernetesAllowedClusters          map[string]struct{}
	KubernetesApplyTimeout             time.Duration
	GcloudBin                          string
	CloudRunApplyEnabled               bool
	CloudRunAllowMutations             bool
	CloudRunAllowedProjects            map[string]struct{}
	CloudRunAllowedRegions             map[string]struct{}
	CloudRunApplyTimeout               time.Duration
	AWSCLIBin                          string
	LambdaApplyEnabled                 bool
	LambdaAllowMutations               bool
	LambdaAllowedRegions               map[string]struct{}
	LambdaAllowedFunctions             map[string]struct{}
	LambdaApplyTimeout                 time.Duration
	AzureCLIBin                        string
	ContainerAppsApplyEnabled          bool
	ContainerAppsAllowMutations        bool
	ContainerAppsAllowedSubscriptions  map[string]struct{}
	ContainerAppsAllowedResourceGroups map[string]struct{}
	ContainerAppsApplyTimeout          time.Duration
	SatelliteEnabled                   bool
	SatelliteName                      string
	SatelliteMode                      string
	SatelliteCloud                     string
	SatelliteRegion                    string
	SatelliteCluster                   string
	SatelliteEndpointURL               string
	SatelliteVersion                   string
	SatelliteCoordinatorURL            string
	SatelliteCoordinatorToken          string
	SatelliteTenantKey                 string
	SatelliteTenantHeader              string
	SatelliteHeartbeatInterval         time.Duration
	SatelliteCoordinatorTimeout        time.Duration
	SatelliteTasksEnabled              bool
	SatelliteTaskPollInterval          time.Duration
	SatelliteTaskLeaseDuration         time.Duration
	ControllerBearerToken              string
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

	applyTimeout, err := envDurationSeconds("KUBERNETES_APPLY_TIMEOUT_SEC", 15)
	if err != nil {
		return controllerConfig{}, err
	}

	applyEnabled, err := envBool("KUBERNETES_APPLY_ENABLED", false)
	if err != nil {
		return controllerConfig{}, err
	}

	allowMutations, err := envBool("KUBERNETES_ALLOW_MUTATIONS", false)
	if err != nil {
		return controllerConfig{}, err
	}

	cloudRunApplyTimeout, err := envDurationSeconds("GCP_CLOUDRUN_APPLY_TIMEOUT_SEC", 20)
	if err != nil {
		return controllerConfig{}, err
	}

	cloudRunApplyEnabled, err := envBool("GCP_CLOUDRUN_APPLY_ENABLED", false)
	if err != nil {
		return controllerConfig{}, err
	}

	cloudRunAllowMutations, err := envBool("GCP_CLOUDRUN_ALLOW_MUTATIONS", false)
	if err != nil {
		return controllerConfig{}, err
	}

	lambdaApplyTimeout, err := envDurationSeconds("AWS_LAMBDA_APPLY_TIMEOUT_SEC", 20)
	if err != nil {
		return controllerConfig{}, err
	}

	lambdaApplyEnabled, err := envBool("AWS_LAMBDA_APPLY_ENABLED", false)
	if err != nil {
		return controllerConfig{}, err
	}

	lambdaAllowMutations, err := envBool("AWS_LAMBDA_ALLOW_MUTATIONS", false)
	if err != nil {
		return controllerConfig{}, err
	}

	containerAppsApplyTimeout, err := envDurationSeconds("AZURE_CONTAINERAPPS_APPLY_TIMEOUT_SEC", 20)
	if err != nil {
		return controllerConfig{}, err
	}

	containerAppsApplyEnabled, err := envBool("AZURE_CONTAINERAPPS_APPLY_ENABLED", false)
	if err != nil {
		return controllerConfig{}, err
	}

	containerAppsAllowMutations, err := envBool("AZURE_CONTAINERAPPS_ALLOW_MUTATIONS", false)
	if err != nil {
		return controllerConfig{}, err
	}

	satelliteEnabled, err := envBool("SATELLITE_ENABLED", false)
	if err != nil {
		return controllerConfig{}, err
	}

	satelliteHeartbeatInterval, err := envDurationSeconds("SATELLITE_HEARTBEAT_INTERVAL_SEC", 30)
	if err != nil {
		return controllerConfig{}, err
	}

	satelliteCoordinatorTimeout, err := envDurationSeconds("SATELLITE_COORDINATOR_TIMEOUT_SEC", 5)
	if err != nil {
		return controllerConfig{}, err
	}

	satelliteTasksEnabled, err := envBool("SATELLITE_TASKS_ENABLED", false)
	if err != nil {
		return controllerConfig{}, err
	}

	satelliteTaskPollInterval, err := envDurationSeconds("SATELLITE_TASK_POLL_INTERVAL_SEC", 5)
	if err != nil {
		return controllerConfig{}, err
	}

	satelliteTaskLeaseDuration, err := envDurationSeconds("SATELLITE_TASK_LEASE_SEC", 30)
	if err != nil {
		return controllerConfig{}, err
	}

	return controllerConfig{
		HTTPPort:                           controllerPort(),
		MySQLDSN:                           envOrDefault("MYSQL_DSN", "sentra:sentra_pass@tcp(localhost:3306)/sentra?parseTime=true"),
		RedisURL:                           envOrDefault("REDIS_URL", "redis://localhost:6379"),
		PrometheusURL:                      envOrDefault("PROMETHEUS_URL", "http://localhost:9090"),
		LokiURL:                            envOrDefault("LOKI_URL", "http://localhost:3100"),
		LokiTenantID:                       envOrDefault("LOKI_TENANT_ID", "local"),
		TempoURL:                           envOrDefault("TEMPO_URL", "http://localhost:3200"),
		TelemetryWindow:                    window,
		TelemetryStep:                      step,
		TelemetryPollInterval:              pollInterval,
		TelemetryQueryTimeout:              queryTimeout,
		ReconcileTimeout:                   reconcileTimeout,
		KubectlBin:                         envOrDefault("KUBECTL_BIN", "kubectl"),
		KubernetesApplyEnabled:             applyEnabled,
		KubernetesAllowMutations:           allowMutations,
		KubernetesAllowedContexts:          envCSVSet("KUBERNETES_ALLOWED_CONTEXTS"),
		KubernetesAllowedClusters:          envCSVSet("KUBERNETES_ALLOWED_CLUSTERS"),
		KubernetesApplyTimeout:             applyTimeout,
		GcloudBin:                          envOrDefault("GCLOUD_BIN", "gcloud"),
		CloudRunApplyEnabled:               cloudRunApplyEnabled,
		CloudRunAllowMutations:             cloudRunAllowMutations,
		CloudRunAllowedProjects:            envCSVSet("GCP_CLOUDRUN_ALLOWED_PROJECTS"),
		CloudRunAllowedRegions:             envCSVSet("GCP_CLOUDRUN_ALLOWED_REGIONS"),
		CloudRunApplyTimeout:               cloudRunApplyTimeout,
		AWSCLIBin:                          envOrDefault("AWS_CLI_BIN", "aws"),
		LambdaApplyEnabled:                 lambdaApplyEnabled,
		LambdaAllowMutations:               lambdaAllowMutations,
		LambdaAllowedRegions:               envCSVSet("AWS_LAMBDA_ALLOWED_REGIONS"),
		LambdaAllowedFunctions:             envCSVSet("AWS_LAMBDA_ALLOWED_FUNCTIONS"),
		LambdaApplyTimeout:                 lambdaApplyTimeout,
		AzureCLIBin:                        envOrDefault("AZURE_CLI_BIN", "az"),
		ContainerAppsApplyEnabled:          containerAppsApplyEnabled,
		ContainerAppsAllowMutations:        containerAppsAllowMutations,
		ContainerAppsAllowedSubscriptions:  envCSVSet("AZURE_CONTAINERAPPS_ALLOWED_SUBSCRIPTIONS"),
		ContainerAppsAllowedResourceGroups: envCSVSet("AZURE_CONTAINERAPPS_ALLOWED_RESOURCE_GROUPS"),
		ContainerAppsApplyTimeout:          containerAppsApplyTimeout,
		SatelliteEnabled:                   satelliteEnabled,
		SatelliteName:                      envOrDefault("SATELLITE_NAME", "local-satellite"),
		SatelliteMode:                      envOrDefault("SATELLITE_MODE", "satellite"),
		SatelliteCloud:                     envOrDefault("SATELLITE_CLOUD", ""),
		SatelliteRegion:                    envOrDefault("SATELLITE_REGION", ""),
		SatelliteCluster:                   envOrDefault("SATELLITE_CLUSTER", ""),
		SatelliteEndpointURL:               envOrDefault("SATELLITE_ENDPOINT_URL", ""),
		SatelliteVersion:                   envOrDefault("SATELLITE_VERSION", "dev"),
		SatelliteCoordinatorURL:            envOrDefault("SATELLITE_COORDINATOR_URL", ""),
		SatelliteCoordinatorToken:          envOrDefault("SATELLITE_COORDINATOR_TOKEN", envOrDefault("SENTRA_API_BEARER_TOKEN", "")),
		SatelliteTenantKey:                 envOrDefault("SATELLITE_TENANT_KEY", envOrDefault("SENTRA_DEFAULT_TENANT", "")),
		SatelliteTenantHeader:              envOrDefault("SATELLITE_TENANT_HEADER", envOrDefault("SENTRA_TENANT_HEADER", "x-sentra-tenant")),
		SatelliteHeartbeatInterval:         satelliteHeartbeatInterval,
		SatelliteCoordinatorTimeout:        satelliteCoordinatorTimeout,
		SatelliteTasksEnabled:              satelliteTasksEnabled,
		SatelliteTaskPollInterval:          satelliteTaskPollInterval,
		SatelliteTaskLeaseDuration:         satelliteTaskLeaseDuration,
		ControllerBearerToken:              envOrDefault("SENTRA_CONTROLLER_BEARER_TOKEN", ""),
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

func envBool(key string, fallback bool) (bool, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}

	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("%s must be a boolean value", key)
	}

	return value, nil
}

func envCSVSet(key string) map[string]struct{} {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return nil
	}

	values := make(map[string]struct{})
	for _, item := range strings.Split(raw, ",") {
		value := strings.TrimSpace(item)
		if value == "" {
			continue
		}
		values[value] = struct{}{}
	}

	if len(values) == 0 {
		return nil
	}

	return values
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
