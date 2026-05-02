#!/usr/bin/env bash
set -euo pipefail

log() {
  echo "[entrypoint] $*"
}

: "${DATABASE_URL:?DATABASE_URL must be set}"

log "step 1/6: waiting for database"
tsx scripts/docker-entrypoint/wait-for-db.ts

log "step 2/6: applying migrations"
prisma migrate deploy --schema prisma/schema

log "step 3/6: seeding admin if needed"
if [[ -n "${BOJECT_ADMIN_EMAIL:-}" && -n "${BOJECT_ADMIN_PASSWORD:-}" ]]; then
  tsx scripts/docker-entrypoint/seed-admin.ts
else
  log "skipping admin seed — BOJECT_ADMIN_EMAIL or BOJECT_ADMIN_PASSWORD not set"
fi

log "step 4/6: importing starter if needed"
tsx scripts/docker-entrypoint/import-starter.ts

log "step 5/6: applying schema-as-code"
tsx scripts/docker-entrypoint/apply-schema.ts

log "step 6/6: starting nuxt server"
exec node .output/server/index.mjs
