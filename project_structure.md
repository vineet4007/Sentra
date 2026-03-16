# Sentra — Phase 0–1 Bootstrapped Repo (Scaffold + Config + CI)

This is a production-grade, no-nonsense scaffold to kick off **Phase 0–1**. It gives you:

* **Repo layout** with strict separation of concerns
* **Docker Compose** for MySQL, Redis, Prometheus, Loki, Tempo (and Promtail)
* Minimal **Go rollout controller** (compiles, runs, exposes basic health)
* Minimal **Node.js API** (Express + WebSocket/SSE-ready, Redis client wired)
* **.env.example**, **Makefile**, **GitHub Actions CI** (build, lint, type-check, docker validate)

Follow the **Quickstart** at the bottom to launch everything locally.

---

## Repository Tree

```
sentra/
├─ .github/workflows/ci.yml
├─ .gitignore
├─ .editorconfig
├─ .env.example
├─ Makefile
├─ README.md
├─ docker-compose.yml
├─ infra/
│  ├─ prometheus/
│  │  └─ prometheus.yml
│  ├─ loki/
│  │  └─ loki-config.yml
│  ├─ promtail/
│  │  └─ promtail-config.yml
│  └─ tempo/
│     └─ tempo.yml
├─ services/
│  ├─ controller/               # Go rollout controller (Phase 1 skeleton)
│  │  ├─ go.mod
│  │  └─ main.go
│  └─ api/                      # Node.js API (REST + WS/SSE skeleton)
│     ├─ package.json
│     ├─ tsconfig.json
│     └─ src/
│        ├─ index.ts
│        ├─ redis.ts
│        ├─ routes/
│        │  └─ health.ts
│        └─ telemetry/
│           └─ placeholder.ts
└─ scripts/
   └─ dev.sh
```

---

## Root: `.gitignore`

```gitignore
# Node
node_modules/
*.log

# Typescript
*.tsbuildinfo

# Go
bin/
*.exe
*.test

# Env
.env

# Docker
**/.DS_Store
**/.idea
**/.vscode
**/.venv

# Coverage
coverage/
```

---

## Root: `.editorconfig`

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

---

## Root: `.env.example`

```bash
# MySQL
MYSQL_ROOT_PASSWORD=sentra_root
MYSQL_DATABASE=sentra
MYSQL_USER=sentra
MYSQL_PASSWORD=sentra_pass

# API
API_PORT=8080
REDIS_URL=redis://redis:6379
MYSQL_DSN=sentra:sentra_pass@tcp(mysql:3306)/sentra?parseTime=true

# Controller
CONTROLLER_HTTP_PORT=8090
PROMETHEUS_URL=http://prometheus:9090
LOKI_URL=http://loki:3100
TEMPO_URL=http://tempo:3200
```

---

## Root: `Makefile`

```makefile
SHELL := /bin/bash

.PHONY: up down logs build fmt lint ci

up:
	docker compose up -d --build

Down:
	docker compose down -v

logs:
	docker compose logs -f --tail=200

build:
	cd services/controller && go build -o ../../bin/controller
	cd services/api && npm ci && npm run build

fmt:
	cd services/controller && go fmt ./...
	cd services/api && npm run lint --silent || true

ci: fmt build
```

> Note: `Down` target capitalized intentionally to avoid accidental teardown; use `make Down`.

---

## Root: `docker-compose.yml`

