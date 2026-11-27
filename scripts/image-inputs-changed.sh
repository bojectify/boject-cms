#!/usr/bin/env bash
set -euo pipefail

# Can these changes change the CMS image? (#499)
#
# Reads newline-separated repo-relative paths on stdin (e.g. the output of
# `git diff --name-only`) and prints `true` if any of them is an input of
# the image built from apps/cms/Dockerfile or of apps/cms/docker/smoke-test.sh,
# else `false`. CI's `image-smoke` job builds and smoke-tests the image only
# when this prints `true`.
#
# Keep the list in sync with what apps/cms/Dockerfile COPYs (and with what
# .dockerignore lets through). A missing path here means a PR that breaks the
# image skips the smoke test.

while IFS= read -r path || [[ -n "$path" ]]; do
  case "$path" in
    apps/cms/* | starters/* | patches/* | \
      package.json | pnpm-lock.yaml | pnpm-workspace.yaml | \
      LICENSE | .dockerignore | \
      .github/workflows/ci.yml | scripts/image-inputs-changed.sh)
      echo true
      exit 0
      ;;
  esac
done

echo false
