package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

type stableCapacityChecker interface {
	CheckStableCapacity(context.Context, adapterRuntimeTarget, rolloutActionIntent) (stableCapacityCheck, error)
}

type stableCapacityPolicy struct {
	Enabled                  bool `json:"enabled"`
	Required                 bool `json:"required"`
	MinReadyReplicas         int  `json:"minReadyReplicas,omitempty"`
	MinAvailableReplicas     int  `json:"minAvailableReplicas,omitempty"`
	MinAvailablePct          int  `json:"minAvailablePct,omitempty"`
	AssumedDesiredReplicas   int  `json:"assumedDesiredReplicas,omitempty"`
	AssumedReadyReplicas     int  `json:"assumedReadyReplicas,omitempty"`
	AssumedAvailableReplicas int  `json:"assumedAvailableReplicas,omitempty"`
}

type stableCapacityCheck struct {
	Checked      bool           `json:"checked"`
	Required     bool           `json:"required"`
	Passed       bool           `json:"passed"`
	Status       string         `json:"status"`
	Adapter      string         `json:"adapter"`
	Mode         string         `json:"mode"`
	Summary      string         `json:"summary"`
	StableTarget map[string]any `json:"stableTarget,omitempty"`
	Requirements map[string]any `json:"requirements,omitempty"`
	Observed     map[string]any `json:"observed,omitempty"`
	Error        string         `json:"error,omitempty"`
}

type kubernetesDeploymentCapacity struct {
	DesiredReplicas     int `json:"desiredReplicas"`
	Replicas            int `json:"replicas"`
	ReadyReplicas       int `json:"readyReplicas"`
	AvailableReplicas   int `json:"availableReplicas"`
	UnavailableReplicas int `json:"unavailableReplicas"`
}

func stableCapacityPolicyFromContext(context deploymentExecutionContext) stableCapacityPolicy {
	policy := defaultStableCapacityPolicy()
	for _, values := range []map[string]any{
		context.Service.ServiceConfig,
		context.Environment.DeploymentTargetConfig,
		context.Deployment.Metadata,
	} {
		applyStableCapacityTopLevelMap(&policy, values)
	}
	for _, values := range []map[string]any{
		nestedMap(context.Service.ServiceConfig, "stableCapacity"),
		nestedMap(context.Environment.DeploymentTargetConfig, "stableCapacity"),
		nestedMap(context.Deployment.Metadata, "stableCapacity"),
	} {
		applyStableCapacityPolicyMap(&policy, values)
	}
	return policy
}

func applyStableCapacityTopLevelMap(policy *stableCapacityPolicy, values map[string]any) {
	if values == nil {
		return
	}

	if value, ok := optionalBoolFromMap(values, "stableCapacityCheckEnabled"); ok {
		policy.Enabled = value
	}
	if value, ok := optionalBoolFromMap(values, "requireStableCapacityCheck"); ok {
		policy.Required = value
	}
	if value, ok := optionalIntFromMap(values, "minStableReadyReplicas"); ok {
		policy.MinReadyReplicas = value
	}
	if value, ok := optionalIntFromMap(values, "minStableAvailableReplicas"); ok {
		policy.MinAvailableReplicas = value
	}
	if value, ok := optionalIntFromMap(values, "minStableAvailablePct"); ok {
		policy.MinAvailablePct = value
	}
	if value, ok := optionalIntFromMap(values, "stableDesiredReplicas"); ok {
		policy.AssumedDesiredReplicas = value
	}
	if value, ok := optionalIntFromMap(values, "stableReadyReplicas"); ok {
		policy.AssumedReadyReplicas = value
	}
	if value, ok := optionalIntFromMap(values, "stableAvailableReplicas"); ok {
		policy.AssumedAvailableReplicas = value
	}
}

func defaultStableCapacityPolicy() stableCapacityPolicy {
	return stableCapacityPolicy{
		Enabled:              true,
		Required:             true,
		MinReadyReplicas:     1,
		MinAvailableReplicas: 1,
	}
}

