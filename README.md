# Retell Hotel Agent Backend (LLM + Rules)

**Features**
- LLM-basierte Slot-Extraktion mit Rule-Fallback
- Caching, Circuit Breaker, Concurrency-Limit
- Public/Tool-Endpoints für Retell & andere Kanäle
- Render.com-ready

## Endpoints
- `GET /healthz`
- `POST /retell/public/extract_core` (rules)
- `POST /retell/tool/extract_core_llm` (LLM, Header `tool-secret`)
- `POST /retell/tool/check_availability_slim` (Header `tool-secret`)
- `POST /retell/public/quote`
- `POST /retell/tool/commit_booking` (Header `tool-secret`)
- `POST /retell/tool/send_offer` (Header `tool-secret`)

## Deploy (Render.com)
1. Repo pushen mit `server.js`, `package.json`, `render.yaml`.
2. Render erstellt Service via `render.yaml`.
3. Im Dashboard `TOOL_SECRET` und `LLM_API_KEY` setzen (Environment → Add Secret).
4. StartCommand: `node server.js` (steht schon in render.yaml).

## Retell Tools
Importiere `tools.json` in Retell und setze bei allen `/retell/tool/*` Tools den Header `tool-secret`.

## Flow
Optionaler Flow für Import: `flow_v009.json` (nutzt `tool-extract-core-llm`).

## Smoke Tests
```bash
# Health
curl -s https://<your-service>.onrender.com/healthz | jq .

# Rule parser
curl -s -X POST https://<your-service>.onrender.com/retell/public/extract_core   -H 'content-type: application/json'   -d '{"utterance":"Ich will vom 22.10. bis 24.10. für 1 Person, keine Kinder buchen."}' | jq .

# LLM parser
curl -s -X POST https://<your-service>.onrender.com/retell/tool/extract_core_llm   -H 'content-type: application/json' -H 'tool-secret: YOUR_SECRET'   -d '{"utterance":"Ich will vom 22.10. bis 24.10. für 1 Person, keine Kinder buchen."}' | jq .

# Availability
curl -s -X POST https://<your-service>.onrender.com/retell/tool/check_availability_slim   -H 'content-type: application/json' -H 'tool-secret: YOUR_SECRET'   -d '{"from_date":"2025-10-22","to_date":"2025-10-24","adults":1,"children":0}' | jq .
```

## Env
Siehe `.env.example`. In Produktion unbedingt `TOOL_SECRET` setzen.
