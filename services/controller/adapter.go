package main

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type rolloutAction struct {
	Type       string          `json:"type"`
	Adapter    string          `json:"adapter"`
	Mode       string          `json:"mode"`
	Applied    bool            `json:"applied"`
	Summary    string          `json:"summary"`
	Decision   rolloutDecision `json:"decision"`
	FromWeight int             `json:"fromWeight"`
	ToWeight   int             `json:"toWeight"`
	AppliedAt  time.Time       `json:"appliedAt"`
	Details    map[string]any  `json:"details,omitempty"`
}

type rolloutAdapter interface {
	Name() string
	Apply(context.Context, adapterRuntimeTarget, rolloutActionIntent) (rolloutAction, error)
}

type adapterRuntimeTarget struct {
	DeploymentID int64
	Namespace    string
	Workload     string
	Deployment   string
	Strategy     string
	Cluster      string
	DryRun       bool
	Mode         string
}

type rolloutActionIntent struct {
	Decision        rolloutDecision
	Summary         string
	FromWeight      int
	ToWeight        int
	Revision        string
	Initialization  bool
	RolloutComplete bool
}

type kubernetesTrafficAdapter struct{}

func newDeploymentAdapter(context deploymentExecutionContext) (rolloutAdapter, adapterRuntimeTarget, error) {
	adapterType := strings.ToLower(strings.TrimSpace(context.Service.AdapterType))
	targetType := strings.ToLower(strings.TrimSpace(context.Environment.DeploymentTargetType))

	if adapterType == "" {
		adapterType = "kubernetes"
	}
	if targetType == "" {
		targetType = "kubernetes"
	}

	if adapterType != "kubernetes" || targetType != "kubernetes" {
		return nil, adapterRuntimeTarget{}, fmt.Errorf(
			"unsupported deployment adapter combination service=%q environment=%q",
			context.Service.AdapterType,
			context.Environment.DeploymentTargetType,
		)
	}

	target := adapterRuntimeTarget{
		DeploymentID: context.Deployment.ID,
		Namespace:    stringFromMap(context.Environment.DeploymentTargetConfig, "namespace"),
		Workload: firstNonEmpty(
			stringFromMap(context.Service.ServiceConfig, "workload"),
			stringFromMap(context.Environment.DeploymentTargetConfig, "workload"),
			context.Service.Name,
		),
		Deployment: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "deployment"),
			stringFromMap(context.Service.ServiceConfig, "deployment"),
			context.Service.Name,
		),
		Strategy: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "strategy"),
			"canary",
		),
		Cluster: stringFromMap(context.Environment.DeploymentTargetConfig, "cluster"),
		DryRun:  boolFromMap(context.Environment.DeploymentTargetConfig, "dryRun", true),
		Mode: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "mode"),
			"simulation",
		),
	}

	if target.Namespace == "" {
		target.Namespace = firstNonEmpty(
			stringFromMap(context.Service.ServiceConfig, "namespace"),
			"default",
		)
	}
	if target.Mode == "" {
		target.Mode = "simulation"
	}

	return kubernetesTrafficAdapter{}, target, validateKubernetesTarget(target)
}

func (k kubernetesTrafficAdapter) Name() string {
	return "kubernetes"
}

func (k kubernetesTrafficAdapter) Apply(
	_ context.Context,
	target adapterRuntimeTarget,
	intent rolloutActionIntent,
) (rolloutAction, error) {
	if err := validateKubernetesTarget(target); err != nil {
		return rolloutAction{}, err
	}

	mode := strings.ToLower(strings.TrimSpace(target.Mode))
	if mode == "" {
		mode = "simulation"
	}

	actionType := string(intent.Decision)
	if intent.Initialization {
		actionType = "initialize"
	} else if intent.RolloutComplete {
		actionType = "complete"
	}

	if mode != "simulation" {
		return rolloutAction{}, fmt.Errorf(
			"kubernetes adapter mode %q is not supported in this local build yet; use simulation mode",
			target.Mode,
		)
	}

	patch := map[string]any{
		"namespace":    target.Namespace,
		"deployment":   target.Deployment,
		"workload":     target.Workload,
		"strategy":     target.Strategy,
		"canaryWeight": intent.ToWeight,
	}

	action := rolloutAction{
		Type:       actionType,
		Adapter:    k.Name(),
		Mode:       mode,
		Applied:    true,
		Summary:    summarizeAdapterAction(intent, target),
		Decision:   intent.Decision,
		FromWeight: intent.FromWeight,
		ToWeight:   intent.ToWeight,
		AppliedAt:  time.Now().UTC(),
		Details: map[string]any{
			"target": patch,
			"patch":  kubernetesPatchDetails(target, intent),
		},
	}

	if target.Cluster != "" {
		action.Details["cluster"] = target.Cluster
	}

	return action, nil
}

