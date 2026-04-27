package main

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
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
	DeploymentID     int64
	Namespace        string
	Workload         string
	Deployment       string
	Strategy         string
	Cluster          string
	Context          string
	Project          string
	Region           string
	ServiceName      string
	StableDeployment string
	StableWorkload   string
	StableRevision   string
	SubscriptionID   string
	ResourceGroup    string
	ContainerAppName string
	FunctionName     string
	AliasName        string
	StableVersion    string
	DryRun           bool
	Mode             string
	AllowDirectApply bool
	StableCapacity   stableCapacityPolicy
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

type commandRunner interface {
	Run(context.Context, string, ...string) ([]byte, error)
}

type execCommandRunner struct{}

func (r execCommandRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	return cmd.CombinedOutput()
}

type kubernetesAdapterConfig struct {
	KubectlBin      string
	ApplyEnabled    bool
	AllowMutations  bool
	AllowedContexts map[string]struct{}
	AllowedClusters map[string]struct{}
	ApplyTimeout    time.Duration
}

type kubernetesTrafficAdapter struct {
	config kubernetesAdapterConfig
	runner commandRunner
}

type cloudRunAdapterConfig struct {
	GcloudBin       string
	ApplyEnabled    bool
	AllowMutations  bool
	AllowedProjects map[string]struct{}
	AllowedRegions  map[string]struct{}
	ApplyTimeout    time.Duration
}

type cloudRunTrafficAdapter struct {
	config cloudRunAdapterConfig
	runner commandRunner
}

type lambdaAdapterConfig struct {
	AWSCLIBin        string
	ApplyEnabled     bool
	AllowMutations   bool
	AllowedRegions   map[string]struct{}
	AllowedFunctions map[string]struct{}
	ApplyTimeout     time.Duration
}

type lambdaAliasAdapter struct {
	config lambdaAdapterConfig
	runner commandRunner
}

type containerAppsAdapterConfig struct {
	AzureCLIBin           string
	ApplyEnabled          bool
	AllowMutations        bool
	AllowedSubscriptions  map[string]struct{}
	AllowedResourceGroups map[string]struct{}
	ApplyTimeout          time.Duration
}

type containerAppsTrafficAdapter struct {
	config containerAppsAdapterConfig
	runner commandRunner
}

func newKubernetesTrafficAdapter(config controllerConfig) kubernetesTrafficAdapter {
	return kubernetesTrafficAdapter{
		config: kubernetesAdapterConfig{
			KubectlBin:      firstNonEmpty(config.KubectlBin, "kubectl"),
			ApplyEnabled:    config.KubernetesApplyEnabled,
			AllowMutations:  config.KubernetesAllowMutations,
			AllowedContexts: config.KubernetesAllowedContexts,
			AllowedClusters: config.KubernetesAllowedClusters,
			ApplyTimeout:    config.KubernetesApplyTimeout,
		},
		runner: execCommandRunner{},
	}
}

func newCloudRunTrafficAdapter(config controllerConfig) cloudRunTrafficAdapter {
	return cloudRunTrafficAdapter{
		config: cloudRunAdapterConfig{
			GcloudBin:       firstNonEmpty(config.GcloudBin, "gcloud"),
			ApplyEnabled:    config.CloudRunApplyEnabled,
			AllowMutations:  config.CloudRunAllowMutations,
			AllowedProjects: config.CloudRunAllowedProjects,
			AllowedRegions:  config.CloudRunAllowedRegions,
			ApplyTimeout:    config.CloudRunApplyTimeout,
		},
		runner: execCommandRunner{},
	}
}

func newLambdaAliasAdapter(config controllerConfig) lambdaAliasAdapter {
	return lambdaAliasAdapter{
		config: lambdaAdapterConfig{
			AWSCLIBin:        firstNonEmpty(config.AWSCLIBin, "aws"),
			ApplyEnabled:     config.LambdaApplyEnabled,
			AllowMutations:   config.LambdaAllowMutations,
			AllowedRegions:   config.LambdaAllowedRegions,
			AllowedFunctions: config.LambdaAllowedFunctions,
			ApplyTimeout:     config.LambdaApplyTimeout,
		},
		runner: execCommandRunner{},
	}
}

func newContainerAppsTrafficAdapter(config controllerConfig) containerAppsTrafficAdapter {
	return containerAppsTrafficAdapter{
		config: containerAppsAdapterConfig{
			AzureCLIBin:           firstNonEmpty(config.AzureCLIBin, "az"),
			ApplyEnabled:          config.ContainerAppsApplyEnabled,
			AllowMutations:        config.ContainerAppsAllowMutations,
			AllowedSubscriptions:  config.ContainerAppsAllowedSubscriptions,
			AllowedResourceGroups: config.ContainerAppsAllowedResourceGroups,
			ApplyTimeout:          config.ContainerAppsApplyTimeout,
		},
		runner: execCommandRunner{},
	}
}

func newDeploymentAdapter(config controllerConfig, context deploymentExecutionContext) (rolloutAdapter, adapterRuntimeTarget, error) {
	adapterType := normalizeAdapterType(context.Service.AdapterType)
	targetType := normalizeAdapterType(context.Environment.DeploymentTargetType)

	if adapterType == "" {
		adapterType = "kubernetes"
	}
	if targetType == "" {
		targetType = "kubernetes"
	}

	if adapterType != targetType {
		return nil, adapterRuntimeTarget{}, fmt.Errorf(
			"unsupported deployment adapter combination service=%q environment=%q",
			context.Service.AdapterType,
			context.Environment.DeploymentTargetType,
		)
	}

	switch adapterType {
	case "kubernetes":
		target := newKubernetesTarget(context)
		return newKubernetesTrafficAdapter(config), target, validateKubernetesTarget(target)
	case "cloudrun":
		target := newCloudRunTarget(context)
		return newCloudRunTrafficAdapter(config), target, validateCloudRunTarget(target)
	case "lambda":
		target := newLambdaTarget(context)
		return newLambdaAliasAdapter(config), target, validateLambdaTarget(target)
	case "containerapps":
		target := newContainerAppsTarget(context)
		return newContainerAppsTrafficAdapter(config), target, validateContainerAppsTarget(target)
	default:
		return nil, adapterRuntimeTarget{}, fmt.Errorf(
			"unsupported deployment adapter %q for environment target %q",
			context.Service.AdapterType,
			context.Environment.DeploymentTargetType,
		)
	}
}

