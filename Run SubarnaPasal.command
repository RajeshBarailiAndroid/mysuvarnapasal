#!/bin/bash
# SubarnaPasal (Kotlin) — double-click me to start the app
cd "$(dirname "$0")" || exit 1

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Opening the download page..."
  open "https://www.docker.com/products/docker-desktop/"
  echo "Install Docker Desktop, open it once, then double-click this file again."
  read -r -p "Press Enter to close..."
  exit 1
fi

# Make sure Docker Desktop is running
if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker Desktop..."
  open -a Docker
  echo -n "Waiting for Docker to be ready"
  for i in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    echo -n "."
    sleep 2
  done
  echo ""
  docker info >/dev/null 2>&1 || { echo "Docker did not start. Open Docker Desktop manually and retry."; read -r -p "Press Enter to close..."; exit 1; }
fi

echo "=============================================="
echo "  Building and starting SubarnaPasal..."
echo "  (first run takes a few minutes)"
echo "=============================================="
docker compose up -d --build || { echo ""; echo "BUILD FAILED — copy the error above and send it to Claude."; read -r -p "Press Enter to close..."; exit 1; }

echo -n "Waiting for the app to come up"
for i in $(seq 1 45); do
  curl -sf http://localhost:3000/api/healthz >/dev/null 2>&1 && break
  echo -n "."
  sleep 2
done
echo ""
echo "SubarnaPasal is running at http://localhost:3000"
open "http://localhost:3000"
echo "(To stop it later: run 'docker compose down' in this folder,"
echo " or just quit Docker Desktop.)"
read -r -p "Press Enter to close this window..."
