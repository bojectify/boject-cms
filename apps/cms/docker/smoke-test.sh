#!/usr/bin/env bash
set -euo pipefail

# Smoke-test the boject/cms:dev image end-to-end:
#   - builds the image
#   - runs it against an ephemeral postgres
#   - verifies first-boot: migrations applied, admin seeded, starter imported
#   - verifies restart idempotency: no duplicate admin, no re-import

PG_NAME="boject-cms-smoke-pg"
APP_NAME="boject-cms-smoke-app"
NETWORK_NAME="boject-cms-smoke-net"
VOLUME_NAME="boject-cms-smoke-storage"
IMAGE_TAG="boject/cms:dev"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

cleanup() {
  echo "[smoke-test] cleaning up"
  docker rm -f "$APP_NAME" "$PG_NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME_NAME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[smoke-test] building image"
(cd "$REPO_ROOT" && docker build -f apps/cms/Dockerfile -t "$IMAGE_TAG" .)

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

echo "[smoke-test] starting cms (first boot — expect admin seed + starter import)"
docker run -d --name "$APP_NAME" \
  --network "$NETWORK_NAME" \
  -e DATABASE_URL=postgresql://boject:boject@${PG_NAME}:5432/boject \
  -e NUXT_SESSION_PASSWORD="$(head -c 32 /dev/urandom | base64)" \
  -e BOJECT_ADMIN_EMAIL=admin@smoke.test \
  -e BOJECT_ADMIN_PASSWORD=smoke-pass \
  -e BOJECT_INITIAL_STARTER=/starters/base.boject.json \
  -v "${VOLUME_NAME}:/app/storage" \
  -v "${REPO_ROOT}/starters:/starters:ro" \
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

echo "[smoke-test] PASS"
