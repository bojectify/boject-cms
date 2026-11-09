#!/usr/bin/env bash
# release:prepare — bump all artifacts to one unified version on a release branch
# and open a PR. Run on the HOST (git writes; the dev container's .git is RO):
#   bash scripts/release-prepare.sh <X.Y.Z | X.Y.Z-rc.N>
set -euo pipefail

VERSION="${1:-}"
[[ -n "$VERSION" ]] || { echo "usage: bash scripts/release-prepare.sh <version>" >&2; exit 1; }

git fetch origin --quiet
[[ "$(git rev-parse --abbrev-ref HEAD)" == "main" ]] || { echo "✗ run from 'main'" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "✗ working tree not clean" >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "✗ main not in sync with origin/main — pull first" >&2; exit 1; }

RELEASE_BRANCH="release/$(date -u +%Y%m%d-%H%M%S)"
git checkout -b "$RELEASE_BRANCH"

# Bump routes into the dev container (rewrites the mounted files); git/gh are host.
pnpm exec tsx scripts/release-version.ts "$VERSION"
pnpm install --lockfile-only

[[ -n "$(git status --porcelain)" ]] || { echo "✗ no changes — already at $VERSION?" >&2; git checkout main; git branch -D "$RELEASE_BRANCH"; exit 1; }

git add -A
# --no-verify: this is a mechanical version bump. Running the lefthook
# pre-commit hook here fires its pnpm jobs (lint/format/typecheck), whose
# verify-deps-before-run sees the lockfile-only-updated tree (node_modules
# is deliberately NOT reinstalled above) as out of sync and auto-runs a full
# `pnpm install` INSIDE the hook — executing apps/cms lifecycle scripts
# (nuxt prepare / prisma generate), which is slow and fails under container
# load. The release PR gets full CI (build/lint/format/typecheck/test), so
# the local hook is redundant for a pure version-string commit.
git commit --no-verify -m "chore(release): publish v$VERSION"
git push -u origin "$RELEASE_BRANCH"

# Body from a file (#513): avoids nested printf/backtick escaping, and carries
# the `## Release notes` section release-tag.sh puts on the GitHub Release.
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT
bash scripts/release-notes.sh body "$VERSION" > "$BODY_FILE"
# The `release` label keeps this PR out of the generated "What's Changed"
# list (.github/release.yml).
gh pr create --base main --head "$RELEASE_BRANCH" \
  --title "chore(release): publish v$VERSION" \
  --label release \
  --body-file "$BODY_FILE"

echo "✓ Release PR opened for v$VERSION."
echo "  Fill in its '## Release notes' section (upgrade steps, behaviour changes),"
echo "  merge it, then: bash scripts/release-tag.sh"
