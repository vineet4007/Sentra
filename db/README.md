# Sentra Database Notes

This folder holds the control-plane schema for Sentra.

## Migration Approach

- SQL files in `db/migrations/` are mounted into MySQL at `/docker-entrypoint-initdb.d` for fresh local databases.
- If the MySQL volume already exists, run `make db-migrate` to apply the same migrations to the running container.
- Migrations are written to be safe to re-run locally with `CREATE TABLE IF NOT EXISTS` and `INSERT IGNORE`.

## Service Ownership

| Table | Primary writer | Primary readers | Notes |
| --- | --- | --- | --- |
| `projects` | API | API, Controller | API owns onboarding metadata. |
| `services` | API | API, Controller | API owns service registration and adapter type selection. |
| `environments` | API | API, Controller | API owns deployment target config, telemetry source config, labels, and secret refs. |
| `policies` | API | API, Controller | API owns rollout policy and SLO configuration. |
| `deployments` | API creates, Controller updates runtime state | API, Controller | API records deployment intent; controller updates live status, weights, and final outcome. |
| `rollout_steps` | Controller | API, Controller | Controller records each step evaluation and decision. |
| `incidents` | Controller | API, Controller | Controller records regressions, pauses, and rollback triggers. |
| `audit_events` | API and Controller | API, Controller | API writes user-initiated audit events; controller writes system decisions and actions. |
| `ai_advisories` | API | API, Web | Persisted shadow-mode AI advisory snapshots used for rollout history, anomaly review, prediction scoring, and primary-vs-candidate model comparison via the `series` column. |
| `satellites` | API | API, Controller | Global coordinator registry for federated satellite heartbeats, capabilities, and freshness. |
| `satellite_tasks` | API queues, Controller completes | API, Controller | Coordinator-owned delegated execution queue for federated satellite reconcile work and reported results. |
| `schema_migrations` | Migration runner | API, Controller | Tracks which schema files have been applied. |

## Local Workflow

- Fresh local start: `cp .env.example .env` then `make up`
- Existing MySQL volume: `make db-migrate`
- Quick validation: `docker compose exec -T mysql mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "SHOW TABLES;"`
