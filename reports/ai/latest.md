# Sentra AI Benchmark Report

Generated: 2026-08-10T11:01:47.597Z
Recommendation: candidate_ready

The candidate model has enough shared outcomes and is meeting the benchmark gates, so it is ready for a controlled shadow promotion review.

## Comparison

- Overlapping rollouts: 97
- Primary engine: fastapi-shadow-v1
- Candidate engine: mixed
- Accuracy delta: 0%
- Recall delta: 0%
- Precision delta: 0%
- Brier improvement: 0

## Gates

- [x] Enough overlapping rollouts: actual 97, expected >= 10. The candidate model should be compared on a meaningful number of shared rollouts before any promotion.
- [x] Enough resolved rollout outcomes: actual 37, expected >= 5. A promotion decision needs enough completed or rolled-back examples to avoid overfitting on in-flight rollouts.
- [x] Candidate accuracy holds up: actual 100%, expected >= 98%. The candidate should not materially reduce overall shadow accuracy.
- [x] Candidate risky-outcome recall is not worse: actual 100%, expected >= 100%. The candidate must not miss more real rollout risk than the current production shadow stream.
- [x] Candidate warning precision stays acceptable: actual 100%, expected >= 95%. The candidate should not introduce too many noisy warnings.
- [x] Candidate calibration does not regress: actual 0, expected <= 0.02. Rollback-probability calibration should stay at least as trustworthy as the current stream.

## Evaluation Snapshot

- Coverage: 97%
- Accuracy: 100%
- Risky-outcome recall: 100%
- Warning precision: 100%
- Brier score: 0

## Engines

- fastapi-shadow-v1: accuracy 100%, recall 100%, precision 100%, Brier 0

