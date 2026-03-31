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

run_step ai-test docker compose run --rm --no-deps ai python -m unittest discover -s tests
run_step smoke bash scripts/smoke-local-stack.sh
run_step integration node scripts/verify-rollout-flow.mjs
run_step multiservice node scripts/verify-multi-service-flow.mjs
run_step federation bash scripts/verify-federation-flow.sh
run_step ai-benchmark node scripts/generate-ai-benchmark-report.mjs
run_step ai-dataset node scripts/export-ai-training-dataset.mjs
run_step ai-train-profile node scripts/train-ai-risk-profile.mjs

cat >> "$SUMMARY_MD" <<EOF

## Artifacts

- AI benchmark: \`reports/ai/latest.md\`
- AI dataset summary: \`reports/ai/datasets/latest-summary.md\`
- Candidate risk profile: \`reports/ai/models/candidate-risk-profile.md\`

Regression suite completed successfully.
EOF

echo "Wrote regression summary to $SUMMARY_MD"
