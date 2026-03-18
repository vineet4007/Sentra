package main

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestKubernetesAdapterSimulationPromote(t *testing.T) {
	adapter := newKubernetesTrafficAdapter(controllerConfig{})
	target := adapterRuntimeTarget{
		Namespace:  "payments",
		Deployment: "payments-api",
		Workload:   "payments-api",
		Strategy:   "canary",
		Mode:       "simulation",
	}
	intent := rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
	}

	action, err := adapter.Apply(context.Background(), target, intent)
	if err != nil {
		t.Fatalf("expected adapter apply to succeed, got error: %v", err)
	}

	if !action.Applied {
		t.Fatalf("expected adapter action to be marked applied")
	}
	if action.ToWeight != 25 {
		t.Fatalf("expected target weight 25, got %d", action.ToWeight)
	}
	if action.Type != "promote" {
		t.Fatalf("expected promote action type, got %q", action.Type)
	}
}

func TestKubernetesAdapterKubectlModeRequiresExplicitOptIn(t *testing.T) {
	adapter := newKubernetesTrafficAdapter(controllerConfig{})
	target := adapterRuntimeTarget{
		Namespace:        "payments",
		Deployment:       "payments-api",
		Workload:         "payments-api",
		Strategy:         "canary",
		Mode:             "kubectl",
		DryRun:           true,
		AllowDirectApply: true,
	}

	_, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
	})
	if err == nil {
		t.Fatal("expected kubectl mode to require controller opt-in")
	}
	if !strings.Contains(err.Error(), "KUBERNETES_APPLY_ENABLED") {
		t.Fatalf("expected opt-in error, got %v", err)
	}
}

func TestKubernetesAdapterKubectlModeBuildsDryRunCommand(t *testing.T) {
	runner := &stubCommandRunner{output: []byte("ingress/payments-api annotated")}
	adapter := kubernetesTrafficAdapter{
		config: kubernetesAdapterConfig{
			KubectlBin:      "kubectl",
			ApplyEnabled:    true,
			AllowedContexts: map[string]struct{}{"kind-sentra": {}},
			ApplyTimeout:    5 * time.Second,
		},
		runner: runner,
	}
	target := adapterRuntimeTarget{
		Namespace:        "payments",
		Deployment:       "payments-api",
		Workload:         "payments-api",
		Strategy:         "canary",
		Mode:             "kubectl",
		DryRun:           true,
		Context:          "kind-sentra",
		AllowDirectApply: true,
	}

	action, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
	})
	if err != nil {
		t.Fatalf("expected kubectl dry-run to succeed, got %v", err)
	}

	wantArgs := []string{
		"--context", "kind-sentra",
		"-n", "payments",
		"annotate", "ingress", "payments-api",
		"nginx.ingress.kubernetes.io/canary=true",
		"nginx.ingress.kubernetes.io/canary-weight=25",
		"--overwrite",
		"--dry-run=server", "-o", "yaml",
	}
	if runner.name != "kubectl" {
		t.Fatalf("expected kubectl binary, got %q", runner.name)
	}
	if !reflect.DeepEqual(runner.args, wantArgs) {
		t.Fatalf("unexpected kubectl args: got %#v want %#v", runner.args, wantArgs)
	}
	if !action.Applied {
		t.Fatal("expected action to be marked applied")
	}
	if action.Mode != "kubectl" {
		t.Fatalf("expected kubectl mode, got %q", action.Mode)
	}
	if !strings.Contains(action.Summary, "kubectl dry-run") {
		t.Fatalf("expected dry-run summary, got %q", action.Summary)
	}
}

func TestKubernetesAdapterKubectlModeBlocksMutationsWithoutSecondGate(t *testing.T) {
	adapter := kubernetesTrafficAdapter{
		config: kubernetesAdapterConfig{
			KubectlBin:   "kubectl",
			ApplyEnabled: true,
			ApplyTimeout: 5 * time.Second,
		},
		runner: &stubCommandRunner{},
	}
	target := adapterRuntimeTarget{
		Namespace:        "payments",
		Deployment:       "payments-api",
		Workload:         "payments-api",
		Strategy:         "canary",
		Mode:             "kubectl",
		DryRun:           false,
		AllowDirectApply: true,
	}

	_, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
	})
	if err == nil {
		t.Fatal("expected kubectl mutation to be blocked")
	}
	if !strings.Contains(err.Error(), "KUBERNETES_ALLOW_MUTATIONS") {
		t.Fatalf("expected mutation gate error, got %v", err)
	}
}

