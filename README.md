# 🏨 Retell AI Hotel Agent Backend v2.5.0

A minimal, production-ready Express backend for a Retell AI hotel voice agent with:
- Zod-validated configuration
- Prometheus metrics (`/metrics`)
- Health check (`/healthz`)
- Public routes under `/retell/public`
- Tool routes under `/retell/tool` protected by `TOOL_SECRET`
- Pino structured logging

## Quickstart

```bash
# 1) Put your settings in .env (see .env.example)
cp .env.example .env && edit .env

# 2) Install deps
npm install

# 3) Start (dev watch)
bash start.sh dev
# or: npm run dev

# 4) Smoke tests
curl -s http://localhost:$PORT/healthz
curl -s http://localhost:$PORT/retell/public/ping
curl -s -H "Authorization: Bearer $TOOL_SECRET" http://localhost:$PORT/retell/tool/whoami
curl -s http://localhost:$PORT/metrics | head -n 20
```

## Routes

- `GET /healthz` — liveness
- `GET /metrics` — Prometheus metrics
- `GET /retell/public/ping` — simple ping
- `POST /retell/public/echo` — echoes posted JSON
- `GET /retell/tool/whoami` — requires `TOOL_SECRET`
- `POST /retell/tool/echo` — requires `TOOL_SECRET`
- `POST /retell/tool/retell-check` — validates `RETELL_API_KEY` presence

## Config

Configuration is validated via Zod in `src/config.js`.

| Var             | Required | Default | Notes |
|-----------------|----------|---------|-------|
| `NODE_ENV`      | no       | `dev`   | `dev`, `development`, `test`, `production` |
| `PORT`          | no       | `10000` | HTTP port |
| `CORS_ORIGIN`   | no       | `*`     | Comma-separated list or `*` |
| `TOOL_SECRET`   | yes(*)   | —       | Required for `/retell/tool/*` |
| `ENABLE_LLM`    | no       | `0`     | Toggle optional LLM usage |
| `RETELL_API_KEY`| no       | —       | Needed for real Retell calls |

(*) Tool routes will return 503 if not configured.

## Production Notes

- Run behind a reverse proxy (TLS, rate limiting, `X-Forwarded-For`).
- Scrape `/metrics` with Prometheus / Grafana.
- Set `LOG_LEVEL=info` (or `warn`) in production.
- Use a stable `CORS_ORIGIN` instead of `*` for web clients.
- Keep secrets in your vault (not in Git).

