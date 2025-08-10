#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${ENCRYPTION_KEY:-}" ]]; then
  echo "ENCRYPTION_KEY is required (32-byte hex, 64 chars)" >&2
  exit 1
fi

export ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-http://localhost:8082}"
export FRONTEND_BASE_URL="${FRONTEND_BASE_URL:-$ALLOWED_ORIGIN}"

echo "Starting PSB (bridge + worker + redis) via docker compose..."
docker compose up --build