func TestCloudRunAdapterSimulationPromote(t *testing.T) {
	adapter := newCloudRunTrafficAdapter(controllerConfig{})
	target := adapterRuntimeTarget{
		Project:        "sentra-dev",
		Region:         "us-central1",
		ServiceName:    "payments-api",
		StableRevision: "payments-api-stable",
		Mode:           "simulation",
	}

	action, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
		Revision:   "payments-api-canary",
	})
	if err != nil {
		t.Fatalf("expected Cloud Run simulation to succeed, got %v", err)
	}
	if !action.Applied {
		t.Fatal("expected Cloud Run simulation action to be marked applied")
	}
	if action.Adapter != "cloudrun" {
		t.Fatalf("expected Cloud Run adapter name, got %q", action.Adapter)
	}
}

func TestCloudRunAdapterGcloudModeRequiresExplicitOptIn(t *testing.T) {
	adapter := newCloudRunTrafficAdapter(controllerConfig{})
	target := adapterRuntimeTarget{
		Project:          "sentra-dev",
		Region:           "us-central1",
		ServiceName:      "payments-api",
		StableRevision:   "payments-api-stable",
		Mode:             "gcloud",
		AllowDirectApply: true,
	}

	_, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
		Revision:   "payments-api-canary",
	})
	if err == nil {
		t.Fatal("expected Cloud Run gcloud mode to require controller opt-in")
	}
	if !strings.Contains(err.Error(), "GCP_CLOUDRUN_APPLY_ENABLED") {
		t.Fatalf("expected Cloud Run opt-in error, got %v", err)
	}
}

func TestCloudRunAdapterGcloudModeBuildsTrafficCommand(t *testing.T) {
	runner := &stubCommandRunner{output: []byte("Updated traffic for [payments-api].")}
	adapter := cloudRunTrafficAdapter{
		config: cloudRunAdapterConfig{
			GcloudBin:       "gcloud",
			ApplyEnabled:    true,
			AllowMutations:  true,
			AllowedProjects: map[string]struct{}{"sentra-dev": {}},
			AllowedRegions:  map[string]struct{}{"us-central1": {}},
			ApplyTimeout:    5 * time.Second,
		},
		runner: runner,
	}
	target := adapterRuntimeTarget{
		Project:          "sentra-dev",
		Region:           "us-central1",
		ServiceName:      "payments-api",
		StableRevision:   "payments-api-stable",
		Mode:             "gcloud",
		AllowDirectApply: true,
		DryRun:           false,
	}

	action, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
		Revision:   "payments-api-canary",
	})
	if err != nil {
		t.Fatalf("expected Cloud Run gcloud apply to succeed, got %v", err)
	}

	wantArgs := []string{
		"run",
		"services",
		"update-traffic",
		"payments-api",
		"--region",
		"us-central1",
		"--project",
		"sentra-dev",
		"--to-revisions=payments-api-canary=25,payments-api-stable=75",
		"--quiet",
	}
	if runner.name != "gcloud" {
		t.Fatalf("expected gcloud binary, got %q", runner.name)
	}
	if !reflect.DeepEqual(runner.args, wantArgs) {
		t.Fatalf("unexpected gcloud args: got %#v want %#v", runner.args, wantArgs)
	}
	if !action.Applied {
		t.Fatal("expected Cloud Run action to be marked applied")
	}
	if action.Mode != "gcloud" {
		t.Fatalf("expected gcloud mode, got %q", action.Mode)
	}
}

func TestCloudRunAdapterRequiresStableRevisionForWeightedTraffic(t *testing.T) {
	adapter := newCloudRunTrafficAdapter(controllerConfig{})
	target := adapterRuntimeTarget{
		Project:        "sentra-dev",
		Region:         "us-central1",
		ServiceName:    "payments-api",
		Mode:           "simulation",
		StableRevision: "",
	}

	_, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
		Revision:   "payments-api-canary",
	})
	if err == nil {
		t.Fatal("expected missing stable revision to fail")
	}
	if !strings.Contains(err.Error(), "stableRevision") {
		t.Fatalf("expected stable revision error, got %v", err)
	}
}

func TestLambdaAdapterSimulationPromote(t *testing.T) {
	adapter := newLambdaAliasAdapter(controllerConfig{})
	target := adapterRuntimeTarget{
		Region:        "us-east-1",
		FunctionName:  "payments-handler",
		AliasName:     "live",
		StableVersion: "41",
		Mode:          "simulation",
	}

	action, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
		Revision:   "42",
	})
	if err != nil {
		t.Fatalf("expected Lambda simulation to succeed, got %v", err)
	}
	if !action.Applied {
		t.Fatal("expected Lambda simulation action to be marked applied")
	}
	if action.Adapter != "lambda" {
		t.Fatalf("expected Lambda adapter name, got %q", action.Adapter)
	}
}

