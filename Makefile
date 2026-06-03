SHELL := /bin/bash

.PHONY: up down logs build fmt lint ci db-migrate db-backup db-restore smoke integration multiservice federation verify regression package ai-test ai-benchmark ai-dataset ai-train-profile

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

ai-test:
	docker compose run --rm --no-deps ai python -m unittest discover -s tests

ai-benchmark:
	node scripts/generate-ai-benchmark-report.mjs

ai-dataset:
	node scripts/export-ai-training-dataset.mjs

ai-train-profile:
	node scripts/train-ai-risk-profile.mjs

fmt:
	cd services/controller && go fmt ./...
	cd services/api && npm run lint --silent || true
	cd services/web && npm run lint --silent || true

ci: fmt build

db-migrate:
	bash scripts/apply-mysql-migrations.sh

db-backup:
	@mkdir -p backups
	docker compose exec -T mysql sh -lc 'mysqldump -u"$$MYSQL_USER" -p"$$MYSQL_PASSWORD" "$$MYSQL_DATABASE"' > backups/sentra-$$(date -u +%Y%m%dT%H%M%SZ).sql

db-restore:
	@test -n "$(BACKUP_FILE)" || (echo "Set BACKUP_FILE=path/to/backup.sql" && exit 1)
	docker compose exec -T mysql sh -lc 'mysql -u"$$MYSQL_USER" -p"$$MYSQL_PASSWORD" "$$MYSQL_DATABASE"' < "$(BACKUP_FILE)"

smoke:
	bash scripts/smoke-local-stack.sh

integration:
	node scripts/verify-rollout-flow.mjs

multiservice:
	node scripts/verify-multi-service-flow.mjs

federation:
	bash scripts/verify-federation-flow.sh

verify: smoke integration multiservice federation

regression:
	bash scripts/run-regression-suite.sh

package:
	bash scripts/package-selfhosted.sh
