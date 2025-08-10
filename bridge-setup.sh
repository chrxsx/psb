#!/usr/bin/env bash
set -euo pipefail

: "${ENCRYPTION_KEY:?ENCRYPTION_KEY must be set (64 hex chars)}"
: "${REDIS_URL:?REDIS_URL must be set (e.g. redis://...)}"
: "${BRIDGE_BASE_URL:=http://localhost:8080}"
: "${ALLOWED_ORIGIN:=http://localhost:8082}"
: "${FRONTEND_BASE_URL:=${ALLOWED_ORIGIN}}"

echo "Environment looks good."

echo "Starting PSB (bridge + worker + redis) via docker compose..."
docker compose up --build