func (k kubernetesTrafficAdapter) Name() string {
	return "kubernetes"
}

func (k kubernetesTrafficAdapter) Apply(
	ctx context.Context,
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

	targetDetails := map[string]any{
		"namespace":    target.Namespace,
		"deployment":   target.Deployment,
		"workload":     target.Workload,
		"strategy":     target.Strategy,
		"canaryWeight": intent.ToWeight,
		"dryRun":       target.DryRun,
		"mode":         mode,
	}
	if target.AllowDirectApply {
		targetDetails["allowDirectApply"] = true
	}
	if target.Context != "" {
		targetDetails["context"] = target.Context
	}

	action := rolloutAction{
		Type:       actionType,
		Adapter:    k.Name(),
		Mode:       mode,
		Summary:    decorateKubernetesSummary(summarizeAdapterAction(intent, target), mode, target.DryRun),
		Decision:   intent.Decision,
		FromWeight: intent.FromWeight,
		ToWeight:   intent.ToWeight,
		AppliedAt:  time.Now().UTC(),
		Details: map[string]any{
			"target": targetDetails,
			"patch":  kubernetesPatchDetails(target, intent),
		},
	}

	if target.Cluster != "" {
		action.Details["cluster"] = target.Cluster
	}

	switch mode {
	case "simulation":
		action.Applied = true
		return action, nil
	case "kubectl":
		if err := k.guardDirectApply(target); err != nil {
			return rolloutAction{}, err
		}

		command, err := kubectlCommandArgs(target, intent)
		if err != nil {
			return rolloutAction{}, err
		}
		action.Details["command"] = append([]string{k.kubectlBin()}, command...)

		ctx, cancel := context.WithTimeout(ctx, k.applyTimeout())
		defer cancel()

		output, err := k.commandRunner().Run(ctx, k.kubectlBin(), command...)
		outputText := strings.TrimSpace(string(output))
		if outputText != "" {
			action.Details["output"] = outputText
		}
		if err != nil {
			if outputText != "" {
				return rolloutAction{}, fmt.Errorf("kubectl apply failed: %w: %s", err, outputText)
			}
			return rolloutAction{}, fmt.Errorf("kubectl apply failed: %w", err)
		}

		action.Applied = true
		return action, nil
	default:
		return rolloutAction{}, fmt.Errorf("unsupported kubernetes adapter mode %q", target.Mode)
	}
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

func (c cloudRunTrafficAdapter) Name() string {
	return "cloudrun"
}

func (l lambdaAliasAdapter) Name() string {
	return "lambda"
}

func (a containerAppsTrafficAdapter) Name() string {
	return "containerapps"
}

func (c cloudRunTrafficAdapter) Apply(
	ctx context.Context,
	target adapterRuntimeTarget,
	intent rolloutActionIntent,
) (rolloutAction, error) {
	if err := validateCloudRunTarget(target); err != nil {
		return rolloutAction{}, err
	}

	mode := strings.ToLower(strings.TrimSpace(target.Mode))
	if mode == "" {
		mode = "simulation"
	}

	assignments, err := cloudRunTrafficAssignments(target, intent)
	if err != nil {
		return rolloutAction{}, err
	}

	actionType := string(intent.Decision)
	if intent.Initialization {
		actionType = "initialize"
	} else if intent.RolloutComplete {
		actionType = "complete"
	}

	targetDetails := map[string]any{
		"project":           target.Project,
		"region":            target.Region,
		"service":           target.ServiceName,
		"stableRevision":    target.StableRevision,
		"candidateRevision": intent.Revision,
		"desiredTraffic":    assignments,
		"mode":              mode,
		"dryRun":            target.DryRun,
	}
	if target.AllowDirectApply {
		targetDetails["allowDirectApply"] = true
	}

	action := rolloutAction{
		Type:       actionType,
		Adapter:    c.Name(),
		Mode:       mode,
		Summary:    decorateCloudRunSummary(summarizeCloudRunAction(intent, target), mode),
		Decision:   intent.Decision,
		FromWeight: intent.FromWeight,
		ToWeight:   intent.ToWeight,
		AppliedAt:  time.Now().UTC(),
		Details: map[string]any{
			"target":      targetDetails,
			"assignments": assignments,
		},
	}

	switch mode {
	case "simulation":
		action.Applied = true
		return action, nil
	case "gcloud":
		if err := c.guardDirectApply(target); err != nil {
			return rolloutAction{}, err
		}

		command := gcloudCloudRunCommandArgs(target, assignments)
		action.Details["command"] = append([]string{c.gcloudBin()}, command...)

		commandCtx, cancel := context.WithTimeout(ctx, c.applyTimeout())
		defer cancel()

		output, err := c.commandRunner().Run(commandCtx, c.gcloudBin(), command...)
		outputText := strings.TrimSpace(string(output))
		if outputText != "" {
			action.Details["output"] = outputText
		}
		if err != nil {
			if outputText != "" {
				return rolloutAction{}, fmt.Errorf("gcloud traffic update failed: %w: %s", err, outputText)
			}
			return rolloutAction{}, fmt.Errorf("gcloud traffic update failed: %w", err)
		}

		action.Applied = true
		return action, nil
	default:
		return rolloutAction{}, fmt.Errorf("unsupported Cloud Run adapter mode %q", target.Mode)
	}
}

func validateCloudRunTarget(target adapterRuntimeTarget) error {
	if strings.TrimSpace(target.Project) == "" {
		return fmt.Errorf("Cloud Run adapter requires a GCP project")
	}
	if strings.TrimSpace(target.Region) == "" {
		return fmt.Errorf("Cloud Run adapter requires a region")
	}
	if strings.TrimSpace(target.ServiceName) == "" {
		return fmt.Errorf("Cloud Run adapter requires a service name")
	}
	if target.Mode == "" {
		target.Mode = "simulation"
	}
	return nil
}

func (l lambdaAliasAdapter) Apply(
	ctx context.Context,
	target adapterRuntimeTarget,
	intent rolloutActionIntent,
) (rolloutAction, error) {
	if err := validateLambdaTarget(target); err != nil {
		return rolloutAction{}, err
	}

	mode := strings.ToLower(strings.TrimSpace(target.Mode))
	if mode == "" {
		mode = "simulation"
	}

	state, err := lambdaAliasRoutingState(target, intent)
	if err != nil {
		return rolloutAction{}, err
	}

	actionType := string(intent.Decision)
	if intent.Initialization {
		actionType = "initialize"
	} else if intent.RolloutComplete {
		actionType = "complete"
	}

	targetDetails := map[string]any{
		"region":           target.Region,
		"functionName":     target.FunctionName,
		"aliasName":        target.AliasName,
		"stableVersion":    target.StableVersion,
		"candidateVersion": intent.Revision,
		"desiredAlias":     state,
		"mode":             mode,
		"dryRun":           target.DryRun,
	}
	if target.AllowDirectApply {
		targetDetails["allowDirectApply"] = true
	}

	action := rolloutAction{
		Type:       actionType,
		Adapter:    l.Name(),
		Mode:       mode,
		Summary:    decorateLambdaSummary(summarizeLambdaAction(intent, target), mode),
		Decision:   intent.Decision,
		FromWeight: intent.FromWeight,
		ToWeight:   intent.ToWeight,
		AppliedAt:  time.Now().UTC(),
		Details: map[string]any{
			"target": targetDetails,
			"alias":  state,
		},
	}

	switch mode {
	case "simulation":
		action.Applied = true
		return action, nil
	case "awscli":
		if err := l.guardDirectApply(target); err != nil {
			return rolloutAction{}, err
		}

		command := awsLambdaCommandArgs(target, state)
		action.Details["command"] = append([]string{l.awscliBin()}, command...)

		commandCtx, cancel := context.WithTimeout(ctx, l.applyTimeout())
		defer cancel()

		output, err := l.commandRunner().Run(commandCtx, l.awscliBin(), command...)
		outputText := strings.TrimSpace(string(output))
		if outputText != "" {
			action.Details["output"] = outputText
		}
		if err != nil {
			if outputText != "" {
				return rolloutAction{}, fmt.Errorf("aws lambda update-alias failed: %w: %s", err, outputText)
			}
			return rolloutAction{}, fmt.Errorf("aws lambda update-alias failed: %w", err)
		}

		action.Applied = true
		return action, nil
	default:
		return rolloutAction{}, fmt.Errorf("unsupported Lambda adapter mode %q", target.Mode)
	}
}

func validateLambdaTarget(target adapterRuntimeTarget) error {
	if strings.TrimSpace(target.Region) == "" {
		return fmt.Errorf("Lambda adapter requires an AWS region")
	}
	if strings.TrimSpace(target.FunctionName) == "" {
		return fmt.Errorf("Lambda adapter requires a function name")
	}
	if strings.TrimSpace(target.AliasName) == "" {
		return fmt.Errorf("Lambda adapter requires an alias name")
	}
	if target.Mode == "" {
		target.Mode = "simulation"
	}
	return nil
}

func (a containerAppsTrafficAdapter) Apply(
	ctx context.Context,
	target adapterRuntimeTarget,
	intent rolloutActionIntent,
) (rolloutAction, error) {
	if err := validateContainerAppsTarget(target); err != nil {
		return rolloutAction{}, err
	}

	mode := strings.ToLower(strings.TrimSpace(target.Mode))
	if mode == "" {
		mode = "simulation"
	}

	assignments, err := containerAppsTrafficAssignments(target, intent)
	if err != nil {
		return rolloutAction{}, err
	}

	actionType := string(intent.Decision)
	if intent.Initialization {
		actionType = "initialize"
	} else if intent.RolloutComplete {
		actionType = "complete"
	}

	targetDetails := map[string]any{
		"subscriptionId":    target.SubscriptionID,
		"resourceGroup":     target.ResourceGroup,
		"containerAppName":  target.ContainerAppName,
		"stableRevision":    target.StableRevision,
		"candidateRevision": intent.Revision,
		"desiredTraffic":    assignments,
		"mode":              mode,
		"dryRun":            target.DryRun,
	}
	if target.AllowDirectApply {
		targetDetails["allowDirectApply"] = true
	}

	action := rolloutAction{
		Type:       actionType,
		Adapter:    a.Name(),
		Mode:       mode,
		Summary:    decorateContainerAppsSummary(summarizeContainerAppsAction(intent, target), mode),
		Decision:   intent.Decision,
		FromWeight: intent.FromWeight,
		ToWeight:   intent.ToWeight,
		AppliedAt:  time.Now().UTC(),
		Details: map[string]any{
			"target":      targetDetails,
			"assignments": assignments,
		},
	}

	switch mode {
	case "simulation":
		action.Applied = true
		return action, nil
	case "azcli":
		if err := a.guardDirectApply(target); err != nil {
			return rolloutAction{}, err
		}

		command := azureContainerAppsCommandArgs(target, assignments)
		action.Details["command"] = append([]string{a.azcliBin()}, command...)

		commandCtx, cancel := context.WithTimeout(ctx, a.applyTimeout())
		defer cancel()

		output, err := a.commandRunner().Run(commandCtx, a.azcliBin(), command...)
		outputText := strings.TrimSpace(string(output))
		if outputText != "" {
			action.Details["output"] = outputText
		}
		if err != nil {
			if outputText != "" {
				return rolloutAction{}, fmt.Errorf("az containerapp ingress traffic set failed: %w: %s", err, outputText)
			}
			return rolloutAction{}, fmt.Errorf("az containerapp ingress traffic set failed: %w", err)
		}

		action.Applied = true
		return action, nil
	default:
		return rolloutAction{}, fmt.Errorf("unsupported Azure Container Apps adapter mode %q", target.Mode)
	}
}

func validateContainerAppsTarget(target adapterRuntimeTarget) error {
	if strings.TrimSpace(target.ResourceGroup) == "" {
		return fmt.Errorf("Azure Container Apps adapter requires a resource group")
	}
	if strings.TrimSpace(target.ContainerAppName) == "" {
		return fmt.Errorf("Azure Container Apps adapter requires a container app name")
	}
	if target.Mode == "" {
		target.Mode = "simulation"
	}
	return nil
}

func (c cloudRunTrafficAdapter) guardDirectApply(target adapterRuntimeTarget) error {
	if !target.AllowDirectApply {
		return fmt.Errorf("Cloud Run gcloud mode requires deployment_target_config.allowDirectApply=true")
	}
	if !c.config.ApplyEnabled {
		return fmt.Errorf("Cloud Run gcloud mode is disabled; set GCP_CLOUDRUN_APPLY_ENABLED=true to opt in")
	}
	if target.DryRun {
		return fmt.Errorf("Cloud Run gcloud mode does not support dryRun=true; use simulation mode for non-mutating validation")
	}
	if !c.config.AllowMutations {
		return fmt.Errorf("Cloud Run mutations are disabled; set GCP_CLOUDRUN_ALLOW_MUTATIONS=true to allow traffic changes")
	}
	if err := ensureAllowedTarget("project", target.Project, c.config.AllowedProjects); err != nil {
		return err
	}
	if err := ensureAllowedTarget("region", target.Region, c.config.AllowedRegions); err != nil {
		return err
	}
	return nil
}

func (l lambdaAliasAdapter) guardDirectApply(target adapterRuntimeTarget) error {
	if !target.AllowDirectApply {
		return fmt.Errorf("Lambda awscli mode requires deployment_target_config.allowDirectApply=true")
	}
	if !l.config.ApplyEnabled {
		return fmt.Errorf("Lambda awscli mode is disabled; set AWS_LAMBDA_APPLY_ENABLED=true to opt in")
	}
	if target.DryRun {
		return fmt.Errorf("Lambda awscli mode does not support dryRun=true; use simulation mode for non-mutating validation")
	}
	if !l.config.AllowMutations {
		return fmt.Errorf("Lambda mutations are disabled; set AWS_LAMBDA_ALLOW_MUTATIONS=true to allow alias updates")
	}
	if err := ensureAllowedTarget("region", target.Region, l.config.AllowedRegions); err != nil {
		return err
	}
	if err := ensureAllowedTarget("function", target.FunctionName, l.config.AllowedFunctions); err != nil {
		return err
	}
	return nil
}

func (a containerAppsTrafficAdapter) guardDirectApply(target adapterRuntimeTarget) error {
	if !target.AllowDirectApply {
		return fmt.Errorf("Azure Container Apps azcli mode requires deployment_target_config.allowDirectApply=true")
	}
	if !a.config.ApplyEnabled {
		return fmt.Errorf("Azure Container Apps azcli mode is disabled; set AZURE_CONTAINERAPPS_APPLY_ENABLED=true to opt in")
	}
	if target.DryRun {
		return fmt.Errorf("Azure Container Apps azcli mode does not support dryRun=true; use simulation mode for non-mutating validation")
	}
	if !a.config.AllowMutations {
		return fmt.Errorf("Azure Container Apps mutations are disabled; set AZURE_CONTAINERAPPS_ALLOW_MUTATIONS=true to allow traffic changes")
	}
	if err := ensureAllowedTarget("subscription", target.SubscriptionID, a.config.AllowedSubscriptions); err != nil {
		return err
	}
	if err := ensureAllowedTarget("resource group", target.ResourceGroup, a.config.AllowedResourceGroups); err != nil {
		return err
	}
	return nil
}

func (k kubernetesTrafficAdapter) guardDirectApply(target adapterRuntimeTarget) error {
	if !target.AllowDirectApply {
		return fmt.Errorf("kubernetes kubectl mode requires deployment_target_config.allowDirectApply=true")
	}
	if !k.config.ApplyEnabled {
		return fmt.Errorf("kubernetes kubectl mode is disabled; set KUBERNETES_APPLY_ENABLED=true to opt in")
	}
	if !target.DryRun && !k.config.AllowMutations {
		return fmt.Errorf(
			"kubernetes mutations are disabled; keep deployment_target_config.dryRun=true or set KUBERNETES_ALLOW_MUTATIONS=true",
		)
	}
	if err := ensureAllowedTarget("context", target.Context, k.config.AllowedContexts); err != nil {
		return err
	}
	if err := ensureAllowedTarget("cluster", target.Cluster, k.config.AllowedClusters); err != nil {
		return err
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
			"Rolled %s/%s back from %d%% to %d%% canary traffic. Stable traffic now serves 100%%.",
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

func decorateKubernetesSummary(summary, mode string, dryRun bool) string {
	switch mode {
	case "kubectl":
		if dryRun {
			return summary + " Validated with kubectl dry-run."
		}
		return summary + " Applied through kubectl."
	default:
		return summary
	}
}

func summarizeCloudRunAction(intent rolloutActionIntent, target adapterRuntimeTarget) string {
	switch {
	case intent.Initialization:
		return fmt.Sprintf(
			"Initialized Cloud Run service %s in %s at %d%% candidate traffic in %s mode.",
			target.ServiceName,
			target.Region,
			intent.ToWeight,
			target.Mode,
		)
	case intent.RolloutComplete:
		return fmt.Sprintf(
			"Promoted Cloud Run service %s in %s to 100%% on revision %s.",
			target.ServiceName,
			target.Region,
			intent.Revision,
		)
	case intent.Decision == decisionRollback:
		return fmt.Sprintf(
			"Rolled Cloud Run service %s in %s back to stable revision %s. Stable traffic now serves 100%%.",
			target.ServiceName,
			target.Region,
			target.StableRevision,
		)
	case intent.Decision == decisionPause:
		return fmt.Sprintf(
			"Paused Cloud Run rollout for %s in %s and kept candidate traffic at %d%%.",
			target.ServiceName,
			target.Region,
			intent.ToWeight,
		)
	case intent.Decision == decisionHold:
		return fmt.Sprintf(
			"Held Cloud Run rollout for %s in %s at %d%% while Sentra waits for more evidence.",
			target.ServiceName,
			target.Region,
			intent.ToWeight,
		)
	default:
		return fmt.Sprintf(
			"Updated Cloud Run traffic for %s in %s from %d%% to %d%% on revision %s.",
			target.ServiceName,
			target.Region,
			intent.FromWeight,
			intent.ToWeight,
			intent.Revision,
		)
	}
}

func decorateCloudRunSummary(summary, mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), "gcloud") {
		return summary + " Applied through gcloud."
	}
	return summary
}

func summarizeLambdaAction(intent rolloutActionIntent, target adapterRuntimeTarget) string {
	switch {
	case intent.Initialization:
		return fmt.Sprintf(
			"Initialized Lambda alias %s for %s in %s at %d%% candidate traffic in %s mode.",
			target.AliasName,
			target.FunctionName,
			target.Region,
			intent.ToWeight,
			target.Mode,
		)
	case intent.RolloutComplete:
		return fmt.Sprintf(
			"Promoted Lambda alias %s for %s in %s to 100%% on version %s.",
			target.AliasName,
			target.FunctionName,
			target.Region,
			intent.Revision,
		)
	case intent.Decision == decisionRollback:
		return fmt.Sprintf(
			"Rolled Lambda alias %s for %s in %s back to stable version %s. Stable traffic now serves 100%%.",
			target.AliasName,
			target.FunctionName,
			target.Region,
			target.StableVersion,
		)
	case intent.Decision == decisionPause:
		return fmt.Sprintf(
			"Paused Lambda rollout for alias %s on %s in %s and kept candidate traffic at %d%%.",
			target.AliasName,
			target.FunctionName,
			target.Region,
			intent.ToWeight,
		)
	case intent.Decision == decisionHold:
		return fmt.Sprintf(
			"Held Lambda rollout for alias %s on %s in %s at %d%% while Sentra waits for more evidence.",
			target.AliasName,
			target.FunctionName,
			target.Region,
			intent.ToWeight,
		)
	default:
		return fmt.Sprintf(
			"Updated Lambda alias %s for %s in %s from %d%% to %d%% on version %s.",
			target.AliasName,
			target.FunctionName,
			target.Region,
			intent.FromWeight,
			intent.ToWeight,
			intent.Revision,
		)
	}
}

func decorateLambdaSummary(summary, mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), "awscli") {
		return summary + " Applied through aws cli."
	}
	return summary
}

