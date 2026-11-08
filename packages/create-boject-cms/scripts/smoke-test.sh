#!/usr/bin/env bash
set -euo pipefail

# Smoke-test the create-boject-cms scaffolder output end-to-end:
#   - builds the cms image (unless SMOKE_IMAGE is pre-built) + the CLI dist
#   - scaffolds a fresh project into a temp dir, pinned to the local cms image
#   - `docker compose up -d` on the GENERATED compose (cms + db + meilisearch + redis)
#   - asserts the cms container boots and answers HTTP (200/302)
#   - runs the first-API-key command printed in the generated .env and checks
#     the key authenticates GET /api/schema/export (#506)
#   - saves the key to .env.local and runs `boject schema pull` with
#     BOJECT_API_KEY unset, proving the CLI loads it itself (#505)
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

echo "[scaffold-smoke] building create-boject-cms + @boject/cli dist"
(cd "$REPO_ROOT" && pnpm --filter create-boject-cms build && pnpm --filter @boject/cli build)

echo "[scaffold-smoke] scaffolding a project into $SITE_DIR"
node "$REPO_ROOT/packages/create-boject-cms/dist/index.js" \
  "$SITE_DIR" \
  --starter web-base \
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

# First API key (#506): run the exact command the generated .env shows, then
# prove the key authenticates a CLI-scoped endpoint.
echo "[scaffold-smoke] minting the first API key with the command from .env"
KEY_CMD=$(sed -n 's/^#   \(docker compose exec cms .*\)$/\1/p' "$SITE_DIR/.env")
if [[ -z "$KEY_CMD" ]]; then
  echo "[scaffold-smoke] FAIL: no first-key command found in generated .env"
  exit 1
fi
KEY_OUT=$(cd "$SITE_DIR" && COMPOSE_PROJECT_NAME="$PROJECT_NAME" bash -c "$KEY_CMD" </dev/null)
RAW_KEY=$(printf '%s\n' "$KEY_OUT" | sed -n 's/^ *Key: *\(boject_[^ ]*\)$/\1/p')
if [[ -z "$RAW_KEY" ]]; then
  echo "[scaffold-smoke] FAIL: first-key command printed no key:"
  printf '%s\n' "$KEY_OUT"
  exit 1
fi
export_code=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $RAW_KEY" \
  "http://localhost:$HOST_PORT/api/schema/export")
if [[ "$export_code" != "200" ]]; then
  echo "[scaffold-smoke] FAIL: minted key got HTTP $export_code from /api/schema/export"
  exit 1
fi
echo "[scaffold-smoke] first API key works (GET /api/schema/export → 200)"

# The CLI loads the key from .env.local itself (#505): save it there as the
# generated README says, then run `schema pull` with BOJECT_API_KEY unset.
echo "[scaffold-smoke] boject schema pull with the key only in .env.local"
printf 'BOJECT_API_KEY=%s\n' "$RAW_KEY" >> "$SITE_DIR/.env.local"
rm -f "$SITE_DIR/content-types/schema.boject.json"
if ! (cd "$SITE_DIR" && env -u BOJECT_API_KEY -u BOJECT_NO_DOTENV \
  node "$REPO_ROOT/packages/boject-cli/dist/index.js" schema pull \
  --url "http://localhost:$HOST_PORT"); then
  echo "[scaffold-smoke] FAIL: boject schema pull did not pick up .env.local"
  exit 1
fi
if [[ ! -s "$SITE_DIR/content-types/schema.boject.json" ]]; then
  echo "[scaffold-smoke] FAIL: schema pull wrote no schema file"
  exit 1
fi
echo "[scaffold-smoke] CLI loaded the key from .env.local (schema pull OK)"

echo "[scaffold-smoke] PASS — scaffolded stack booted, answered HTTP $code, the first-key command works, and the CLI loads .env.local"
