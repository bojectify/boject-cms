#!/usr/bin/env bash
set -euo pipefail

log() {
  echo "[entrypoint] $*"
}

: "${DATABASE_URL:?DATABASE_URL must be set}"

log "step 1/7: waiting for database"
tsx scripts/docker-entrypoint/wait-for-db.ts

log "step 2/7: applying migrations"
prisma migrate deploy --schema prisma/schema

log "step 3/7: seeding admin if needed"
if [[ -n "${BOJECT_ADMIN_EMAIL:-}" && -n "${BOJECT_ADMIN_PASSWORD:-}" ]]; then
  tsx scripts/docker-entrypoint/seed-admin.ts
else
  log "skipping admin seed — BOJECT_ADMIN_EMAIL or BOJECT_ADMIN_PASSWORD not set"
fi

log "step 4/7: seeding bootstrap API key if configured"
if [[ -n "${BOJECT_BOOTSTRAP_API_KEY:-}" ]]; then
  tsx scripts/docker-entrypoint/seed-api-key.ts
else
  log "skipping bootstrap API key — BOJECT_BOOTSTRAP_API_KEY not set"
fi

log "step 5/7: importing starter if needed"
tsx scripts/docker-entrypoint/import-starter.ts

log "step 6/7: applying schema-as-code"
tsx scripts/docker-entrypoint/apply-schema.ts

log "step 7/7: starting nuxt server"
exec node .output/server/index.mjs