func summarizeContainerAppsAction(intent rolloutActionIntent, target adapterRuntimeTarget) string {
	switch {
	case intent.Initialization:
		return fmt.Sprintf(
			"Initialized Azure Container Apps traffic for %s in %s at %d%% candidate traffic in %s mode.",
			target.ContainerAppName,
			target.ResourceGroup,
			intent.ToWeight,
			target.Mode,
		)
	case intent.RolloutComplete:
		return fmt.Sprintf(
			"Promoted Azure Container App %s in %s to 100%% on revision %s.",
			target.ContainerAppName,
			target.ResourceGroup,
			intent.Revision,
		)
	case intent.Decision == decisionRollback:
		return fmt.Sprintf(
			"Rolled Azure Container App %s in %s back to stable revision %s. Stable traffic now serves 100%%.",
			target.ContainerAppName,
			target.ResourceGroup,
			target.StableRevision,
		)
	case intent.Decision == decisionPause:
		return fmt.Sprintf(
			"Paused Azure Container App rollout for %s in %s and kept candidate traffic at %d%%.",
			target.ContainerAppName,
			target.ResourceGroup,
			intent.ToWeight,
		)
	case intent.Decision == decisionHold:
		return fmt.Sprintf(
			"Held Azure Container App rollout for %s in %s at %d%% while Sentra waits for more evidence.",
			target.ContainerAppName,
			target.ResourceGroup,
			intent.ToWeight,
		)
	default:
		return fmt.Sprintf(
			"Updated Azure Container App traffic for %s in %s from %d%% to %d%% on revision %s.",
			target.ContainerAppName,
			target.ResourceGroup,
			intent.FromWeight,
			intent.ToWeight,
			intent.Revision,
		)
	}
}

