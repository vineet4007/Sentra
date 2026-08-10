#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

read_env_value() {
  local key="$1"
  local file="${ROOT_DIR}/.env"
  if [[ ! -f "${file}" ]]; then
    return 0
  fi

  local line
  line="$(grep -E "^${key}=" "${file}" | tail -n 1 || true)"
  if [[ -z "${line}" ]]; then
    return 0
  fi

  local value="${line#*=}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "${value}"
}

default_env_from_file() {
  local key="$1"
  if [[ -n "${!key:-}" ]]; then
    return
  fi

  local value
  value="$(read_env_value "${key}")"
  if [[ -n "${value}" ]]; then
    export "${key}=${value}"
  fi
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local expected="$3"
  local attempts="${4:-60}"

  for _ in $(seq 1 "${attempts}"); do
    local response
    if response="$(curl -fsS "${url}" 2>/dev/null)" && [[ "${response}" == *"${expected}"* ]]; then
      echo "${label} is ready"
      return 0
    fi
    sleep 2
  done

  echo "Timed out waiting for ${label} at ${url}" >&2
  return 1
}

compose_port() {
  local service="$1"
  local container_port="$2"
  local fallback="$3"
  local mapping
  mapping="$(docker compose --profile demo port "${service}" "${container_port}" 2>/dev/null | head -n 1 || true)"
  if [[ -n "${mapping}" ]]; then
    printf '%s' "${mapping##*:}"
    return
  fi
  printf '%s' "${fallback}"
}

for key in \
  SENTRA_API_BEARER_TOKEN \
  SENTRA_ACTION_TOKEN \
  SENTRA_ACTION_HEADER \
  SENTRA_ACTION_ACTOR_HEADER \
  SENTRA_CONTROLLER_BEARER_TOKEN \
  SENTRA_TENANT_HEADER; do
  default_env_from_file "${key}"
done

(
  cd "${ROOT_DIR}"
  docker compose --profile demo up -d --build
  docker compose --profile demo up -d --force-recreate prometheus demo-workload
)

API_PORT="$(compose_port api 8080 "${SENTRA_API_HOST_PORT:-8080}")"
CONTROLLER_PORT="$(compose_port controller 8090 "${SENTRA_CONTROLLER_HOST_PORT:-8090}")"
DEMO_PORT="$(compose_port demo-workload 9102 "${SENTRA_DEMO_WORKLOAD_HOST_PORT:-18091}")"
PROMETHEUS_PORT="$(compose_port prometheus 9090 "${SENTRA_PROMETHEUS_HOST_PORT:-9090}")"
LOKI_PORT="$(compose_port loki 3100 "${SENTRA_LOKI_HOST_PORT:-3100}")"
TEMPO_PORT="$(compose_port tempo 3200 "${SENTRA_TEMPO_HOST_PORT:-3200}")"

HOST_API_URL="http://localhost:${API_PORT}"
HOST_CONTROLLER_URL="http://localhost:${CONTROLLER_PORT}"
HOST_DEMO_URL="http://localhost:${DEMO_PORT}"

wait_for_url "API" "${HOST_API_URL}/health" '"status":"ok"'
wait_for_url "Controller" "${HOST_CONTROLLER_URL}/health" 'ok'
wait_for_url "Demo workload" "${HOST_DEMO_URL}/health" '"status"'
wait_for_url "Prometheus" "http://localhost:${PROMETHEUS_PORT}/-/ready" 'Ready'
wait_for_url "Loki" "http://localhost:${LOKI_PORT}/metrics" 'loki_request_duration_seconds'
wait_for_url "Tempo" "http://localhost:${TEMPO_PORT}/metrics" 'tempo_request_duration_seconds'

if command -v node >/dev/null 2>&1; then
  SENTRA_API_URL="${SENTRA_API_URL:-${HOST_API_URL}}" \
  SENTRA_CONTROLLER_URL="${SENTRA_CONTROLLER_URL:-${HOST_CONTROLLER_URL}}" \
  SENTRA_DEMO_WORKLOAD_URL="${SENTRA_DEMO_WORKLOAD_URL:-${HOST_DEMO_URL}}" \
  SENTRA_INTERNAL_PROMETHEUS_URL="${SENTRA_INTERNAL_PROMETHEUS_URL:-http://prometheus:9090}" \
  SENTRA_INTERNAL_LOKI_URL="${SENTRA_INTERNAL_LOKI_URL:-http://loki:3100}" \
  SENTRA_INTERNAL_TEMPO_URL="${SENTRA_INTERNAL_TEMPO_URL:-http://tempo:3200}" \
  node "${ROOT_DIR}/scripts/verify-demo-workload-flow.mjs"
else
  docker run --rm \
    --add-host=host.docker.internal:host-gateway \
    --user "$(id -u):$(id -g)" \
    -v "${ROOT_DIR}:/repo" \
    -w /repo \
    -e "SENTRA_API_URL=http://host.docker.internal:${API_PORT}" \
    -e "SENTRA_CONTROLLER_URL=http://host.docker.internal:${CONTROLLER_PORT}" \
    -e "SENTRA_DEMO_WORKLOAD_URL=http://host.docker.internal:${DEMO_PORT}" \
    -e "SENTRA_INTERNAL_PROMETHEUS_URL=${SENTRA_INTERNAL_PROMETHEUS_URL:-http://prometheus:9090}" \
    -e "SENTRA_INTERNAL_LOKI_URL=${SENTRA_INTERNAL_LOKI_URL:-http://loki:3100}" \
    -e "SENTRA_INTERNAL_TEMPO_URL=${SENTRA_INTERNAL_TEMPO_URL:-http://tempo:3200}" \
    -e "SENTRA_API_BEARER_TOKEN=${SENTRA_API_BEARER_TOKEN:-}" \
    -e "SENTRA_ACTION_TOKEN=${SENTRA_ACTION_TOKEN:-}" \
    -e "SENTRA_ACTION_HEADER=${SENTRA_ACTION_HEADER:-x-sentra-action-token}" \
    -e "SENTRA_ACTION_ACTOR_HEADER=${SENTRA_ACTION_ACTOR_HEADER:-x-sentra-actor}" \
    -e "SENTRA_CONTROLLER_BEARER_TOKEN=${SENTRA_CONTROLLER_BEARER_TOKEN:-}" \
    -e "SENTRA_TENANT_HEADER=${SENTRA_TENANT_HEADER:-x-sentra-tenant}" \
    node:20-alpine node scripts/verify-demo-workload-flow.mjs
fi