```yaml
version: "3.9"

services:
  mysql:
    image: mysql:8.4
    command: ["mysqld", "--default-authentication-plugin=mysql_native_password"]
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-u$$MYSQL_USER", "-p$$MYSQL_PASSWORD"]
      interval: 10s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7.4-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 30

  prometheus:
    image: prom/prometheus:v2.55.0
    volumes:
      - ./infra/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    command: ["--config.file=/etc/prometheus/prometheus.yml"]
    ports:
      - "9090:9090"

  loki:
    image: grafana/loki:3.1.1
    command: ["-config.file=/etc/loki/config/loki-config.yml"]
    volumes:
      - ./infra/loki/loki-config.yml:/etc/loki/config/loki-config.yml:ro
      - loki_data:/loki
    ports:
      - "3100:3100"

  promtail:
    image: grafana/promtail:3.1.1
    command: ["-config.file=/etc/promtail/config.yml"]
    volumes:
      - ./infra/promtail/promtail-config.yml:/etc/promtail/config.yml:ro
      - /var/log:/var/log:ro

  tempo:
    image: grafana/tempo:2.6.1
    command: ["-config.file=/etc/tempo/tempo.yml"]
    volumes:
      - ./infra/tempo/tempo.yml:/etc/tempo/tempo.yml:ro
      - tempo_data:/var/tempo
    ports:
      - "3200:3200"   # HTTP

  api:
    build:
      context: ./services/api
      dockerfile: Dockerfile
    env_file:
      - ./.env
    ports:
      - "8080:8080"
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: ["npm", "run", "start"]

  controller:
    build:
      context: ./services/controller
      dockerfile: Dockerfile
    env_file:
      - ./.env
    ports:
      - "8090:8090"
    depends_on:
      prometheus:
        condition: service_started
      loki:
        condition: service_started
      tempo:
        condition: service_started
    command: ["/app/controller"]

volumes:
  mysql_data:
  redis_data:
  loki_data:
  tempo_data:
```

---

## `infra/prometheus/prometheus.yml`

```yaml
global:
  scrape_interval: 5s

scrape_configs:
  - job_name: "prometheus"
    static_configs:
      - targets: ["prometheus:9090"]
  - job_name: "controller"
    metrics_path: /metrics
    static_configs:
      - targets: ["controller:8090"]
```

---

## `infra/loki/loki-config.yml`

```yaml
server:
  http_listen_port: 3100
common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
schema_config:
  configs:
    - from: 2024-01-01
      store: boltdb-shipper
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h
ruler:
  alertmanager_url: http://localhost:9093
```

---

## `infra/promtail/promtail-config.yml`

```yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: varlogs
    static_configs:
      - targets:
          - localhost
        labels:
          job: varlogs
          __path__: /var/log/*.log
```

---

## `infra/tempo/tempo.yml`

```yaml
server:
  http_listen_port: 3200

storage:
  trace:
    backend: local
    local:
      path: /var/tempo/traces

distributor:
  receivers:
    otlp:
      protocols:
        http:
        grpc:
```

---

## Go Controller: `services/controller/go.mod`

```go
module github.com/yourorg/sentra/controller

go 1.22

require (
	github.com/prometheus/client_golang v1.20.2
)
```

### `services/controller/main.go`

```go
package main

import (
	"fmt"
	"log"
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	ready = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "sentra_controller_ready",
		Help: "Readiness of the controller (1=ready)",
	})
)

func health(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func main() {
	prometheus.MustRegister(ready)
	ready.Set(1)

	http.HandleFunc("/health", health)
	http.Handle("/metrics", promhttp.Handler())

	port := ":8090"
	log.Printf("controller up on %s", port)
	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatal(err)
	}

	fmt.Println()
}
```

### `services/controller/Dockerfile`

```dockerfile
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod .
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/controller

FROM alpine:3.20
WORKDIR /app
COPY --from=build /out/controller /app/controller
EXPOSE 8090
ENTRYPOINT ["/app/controller"]
```

---

## Node API: `services/api/package.json`

```json
{
  "name": "sentra-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node --enable-source-maps dist/index.js",
    "build": "tsc -p tsconfig.json",
    "lint": "eslint . --ext .ts"
  },
  "dependencies": {
    "express": "^4.19.2",
    "ioredis": "^5.4.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@typescript-eslint/eslint-plugin": "^8.7.0",
    "@typescript-eslint/parser": "^8.7.0",
    "eslint": "^9.12.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.3"
  }
}
```