func decorateContainerAppsSummary(summary, mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), "azcli") {
		return summary + " Applied through az cli."
	}
	return summary
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

func kubectlCommandArgs(target adapterRuntimeTarget, intent rolloutActionIntent) ([]string, error) {
	base := []string{}
	if target.Context != "" {
		base = append(base, "--context", target.Context)
	}
	base = append(base, "-n", target.Namespace)

	switch strings.ToLower(strings.TrimSpace(target.Strategy)) {
	case "", "canary", "ingress", "nginx-ingress":
		args := append(base,
			"annotate",
			"ingress",
			target.Deployment,
			"nginx.ingress.kubernetes.io/canary=true",
			fmt.Sprintf("nginx.ingress.kubernetes.io/canary-weight=%d", intent.ToWeight),
			"--overwrite",
		)
		if target.DryRun {
			args = append(args, "--dry-run=server", "-o", "yaml")
		}
		return args, nil
	default:
		return nil, fmt.Errorf(
			"kubernetes kubectl mode currently supports ingress canary strategy only; got %q",
			target.Strategy,
		)
	}
}

func cloudRunTrafficAssignments(target adapterRuntimeTarget, intent rolloutActionIntent) ([]string, error) {
	candidateRevision := strings.TrimSpace(intent.Revision)
	stableRevision := strings.TrimSpace(target.StableRevision)
	if candidateRevision == "" {
		return nil, fmt.Errorf("Cloud Run adapter requires a candidate revision")
	}

	switch {
	case intent.RolloutComplete:
		return []string{fmt.Sprintf("%s=100", candidateRevision)}, nil
	case intent.Decision == decisionRollback:
		if stableRevision == "" {
			return nil, fmt.Errorf("Cloud Run rollback requires deployment_metadata.stableRevision or deployment_target_config.stableRevision")
		}
		return []string{fmt.Sprintf("%s=100", stableRevision)}, nil
	default:
		if stableRevision == "" {
			return nil, fmt.Errorf("Cloud Run weighted rollout requires deployment_metadata.stableRevision or deployment_target_config.stableRevision")
		}
		if stableRevision == candidateRevision {
			return nil, fmt.Errorf("Cloud Run stableRevision must differ from the candidate revision %q", candidateRevision)
		}

		candidateWeight := clampTrafficWeight(intent.ToWeight)
		stableWeight := 100 - candidateWeight
		assignments := []string{}
		if candidateWeight > 0 {
			assignments = append(assignments, fmt.Sprintf("%s=%d", candidateRevision, candidateWeight))
		}
		if stableWeight > 0 {
			assignments = append(assignments, fmt.Sprintf("%s=%d", stableRevision, stableWeight))
		}
		if len(assignments) == 0 {
			return nil, fmt.Errorf("Cloud Run traffic assignment resolved to 0%% for all revisions")
		}
		return assignments, nil
	}
}

