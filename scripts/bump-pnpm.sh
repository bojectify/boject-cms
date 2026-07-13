#!/usr/bin/env bash
# bump-pnpm — set the pinned pnpm version across every repo pin site, then
# rebuild the dev container so the running image matches. Run on the HOST
# (docker writes; the dev container has no docker CLI + a read-only .git mount):
#   bash scripts/bump-pnpm.sh <X.Y.Z> [--no-rebuild]
#
# Pin sites kept in lockstep (a bump is broken if any one drifts):
#   - package.json          "packageManager": "pnpm@X.Y.Z"
#   - Dockerfile.dev        ARG PNPM_VERSION=X.Y.Z             (dev container)
#   - apps/cms/Dockerfile   corepack prepare pnpm@X.Y.Z   (x2, prod image)
#
# The two prod-image pins ride the next release build in CI; only Dockerfile.dev
# needs the local rebuild this script performs. Does NOT commit (commit the diff
# yourself) and does NOT touch the host's standalone pnpm (managed separately).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NEW="${1:-}"
REBUILD=1
[[ "${2:-}" == "--no-rebuild" ]] && REBUILD=0

CURRENT="$(sed -n 's/.*"packageManager": "pnpm@\([0-9.]*\)".*/\1/p' package.json)"

if [[ -z "$NEW" ]]; then
  echo "usage: bash scripts/bump-pnpm.sh <X.Y.Z> [--no-rebuild]" >&2
  echo "current: pnpm@${CURRENT:-unknown}" >&2
  exit 1
fi
[[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || { echo "✗ '$NEW' is not a valid X.Y.Z version" >&2; exit 1; }

[[ "$NEW" == "$CURRENT" ]] \
  && echo "• package.json already pins pnpm@${NEW}; re-syncing the other sites anyway."

# Rewrite all four pin sites. NEW is passed via env so the perl program can stay
# single-quoted — no bash interpolation into the regex, and @/$ need no escaping
# dance.
NEW="$NEW" perl -pi -e 's/("packageManager":\s*"pnpm\@)\d+\.\d+\.\d+"/$1$ENV{NEW}"/' package.json
NEW="$NEW" perl -pi -e 's/^(ARG PNPM_VERSION=)\d+\.\d+\.\d+/$1$ENV{NEW}/'             Dockerfile.dev
NEW="$NEW" perl -pi -e 's/(corepack prepare pnpm\@)\d+\.\d+\.\d+/$1$ENV{NEW}/g'      apps/cms/Dockerfile

# Assert every site landed on NEW — a silent miss is the exact failure mode this
# script exists to prevent.
grep -q "\"packageManager\": \"pnpm@${NEW}\"" package.json \
  || { echo "✗ package.json pin not updated" >&2; exit 1; }
grep -q "^ARG PNPM_VERSION=${NEW}$" Dockerfile.dev \
  || { echo "✗ Dockerfile.dev pin not updated" >&2; exit 1; }
[[ "$(grep -c "corepack prepare pnpm@${NEW}" apps/cms/Dockerfile)" == "2" ]] \
  || { echo "✗ apps/cms/Dockerfile expected 2 pins at ${NEW}" >&2; exit 1; }

echo "✓ pinned pnpm@${NEW} across all 4 sites (was ${CURRENT:-unknown})"
git --no-pager diff --stat -- package.json Dockerfile.dev apps/cms/Dockerfile || true

if [[ "$REBUILD" == "0" ]]; then
  echo "• --no-rebuild: skipping the dev container rebuild. When ready:"
  echo "    docker compose up -d --build dev"
  exit 0
fi

echo "→ rebuilding the dev container (docker compose up -d --build dev)…"
docker compose up -d --build dev

IN_CONTAINER="$(docker compose exec -T dev pnpm -v | tr -d '\r\n ')"
[[ "$IN_CONTAINER" == "$NEW" ]] \
  || { echo "✗ dev container reports pnpm ${IN_CONTAINER}, expected ${NEW}" >&2; exit 1; }

echo "✓ dev container now runs pnpm ${IN_CONTAINER}"
echo "• Commit: package.json, Dockerfile.dev, apps/cms/Dockerfile"
echo "• Host pnpm is separate (standalone install) and is unaffected."
