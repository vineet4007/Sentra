# Sentra Operations Runbook

This runbook covers the first production-adjacent safeguards for the self-hosted Docker Compose deployment.

## Edge TLS

Run Sentra behind a TLS-terminating reverse proxy such as Caddy, NGINX, Traefik, or a cloud load balancer.

- Terminate HTTPS before traffic reaches the `web` service.
- Keep `api`, `controller`, MySQL, Redis, Prometheus, Loki, and Tempo on private networks.
- Set `SENTRA_CORS_ORIGINS` to the public web origin, for example `https://sentra.example.com`.
- Set `SENTRA_TRUST_PROXY=true` only when the API is behind a trusted proxy that sets forwarding headers.
- Keep `SENTRA_API_BEARER_TOKEN`, `SENTRA_ACTION_TOKEN`, and `SENTRA_CONTROLLER_BEARER_TOKEN` non-empty outside local development.

## API Request Guardrails

The API has built-in CORS and in-memory rate limiting.

- `SENTRA_CORS_ORIGINS`: comma-separated allowed browser origins.
- `SENTRA_CORS_ALLOW_CREDENTIALS`: whether to send credentialed CORS responses.
- `SENTRA_RATE_LIMIT_ENABLED`: set to `false` only for controlled local debugging.
- `SENTRA_RATE_LIMIT_WINDOW_SEC`: rate-limit window size.
- `SENTRA_RATE_LIMIT_MAX`: requests allowed per client IP in the window.
- `SENTRA_JSON_BODY_LIMIT`: JSON body size limit.

For multi-replica API deployments, use the same settings at the reverse proxy or gateway too, because the built-in limiter is per process.

## Graceful Shutdown

The API and controller now handle `SIGTERM` and `SIGINT`.

- API shutdown closes active SSE streams, stops accepting new HTTP requests, and closes Redis/MySQL clients.
- Controller shutdown stops background telemetry, satellite heartbeat, and task polling loops through context cancellation.
- `SENTRA_SHUTDOWN_GRACE_SEC` controls the API grace period.

## Database Backup

Create a timestamped local backup from the running Compose stack:

```bash
make db-backup
```

Backups are written under `backups/`.

Restore a backup into the running Compose stack:

```bash
make db-restore BACKUP_FILE=backups/sentra-20260327T060755Z.sql
```

Before restoring shared or production data, stop write traffic to the API and keep a copy of the current database volume or latest dump.

## Migrations

Fresh MySQL volumes apply files from `db/migrations/` automatically. Existing databases should be migrated with:

```bash
make db-migrate
```

For production, take a database backup before running migrations and verify `schema_migrations` afterward.

## Container Health

The API, controller, web, and AI images include Docker health checks. The Compose stack already includes MySQL and Redis health checks.

Use:

```bash
docker compose ps
```

to confirm container health before running smoke or regression checks.
