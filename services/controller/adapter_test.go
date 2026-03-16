package main

import (
	"context"
	"testing"
)

func TestKubernetesAdapterSimulationPromote(t *testing.T) {
	adapter := kubernetesTrafficAdapter{}
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
