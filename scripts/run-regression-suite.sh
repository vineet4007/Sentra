#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")"
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
REPORT_DIR="$ROOT_DIR/reports/regression/$VERSION/$STAMP"
SUMMARY_MD="$REPORT_DIR/summary.md"

mkdir -p "$REPORT_DIR"

cat > "$SUMMARY_MD" <<EOF
# Sentra Regression Suite

- Version: $VERSION
- Run timestamp: $STAMP

## Results

EOF

run_step() {
  local name="$1"
  shift
  local log_file="$REPORT_DIR/${name}.log"

  echo "Running ${name}..."
  if (
    cd "$ROOT_DIR"
    "$@"
  ) >"$log_file" 2>&1; then
    printf -- "- [x] %s\n" "$name" >> "$SUMMARY_MD"
  else
    printf -- "- [ ] %s\n" "$name" >> "$SUMMARY_MD"
    {
      echo
      echo "Failure log: \`$log_file\`"
    } >> "$SUMMARY_MD"
    cat "$log_file"
    exit 1
  fi
}

run_node_step() {
  local name="$1"
  local script_path="$2"
  shift 2

  if command -v node >/dev/null 2>&1; then
    run_step "$name" node "$script_path" "$@"
    return
  fi

  run_step "$name" docker run --rm \
    --add-host=host.docker.internal:host-gateway \
    --user "$(id -u):$(id -g)" \
    -v "$ROOT_DIR:/repo" \
    -w /repo \
    -e "SENTRA_API_URL=${SENTRA_API_URL:-http://host.docker.internal:8080}" \
    -e "SENTRA_CONTROLLER_URL=${SENTRA_CONTROLLER_URL:-http://host.docker.internal:8090}" \
    -e "SENTRA_INTERNAL_PROMETHEUS_URL=${SENTRA_INTERNAL_PROMETHEUS_URL:-http://prometheus:9090}" \
    -e "SENTRA_INTERNAL_LOKI_URL=${SENTRA_INTERNAL_LOKI_URL:-http://loki:3100}" \
    -e "SENTRA_INTERNAL_TEMPO_URL=${SENTRA_INTERNAL_TEMPO_URL:-http://tempo:3200}" \
    node:20-alpine node "$script_path" "$@"
}

run_step ai-test docker compose run --rm --no-deps ai python -m unittest discover -s tests
run_step smoke bash scripts/smoke-local-stack.sh
run_node_step integration scripts/verify-rollout-flow.mjs
run_node_step multiservice scripts/verify-multi-service-flow.mjs
run_step federation bash scripts/verify-federation-flow.sh
run_node_step ai-benchmark scripts/generate-ai-benchmark-report.mjs
run_node_step ai-dataset scripts/export-ai-training-dataset.mjs
run_node_step ai-train-profile scripts/train-ai-risk-profile.mjs

cat >> "$SUMMARY_MD" <<EOF

## Artifacts

- AI benchmark: \`reports/ai/latest.md\`
- AI dataset summary: \`reports/ai/datasets/latest-summary.md\`
- Candidate risk profile: \`reports/ai/models/candidate-risk-profile.md\`

Regression suite completed successfully.
EOF

echo "Wrote regression summary to $SUMMARY_MD"
