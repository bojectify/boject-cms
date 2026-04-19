#!/usr/bin/env bash
set -euo pipefail

log() {
  echo "[entrypoint] $*"
}

: "${DATABASE_URL:?DATABASE_URL must be set}"

log "step 1/5: waiting for database"
tsx scripts/docker-entrypoint/wait-for-db.ts

log "step 2/5: applying migrations"
prisma migrate deploy --schema prisma/schema

log "step 3/5: seeding admin if needed"
if [[ -n "${BOJECT_ADMIN_EMAIL:-}" && -n "${BOJECT_ADMIN_PASSWORD:-}" ]]; then
  tsx scripts/docker-entrypoint/seed-admin.ts
else
  log "skipping admin seed — BOJECT_ADMIN_EMAIL or BOJECT_ADMIN_PASSWORD not set"
fi

log "step 4/5: importing starter if needed"
tsx scripts/docker-entrypoint/import-starter.ts

log "step 5/5: starting nuxt server"
exec node .output/server/index.mjs
