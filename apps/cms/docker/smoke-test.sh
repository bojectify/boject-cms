#!/usr/bin/env bash
set -euo pipefail

# Smoke-test the boject/cms:dev image end-to-end:
#   - builds the image
#   - runs it against an ephemeral postgres
#   - verifies first-boot: migrations applied, admin seeded, starter imported,
#     and apply-schema is a no-op (starter already created the schema)
#   - verifies restart idempotency: no duplicate admin, no re-import,
#     apply-schema still a no-op
#   - verifies edit-bundle-then-restart applies the diff
#   - verifies a removal-with-entries bundle fails the boot (BLOCKED)
#
# Dependency: jq (for in-place editing of the bundle JSON between restarts).

PG_NAME="boject-cms-smoke-pg"
REDIS_NAME="boject-cms-smoke-redis"
MEILI_NAME="boject-cms-smoke-meili"
APP_NAME="boject-cms-smoke-app"
NETWORK_NAME="boject-cms-smoke-net"
VOLUME_NAME="boject-cms-smoke-storage"
IMAGE_TAG="${SMOKE_IMAGE:-boject/cms:dev}"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONTENT_DIR="$(mktemp -d -t boject-cms-smoke-content-XXXXXX)"

cleanup() {
  echo "[smoke-test] cleaning up"
  docker rm -f "$APP_NAME" "$PG_NAME" "$REDIS_NAME" "$MEILI_NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
  rm -rf "$CONTENT_DIR" 2>/dev/null || true
}
trap cleanup EXIT

if [[ -n "${SMOKE_IMAGE:-}" ]]; then
  echo "[smoke-test] using pre-built image $IMAGE_TAG (skipping build)"
else
  echo "[smoke-test] building image"
  (cd "$REPO_ROOT" && docker build -f apps/cms/Dockerfile -t "$IMAGE_TAG" .)
fi

echo "[smoke-test] creating network + volume"
docker network create "$NETWORK_NAME" >/dev/null
docker volume create "$VOLUME_NAME" >/dev/null

echo "[smoke-test] starting postgres"
docker run -d --name "$PG_NAME" \
  --network "$NETWORK_NAME" \
  -e POSTGRES_USER=boject \
  -e POSTGRES_PASSWORD=boject \
  -e POSTGRES_DB=boject \
  postgres:17 >/dev/null

# Wait for postgres
for i in {1..30}; do
  if docker exec "$PG_NAME" pg_isready -U boject -d boject >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[smoke-test] starting redis"
# Cold-by-design, mirroring the docker-compose redis sidecar. The production
# cache-config-guard plugin throws at boot if REDIS_URL is unset, so the app
# container needs a real Redis to boot.
docker run -d --name "$REDIS_NAME" \
  --network "$NETWORK_NAME" \
  redis:7.4-alpine redis-server --save "" --appendonly no >/dev/null

echo "[smoke-test] starting meilisearch"
# The production meili client (resolveMeiliConfig) throws at boot if
# MEILI_MASTER_KEY is unset, so the app needs a real Meilisearch + key to boot.
MEILI_KEY="$(head -c 16 /dev/urandom | base64)"
docker run -d --name "$MEILI_NAME" \
  --network "$NETWORK_NAME" \
  -e MEILI_MASTER_KEY="$MEILI_KEY" \
  getmeili/meilisearch:v1.45.2 >/dev/null

echo "[smoke-test] seeding content-types dir with the base starter"
cp "$REPO_ROOT/starters/base.boject.json" "$CONTENT_DIR/schema.boject.json"

echo "[smoke-test] starting cms (first boot — expect admin seed + starter import)"
docker run -d --name "$APP_NAME" \
  --network "$NETWORK_NAME" \
  -e DATABASE_URL=postgresql://boject:boject@${PG_NAME}:5432/boject \
  -e REDIS_URL=redis://${REDIS_NAME}:6379 \
  -e MEILI_URL=http://${MEILI_NAME}:7700 \
  -e MEILI_MASTER_KEY="$MEILI_KEY" \
  -e NUXT_SESSION_PASSWORD="$(head -c 32 /dev/urandom | base64)" \
  -e BOJECT_ADMIN_EMAIL=admin@smoke.test \
  -e BOJECT_ADMIN_PASSWORD="$(head -c 16 /dev/urandom | base64)" \
  -e BOJECT_INITIAL_STARTER=/starters/base.boject.json \
  -e BOJECT_SCHEMA_DIR=/app/content-types \
  -v "${VOLUME_NAME}:/app/storage" \
  -v "${REPO_ROOT}/starters:/starters:ro" \
  -v "$CONTENT_DIR:/app/content-types:ro" \
  -p 4010:3000 \
  "$IMAGE_TAG" >/dev/null

