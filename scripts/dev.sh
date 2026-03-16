#!/usr/bin/env bash
set -euo pipefail

cp -n .env.example .env || true

docker compose up -d --build

echo "API -> http://localhost:8080/health"
echo "CTRL -> http://localhost:8090/health"