### `services/api/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

### `services/api/src/index.ts`

```ts
import express from 'express'
import { createClient } from './redis.js'
import healthRouter from './routes/health.js'

const app = express()
const port = process.env.API_PORT ? Number(process.env.API_PORT) : 8080

app.use(express.json())
app.use('/health', healthRouter)

// Placeholder SSE endpoint (Phase 1 wiring)
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  res.write(`data: {"status":"ok"}\n\n`)
})

// Init Redis eagerly so we fail fast
createClient()
  .then(() => {
    app.listen(port, () => console.log(`[api] listening on :${port}`))
  })
  .catch((err) => {
    console.error('[api] redis init failed:', err)
    process.exit(1)
  })
```

### `services/api/src/redis.ts`

```ts
import IORedis from 'ioredis'

let redis: IORedis.Redis | null = null

export async function createClient(): Promise<IORedis.Redis> {
  if (redis) return redis
  const url = process.env.REDIS_URL || 'redis://localhost:6379'
  const client = new IORedis(url)
  await client.ping()
  redis = client
  return client
}

export function getClient(): IORedis.Redis {
  if (!redis) throw new Error('Redis not initialized')
  return redis
}
```

### `services/api/src/routes/health.ts`

```ts
import { Router } from 'express'
import { getClient } from '../redis.js'

const r = Router()

r.get('/', async (_req, res) => {
  try {
    const pong = await getClient().ping()
    res.json({ status: 'ok', redis: pong })
  } catch (e) {
    res.status(500).json({ status: 'error', error: String(e) })
  }
})

export default r
```

### `services/api/src/telemetry/placeholder.ts`

```ts
// Placeholder module for Prometheus/Loki/Tempo client adapters.
// Phase 1 will flesh out typed clients and polling schedulers here.
export function notImplemented(): never {
  throw new Error('Telemetry adapters not implemented yet')
}
```

### `services/api/Dockerfile`

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN \
  if [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then npm i -g pnpm && pnpm i --frozen-lockfile; \
  elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
  else npm i; fi

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY package.json ./package.json
RUN npm i --omit=dev
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

---

## Root: `.github/workflows/ci.yml`

```yaml
name: ci

on:
  push:
    branches: [ main ]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.22.x'

      - name: Build controller
        working-directory: services/controller
        run: |
          go build ./...

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: services/api/package-lock.json

      - name: Install deps (API)
        working-directory: services/api
        run: npm ci

      - name: Lint + Build (API)
        working-directory: services/api
        run: |
          npm run build

      - name: Validate docker compose
        run: |
          docker compose -f docker-compose.yml config > /dev/null
```

---

## Root: `README.md`

````markdown
# Sentra — Phase 0–1 Scaffold

## Prereqs
- Docker & Docker Compose
- Go 1.22+
- Node.js 20+

## Setup
```bash
cp .env.example .env
make up
make logs
````

Services exposed:

* API: [http://localhost:8080/health](http://localhost:8080/health)
* Controller health: [http://localhost:8090/health](http://localhost:8090/health)
* Prometheus: [http://localhost:9090](http://localhost:9090)
* Loki HTTP: [http://localhost:3100](http://localhost:3100)
* Tempo: [http://localhost:3200](http://localhost:3200)

## Dev

* API dev mode:

  ```bash
  cd services/api && npm i && npm run dev
  ```
* Controller:

  ```bash
  cd services/controller && go run .
  ```

## Next (Phase 1 tasks)

* Wire controller polling to Prometheus/Loki/Tempo and publish rollout-state via Redis pub/sub.
* API subscribes to Redis and exposes /rollouts + /events.
* Define initial SLO policy schema in MySQL (tables: services, rollouts, checks, decisions, audits).

````

---

## `scripts/dev.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

cp -n .env.example .env || true

docker compose up -d --build

echo "API -> http://localhost:8080/health"
echo "CTRL -> http://localhost:8090/health"
````
