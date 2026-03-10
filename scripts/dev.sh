#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== Building extension ==="
npm run dev

echo ""
echo "=== Starting database ==="
if docker compose ps --status running 2>/dev/null | grep -q postgres; then
  echo "PostgreSQL already running, restarting..."
  docker compose restart
else
  docker compose up -d
fi

echo ""
echo "Waiting for PostgreSQL to be healthy..."
timeout 30 bash -c 'until docker inspect --format="{{.State.Health.Status}}" gitrx-postgres 2>/dev/null | grep -q healthy; do sleep 1; done' \
  && echo "PostgreSQL is ready." \
  || echo "WARNING: PostgreSQL health check timed out after 30s."

echo ""
echo "========================================="
echo "  Now press F5 in VS Code to launch"
echo "========================================="
