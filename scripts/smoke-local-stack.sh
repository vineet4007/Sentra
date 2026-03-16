#!/usr/bin/env bash
set -euo pipefail

API_URL="${SENTRA_API_URL:-http://localhost:8080}"
CONTROLLER_URL="${SENTRA_CONTROLLER_URL:-http://localhost:8090}"
PROMETHEUS_URL="${SENTRA_PROMETHEUS_URL:-http://localhost:9090}"
LOKI_URL="${SENTRA_LOKI_URL:-http://localhost:3100}"
TEMPO_URL="${SENTRA_TEMPO_URL:-http://localhost:3200}"

check_contains() {
  local label="$1"
  local url="$2"
  local expected="$3"

  echo "Checking ${label} at ${url}"
  local response
  response="$(curl -fsS "${url}")"
  if [[ "${response}" != *"${expected}"* ]]; then
    echo "Smoke check failed for ${label}: expected to find ${expected}"
    echo "Response was: ${response}"
    exit 1
  fi
}

check_contains "API health" "${API_URL}/health" '"status":"ok"'
check_contains "Controller health" "${CONTROLLER_URL}/health" 'ok'
check_contains "Controller telemetry validation" "${CONTROLLER_URL}/telemetry/validate" '"status":"ok"'
check_contains "Prometheus readiness" "${PROMETHEUS_URL}/-/ready" 'Ready'
check_contains "Loki metrics" "${LOKI_URL}/metrics" 'loki_request_duration_seconds'
check_contains "Tempo metrics" "${TEMPO_URL}/metrics" 'tempo_request_duration_seconds'
check_contains "API live rollouts" "${API_URL}/rollouts/live" '"ok":true'

echo "Local stack smoke checks passed."