func validateKubernetesTarget(target adapterRuntimeTarget) error {
	if strings.TrimSpace(target.Namespace) == "" {
		return fmt.Errorf("kubernetes adapter requires a namespace")
	}
	if strings.TrimSpace(target.Deployment) == "" {
		return fmt.Errorf("kubernetes adapter requires a deployment target")
	}
	if strings.TrimSpace(target.Strategy) == "" {
		return fmt.Errorf("kubernetes adapter requires a traffic strategy")
	}
	if target.Mode == "" {
		target.Mode = "simulation"
	}
	return nil
}

func summarizeAdapterAction(intent rolloutActionIntent, target adapterRuntimeTarget) string {
	switch {
	case intent.Initialization:
		return fmt.Sprintf(
			"Initialized %s/%s canary traffic at %d%% in %s mode.",
			target.Namespace,
			target.Deployment,
			intent.ToWeight,
			target.Mode,
		)
	case intent.RolloutComplete:
		return fmt.Sprintf(
			"Marked rollout complete for %s/%s at %d%% traffic.",
			target.Namespace,
			target.Deployment,
			intent.ToWeight,
		)
	case intent.Decision == decisionRollback:
		return fmt.Sprintf(
			"Rolled %s/%s back from %d%% to %d%% canary traffic.",
			target.Namespace,
			target.Deployment,
			intent.FromWeight,
			intent.ToWeight,
		)
	case intent.Decision == decisionPause:
		return fmt.Sprintf(
			"Paused rollout for %s/%s and kept canary traffic at %d%%.",
			target.Namespace,
			target.Deployment,
			intent.ToWeight,
		)
	case intent.Decision == decisionHold:
		return fmt.Sprintf(
			"Held rollout for %s/%s at %d%% while Sentra waits for more evidence.",
			target.Namespace,
			target.Deployment,
			intent.ToWeight,
		)
	default:
		return fmt.Sprintf(
			"Updated %s/%s canary traffic from %d%% to %d%%.",
			target.Namespace,
			target.Deployment,
			intent.FromWeight,
			intent.ToWeight,
		)
	}
}

func kubernetesPatchDetails(target adapterRuntimeTarget, intent rolloutActionIntent) map[string]any {
	switch strings.ToLower(strings.TrimSpace(target.Strategy)) {
	case "istio":
		return map[string]any{
			"kind":      "VirtualService",
			"namespace": target.Namespace,
			"name":      target.Workload,
			"specPatch": map[string]any{
				"http[0].route[canary].weight": intent.ToWeight,
				"http[0].route[stable].weight": 100 - intent.ToWeight,
			},
		}
	default:
		return map[string]any{
			"kind":      "Ingress",
			"namespace": target.Namespace,
			"name":      target.Deployment,
			"annotations": map[string]string{
				"nginx.ingress.kubernetes.io/canary":        "true",
				"nginx.ingress.kubernetes.io/canary-weight": fmt.Sprintf("%d", intent.ToWeight),
			},
		}
	}
}

func stringFromMap(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	raw, ok := values[key]
	if !ok || raw == nil {
		return ""
	}
	text, ok := raw.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func boolFromMap(values map[string]any, key string, fallback bool) bool {
	if values == nil {
		return fallback
	}
	raw, ok := values[key]
	if !ok || raw == nil {
		return fallback
	}
	flag, ok := raw.(bool)
	if ok {
		return flag
	}
	return fallback
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
