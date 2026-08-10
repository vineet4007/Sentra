#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-clean-smoke}"
PROJECT_NAME="sentra-clean-smoke-$RANDOM"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sentra-selfhosted-smoke.XXXXXX")"

cleanup() {
  local status=$?
  if [[ -n "${BUNDLE_DIR:-}" && -d "${BUNDLE_DIR:-}" ]]; then
    if [[ "${status}" -ne 0 ]]; then
      (
        cd "${BUNDLE_DIR}"
        echo "Clean bundle smoke failed; dumping container status and web/API logs..." >&2
        docker compose -p "${PROJECT_NAME}" \
          -f docker-compose.yml \
          -f deploy/selfhosted/docker-compose.selfhosted.yml \
          ps >&2 || true
        docker compose -p "${PROJECT_NAME}" \
          -f docker-compose.yml \
          -f deploy/selfhosted/docker-compose.selfhosted.yml \
          logs --tail=160 web api >&2 || true
      )
    fi
    (
      cd "${BUNDLE_DIR}"
      docker compose -p "${PROJECT_NAME}" \
        -f docker-compose.yml \
        -f deploy/selfhosted/docker-compose.selfhosted.yml \
        down -v --remove-orphans >/dev/null 2>&1 || true
    )
  fi
  rm -rf "${WORK_DIR}"
  return "${status}"
}
trap cleanup EXIT

bash "${ROOT_DIR}/scripts/package-selfhosted.sh" "${VERSION}"

ARCHIVE_PATH="${ROOT_DIR}/dist/sentra-selfhosted-${VERSION}.tar.gz"
tar -xzf "${ARCHIVE_PATH}" -C "${WORK_DIR}"
BUNDLE_DIR="${WORK_DIR}/sentra-selfhosted-${VERSION}"

set_env() {
  local key="$1"
  local value="$2"
  local env_file="${BUNDLE_DIR}/.env"
  local tmp_file="${env_file}.tmp"

  if grep -q "^${key}=" "${env_file}"; then
    awk -v key="${key}" -v value="${value}" '
      BEGIN { prefix = key "=" }
      index($0, prefix) == 1 { print key "=" value; next }
      { print }
    ' "${env_file}" > "${tmp_file}"
    mv "${tmp_file}" "${env_file}"
    return
  fi

  printf '%s=%s\n' "${key}" "${value}" >> "${env_file}"
}

set_env MYSQL_HOST_PORT 13306
set_env REDIS_HOST_PORT 16379
set_env SENTRA_AI_HOST_PORT 18000
set_env SENTRA_API_HOST_PORT 18080
set_env SENTRA_WEB_HOST_PORT 13000
set_env SENTRA_CONTROLLER_HOST_PORT 18090
set_env SENTRA_PROMETHEUS_HOST_PORT 19090
set_env SENTRA_LOKI_HOST_PORT 13100
set_env SENTRA_TEMPO_HOST_PORT 13200
set_env SENTRA_CORS_ORIGINS http://localhost:13000,http://127.0.0.1:13000
set_env SENTRA_RATE_LIMIT_BACKEND redis
set_env SENTRA_RATE_LIMIT_REDIS_PREFIX sentra:clean-smoke:rate-limit
set_env SENTRA_API_BEARER_TOKEN ''
set_env SENTRA_OIDC_ISSUER ''
set_env SENTRA_OIDC_AUDIENCE ''
set_env SENTRA_OIDC_JWKS_URL ''
set_env SENTRA_OIDC_DISCOVERY_URL ''
set_env SENTRA_RBAC_ENABLED false
set_env SENTRA_RBAC_ACTION_TOKEN_FALLBACK true
set_env SENTRA_ACTION_TOKEN ''
set_env SENTRA_CONTROLLER_BEARER_TOKEN ''
set_env SENTRA_REQUIRE_TENANT false

(
  cd "${BUNDLE_DIR}"
  docker compose -p "${PROJECT_NAME}" \
    -f docker-compose.yml \
    -f deploy/selfhosted/docker-compose.selfhosted.yml \
    up -d --build
)

wait_for_url() {
  local label="$1"
  local url="$2"
  local expected="$3"

  for _ in $(seq 1 60); do
    local response=""
    if response="$(curl -fsS "${url}" 2>/dev/null)" && [[ "${response}" == *"${expected}"* ]]; then
      echo "${label} is ready"
      return
    fi
    sleep 2
  done

  echo "Timed out waiting for ${label} at ${url}" >&2
  exit 1
}

wait_for_url "API" "http://localhost:18080/health" '"status":"ok"'
wait_for_url "Controller" "http://localhost:18090/health" 'ok'
wait_for_url "AI" "http://localhost:18000/health" '"status":"ok"'
wait_for_url "Web" "http://localhost:13000" '<html'

SENTRA_API_URL=http://localhost:18080 \
SENTRA_CONTROLLER_URL=http://localhost:18090 \
SENTRA_PROMETHEUS_URL=http://localhost:19090 \
SENTRA_LOKI_URL=http://localhost:13100 \
SENTRA_TEMPO_URL=http://localhost:13200 \
SENTRA_AI_URL_HOST=http://localhost:18000 \
  "${ROOT_DIR}/scripts/smoke-local-stack.sh"

echo "Self-hosted bundle smoke checks passed for ${ARCHIVE_PATH}"
