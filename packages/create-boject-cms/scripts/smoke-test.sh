#!/usr/bin/env bash
set -euo pipefail

# Smoke-test the create-boject-cms scaffolder output end-to-end:
#   - builds the cms image (unless SMOKE_IMAGE is pre-built) + the CLI dist
#   - scaffolds a fresh project into a temp dir, pinned to the local cms image
#   - `docker compose up -d` on the GENERATED compose (cms + db + meilisearch + redis)
#   - asserts the cms container boots and answers HTTP (200/302)
#   - tears everything down on exit
#
# This is the gate the unit/e2e content-assertions can't provide: it proves the
# generated four-service stack actually boots. Mirrors apps/cms/docker/smoke-test.sh.
#
# Deps (host): Docker (compose v2), Node, curl.
# Env: SMOKE_IMAGE (reuse a pre-built cms image, skip the build),
#      SMOKE_PORT (host port, default 4020),
#      HEALTH_WAIT_TRIES (poll iterations ≈ seconds, default 180).

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
IMAGE_TAG="${SMOKE_IMAGE:-boject/cms:dev}"
HOST_PORT="${SMOKE_PORT:-4020}"
PROJECT_NAME="boject-scaffold-smoke"
WORK_DIR="$(mktemp -d -t boject-scaffold-smoke-XXXXXX)"
SITE_DIR="$WORK_DIR/site"
HEALTH_WAIT_TRIES="${HEALTH_WAIT_TRIES:-180}"

cleanup() {
  echo "[scaffold-smoke] cleaning up"
  if [[ -d "$SITE_DIR" ]]; then
    (cd "$SITE_DIR" && docker compose -p "$PROJECT_NAME" down -v >/dev/null 2>&1) || true
  fi
  rm -rf "$WORK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

if [[ -n "${SMOKE_IMAGE:-}" ]]; then
  echo "[scaffold-smoke] using pre-built image $IMAGE_TAG (skipping build)"
else
  echo "[scaffold-smoke] building cms image $IMAGE_TAG"
  (cd "$REPO_ROOT" && docker build -f apps/cms/Dockerfile -t "$IMAGE_TAG" .)
fi

echo "[scaffold-smoke] building create-boject-cms dist"
(cd "$REPO_ROOT" && pnpm --filter create-boject-cms build)

echo "[scaffold-smoke] scaffolding a project into $SITE_DIR"
node "$REPO_ROOT/packages/create-boject-cms/dist/index.js" \
  "$SITE_DIR" \
  --starter base \
  --image "$IMAGE_TAG" \
  --port "$HOST_PORT"

echo "[scaffold-smoke] docker compose up -d (cms + db + meilisearch + redis)"
(cd "$SITE_DIR" && docker compose -p "$PROJECT_NAME" up -d)

echo "[scaffold-smoke] waiting for cms to respond on :$HOST_PORT"
code="000"
for _ in $(seq 1 "$HEALTH_WAIT_TRIES"); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$HOST_PORT/" 2>/dev/null || echo "000")
  if [[ "$code" == "200" || "$code" == "302" ]]; then
    break
  fi
  sleep 1
done

if [[ "$code" != "200" && "$code" != "302" ]]; then
  echo "[scaffold-smoke] FAIL: cms did not respond (last code=$code)"
  (cd "$SITE_DIR" && docker compose -p "$PROJECT_NAME" ps) || true
  (cd "$SITE_DIR" && docker compose -p "$PROJECT_NAME" logs cms | tail -60) || true
  exit 1
fi

echo "[scaffold-smoke] cms state:"
(cd "$SITE_DIR" && docker compose -p "$PROJECT_NAME" ps)

echo "[scaffold-smoke] PASS — scaffolded stack booted and answered HTTP $code"