func TestLambdaAdapterAWSCLIModeRequiresExplicitOptIn(t *testing.T) {
	adapter := newLambdaAliasAdapter(controllerConfig{})
	target := adapterRuntimeTarget{
		Region:           "us-east-1",
		FunctionName:     "payments-handler",
		AliasName:        "live",
		StableVersion:    "41",
		Mode:             "awscli",
		AllowDirectApply: true,
	}

	_, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
		Revision:   "42",
	})
	if err == nil {
		t.Fatal("expected Lambda awscli mode to require controller opt-in")
	}
	if !strings.Contains(err.Error(), "AWS_LAMBDA_APPLY_ENABLED") {
		t.Fatalf("expected Lambda opt-in error, got %v", err)
	}
}

func TestLambdaAdapterAWSCLIModeBuildsWeightedAliasCommand(t *testing.T) {
	runner := &stubCommandRunner{output: []byte("{\"Name\":\"live\"}")}
	adapter := lambdaAliasAdapter{
		config: lambdaAdapterConfig{
			AWSCLIBin:        "aws",
			ApplyEnabled:     true,
			AllowMutations:   true,
			AllowedRegions:   map[string]struct{}{"us-east-1": {}},
			AllowedFunctions: map[string]struct{}{"payments-handler": {}},
			ApplyTimeout:     5 * time.Second,
		},
		runner: runner,
	}
	target := adapterRuntimeTarget{
		Region:           "us-east-1",
		FunctionName:     "payments-handler",
		AliasName:        "live",
		StableVersion:    "41",
		Mode:             "awscli",
		AllowDirectApply: true,
		DryRun:           false,
	}

	action, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
		Revision:   "42",
	})
	if err != nil {
		t.Fatalf("expected Lambda awscli apply to succeed, got %v", err)
	}

	wantArgs := []string{
		"lambda",
		"update-alias",
		"--function-name",
		"payments-handler",
		"--name",
		"live",
		"--function-version",
		"41",
		"--routing-config",
		"AdditionalVersionWeights={42=0.25}",
		"--region",
		"us-east-1",
		"--no-cli-pager",
		"--output",
		"json",
	}
	if runner.name != "aws" {
		t.Fatalf("expected aws binary, got %q", runner.name)
	}
	if !reflect.DeepEqual(runner.args, wantArgs) {
		t.Fatalf("unexpected aws args: got %#v want %#v", runner.args, wantArgs)
	}
	if !action.Applied {
		t.Fatal("expected Lambda action to be marked applied")
	}
	if action.Mode != "awscli" {
		t.Fatalf("expected awscli mode, got %q", action.Mode)
	}
}

func TestLambdaAdapterRequiresStableVersionForWeightedTraffic(t *testing.T) {
	adapter := newLambdaAliasAdapter(controllerConfig{})
	target := adapterRuntimeTarget{
		Region:       "us-east-1",
		FunctionName: "payments-handler",
		AliasName:    "live",
		Mode:         "simulation",
	}

	_, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
		Revision:   "42",
	})
	if err == nil {
		t.Fatal("expected missing stable version to fail")
	}
	if !strings.Contains(err.Error(), "stableVersion") {
		t.Fatalf("expected stable version error, got %v", err)
	}
}

func TestLambdaAdapterBlocksMutationsWithoutSecondGate(t *testing.T) {
	adapter := lambdaAliasAdapter{
		config: lambdaAdapterConfig{
			AWSCLIBin:      "aws",
			ApplyEnabled:   true,
			ApplyTimeout:   5 * time.Second,
			AllowMutations: false,
		},
		runner: &stubCommandRunner{},
	}
	target := adapterRuntimeTarget{
		Region:           "us-east-1",
		FunctionName:     "payments-handler",
		AliasName:        "live",
		StableVersion:    "41",
		Mode:             "awscli",
		AllowDirectApply: true,
		DryRun:           false,
	}

	_, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
		Revision:   "42",
	})
	if err == nil {
		t.Fatal("expected Lambda mutation to be blocked")
	}
	if !strings.Contains(err.Error(), "AWS_LAMBDA_ALLOW_MUTATIONS") {
		t.Fatalf("expected Lambda mutation gate error, got %v", err)
	}
}

func TestContainerAppsAdapterSimulationPromote(t *testing.T) {
	adapter := newContainerAppsTrafficAdapter(controllerConfig{})
	target := adapterRuntimeTarget{
		ResourceGroup:    "sentra-rg",
		ContainerAppName: "payments-api",
		StableRevision:   "payments-api--stable",
		Mode:             "simulation",
	}

	action, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
		Revision:   "payments-api--candidate",
	})
	if err != nil {
		t.Fatalf("expected Container Apps simulation to succeed, got %v", err)
	}
	if !action.Applied {
		t.Fatal("expected Container Apps simulation action to be marked applied")
	}
	if action.Adapter != "containerapps" {
		t.Fatalf("expected Container Apps adapter name, got %q", action.Adapter)
	}
}

