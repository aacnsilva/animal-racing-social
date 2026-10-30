#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
COMPOSE=(docker compose -f compose.prod.yml --env-file .env)

if [ "${1:-}" != "" ]; then
  if grep -q '^IMAGE_TAG=' .env; then
    sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" .env
  else
    echo "IMAGE_TAG=$1" >> .env
  fi
fi

echo "Deploying $(grep '^IMAGE_TAG=' .env)"
"${COMPOSE[@]}" pull --quiet
"${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout 300
"${COMPOSE[@]}" ps --format 'table {{.Service}}\t{{.Status}}'
docker image prune -f --filter "until=168h" > /dev/null
echo "Deployed."