func applyStableCapacityPolicyMap(policy *stableCapacityPolicy, values map[string]any) {
	if values == nil {
		return
	}

	if value, ok := optionalBoolFromMap(values, "enabled"); ok {
		policy.Enabled = value
	}
	if value, ok := optionalBoolFromMap(values, "required"); ok {
		policy.Required = value
	}
	if value, ok := optionalIntFromMap(values, "minReadyReplicas"); ok {
		policy.MinReadyReplicas = value
	}
	if value, ok := optionalIntFromMap(values, "minAvailableReplicas"); ok {
		policy.MinAvailableReplicas = value
	}
	if value, ok := optionalIntFromMap(values, "minAvailablePct"); ok {
		policy.MinAvailablePct = value
	}
	if value, ok := optionalIntFromMap(values, "assumedDesiredReplicas"); ok {
		policy.AssumedDesiredReplicas = value
	}
	if value, ok := optionalIntFromMap(values, "assumedReadyReplicas"); ok {
		policy.AssumedReadyReplicas = value
	}
	if value, ok := optionalIntFromMap(values, "assumedAvailableReplicas"); ok {
		policy.AssumedAvailableReplicas = value
	}
}

func requiresStableCapacityCheck(intent rolloutActionIntent) bool {
	return intent.Initialization || intent.Decision == decisionPromote
}

func (k kubernetesTrafficAdapter) CheckStableCapacity(
	ctx context.Context,
	target adapterRuntimeTarget,
	intent rolloutActionIntent,
) (stableCapacityCheck, error) {
	mode := strings.ToLower(strings.TrimSpace(target.Mode))
	if mode == "" {
		mode = "simulation"
	}
	check := stableCapacityCheck{
		Checked:  true,
		Required: target.StableCapacity.Required,
		Adapter:  k.Name(),
		Mode:     mode,
		StableTarget: map[string]any{
			"namespace":        target.Namespace,
			"stableDeployment": target.StableDeployment,
			"stableWorkload":   target.StableWorkload,
		},
		Requirements: stableCapacityRequirements(target.StableCapacity),
	}

	if !requiresStableCapacityCheck(intent) {
		check.Passed = true
		check.Status = "skipped"
		check.Summary = "Stable capacity check was skipped because this action does not increase candidate traffic."
		return check, nil
	}

	if !target.StableCapacity.Enabled {
		check.Passed = true
		check.Status = "disabled"
		check.Summary = "Stable capacity check is disabled for this deployment target."
		return check, nil
	}

	if assumed, ok := assumedKubernetesCapacity(target.StableCapacity); ok {
		check.Observed = capacityObservedMap(assumed)
		return evaluateKubernetesCapacityCheck(check, target, assumed), nil
	}

	if mode == "simulation" {
		check.Passed = true
		check.Status = "assumed"
		check.Summary = "Stable capacity check passed by simulation assumption. Configure stableCapacity.assumedReadyReplicas or use kubectl mode for runtime verification."
		return check, nil
	}

	if mode != "kubectl" {
		check.Passed = true
		check.Status = "not_supported"
		check.Summary = fmt.Sprintf("Stable capacity runtime verification is not supported for Kubernetes mode %q yet.", mode)
		return check, nil
	}

	if err := k.guardDirectApply(target); err != nil {
		return stableCapacityCheck{}, err
	}

	stableDeployment := strings.TrimSpace(target.StableDeployment)
	if stableDeployment == "" {
		check.Summary = "Stable capacity check failed because no stableDeployment is configured for the Kubernetes target."
		if !check.Required {
			check.Passed = true
			check.Status = "warning"
			return check, nil
		}
		check.Passed = false
		check.Status = "blocked"
		return check, nil
	}

	args := kubectlStableDeploymentGetArgs(target, stableDeployment)
	check.Requirements["command"] = append([]string{k.kubectlBin()}, args...)

	output, err := k.commandRunner().Run(ctx, k.kubectlBin(), args...)
	outputText := strings.TrimSpace(string(output))
	if err != nil {
		check.Error = strings.TrimSpace(fmt.Sprintf("%v: %s", err, outputText))
		check.Summary = fmt.Sprintf("Stable capacity check failed because Sentra could not read deployment %s/%s.", target.Namespace, stableDeployment)
		if !check.Required {
			check.Passed = true
			check.Status = "warning"
			return check, nil
		}
		check.Passed = false
		check.Status = "blocked"
		return check, nil
	}

	capacity, err := parseKubernetesDeploymentCapacity(output)
	if err != nil {
		check.Error = err.Error()
		check.Summary = fmt.Sprintf("Stable capacity check failed because Kubernetes returned unreadable capacity data for %s/%s.", target.Namespace, stableDeployment)
		if !check.Required {
			check.Passed = true
			check.Status = "warning"
			return check, nil
		}
		check.Passed = false
		check.Status = "blocked"
		return check, nil
	}

	check.Observed = capacityObservedMap(capacity)
	return evaluateKubernetesCapacityCheck(check, target, capacity), nil
}