func gcloudCloudRunCommandArgs(target adapterRuntimeTarget, assignments []string) []string {
	return []string{
		"run",
		"services",
		"update-traffic",
		target.ServiceName,
		"--region",
		target.Region,
		"--project",
		target.Project,
		"--to-revisions=" + strings.Join(assignments, ","),
		"--quiet",
	}
}

func lambdaAliasRoutingState(target adapterRuntimeTarget, intent rolloutActionIntent) (map[string]any, error) {
	candidateVersion := strings.TrimSpace(intent.Revision)
	stableVersion := strings.TrimSpace(target.StableVersion)
	if candidateVersion == "" {
		return nil, fmt.Errorf("Lambda adapter requires a candidate version in deployment.revision")
	}

	switch {
	case intent.RolloutComplete:
		return map[string]any{
			"functionVersion":          candidateVersion,
			"additionalVersionWeights": map[string]float64{},
		}, nil
	case intent.Decision == decisionRollback:
		if stableVersion == "" {
			return nil, fmt.Errorf("Lambda rollback requires deployment_metadata.stableVersion or deployment_target_config.stableVersion")
		}
		return map[string]any{
			"functionVersion":          stableVersion,
			"additionalVersionWeights": map[string]float64{},
		}, nil
	default:
		if stableVersion == "" {
			return nil, fmt.Errorf("Lambda weighted rollout requires deployment_metadata.stableVersion or deployment_target_config.stableVersion")
		}
		if stableVersion == candidateVersion {
			return nil, fmt.Errorf("Lambda stableVersion must differ from the candidate version %q", candidateVersion)
		}
		candidateWeight := clampTrafficWeight(intent.ToWeight)
		additional := map[string]float64{}
		if candidateWeight > 0 {
			additional[candidateVersion] = float64(candidateWeight) / 100.0
		}
		return map[string]any{
			"functionVersion":          stableVersion,
			"additionalVersionWeights": additional,
		}, nil
	}
}

