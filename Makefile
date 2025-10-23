SHELL := /bin/bash
bootstrap:
	@echo "Installing local deps"
	@command -v pnpm >/dev/null 2>&1 || npm i -g pnpm
	@pnpm -C apps/gateway-node i || true
	@pnpm -C apps/worker-node i || true
infra-up:
	docker compose -f deploy/local/docker-compose.yml up -d
infra-down:
	docker compose -f deploy/local/docker-compose.yml down -v
