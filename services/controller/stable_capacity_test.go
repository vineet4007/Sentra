package main

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestKubernetesStableCapacitySimulationAssumesPass(t *testing.T) {
	adapter := newKubernetesTrafficAdapter(controllerConfig{})
	check, err := adapter.CheckStableCapacity(context.Background(), adapterRuntimeTarget{
		Namespace:        "sentra",
		Deployment:       "sentra-api-canary",
		StableDeployment: "sentra-api",
		Mode:             "simulation",
		StableCapacity:   defaultStableCapacityPolicy(),
	}, rolloutActionIntent{
		Decision:       decisionInitialize,
		Initialization: true,
		ToWeight:       5,
	})
	if err != nil {
		t.Fatalf("expected simulation capacity check to succeed, got %v", err)
	}
	if !check.Passed {
		t.Fatalf("expected simulation capacity check to pass, got %#v", check)
	}
	if check.Status != "assumed" {
		t.Fatalf("expected assumed status, got %q", check.Status)
	}
}

func TestKubernetesStableCapacityKubectlModeReadsStableDeployment(t *testing.T) {
	runner := &stubCommandRunner{
		output: []byte(`{
			"spec": {"replicas": 3},
			"status": {"replicas": 3, "readyReplicas": 3, "availableReplicas": 3}
		}`),
	}
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
		Namespace:        "sentra",
		Deployment:       "sentra-api-canary",
		StableDeployment: "sentra-api",
		Mode:             "kubectl",
		DryRun:           true,
		Context:          "kind-sentra",
		AllowDirectApply: true,
		StableCapacity: stableCapacityPolicy{
			Enabled:              true,
			Required:             true,
			MinReadyReplicas:     2,
			MinAvailableReplicas: 2,
			MinAvailablePct:      80,
		},
	}

	check, err := adapter.CheckStableCapacity(context.Background(), target, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
	})
	if err != nil {
		t.Fatalf("expected kubectl capacity check to succeed, got %v", err)
	}
	if !check.Passed {
		t.Fatalf("expected stable capacity check to pass, got %#v", check)
	}
	if check.Status != "passed" {
		t.Fatalf("expected passed status, got %q", check.Status)
	}

	wantArgs := []string{"--context", "kind-sentra", "-n", "sentra", "get", "deployment", "sentra-api", "-o", "json"}
	if runner.name != "kubectl" {
		t.Fatalf("expected kubectl binary, got %q", runner.name)
	}
	if !reflect.DeepEqual(runner.args, wantArgs) {
		t.Fatalf("unexpected kubectl capacity args: got %#v want %#v", runner.args, wantArgs)
	}
	if availablePct, ok := check.Observed["availablePct"].(int); !ok || availablePct != 100 {
		t.Fatalf("expected observed availablePct=100, got %#v", check.Observed["availablePct"])
	}
}

func TestKubernetesStableCapacityBlocksWhenStableHasNoReadyReplicas(t *testing.T) {
	runner := &stubCommandRunner{
		output: []byte(`{
			"spec": {"replicas": 3},
			"status": {"replicas": 3, "readyReplicas": 0, "availableReplicas": 0, "unavailableReplicas": 3}
		}`),
	}
	adapter := kubernetesTrafficAdapter{
		config: kubernetesAdapterConfig{
			KubectlBin:      "kubectl",
			ApplyEnabled:    true,
			AllowedContexts: map[string]struct{}{"kind-sentra": {}},
			ApplyTimeout:    5 * time.Second,
		},
		runner: runner,
	}

	check, err := adapter.CheckStableCapacity(context.Background(), adapterRuntimeTarget{
		Namespace:        "sentra",
		Deployment:       "sentra-api-canary",
		StableDeployment: "sentra-api",
		Mode:             "kubectl",
		DryRun:           true,
		Context:          "kind-sentra",
		AllowDirectApply: true,
		StableCapacity:   defaultStableCapacityPolicy(),
	}, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
	})
	if err != nil {
		t.Fatalf("expected kubectl capacity check to return a blocking result, got error: %v", err)
	}
	if check.Passed {
		t.Fatalf("expected stable capacity check to block, got %#v", check)
	}
	if check.Status != "blocked" {
		t.Fatalf("expected blocked status, got %q", check.Status)
	}
	if !strings.Contains(check.Summary, "ready replicas 0") {
		t.Fatalf("expected ready replica failure summary, got %q", check.Summary)
	}
}

func TestCloudRunStableCapacityBlocksWhenStableRevisionMissing(t *testing.T) {
	adapter := newCloudRunTrafficAdapter(controllerConfig{})
	check, err := adapter.CheckStableCapacity(context.Background(), adapterRuntimeTarget{
		Project:        "sentra-dev",
		Region:         "us-central1",
		ServiceName:    "sentra-api",
		Mode:           "simulation",
		StableCapacity: defaultStableCapacityPolicy(),
	}, rolloutActionIntent{
		Decision:   decisionPromote,
		FromWeight: 5,
		ToWeight:   25,
		Revision:   "sentra-api-candidate",
	})
	if err != nil {
		t.Fatalf("expected Cloud Run capacity check to return a blocking result, got error: %v", err)
	}
	if check.Passed {
		t.Fatalf("expected missing stable revision to block, got %#v", check)
	}
	if check.Status != "blocked" {
		t.Fatalf("expected blocked status, got %q", check.Status)
	}
}

func TestStableCapacityPolicyFromContextReadsNestedOverrides(t *testing.T) {
	policy := stableCapacityPolicyFromContext(deploymentExecutionContext{
		Environment: controllerEnvironment{
			DeploymentTargetConfig: map[string]any{
				"stableCapacity": map[string]any{
					"minReadyReplicas":     float64(3),
					"minAvailableReplicas": "2",
					"minAvailablePct":      75,
				},
			},
		},
	})

	if policy.MinReadyReplicas != 3 {
		t.Fatalf("expected min ready replicas 3, got %d", policy.MinReadyReplicas)
	}
	if policy.MinAvailableReplicas != 2 {
		t.Fatalf("expected min available replicas 2, got %d", policy.MinAvailableReplicas)
	}
	if policy.MinAvailablePct != 75 {
		t.Fatalf("expected min available pct 75, got %d", policy.MinAvailablePct)
	}
}
