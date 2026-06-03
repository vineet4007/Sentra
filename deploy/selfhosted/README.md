# Sentra Self-Hosted Bundle

This bundle is the first packaging slice for Sentra's self-hosted deployment model.

It is meant for operators who want to unpack one archive, fill in environment values, and start Sentra with Docker Compose.

## What is included

- `docker-compose.yml` as the base stack definition
- `deploy/selfhosted/docker-compose.selfhosted.yml` as a runtime overlay
- `deploy/selfhosted/.env.production.example` as the production-oriented env template
- API, controller, and web source trees so the stack can build locally
- Database migrations, observability config, and verification scripts

## Install

1. Unpack the archive on the target machine.
2. Copy `deploy/selfhosted/.env.production.example` to `.env`.
3. Replace placeholder secrets and review ports, tokens, and tenancy settings.
4. Start the stack:

```bash
docker compose -f docker-compose.yml -f deploy/selfhosted/docker-compose.selfhosted.yml up -d --build
```

5. Run the smoke check:

```bash
bash scripts/smoke-local-stack.sh
```

## What the overlay changes

- Sets `restart: unless-stopped` for packaged services
- Adds container log rotation defaults
- Keeps the existing local architecture intact so the current repo still matches the packaged runtime

## Recommended production follow-up

- Move real credentials out of `.env` and into a secret manager or workload identity flow
- Put the web surface behind TLS and your preferred reverse proxy
- Set `SENTRA_CORS_ORIGINS` to the public Sentra web origin and keep API/controller endpoints private
- Use SSO or a trusted auth proxy to inject the configured Sentra action-authority header only for approved operators
- Restrict direct controller and observability endpoints at the network layer
- Replace local-only example integration values with real cluster or cloud target config
- Use `make db-backup` and `make db-restore BACKUP_FILE=...` for the first Compose-level backup/restore workflow
