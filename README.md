# Retell Agent — Unified Header `tool-secret`

## Start (lokal)
```bash
npm install
cp .env.example .env
# setze dein Secret
echo 'TOOL_SECRET=MYSECRET123' > .env
npm start
```

## Test
```bash
curl -s http://localhost:10000/healthz

curl -s -X POST http://localhost:10000/retell/tool/list_rooms \
  -H 'content-type: application/json' \
  -H 'tool-secret: MYSECRET123'

curl -s -X POST http://localhost:10000/retell/tool/check_availability \
  -H 'content-type: application/json' \
  -H 'tool-secret: MYSECRET123' \
  -d '{"from_date":"2025-10-20","to_date":"2025-10-22","adults":2}'
```
