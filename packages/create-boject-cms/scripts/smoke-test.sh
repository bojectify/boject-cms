#!/usr/bin/env bash
set -euo pipefail

# Smoke-test the create-boject-cms scaffolder output end-to-end:
#   - builds the cms image (unless SMOKE_IMAGE is pre-built) + the CLI dist
#   - scaffolds a fresh project into a temp dir, pinned to the local cms image
#   - `docker compose up -d` on the GENERATED compose (cms + db + meilisearch + redis)
#   - asserts the cms container boots and answers HTTP (200/302)
#   - runs `boject schema pull` with zero manual steps: the scaffold's generated
#     key (.env.local) was seeded by the CMS from BOJECT_BOOTSTRAP_API_KEY (#510)
#   - runs the extra-key command printed in the generated .env and checks the
#     key authenticates GET /api/schema/export (#506)
#   - restarts cms and checks there is still exactly one bootstrap key (#510)
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

CLI=("node" "$REPO_ROOT/packages/boject-cli/dist/index.js")
compose() { (cd "$SITE_DIR" && COMPOSE_PROJECT_NAME="$PROJECT_NAME" docker compose "$@"); }

# 1. Zero-step CLI (#510): the scaffold generated a key (non-TTY default) into
#    .env.local and its prefix:hash into .env; the CMS seeded it on boot. The
#    CLI must work with nothing minted, exported or passed — no --url either
#    (#511: .boject.config.json already points at the scaffolded --port).
echo "[scaffold-smoke] boject schema pull with zero manual steps"
if ! grep -q '^BOJECT_API_KEY=boject_' "$SITE_DIR/.env.local"; then
  echo "[scaffold-smoke] FAIL: scaffold wrote no CLI key to .env.local"
  exit 1
fi
rm -f "$SITE_DIR/content-types/schema.boject.json"
if ! (cd "$SITE_DIR" && env -u BOJECT_API_KEY -u BOJECT_NO_DOTENV "${CLI[@]}" schema pull); then
  echo "[scaffold-smoke] FAIL: schema pull failed with the bootstrap key"
  compose logs cms | grep -i 'seed-api-key\|bootstrap' || true
  exit 1
fi
if [[ ! -s "$SITE_DIR/content-types/schema.boject.json" ]]; then
  echo "[scaffold-smoke] FAIL: schema pull wrote no schema file"
  exit 1
fi
echo "[scaffold-smoke] CLI works out of the box (bootstrap key seeded from .env)"

# 2. The manual first-key command (#506) still works for extra keys: run the
#    exact line the generated .env shows and check the key authenticates.
echo "[scaffold-smoke] minting an extra key with the command from .env"
KEY_CMD=$(sed -n 's/^#   \(docker compose exec cms .*\)$/\1/p' "$SITE_DIR/.env")
if [[ -z "$KEY_CMD" ]]; then
  echo "[scaffold-smoke] FAIL: no key command found in generated .env"
  exit 1
fi
KEY_OUT=$(cd "$SITE_DIR" && COMPOSE_PROJECT_NAME="$PROJECT_NAME" bash -c "$KEY_CMD" </dev/null)
RAW_KEY=$(printf '%s\n' "$KEY_OUT" | sed -n 's/^ *Key: *\(boject_[^ ]*\)$/\1/p')
if [[ -z "$RAW_KEY" ]]; then
  echo "[scaffold-smoke] FAIL: key command printed no key:"
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
echo "[scaffold-smoke] manual key command works (GET /api/schema/export → 200)"

# 3. Restart idempotency (#510): the bootstrap step must not duplicate the key.
echo "[scaffold-smoke] restarting cms to check the bootstrap seed is idempotent"
compose restart cms >/dev/null
code="000"
for _ in $(seq 1 "$HEALTH_WAIT_TRIES"); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$HOST_PORT/" 2>/dev/null || echo "000")
  if [[ "$code" == "200" || "$code" == "302" ]]; then
    break
  fi
  sleep 1
done
if [[ "$code" != "200" && "$code" != "302" ]]; then
  echo "[scaffold-smoke] FAIL: cms did not come back after restart (last code=$code)"
  compose logs cms | tail -60 || true
  exit 1
fi
bootstrap_count=$(compose exec -T cms tsx scripts/manage-api-keys/index.ts list | grep -c 'cli (bootstrap)' || true)
if [[ "$bootstrap_count" != "1" ]]; then
  echo "[scaffold-smoke] FAIL: expected exactly 1 'cli (bootstrap)' key after restart, found $bootstrap_count"
  exit 1
fi
echo "[scaffold-smoke] restart kept exactly one bootstrap key"

echo "[scaffold-smoke] PASS — stack booted, the CLI works with zero manual steps, the manual key command works, and restarts keep one bootstrap key"
