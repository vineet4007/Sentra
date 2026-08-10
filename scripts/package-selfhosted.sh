#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
VERSION_INPUT="${1:-}"

if [[ -n "${VERSION_INPUT}" ]]; then
  VERSION="${VERSION_INPUT}"
else
  VERSION="${TIMESTAMP}"
fi

BUNDLE_NAME="sentra-selfhosted-${VERSION}"
STAGE_DIR="${DIST_DIR}/${BUNDLE_NAME}"
ARCHIVE_PATH="${DIST_DIR}/${BUNDLE_NAME}.tar.gz"

GIT_COMMIT="unknown"
if command -v git >/dev/null 2>&1; then
  if GIT_VALUE="$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null)"; then
    GIT_COMMIT="${GIT_VALUE}"
  fi
fi

mkdir -p "${DIST_DIR}"
rm -rf "${STAGE_DIR}" "${ARCHIVE_PATH}"
mkdir -p "${STAGE_DIR}"

copy_into_bundle() {
  local source_path="$1"
  local destination_dir
  destination_dir="$(dirname "${source_path}")"
  mkdir -p "${STAGE_DIR}/${destination_dir}"
  if [[ -d "${ROOT_DIR}/${source_path}" ]]; then
    tar -C "${ROOT_DIR}" \
      --exclude='node_modules' \
      --exclude='*/node_modules' \
      --exclude='.next' \
      --exclude='*/.next' \
      --exclude='dist' \
      --exclude='*/dist' \
      --exclude='coverage' \
      --exclude='*/coverage' \
      --exclude='bin' \
      --exclude='*/bin' \
      --exclude='__pycache__' \
      --exclude='*/__pycache__' \
      --exclude='*.pyc' \
      --exclude='*.pyo' \
      --exclude='.DS_Store' \
      --exclude='*/.DS_Store' \
      --exclude='*.log' \
      -cf - "${source_path}" | tar -xf - -C "${STAGE_DIR}"
    return
  fi

  cp -R "${ROOT_DIR}/${source_path}" "${STAGE_DIR}/${source_path}"
}

INCLUDE_PATHS=(
  ".editorconfig"
  ".env.example"
  "README.md"
  "Makefile"
  "docker-compose.yml"
  "db"
  "deploy"
  "examples"
  "infra"
  "scripts"
  "services/ai"
  "services/api"
  "services/controller"
  "services/web"
)

for path in "${INCLUDE_PATHS[@]}"; do
  copy_into_bundle "${path}"
done

cp "${STAGE_DIR}/deploy/selfhosted/.env.production.example" "${STAGE_DIR}/.env"

cat > "${STAGE_DIR}/BUNDLE_MANIFEST.json" <<EOF
{
  "bundleName": "${BUNDLE_NAME}",
  "createdAt": "${TIMESTAMP}",
  "gitCommit": "${GIT_COMMIT}",
  "packagingMode": "selfhosted-compose",
  "envFile": ".env",
  "entrypoint": "docker compose -f docker-compose.yml -f deploy/selfhosted/docker-compose.selfhosted.yml up -d --build"
}
EOF

tar -czf "${ARCHIVE_PATH}" -C "${DIST_DIR}" "${BUNDLE_NAME}"

for required_path in \
  ".env" \
  "README.md" \
  "docker-compose.yml" \
  "deploy/selfhosted/.env.production.example" \
  "deploy/selfhosted/docker-compose.selfhosted.yml" \
  "services/ai" \
  "services/api" \
  "services/controller" \
  "services/web"; do
  if [[ ! -e "${STAGE_DIR}/${required_path}" ]]; then
    echo "missing required bundle path: ${required_path}" >&2
    exit 1
  fi
done

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  (
    cd "${STAGE_DIR}"
    docker compose -f docker-compose.yml -f deploy/selfhosted/docker-compose.selfhosted.yml config >/dev/null
  )
else
  echo "Skipping bundle Compose config smoke: docker compose is not available"
fi

echo "Created ${ARCHIVE_PATH}"
