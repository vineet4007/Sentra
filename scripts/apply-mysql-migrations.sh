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

for file in "$ROOT_DIR"/db/migrations/*.sql; do
  [[ -f "$file" ]] || continue
  echo "Applying $(basename "$file")"
  docker compose exec -T mysql \
    mysql -h127.0.0.1 -uroot -p"${MYSQL_ROOT_PASSWORD}" "${MYSQL_DATABASE}" < "$file"
done

echo "MySQL migrations applied."
