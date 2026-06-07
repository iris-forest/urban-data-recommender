#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
VITE_API_BASE_URL="${VITE_API_BASE_URL:-/backend}"
VITE_BACKEND_PROXY_TARGET="${VITE_BACKEND_PROXY_TARGET:-http://${BACKEND_HOST}:${BACKEND_PORT}}"
PIDS=()

if [[ ! -x "$ROOT_DIR/.venv/bin/python" ]]; then
  echo "Missing .venv. Run ./scripts/setup.sh first." >&2
  exit 1
fi

if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
  echo "Missing frontend/node_modules. Run ./scripts/setup.sh first." >&2
  exit 1
fi

cleanup() {
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT INT TERM

cd "$ROOT_DIR/backend"
../.venv/bin/python -m uvicorn app.api:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" --reload &
PIDS+=("$!")

cd "$ROOT_DIR/frontend"
VITE_API_BASE_URL="${VITE_API_BASE_URL}" \
VITE_BACKEND_PROXY_TARGET="${VITE_BACKEND_PROXY_TARGET}" \
pnpm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" &
PIDS+=("$!")

while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"
      exit $?
    fi
  done
  sleep 1
done
