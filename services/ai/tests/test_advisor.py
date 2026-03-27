import unittest

from app.advisor import build_ai_advisor
from app.models import RolloutAdvisorContext


class AdvisorTests(unittest.TestCase):
    def test_recommends_rollback_for_critical_incident(self):
        advisor = build_ai_advisor(
            RolloutAdvisorContext(
                deploymentId=1,
                status="running",
                currentWeight=25,
                lastDecision="rollback",
                incidents=[{"severity": "critical", "status": "open", "summary": "error spike"}],
                steps=[{"status": "completed"}, {"status": "in_progress"}],
                auditEvents=[{"summary": "Rolled back due to severe regression"}],
            )
        )

        self.assertEqual(advisor.recommendation, "rollback")
        self.assertEqual(advisor.severity, "critical")
        self.assertGreaterEqual(advisor.riskScore, 80)
        self.assertEqual(advisor.prediction.predictedOutcome, "rollback_expected")
        self.assertTrue(advisor.prediction.shouldEscalate)
        self.assertGreaterEqual(len(advisor.anomalies), 1)

    def test_recommends_continue_for_healthy_rollout(self):
        advisor = build_ai_advisor(
            RolloutAdvisorContext(
                deploymentId=2,
                status="running",
                currentWeight=25,
                lastDecision="promote",
                liveState={
                    "decision": "promote",
                    "evaluation": {
                        "gateResults": [
                            {
                                "name": "errorRatePct",
                                "signalStatus": "ok",
                                "passed": True,
                                "value": 0.2,
                                "threshold": {"max": 2},
                            },
                            {
                                "name": "latencyP95Ms",
                                "signalStatus": "ok",
                                "passed": True,
                                "value": 120,
                                "threshold": {"max": 500},
                            },
                        ]
                    },
                },
                incidents=[],
                steps=[{"status": "completed"}, {"status": "in_progress"}],
                auditEvents=[{"summary": "Promoted to 25%"}],
                satelliteTasks=[{"status": "completed", "satelliteName": "regional-west"}],
            )
        )

        self.assertEqual(advisor.recommendation, "continue")
        self.assertIn(advisor.severity, ("low", "elevated"))
        self.assertLess(advisor.riskScore, 40)
        self.assertEqual(advisor.prediction.predictedOutcome, "stable")
        self.assertFalse(advisor.prediction.shouldEscalate)
        self.assertGreaterEqual(len(advisor.anomalies), 1)

    def test_detects_baseline_shift_from_metadata(self):
        advisor = build_ai_advisor(
            RolloutAdvisorContext(
                deploymentId=3,
                status="running",
                currentWeight=50,
                lastDecision="promote",
                liveState={
                    "decision": "promote",
                    "evaluation": {
                        "gateResults": [
                            {
                                "name": "errorRatePct",
                                "signalStatus": "ok",
                                "passed": True,
                                "value": 1.7,
                                "threshold": {"max": 2},
                            }
                        ]
                    },
                },
                incidents=[],
                steps=[{"status": "completed"}, {"status": "in_progress"}],
                auditEvents=[{"summary": "Promoted to 50%"}],
                metadata={
                    "shadowBaseline": {
                        "sampleCount": 4,
                        "avgRiskScore": 18,
                        "avgConfidencePct": 76,
                    }
                },
            )
        )

        self.assertTrue(any(anomaly.kind == "baseline_shift" for anomaly in advisor.anomalies))
        self.assertIn(advisor.recommendation, ("investigate", "continue"))


if __name__ == "__main__":
    unittest.main()
