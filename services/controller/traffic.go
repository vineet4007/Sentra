package main

import "fmt"

type rolloutTrafficState struct {
	CandidateWeight   int    `json:"candidateWeight"`
	StableWeight      int    `json:"stableWeight"`
	State             string `json:"state"`
	RecoveredToStable bool   `json:"recoveredToStable"`
	Summary           string `json:"summary"`
}

func deriveTrafficState(candidateWeight int, decision rolloutDecision, rolloutComplete bool) rolloutTrafficState {
	candidateWeight = clampTrafficWeight(candidateWeight)
	stableWeight := 100 - candidateWeight

	traffic := rolloutTrafficState{
		CandidateWeight: candidateWeight,
		StableWeight:    stableWeight,
		State:           "split",
		Summary: fmt.Sprintf(
			"Candidate is serving %d%% while stable keeps %d%% of live traffic.",
			candidateWeight,
			stableWeight,
		),
	}

	switch {
	case decision == decisionRollback:
		traffic.CandidateWeight = 0
		traffic.StableWeight = 100
		traffic.State = "stable_restored"
		traffic.RecoveredToStable = true
		traffic.Summary = "Stable is serving 100% again while the candidate stays out of traffic."
	case rolloutComplete || candidateWeight >= 100:
		traffic.CandidateWeight = 100
		traffic.StableWeight = 0
		traffic.State = "candidate_full"
		traffic.Summary = "The candidate is now serving 100% of live traffic."
	case candidateWeight <= 0:
		traffic.CandidateWeight = 0
		traffic.StableWeight = 100
		traffic.State = "stable_only"
		traffic.Summary = "Stable is serving 100% while the candidate is waiting for traffic."
	}

	return traffic
}
