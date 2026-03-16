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