func (c cloudRunTrafficAdapter) CheckStableCapacity(
	_ context.Context,
	target adapterRuntimeTarget,
	intent rolloutActionIntent,
) (stableCapacityCheck, error) {
	return revisionIdentityCapacityCheck(c.Name(), target, intent, "stableRevision", target.StableRevision), nil
}

func (l lambdaAliasAdapter) CheckStableCapacity(
	_ context.Context,
	target adapterRuntimeTarget,
	intent rolloutActionIntent,
) (stableCapacityCheck, error) {
	return revisionIdentityCapacityCheck(l.Name(), target, intent, "stableVersion", target.StableVersion), nil
}

func (a containerAppsTrafficAdapter) CheckStableCapacity(
	_ context.Context,
	target adapterRuntimeTarget,
	intent rolloutActionIntent,
) (stableCapacityCheck, error) {
	return revisionIdentityCapacityCheck(a.Name(), target, intent, "stableRevision", target.StableRevision), nil
}

func revisionIdentityCapacityCheck(
	adapter string,
	target adapterRuntimeTarget,
	intent rolloutActionIntent,
	stableKey string,
	stableValue string,
) stableCapacityCheck {
	mode := strings.ToLower(strings.TrimSpace(target.Mode))
	if mode == "" {
		mode = "simulation"
	}

	check := stableCapacityCheck{
		Checked:  true,
		Required: target.StableCapacity.Required,
		Adapter:  adapter,
		Mode:     mode,
		StableTarget: map[string]any{
			stableKey: stableValue,
		},
		Requirements: stableCapacityRequirements(target.StableCapacity),
	}

	if !requiresStableCapacityCheck(intent) {
		check.Passed = true
		check.Status = "skipped"
		check.Summary = "Stable capacity check was skipped because this action does not increase candidate traffic."
		return check
	}
	if !target.StableCapacity.Enabled {
		check.Passed = true
		check.Status = "disabled"
		check.Summary = "Stable capacity check is disabled for this deployment target."
		return check
	}
	if strings.TrimSpace(stableValue) == "" {
		check.Summary = fmt.Sprintf("Stable capacity check failed because %s is not configured for the %s target.", stableKey, adapter)
		if !check.Required {
			check.Passed = true
			check.Status = "warning"
			return check
		}
		check.Passed = false
		check.Status = "blocked"
		return check
	}

	check.Passed = true
	check.Status = "identity_validated"
	check.Summary = fmt.Sprintf("Stable %s is configured. Runtime capacity verification for %s is not implemented yet, so Sentra validated the rollback identity only.", stableKey, adapter)
	return check
}

func kubectlStableDeploymentGetArgs(target adapterRuntimeTarget, stableDeployment string) []string {
	args := []string{}
	if target.Context != "" {
		args = append(args, "--context", target.Context)
	}
	args = append(args, "-n", target.Namespace, "get", "deployment", stableDeployment, "-o", "json")
	return args
}

func assumedKubernetesCapacity(policy stableCapacityPolicy) (kubernetesDeploymentCapacity, bool) {
	if policy.AssumedDesiredReplicas <= 0 && policy.AssumedReadyReplicas <= 0 && policy.AssumedAvailableReplicas <= 0 {
		return kubernetesDeploymentCapacity{}, false
	}
	desired := policy.AssumedDesiredReplicas
	if desired <= 0 {
		desired = maxInt(policy.AssumedReadyReplicas, policy.AssumedAvailableReplicas)
	}
	return kubernetesDeploymentCapacity{
		DesiredReplicas:   desired,
		Replicas:          desired,
		ReadyReplicas:     policy.AssumedReadyReplicas,
		AvailableReplicas: policy.AssumedAvailableReplicas,
	}, true
}

