package main

import "testing"

func TestDeriveTrafficStateRollbackRestoresStable(t *testing.T) {
	traffic := deriveTrafficState(25, decisionRollback, false)

	if traffic.CandidateWeight != 0 {
		t.Fatalf("expected candidate weight 0, got %d", traffic.CandidateWeight)
	}
	if traffic.StableWeight != 100 {
		t.Fatalf("expected stable weight 100, got %d", traffic.StableWeight)
	}
	if !traffic.RecoveredToStable {
		t.Fatal("expected rollback traffic to mark recoveredToStable")
	}
	if traffic.State != "stable_restored" {
		t.Fatalf("expected stable_restored state, got %q", traffic.State)
	}
}

func TestDeriveTrafficStateSplitTraffic(t *testing.T) {
	traffic := deriveTrafficState(25, decisionPromote, false)

	if traffic.CandidateWeight != 25 {
		t.Fatalf("expected candidate weight 25, got %d", traffic.CandidateWeight)
	}
	if traffic.StableWeight != 75 {
		t.Fatalf("expected stable weight 75, got %d", traffic.StableWeight)
	}
	if traffic.State != "split" {
		t.Fatalf("expected split state, got %q", traffic.State)
	}
}

func TestDeriveTrafficStateCandidateFull(t *testing.T) {
	traffic := deriveTrafficState(100, decisionPromote, true)

	if traffic.CandidateWeight != 100 {
		t.Fatalf("expected candidate weight 100, got %d", traffic.CandidateWeight)
	}
	if traffic.StableWeight != 0 {
		t.Fatalf("expected stable weight 0, got %d", traffic.StableWeight)
	}
	if traffic.State != "candidate_full" {
		t.Fatalf("expected candidate_full state, got %q", traffic.State)
	}
}