func awsLambdaCommandArgs(target adapterRuntimeTarget, state map[string]any) []string {
	functionVersion, _ := state["functionVersion"].(string)
	additional, _ := state["additionalVersionWeights"].(map[string]float64)

	args := []string{
		"lambda",
		"update-alias",
		"--function-name",
		target.FunctionName,
		"--name",
		target.AliasName,
		"--function-version",
		functionVersion,
		"--routing-config",
		lambdaRoutingConfigArg(additional),
		"--region",
		target.Region,
		"--no-cli-pager",
		"--output",
		"json",
	}
	return args
}

func lambdaRoutingConfigArg(weights map[string]float64) string {
	if len(weights) == 0 {
		return "AdditionalVersionWeights={}"
	}

	parts := make([]string, 0, len(weights))
	for version, weight := range weights {
		parts = append(parts, fmt.Sprintf("%s=%s", version, formatTrafficFraction(weight)))
	}
	return "AdditionalVersionWeights={" + strings.Join(parts, ",") + "}"
}

func formatTrafficFraction(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func containerAppsTrafficAssignments(target adapterRuntimeTarget, intent rolloutActionIntent) ([]string, error) {
	candidateRevision := strings.TrimSpace(intent.Revision)
	stableRevision := strings.TrimSpace(target.StableRevision)
	if candidateRevision == "" {
		return nil, fmt.Errorf("Azure Container Apps adapter requires a candidate revision")
	}

	switch {
	case intent.RolloutComplete:
		return []string{fmt.Sprintf("%s=100", candidateRevision)}, nil
	case intent.Decision == decisionRollback:
		if stableRevision == "" {
			return nil, fmt.Errorf("Azure Container Apps rollback requires deployment_metadata.stableRevision or deployment_target_config.stableRevision")
		}
		return []string{fmt.Sprintf("%s=100", stableRevision)}, nil
	default:
		if stableRevision == "" {
			return nil, fmt.Errorf("Azure Container Apps weighted rollout requires deployment_metadata.stableRevision or deployment_target_config.stableRevision")
		}
		if stableRevision == candidateRevision {
			return nil, fmt.Errorf("Azure Container Apps stableRevision must differ from the candidate revision %q", candidateRevision)
		}
		candidateWeight := clampTrafficWeight(intent.ToWeight)
		stableWeight := 100 - candidateWeight
		assignments := []string{}
		if candidateWeight > 0 {
			assignments = append(assignments, fmt.Sprintf("%s=%d", candidateRevision, candidateWeight))
		}
		if stableWeight > 0 {
			assignments = append(assignments, fmt.Sprintf("%s=%d", stableRevision, stableWeight))
		}
		if len(assignments) == 0 {
			return nil, fmt.Errorf("Azure Container Apps traffic assignment resolved to 0%% for all revisions")
		}
		return assignments, nil
	}
}

func azureContainerAppsCommandArgs(target adapterRuntimeTarget, assignments []string) []string {
	args := []string{
		"containerapp",
		"ingress",
		"traffic",
		"set",
		"--name",
		target.ContainerAppName,
		"--resource-group",
		target.ResourceGroup,
		"--revision-weight",
	}
	args = append(args, assignments...)
	if strings.TrimSpace(target.SubscriptionID) != "" {
		args = append(args, "--subscription", target.SubscriptionID)
	}
	args = append(args, "--output", "json", "--only-show-errors")
	return args
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

func normalizeAdapterType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "kubernetes", "k8s":
		return strings.ToLower(strings.TrimSpace(value))
	case "cloudrun", "cloud-run", "gcp-cloudrun", "gcp_cloudrun":
		return "cloudrun"
	case "lambda", "aws-lambda", "aws_lambda", "lambda-alias", "lambda_alias":
		return "lambda"
	case "containerapps", "container-apps", "azure-containerapps", "azure_containerapps":
		return "containerapps"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func newKubernetesTarget(context deploymentExecutionContext) adapterRuntimeTarget {
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
		Cluster: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "cluster"),
			stringFromMap(context.Service.ServiceConfig, "cluster"),
		),
		Context: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "context"),
			stringFromMap(context.Environment.DeploymentTargetConfig, "kubeContext"),
			stringFromMap(context.Service.ServiceConfig, "context"),
			stringFromMap(context.Service.ServiceConfig, "kubeContext"),
		),
		StableDeployment: firstNonEmpty(
			stringFromMap(context.Deployment.Metadata, "stableDeployment"),
			stringFromMap(context.Environment.DeploymentTargetConfig, "stableDeployment"),
			stringFromMap(context.Service.ServiceConfig, "stableDeployment"),
		),
		StableWorkload: firstNonEmpty(
			stringFromMap(context.Deployment.Metadata, "stableWorkload"),
			stringFromMap(context.Environment.DeploymentTargetConfig, "stableWorkload"),
			stringFromMap(context.Service.ServiceConfig, "stableWorkload"),
		),
		DryRun: boolFromMap(context.Environment.DeploymentTargetConfig, "dryRun", true),
		Mode: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "mode"),
			"simulation",
		),
		AllowDirectApply: boolFromMap(
			context.Environment.DeploymentTargetConfig,
			"allowDirectApply",
			boolFromMap(context.Environment.DeploymentTargetConfig, "directApply", false),
		),
		StableCapacity: stableCapacityPolicyFromContext(context),
	}

	if target.Namespace == "" {
		target.Namespace = firstNonEmpty(
			stringFromMap(context.Service.ServiceConfig, "namespace"),
			"default",
		)
	}
	if target.StableDeployment == "" {
		target.StableDeployment = firstNonEmpty(target.StableWorkload, target.Deployment)
	}
	if target.StableWorkload == "" {
		target.StableWorkload = target.StableDeployment
	}
	if target.Mode == "" {
		target.Mode = "simulation"
	}

	return target
}

