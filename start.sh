#!/bin/sh
# SubarnaPasal — one-command local dev.
# Usage:  sh start.sh      (from the project root)
# Starts the API server (port 8080) and the frontend (http://localhost:19951).
set -e

cd "$(dirname "$0")"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is not installed. Install it with:  npm install -g pnpm"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run)..."
  pnpm install
fi

echo "Starting API server on port ${PORT:-8080}..."
pnpm --filter @workspace/api-server run dev &
API_PID=$!

cleanup() {
  echo "Stopping API server..."
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Give the API server a moment to build and boot
sleep 5

echo "Starting frontend at http://localhost:19951 ..."
pnpm --filter @workspace/subarnapasal run dev
