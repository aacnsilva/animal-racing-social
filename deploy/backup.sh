#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p backups
file="backups/ars-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
docker compose -f compose.prod.yml --env-file .env exec -T postgres pg_dump -U postgres --format=plain ars | gzip > "$file"
ls -1t backups/ars-*.sql.gz | tail -n +15 | xargs -r rm --
echo "Backup written to $file"
