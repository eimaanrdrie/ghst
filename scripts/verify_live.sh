#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_DB="/tmp/ghst_live_${$}.db"
export DATABASE_URL="sqlite:///${LIVE_DB}"
export DEMO_MODE="true"
export JWT_SECRET="live-check-jwt-secret-with-more-than-32-characters"
export PROMPT_HMAC_KEY="live-check-hmac-secret-with-more-than-32-characters"

cleanup() {
  kill "${API_PID:-0}" "${WEB_PID:-0}" 2>/dev/null || true
  rm -f "${LIVE_DB}"
}
trap cleanup EXIT

cd "${ROOT}/backend"
"${ROOT}/.venv/bin/python" -m app.db.seed >/tmp/ghst-seed.log
"${ROOT}/.venv/bin/uvicorn" app.main:app --host 127.0.0.1 --port 8000 >/tmp/ghst-api.log 2>&1 &
API_PID=$!

cd "${ROOT}/frontend"
"${ROOT}/.venv/bin/python" -m http.server 3000 --directory out --bind 127.0.0.1 >/tmp/ghst-web.log 2>&1 &
WEB_PID=$!

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/api/v1/health/live >/dev/null && curl -fsS http://127.0.0.1:3000/ >/dev/null; then
    break
  fi
  sleep 0.5
done

cd "${ROOT}"
"${ROOT}/.venv/bin/python" scripts/live_demo_check.py
