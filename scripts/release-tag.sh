#!/usr/bin/env bash
# release:tag — after the release PR merges, tag the release commit + create the
# GitHub Release (auto-notes). Run on the HOST: bash scripts/release-tag.sh
set -euo pipefail

[[ -z "$(git status --porcelain)" ]] || { echo "✗ working tree not clean" >&2; exit 1; }
git fetch origin --quiet
git checkout main
git merge --ff-only origin/main

RELEASE_SHA="$(git log -1 --format=%H --grep='^chore(release): publish' || true)"
[[ -n "$RELEASE_SHA" ]] || { echo "✗ no 'chore(release): publish' commit on main" >&2; exit 1; }

VERSION="$(git show "${RELEASE_SHA}:package.json" | grep -m1 '"version"' | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
TAG="v${VERSION}"
echo "Release commit $(git log -1 --oneline "$RELEASE_SHA") → $TAG"

if [[ -n "$(git ls-remote --tags origin "refs/tags/${TAG}")" ]]; then
  echo "✓ $TAG already on remote — nothing to do."
  exit 0
fi

git tag -d "$TAG" >/dev/null 2>&1 || true
git tag -a "$TAG" "$RELEASE_SHA" -m "$TAG"
git push origin "refs/tags/${TAG}"
gh release create "$TAG" --verify-tag --generate-notes --title "$TAG"

echo "✓ Pushed $TAG + created the GitHub Release. Publish workflows are running."