func newCloudRunTarget(context deploymentExecutionContext) adapterRuntimeTarget {
	target := adapterRuntimeTarget{
		DeploymentID: context.Deployment.ID,
		Project: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "project"),
			stringFromMap(context.Service.ServiceConfig, "project"),
			stringFromMap(context.Deployment.Metadata, "project"),
		),
		Region: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "region"),
			stringFromMap(context.Service.ServiceConfig, "region"),
			stringFromMap(context.Deployment.Metadata, "region"),
		),
		ServiceName: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "service"),
			stringFromMap(context.Environment.DeploymentTargetConfig, "cloudRunService"),
			stringFromMap(context.Service.ServiceConfig, "service"),
			stringFromMap(context.Service.ServiceConfig, "cloudRunService"),
			context.Service.Name,
		),
		StableRevision: firstNonEmpty(
			stringFromMap(context.Deployment.Metadata, "stableRevision"),
			stringFromMap(context.Environment.DeploymentTargetConfig, "stableRevision"),
			stringFromMap(context.Service.ServiceConfig, "stableRevision"),
		),
		DryRun: boolFromMap(context.Environment.DeploymentTargetConfig, "dryRun", false),
		Mode: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "mode"),
			"simulation",
		),
		AllowDirectApply: boolFromMap(
			context.Environment.DeploymentTargetConfig,
			"allowDirectApply",
			boolFromMap(context.Environment.DeploymentTargetConfig, "directApply", false),
		),
		StableCapacity: stableCapacityPolicyFromContext(context),
	}

	if target.Mode == "" {
		target.Mode = "simulation"
	}

	return target
}

