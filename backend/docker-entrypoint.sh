#!/bin/sh
set -e

SEED_DIR="/app/backend/catalog-cache-seed"
CACHE_DIR="/app/backend/data/cache"

if [ -d "$SEED_DIR" ] && [ ! -f "$CACHE_DIR/manifest.json" ]; then
  echo "Seeding catalog cache from built image..."
  mkdir -p "$CACHE_DIR"
  cp -a "$SEED_DIR/." "$CACHE_DIR/"
fi

mkdir -p "$CACHE_DIR" /app/imports

exec "$@"
