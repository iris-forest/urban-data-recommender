#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
PNPM_VERSION="${PNPM_VERSION:-11.0.5}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python is required. Install Python 3, then rerun ./scripts/setup.sh." >&2
  exit 1
fi

if ! command -v corepack >/dev/null 2>&1; then
  echo "Node.js 22 with Corepack is required. Install Node.js 22, then rerun ./scripts/setup.sh." >&2
  exit 1
fi

if [[ ! -d "$ROOT_DIR/.venv" ]]; then
  "$PYTHON_BIN" -m venv "$ROOT_DIR/.venv"
fi

"$ROOT_DIR/.venv/bin/pip" install -r "$ROOT_DIR/backend/requirements.txt"

cd "$ROOT_DIR/frontend"
corepack enable
corepack prepare "pnpm@${PNPM_VERSION}" --activate
pnpm install --frozen-lockfile --store-dir .pnpm-store
