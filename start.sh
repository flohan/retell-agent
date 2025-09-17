#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-dev}"

# Colors
GREEN="\033[0;32m"; RED="\033[0;31m"; NC="\033[0m"

# Load dotenv (server also loads it, this is for banner only)
if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs -I {} echo {} | sed 's/\r$//') || true
fi

NODE_ENV="${NODE_ENV:-dev}"
PORT="${PORT:-10000}"
TOOL_SECRET="${TOOL_SECRET:-}"
ENABLE_LLM="${ENABLE_LLM:-0}"

echo -e "🏨 Retell AI Hotel Agent Backend v2.5.0"
echo -e "========================================${NC}"
echo -e "✅ Node.js $(node -v)"
echo -e "✅ Environment configured"
echo -e "📋 Configuration:"
echo -e "   Port: ${PORT}"
echo -e "   Mode: ${MODE}"
if [ -n "${TOOL_SECRET}" ]; then
  echo -e "   Tool Secret: ✓ Configured"
else
  echo -e "   Tool Secret: ✗ Missing"
fi
if [ "${ENABLE_LLM}" = "1" ]; then
  echo -e "   LLM API: ✓ Enabled"
else
  echo -e "   LLM API: ✗ Disabled"
fi

echo
echo -e "🚀 Starting server in ${MODE} mode..."
echo -e "   URL: http://localhost:${PORT}"
echo -e "   Health: http://localhost:${PORT}/healthz"
echo -e "   Logs: Watching for changes..."

if [ "${MODE}" = "prod" ]; then
  exec npm start
else
  exec npm run dev
fi