func evaluateKubernetesCapacityCheck(
	check stableCapacityCheck,
	target adapterRuntimeTarget,
	capacity kubernetesDeploymentCapacity,
) stableCapacityCheck {
	failures := []string{}
	minReady := target.StableCapacity.MinReadyReplicas
	minAvailable := target.StableCapacity.MinAvailableReplicas
	minAvailablePct := target.StableCapacity.MinAvailablePct

	if minReady > 0 && capacity.ReadyReplicas < minReady {
		failures = append(failures, fmt.Sprintf("ready replicas %d < required %d", capacity.ReadyReplicas, minReady))
	}
	if minAvailable > 0 && capacity.AvailableReplicas < minAvailable {
		failures = append(failures, fmt.Sprintf("available replicas %d < required %d", capacity.AvailableReplicas, minAvailable))
	}
	if minAvailablePct > 0 {
		desired := capacity.DesiredReplicas
		if desired <= 0 {
			desired = capacity.Replicas
		}
		if desired <= 0 {
			failures = append(failures, "desired replicas are unknown")
		} else {
			availablePct := capacity.AvailableReplicas * 100 / desired
			check.Observed["availablePct"] = availablePct
			if availablePct < minAvailablePct {
				failures = append(failures, fmt.Sprintf("available capacity %d%% < required %d%%", availablePct, minAvailablePct))
			}
		}
	}

	if len(failures) > 0 {
		check.Summary = fmt.Sprintf(
			"Stable capacity check failed for Kubernetes deployment %s/%s: %s. Sentra is blocking traffic promotion so rollback has a safe target.",
			target.Namespace,
			target.StableDeployment,
			strings.Join(failures, "; "),
		)
		if !check.Required {
			check.Passed = true
			check.Status = "warning"
			check.Summary = strings.Replace(
				check.Summary,
				"Sentra is blocking traffic promotion",
				"Sentra recorded a warning",
				1,
			)
			return check
		}
		check.Passed = false
		check.Status = "blocked"
		return check
	}

	check.Passed = true
	check.Status = "passed"
	check.Summary = fmt.Sprintf(
		"Stable capacity check passed for Kubernetes deployment %s/%s with %d ready and %d available replicas.",
		target.Namespace,
		target.StableDeployment,
		capacity.ReadyReplicas,
		capacity.AvailableReplicas,
	)
	return check
}

func parseKubernetesDeploymentCapacity(payload []byte) (kubernetesDeploymentCapacity, error) {
	var data struct {
		Spec struct {
			Replicas *int `json:"replicas"`
		} `json:"spec"`
		Status struct {
			Replicas            int `json:"replicas"`
			ReadyReplicas       int `json:"readyReplicas"`
			AvailableReplicas   int `json:"availableReplicas"`
			UnavailableReplicas int `json:"unavailableReplicas"`
		} `json:"status"`
	}
	if err := json.Unmarshal(payload, &data); err != nil {
		return kubernetesDeploymentCapacity{}, err
	}

	desired := data.Status.Replicas
	if data.Spec.Replicas != nil {
		desired = *data.Spec.Replicas
	}
	return kubernetesDeploymentCapacity{
		DesiredReplicas:     desired,
		Replicas:            data.Status.Replicas,
		ReadyReplicas:       data.Status.ReadyReplicas,
		AvailableReplicas:   data.Status.AvailableReplicas,
		UnavailableReplicas: data.Status.UnavailableReplicas,
	}, nil
}

func stableCapacityRequirements(policy stableCapacityPolicy) map[string]any {
	return map[string]any{
		"enabled":              policy.Enabled,
		"required":             policy.Required,
		"minReadyReplicas":     policy.MinReadyReplicas,
		"minAvailableReplicas": policy.MinAvailableReplicas,
		"minAvailablePct":      policy.MinAvailablePct,
	}
}

func capacityObservedMap(capacity kubernetesDeploymentCapacity) map[string]any {
	return map[string]any{
		"desiredReplicas":     capacity.DesiredReplicas,
		"replicas":            capacity.Replicas,
		"readyReplicas":       capacity.ReadyReplicas,
		"availableReplicas":   capacity.AvailableReplicas,
		"unavailableReplicas": capacity.UnavailableReplicas,
	}
}

func optionalBoolFromMap(values map[string]any, key string) (bool, bool) {
	if values == nil {
		return false, false
	}
	raw, ok := values[key]
	if !ok || raw == nil {
		return false, false
	}
	switch value := raw.(type) {
	case bool:
		return value, true
	case string:
		parsed, err := strconv.ParseBool(strings.TrimSpace(value))
		if err == nil {
			return parsed, true
		}
	}
	return false, false
}

func optionalIntFromMap(values map[string]any, key string) (int, bool) {
	if values == nil {
		return 0, false
	}
	raw, ok := values[key]
	if !ok || raw == nil {
		return 0, false
	}
	switch value := raw.(type) {
	case int:
		return value, true
	case int64:
		return int(value), true
	case float64:
		return int(value), true
	case json.Number:
		parsed, err := value.Int64()
		if err == nil {
			return int(parsed), true
		}
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err == nil {
			return parsed, true
		}
	}
	return 0, false
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}
