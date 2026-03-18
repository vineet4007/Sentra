#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$ROOT_DIR/.env.example"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No .env or .env.example file found in $ROOT_DIR" >&2
  exit 1
fi

while IFS='=' read -r key value; do
  [[ -n "$key" ]] || continue
  [[ "$key" =~ ^# ]] && continue
  export "$key=$value"
done < "$ENV_FILE"

mysql_exec() {
  docker compose exec -T mysql \
    mysql -h127.0.0.1 -uroot -p"${MYSQL_ROOT_PASSWORD}" "${MYSQL_DATABASE}" "$@"
}

for file in "$ROOT_DIR"/db/migrations/*.sql; do
  [[ -f "$file" ]] || continue

  version="$(basename "$file" | cut -d '_' -f 1)"
  has_schema_table="$(mysql_exec -Nse "SHOW TABLES LIKE 'schema_migrations'" 2>/dev/null || true)"

  if [[ "$has_schema_table" == "schema_migrations" ]]; then
    already_applied="$(mysql_exec -Nse "SELECT 1 FROM schema_migrations WHERE version='${version}' LIMIT 1" 2>/dev/null || true)"
    if [[ "$already_applied" == "1" ]]; then
      echo "Skipping $(basename "$file") (already applied)"
      continue
    fi
  fi

  echo "Applying $(basename "$file")"
  mysql_exec < "$file"
done

echo "MySQL migrations applied."