# Wait for Nuxt to respond
echo "[smoke-test] waiting for cms to respond"
for i in {1..60}; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4010/ 2>/dev/null || echo "000")
  if [[ "$code" == "200" || "$code" == "302" ]]; then
    break
  fi
  sleep 1
done
if [[ "$code" != "200" && "$code" != "302" ]]; then
  echo "[smoke-test] FAIL: cms did not respond (got $code)"
  docker logs "$APP_NAME" | tail -50
  exit 1
fi

# Grep logs for the expected seed/import messages
logs=$(docker logs "$APP_NAME" 2>&1)
if ! grep -q "seeded admin user" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected admin seed log not found"
  echo "$logs" | tail -30
  exit 1
fi
if ! grep -q "imported" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected starter import log not found"
  echo "$logs" | tail -30
  exit 1
fi

# step 5/6 first-boot expectation: starter already created the schema,
# so apply-schema is a no-op against the just-imported state.
if ! grep -q "\\[apply-schema\\] done — 1 file applied, 0 total changes" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected first-boot apply-schema no-op"
  echo "[smoke-test] --- apply-schema log lines ---"
  grep -E "\\[apply-schema\\]" <<<"$logs" || echo "(no apply-schema lines found)"
  echo "[smoke-test] --- last 80 lines of full log ---"
  echo "$logs" | tail -80
  exit 1
fi

if [[ -n "${BOOT_ONLY:-}" ]]; then
  echo "[smoke-test] BOOT_ONLY: first boot OK — skipping restart assertions"
  echo "[smoke-test] PASS"
  exit 0
fi

echo "[smoke-test] first-boot OK. Restarting to verify idempotency."
docker restart "$APP_NAME" >/dev/null

# Wait again
for i in {1..60}; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4010/ 2>/dev/null || echo "000")
  if [[ "$code" == "200" || "$code" == "302" ]]; then
    break
  fi
  sleep 1
done

logs=$(docker logs --since 1m "$APP_NAME" 2>&1)
if ! grep -q "skipped — users already exist" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected 'skipped — users already exist' on restart"
  echo "$logs" | tail -30
  exit 1
fi
if ! grep -q "content-types-already-exist" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected starter-skip log on restart"
  echo "$logs" | tail -30
  exit 1
fi

# Step 5/6 second-boot expectation: still a no-op.
if ! grep -q "\\[apply-schema\\] done — 1 file applied, 0 total changes" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected second-boot apply-schema no-op"
  echo "$logs" | tail -50
  exit 1
fi

echo "[smoke-test] mutating schema bundle to add a field, restarting"
# Insert a new field into the first content type. Use jq to keep the JSON valid.
tmp_bundle="$(mktemp)"
jq '.contentTypes[0].fields += [{
      "id": null,
      "identifier": "smokeTestField",
      "name": "Smoke Test Field",
      "type": "TEXT",
      "required": false,
      "order": 99,
      "options": null
    }]' "$CONTENT_DIR/schema.boject.json" > "$tmp_bundle"
mv "$tmp_bundle" "$CONTENT_DIR/schema.boject.json"

docker restart "$APP_NAME" >/dev/null
for i in {1..60}; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4010/ 2>/dev/null || echo "000")
  if [[ "$code" == "200" || "$code" == "302" ]]; then
    break
  fi
  sleep 1
done

logs=$(docker logs --since 1m "$APP_NAME" 2>&1)
if ! grep -q "\\[apply-schema\\] schema.boject.json: 1 created, 0 updated, 0 removed" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected apply-schema to create the new field"
  echo "$logs" | tail -50
  exit 1
fi

echo "[smoke-test] mutating bundle to remove the first content type, restarting (expect blocker)"
# Drop all content types. The base starter seeds at least one entry
# (SiteSettings), so removal will be blocked.
jq '.contentTypes = []' "$CONTENT_DIR/schema.boject.json" > "$tmp_bundle"
mv "$tmp_bundle" "$CONTENT_DIR/schema.boject.json"

# Restart will exit non-zero because the apply-schema script throws and
# entrypoint.sh has `set -e`. Docker should mark the container as exited.
docker restart "$APP_NAME" >/dev/null
sleep 5

state=$(docker inspect --format '{{.State.Status}}' "$APP_NAME")
if [[ "$state" != "exited" && "$state" != "restarting" ]]; then
  echo "[smoke-test] FAIL: expected container to exit on blocker, got state=$state"
  docker logs "$APP_NAME" | tail -50
  exit 1
fi

logs=$(docker logs --since 30s "$APP_NAME" 2>&1)
if ! grep -q "\\[apply-schema\\] schema.boject.json: BLOCKED" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected BLOCKED log line"
  echo "$logs" | tail -50
  exit 1
fi

echo "[smoke-test] all schema-as-code assertions passed"
echo "[smoke-test] PASS"
