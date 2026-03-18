from __future__ import annotations

from .models import AiAdvisor, AiAdvisorSignal, RolloutAdvisorContext


def build_ai_advisor(context: RolloutAdvisorContext) -> AiAdvisor:
    risk_score = 18
    confidence_pct = 58
    recommendation: str = "investigate"
    signals: list[AiAdvisorSignal] = []
    rationales: list[str] = []

    open_incidents = [incident for incident in context.incidents if incident.status != "resolved"]
    critical_incidents = [incident for incident in open_incidents if incident.severity == "critical"]
    gate_results = context.liveState.evaluation.gateResults if context.liveState and context.liveState.evaluation else []
    failing_gates = [gate for gate in gate_results if gate.passed is False and gate.signalStatus == "ok"]
    severe_gates = [gate for gate in gate_results if gate.severe]
    no_data_gates = [gate for gate in gate_results if gate.signalStatus == "no_data"]
    error_gates = [gate for gate in gate_results if gate.signalStatus == "error"]
    passed_gates = [gate for gate in gate_results if gate.passed]
    completed_satellite_tasks = [task for task in context.satelliteTasks if task.status == "completed"]
    failed_satellite_tasks = [task for task in context.satelliteTasks if task.status == "failed"]
    completed_steps = sum(1 for step in context.steps if step.status == "completed")
    total_steps = len(context.steps)

    if critical_incidents:
        risk_score += 44 + min(len(critical_incidents) * 8, 22)
        confidence_pct += 16
        recommendation = "rollback"
        rationales.append(
            f"{len(critical_incidents)} critical incident{' is' if len(critical_incidents) == 1 else 's are'} still open."
        )
        signals.append(
            AiAdvisorSignal(label="Incidents", tone="critical", value=f"{len(critical_incidents)} critical open")
        )
    elif open_incidents:
        risk_score += 24 + min(len(open_incidents) * 4, 14)
        confidence_pct += 8
        recommendation = "pause"
        rationales.append(
            f"{len(open_incidents)} incident{' is' if len(open_incidents) == 1 else 's are'} still open and need attention."
        )
        signals.append(AiAdvisorSignal(label="Incidents", tone="warn", value=f"{len(open_incidents)} open"))
    else:
        risk_score -= 7
        confidence_pct += 6
        signals.append(AiAdvisorSignal(label="Incidents", tone="good", value="none open"))

    if failing_gates or severe_gates:
        risk_score += 20 + len(failing_gates) * 7 + len(severe_gates) * 10
        confidence_pct += 12
        recommendation = "rollback" if severe_gates else "pause"
        rationales.append(
            f"{len(failing_gates) + len(severe_gates)} rollout gate{' is' if len(failing_gates) + len(severe_gates) == 1 else 's are'} outside the healthy threshold."
        )
        signals.append(
            AiAdvisorSignal(
                label="Telemetry gates",
                tone="critical",
                value=f"{len(failing_gates) + len(severe_gates)} failing",
            )
        )
    elif error_gates or no_data_gates:
        risk_score += 10 + len(error_gates) * 9 + len(no_data_gates) * 5
        if recommendation not in ("rollback", "pause"):
            recommendation = "collect_more_data"
        if error_gates:
            rationales.append(
                f"Telemetry collection has {len(error_gates)} backend error{'s' if len(error_gates) != 1 else ''}, which lowers confidence."
            )
        else:
            rationales.append(
                f"{len(no_data_gates)} rollout gate{' still has' if len(no_data_gates) == 1 else 's still have'} no data."
            )
        signals.append(
            AiAdvisorSignal(
                label="Telemetry gates",
                tone="critical" if error_gates else "warn",
                value=f"{len(error_gates)} backend issues" if error_gates else f"{len(no_data_gates)} no-data",
            )
        )
    elif passed_gates:
        risk_score -= 14 + min(len(passed_gates) * 3, 10)
        confidence_pct += 16
        if recommendation == "investigate":
            recommendation = "continue"
        rationales.append(
            f"{len(passed_gates)} telemetry gate{' is' if len(passed_gates) == 1 else 's are'} currently healthy."
        )
        signals.append(AiAdvisorSignal(label="Telemetry gates", tone="good", value=f"{len(passed_gates)} passing"))
    else:
        risk_score += 7
        recommendation = "collect_more_data"
        rationales.append("The rollout does not have enough evaluation history yet for a confident advisory signal.")
        signals.append(AiAdvisorSignal(label="Telemetry gates", tone="accent", value="awaiting data"))

    margin_alerts = threshold_margin_alerts(gate_results)
    if margin_alerts:
        risk_score += min(12, len(margin_alerts) * 4)
        confidence_pct += 3
        if recommendation == "continue":
            recommendation = "investigate"
        rationales.append(
            f"{len(margin_alerts)} gate{' is' if len(margin_alerts) == 1 else 's are'} close to the configured threshold, so promotion risk is rising."
        )
        signals.append(AiAdvisorSignal(label="Threshold margin", tone="warn", value="narrow"))

    if failed_satellite_tasks:
        risk_score += 12 + len(failed_satellite_tasks) * 4
        confidence_pct += 5
        if recommendation == "continue":
            recommendation = "investigate"
        rationales.append(
            f"{len(failed_satellite_tasks)} delegated satellite task{' failed' if len(failed_satellite_tasks) == 1 else 's failed'} recently."
        )
        signals.append(
            AiAdvisorSignal(
                label="Federation",
                tone="warn",
                value=f"{len(failed_satellite_tasks)} failed task{'s' if len(failed_satellite_tasks) != 1 else ''}",
            )
        )
    elif completed_satellite_tasks:
        risk_score -= 4
        confidence_pct += 4
        signals.append(
            AiAdvisorSignal(
                label="Federation",
                tone="good",
                value=f"{len(completed_satellite_tasks)} delegated task{'s' if len(completed_satellite_tasks) != 1 else ''}",
            )
        )

    if total_steps > 0:
        step_completion = int((completed_steps / total_steps) * 100)
        signals.append(AiAdvisorSignal(label="Rollout steps", tone="accent", value=f"{step_completion}% complete"))
        if step_completion >= 50 and not open_incidents and not failing_gates and not error_gates:
            risk_score -= 4
            confidence_pct += 4
            rationales.append("The rollout has crossed higher-traffic phases without surfacing a fresh incident.")

    decision = (context.liveState.decision if context.liveState else None) or context.lastDecision or context.status
    decision = (decision or "").lower().strip()
    if decision == "rollback":
        risk_score = max(risk_score, 82)
        confidence_pct = max(confidence_pct, 78)
        recommendation = "rollback"
        rationales.append("The deterministic controller is already in rollback posture, so the advisor agrees.")
    elif decision == "pause":
        risk_score = max(risk_score, 66)
        confidence_pct = max(confidence_pct, 72)
        if recommendation != "rollback":
            recommendation = "pause"
        rationales.append("The rollout is already paused, which usually means an operator check is warranted.")
    elif decision in ("promote", "initialize"):
        risk_score -= 5
        confidence_pct += 5
        rationales.append("The control plane currently sees enough healthy signal to keep the rollout moving.")

    if context.currentWeight >= 50 and not open_incidents and not failing_gates and not no_data_gates:
        risk_score -= 5
        confidence_pct += 4

    latest_audit = context.auditEvents[0].summary if context.auditEvents else None
    if latest_audit:
        rationales.append(f"Latest audit signal: {latest_audit}")
    elif context.lastDecisionReason:
        rationales.append(f"Latest control-plane note: {context.lastDecisionReason}")

    risk_score = clamp(risk_score, 4, 97)
    confidence_pct = clamp(confidence_pct, 28, 96)

    severity = "low"
    if risk_score >= 80:
        severity = "critical"
    elif risk_score >= 62:
        severity = "high"
    elif risk_score >= 36:
        severity = "elevated"

    return AiAdvisor(
        recommendation=recommendation,  # type: ignore[arg-type]
        severity=severity,  # type: ignore[arg-type]
        confidencePct=confidence_pct,
        riskScore=risk_score,
        headline=build_headline(recommendation, severity),
        summary=build_summary(recommendation, severity, context.currentWeight, len(completed_satellite_tasks)),
        rationales=unique_non_empty(rationales)[:5],
        signals=signals[:5],
    )


