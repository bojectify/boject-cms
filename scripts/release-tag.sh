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

# Hand-written notes (#513): the `## Release notes` section of the merged
# release PR goes above GitHub's generated list. A squash-merge commit maps
# back to its PR via the commits/<sha>/pulls API. No PR / empty section → no
# extra notes.
# Never fails the release: on an API error gh prints the error JSON to stdout,
# so only a numeric PR number is accepted, and a failed body fetch → no notes.
NOTES=""
PR_NUMBER="$(gh api "repos/{owner}/{repo}/commits/${RELEASE_SHA}/pulls" --jq '.[0].number // empty' 2>/dev/null)" || PR_NUMBER=""
[[ "$PR_NUMBER" =~ ^[0-9]+$ ]] || PR_NUMBER=""
if [[ -n "$PR_NUMBER" ]]; then
  NOTES="$(gh pr view "$PR_NUMBER" --json body --jq .body 2>/dev/null | bash scripts/release-notes.sh extract)" || NOTES=""
fi
if [[ -n "$NOTES" ]]; then
  echo "Release notes from PR #${PR_NUMBER} will lead the GitHub Release."
else
  echo "No '## Release notes' in the release PR — generated notes only."
fi

git tag -d "$TAG" >/dev/null 2>&1 || true
git tag -a "$TAG" "$RELEASE_SHA" -m "$TAG"
git push origin "refs/tags/${TAG}"

# `--notes` + `--generate-notes`: gh prepends the given notes to the generated
# ones. Optional args via an array; the ${…+…} form keeps an empty array safe
# under `set -u` on macOS's bash 3.2.
RELEASE_ARGS=(--verify-tag --generate-notes --title "$TAG")
[[ "$VERSION" == *-* ]] && RELEASE_ARGS+=(--prerelease)
[[ -n "$NOTES" ]] && RELEASE_ARGS+=(--notes "$NOTES")
gh release create "$TAG" ${RELEASE_ARGS[@]+"${RELEASE_ARGS[@]}"}

echo "✓ Pushed $TAG + created the GitHub Release. Publish workflows are running."