func newLambdaTarget(context deploymentExecutionContext) adapterRuntimeTarget {
	target := adapterRuntimeTarget{
		DeploymentID: context.Deployment.ID,
		Region: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "region"),
			stringFromMap(context.Service.ServiceConfig, "region"),
			stringFromMap(context.Deployment.Metadata, "region"),
		),
		FunctionName: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "functionName"),
			stringFromMap(context.Environment.DeploymentTargetConfig, "lambdaFunction"),
			stringFromMap(context.Service.ServiceConfig, "functionName"),
			stringFromMap(context.Service.ServiceConfig, "lambdaFunction"),
			context.Service.Name,
		),
		AliasName: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "aliasName"),
			stringFromMap(context.Environment.DeploymentTargetConfig, "alias"),
			stringFromMap(context.Service.ServiceConfig, "aliasName"),
			stringFromMap(context.Service.ServiceConfig, "alias"),
			"live",
		),
		StableVersion: firstNonEmpty(
			stringFromMap(context.Deployment.Metadata, "stableVersion"),
			stringFromMap(context.Environment.DeploymentTargetConfig, "stableVersion"),
			stringFromMap(context.Service.ServiceConfig, "stableVersion"),
		),
		DryRun: boolFromMap(context.Environment.DeploymentTargetConfig, "dryRun", false),
		Mode: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "mode"),
			"simulation",
		),
		AllowDirectApply: boolFromMap(
			context.Environment.DeploymentTargetConfig,
			"allowDirectApply",
			boolFromMap(context.Environment.DeploymentTargetConfig, "directApply", false),
		),
		StableCapacity: stableCapacityPolicyFromContext(context),
	}

	if target.Mode == "" {
		target.Mode = "simulation"
	}

	return target
}

func newContainerAppsTarget(context deploymentExecutionContext) adapterRuntimeTarget {
	target := adapterRuntimeTarget{
		DeploymentID: context.Deployment.ID,
		SubscriptionID: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "subscriptionId"),
			stringFromMap(context.Environment.DeploymentTargetConfig, "subscription"),
			stringFromMap(context.Service.ServiceConfig, "subscriptionId"),
			stringFromMap(context.Service.ServiceConfig, "subscription"),
			stringFromMap(context.Deployment.Metadata, "subscriptionId"),
		),
		ResourceGroup: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "resourceGroup"),
			stringFromMap(context.Service.ServiceConfig, "resourceGroup"),
			stringFromMap(context.Deployment.Metadata, "resourceGroup"),
		),
		ContainerAppName: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "containerAppName"),
			stringFromMap(context.Environment.DeploymentTargetConfig, "appName"),
			stringFromMap(context.Service.ServiceConfig, "containerAppName"),
			stringFromMap(context.Service.ServiceConfig, "appName"),
			context.Service.Name,
		),
		StableRevision: firstNonEmpty(
			stringFromMap(context.Deployment.Metadata, "stableRevision"),
			stringFromMap(context.Environment.DeploymentTargetConfig, "stableRevision"),
			stringFromMap(context.Service.ServiceConfig, "stableRevision"),
		),
		DryRun: boolFromMap(context.Environment.DeploymentTargetConfig, "dryRun", false),
		Mode: firstNonEmpty(
			stringFromMap(context.Environment.DeploymentTargetConfig, "mode"),
			"simulation",
		),
		AllowDirectApply: boolFromMap(
			context.Environment.DeploymentTargetConfig,
			"allowDirectApply",
			boolFromMap(context.Environment.DeploymentTargetConfig, "directApply", false),
		),
		StableCapacity: stableCapacityPolicyFromContext(context),
	}

	if target.Mode == "" {
		target.Mode = "simulation"
	}

	return target
}

func clampTrafficWeight(value int) int {
	switch {
	case value < 0:
		return 0
	case value > 100:
		return 100
	default:
		return value
	}
}

func ensureAllowedTarget(kind, value string, allowed map[string]struct{}) error {
	if len(allowed) == 0 {
		return nil
	}
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("direct apply requires target %s to match the controller allowlist", kind)
	}
	if _, ok := allowed[strings.TrimSpace(value)]; !ok {
		return fmt.Errorf("%s %q is not allowed by the controller configuration", kind, value)
	}
	return nil
}

func (k kubernetesTrafficAdapter) kubectlBin() string {
	return firstNonEmpty(k.config.KubectlBin, "kubectl")
}

func (k kubernetesTrafficAdapter) applyTimeout() time.Duration {
	if k.config.ApplyTimeout > 0 {
		return k.config.ApplyTimeout
	}
	return 15 * time.Second
}

func (k kubernetesTrafficAdapter) commandRunner() commandRunner {
	if k.runner != nil {
		return k.runner
	}
	return execCommandRunner{}
}

func (c cloudRunTrafficAdapter) gcloudBin() string {
	return firstNonEmpty(c.config.GcloudBin, "gcloud")
}

func (c cloudRunTrafficAdapter) applyTimeout() time.Duration {
	if c.config.ApplyTimeout > 0 {
		return c.config.ApplyTimeout
	}
	return 20 * time.Second
}

func (c cloudRunTrafficAdapter) commandRunner() commandRunner {
	if c.runner != nil {
		return c.runner
	}
	return execCommandRunner{}
}

func (l lambdaAliasAdapter) awscliBin() string {
	return firstNonEmpty(l.config.AWSCLIBin, "aws")
}

func (l lambdaAliasAdapter) applyTimeout() time.Duration {
	if l.config.ApplyTimeout > 0 {
		return l.config.ApplyTimeout
	}
	return 20 * time.Second
}

func (l lambdaAliasAdapter) commandRunner() commandRunner {
	if l.runner != nil {
		return l.runner
	}
	return execCommandRunner{}
}

func (a containerAppsTrafficAdapter) azcliBin() string {
	return firstNonEmpty(a.config.AzureCLIBin, "az")
}

func (a containerAppsTrafficAdapter) applyTimeout() time.Duration {
	if a.config.ApplyTimeout > 0 {
		return a.config.ApplyTimeout
	}
	return 20 * time.Second
}

func (a containerAppsTrafficAdapter) commandRunner() commandRunner {
	if a.runner != nil {
		return a.runner
	}
	return execCommandRunner{}
}
