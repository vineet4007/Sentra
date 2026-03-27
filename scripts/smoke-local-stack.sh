#!/usr/bin/env bash
set -euo pipefail

API_URL="${SENTRA_API_URL:-http://localhost:8080}"
CONTROLLER_URL="${SENTRA_CONTROLLER_URL:-http://localhost:8090}"
PROMETHEUS_URL="${SENTRA_PROMETHEUS_URL:-http://localhost:9090}"
LOKI_URL="${SENTRA_LOKI_URL:-http://localhost:3100}"
TEMPO_URL="${SENTRA_TEMPO_URL:-http://localhost:3200}"
AI_URL="${SENTRA_AI_URL_HOST:-http://localhost:8000}"

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

check_ai_health() {
  echo "Checking AI health"

  local response=""
  if response="$(curl -fsS "${AI_URL}/health" 2>/dev/null)"; then
    :
  else
    echo "Falling back to in-network AI health check through the API container"
    response="$(docker compose exec -T api sh -lc "wget -qO- http://ai:8000/health")"
  fi

  if [[ "${response}" != *'"status":"ok"'* ]]; then
    echo "Smoke check failed for AI health"
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
check_ai_health
check_contains "API live rollouts" "${API_URL}/rollouts/live" '"ok":true'
check_contains "API AI evaluation" "${API_URL}/ai/evaluation" '"timeline"'
check_contains "API AI benchmark" "${API_URL}/ai/benchmark" '"recommendation"'
check_contains "API AI dataset" "${API_URL}/ai/dataset" '"series"'

echo "Local stack smoke checks passed."