def threshold_margin_alerts(gates):
    alerts = []
    for gate in gates:
        if gate.passed is not True or gate.value is None or not gate.threshold:
            continue

        gate_max = gate.threshold.get("max")
        gate_min = gate.threshold.get("min")
        if gate_max is not None and gate_max > 0 and gate.value / gate_max >= 0.85:
            alerts.append(gate)
            continue
        if gate_min is not None and gate_min > 0 and gate.value / gate_min <= 1.15:
            alerts.append(gate)
    return alerts


def build_headline(recommendation: str, severity: str) -> str:
    if recommendation == "rollback":
        return "Shadow advisor sees rollback-level risk."
    if recommendation == "pause":
        return "Shadow advisor would slow the rollout down."
    if recommendation == "collect_more_data":
        return "Shadow advisor wants more telemetry before trusting the next step."
    if recommendation == "continue":
        if severity == "low":
            return "Shadow advisor agrees with the current rollout direction."
        return "Shadow advisor sees manageable risk, but wants close monitoring."
    return "Shadow advisor wants an operator review."


def build_summary(recommendation: str, severity: str, current_weight: int, delegated_task_count: int) -> str:
    federation_note = (
        f" Delegated satellite execution is active with {delegated_task_count} recent successful task{'s' if delegated_task_count != 1 else ''}."
        if delegated_task_count > 0
        else ""
    )

    if recommendation == "rollback":
        return (
            f"Risk is {severity} at {current_weight}% traffic, so the advisory layer would prefer an immediate defensive rollback."
            f"{federation_note}"
        )
    if recommendation == "pause":
        return (
            f"Risk is {severity} at {current_weight}% traffic, and the advisory layer would hold here until the failing signals are understood."
            f"{federation_note}"
        )
    if recommendation == "collect_more_data":
        return (
            "Sentra can keep observing, but the advisory layer does not yet see enough clean signal to make a confident promotion recommendation."
            f"{federation_note}"
        )
    if recommendation == "continue":
        risk_phrase = "low" if severity == "low" else "controlled"
        return (
            f"The advisory layer sees {risk_phrase} risk at {current_weight}% traffic and is comfortable staying in shadow mode while the rollout progresses."
            f"{federation_note}"
        )
    return (
        f"The advisory layer sees {severity} risk and would ask for a human check before trusting the next rollout transition."
        f"{federation_note}"
    )


def unique_non_empty(values: list[str]) -> list[str]:
    seen: list[str] = []
    for value in values:
        normalized = value.strip()
        if normalized and normalized not in seen:
            seen.append(normalized)
    return seen


def clamp(value: int, low: int, high: int) -> int:
    return min(high, max(low, round(value)))
