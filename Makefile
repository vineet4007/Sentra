SHELL := /bin/bash

.PHONY: up down logs build fmt lint ci db-migrate smoke integration verify

up:
	docker compose up -d --build

down:
	docker compose down -v

logs:
	docker compose logs -f --tail=200

build:
	cd services/controller && go build -o ../../bin/controller
	cd services/api && npm ci && npm run build
	cd services/web && npm ci && npm run build

fmt:
	cd services/controller && go fmt ./...
	cd services/api && npm run lint --silent || true
	cd services/web && npm run lint --silent || true

ci: fmt build

db-migrate:
	bash scripts/apply-mysql-migrations.sh

smoke:
	bash scripts/smoke-local-stack.sh

integration:
	node scripts/verify-rollout-flow.mjs

verify: smoke integration