func TestContainerAppsAdapterAZCLIModeRequiresExplicitOptIn(t *testing.T) {
	adapter := newContainerAppsTrafficAdapter(controllerConfig{})
	target := adapterRuntimeTarget{
		ResourceGroup:    "sentra-rg",
		ContainerAppName: "payments-api",
		StableRevision:   "payments-api--stable",
		Mode:             "azcli",
		AllowDirectApply: true,
	}

	_, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
		Revision:   "payments-api--candidate",
	})
	if err == nil {
		t.Fatal("expected Container Apps azcli mode to require controller opt-in")
	}
	if !strings.Contains(err.Error(), "AZURE_CONTAINERAPPS_APPLY_ENABLED") {
		t.Fatalf("expected Container Apps opt-in error, got %v", err)
	}
}

func TestContainerAppsAdapterAZCLIModeBuildsTrafficCommand(t *testing.T) {
	runner := &stubCommandRunner{output: []byte("{\"name\":\"payments-api\"}")}
	adapter := containerAppsTrafficAdapter{
		config: containerAppsAdapterConfig{
			AzureCLIBin:           "az",
			ApplyEnabled:          true,
			AllowMutations:        true,
			AllowedSubscriptions:  map[string]struct{}{"sub-123": {}},
			AllowedResourceGroups: map[string]struct{}{"sentra-rg": {}},
			ApplyTimeout:          5 * time.Second,
		},
		runner: runner,
	}
	target := adapterRuntimeTarget{
		SubscriptionID:   "sub-123",
		ResourceGroup:    "sentra-rg",
		ContainerAppName: "payments-api",
		StableRevision:   "payments-api--stable",
		Mode:             "azcli",
		AllowDirectApply: true,
		DryRun:           false,
	}

	action, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
		Revision:   "payments-api--candidate",
	})
	if err != nil {
		t.Fatalf("expected Container Apps azcli apply to succeed, got %v", err)
	}

	wantArgs := []string{
		"containerapp",
		"ingress",
		"traffic",
		"set",
		"--name",
		"payments-api",
		"--resource-group",
		"sentra-rg",
		"--revision-weight",
		"payments-api--candidate=25",
		"payments-api--stable=75",
		"--subscription",
		"sub-123",
		"--output",
		"json",
		"--only-show-errors",
	}
	if runner.name != "az" {
		t.Fatalf("expected az binary, got %q", runner.name)
	}
	if !reflect.DeepEqual(runner.args, wantArgs) {
		t.Fatalf("unexpected az args: got %#v want %#v", runner.args, wantArgs)
	}
	if !action.Applied {
		t.Fatal("expected Container Apps action to be marked applied")
	}
	if action.Mode != "azcli" {
		t.Fatalf("expected azcli mode, got %q", action.Mode)
	}
}

func TestContainerAppsAdapterRequiresStableRevisionForWeightedTraffic(t *testing.T) {
	adapter := newContainerAppsTrafficAdapter(controllerConfig{})
	target := adapterRuntimeTarget{
		ResourceGroup:    "sentra-rg",
		ContainerAppName: "payments-api",
		Mode:             "simulation",
	}

	_, err := adapter.Apply(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
		Revision:   "payments-api--candidate",
	})
	if err == nil {
		t.Fatal("expected missing stable revision to fail")
	}
	if !strings.Contains(err.Error(), "stableRevision") {
		t.Fatalf("expected stable revision error, got %v", err)
	}
}

func TestNormalizeStoredLabelMapFallsBackFromValues(t *testing.T) {
	labels := telemetryLabels{
		Project:     "demo-project",
		Service:     "payments-api",
		Environment: "staging",
		Version:     "build-2026-03-13.1",
	}

	actual := normalizeStoredLabelMap(telemetryLabelMap{
		Service:     "payments-api",
		Environment: "staging",
		Version:     "candidate",
	}, labels)

	if actual.Service != "service" {
		t.Fatalf("expected service label key fallback, got %q", actual.Service)
	}
	if actual.Environment != "env" {
		t.Fatalf("expected environment label key fallback, got %q", actual.Environment)
	}
	if actual.Version != "version" {
		t.Fatalf("expected version label key fallback, got %q", actual.Version)
	}
}

type stubCommandRunner struct {
	name   string
	args   []string
	output []byte
	err    error
}

func (s *stubCommandRunner) Run(_ context.Context, name string, args ...string) ([]byte, error) {
	s.name = name
	s.args = append([]string(nil), args...)
	return s.output, s.err
}
