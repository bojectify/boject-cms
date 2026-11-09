#!/usr/bin/env bash
# Release-notes helpers for the release scripts (#513). Runs on the HOST
# (release-prepare.sh / release-tag.sh) and in the scripts vitest project.
#
#   bash scripts/release-notes.sh body <version>   # release PR body → stdout
#   bash scripts/release-notes.sh extract          # PR body (stdin) → notes
#
# The release PR body has a `## Release notes` section for hand-written notes
# (upgrade steps, behaviour changes, new flags). `extract` prints that
# section's text, up to the template's "## Next steps" heading — HTML comments
# (the prompt) removed, blank edges trimmed —
# or nothing when it's empty, so release-tag.sh can put it above GitHub's
# generated "What's Changed" list.
set -euo pipefail

cmd="${1:-}"

case "$cmd" in
  body)
    version="${2:-}"
    [[ -n "$version" ]] || { echo "usage: release-notes.sh body <version>" >&2; exit 1; }
    cat <<EOF
Unified version bump to \`v${version}\` (all 4 package.json + both version.ts).

## Release notes

<!-- Hand-written notes shown at the top of the GitHub Release, above the
generated "What's Changed" list: upgrade steps for existing projects,
behaviour changes, new flags or env vars. Leave this comment alone and add
your notes below it; an empty section adds nothing. -->

## Next steps

After the required \`ci\` check passes and this merges, run:

    bash scripts/release-tag.sh

to tag \`v${version}\` and trigger the publish workflows.
EOF
    ;;
  extract)
    # 1. Normalise CRLF. 2. Keep only the lines after "## Release notes" up to
    # the template's own "## Next steps" heading (or the end) — NOT any "## "
    # heading, so notes can use their own ## headings. 3. Drop <!-- ... -->
    # comments (may span lines). 4. Trim leading/trailing blank lines.
    tr -d '\r' | awk '
      /^## Release notes[[:space:]]*$/ { inside = 1; next }
      inside && /^## Next steps[[:space:]]*$/ { inside = 0 }
      !inside { next }
      {
        line = $0
        out = ""
        while (length(line) > 0) {
          if (in_comment) {
            end = index(line, "-->")
            if (end == 0) { line = ""; break }
            line = substr(line, end + 3)
            in_comment = 0
          } else {
            start = index(line, "<!--")
            if (start == 0) { out = out line; line = ""; break }
            out = out substr(line, 1, start - 1)
            line = substr(line, start + 4)
            in_comment = 1
          }
        }
        # A line that was only (part of) a comment disappears entirely.
        if (out == "" && $0 != "" ) next
        lines[++n] = out
      }
      END {
        first = 1; while (first <= n && lines[first] ~ /^[[:space:]]*$/) first++
        last = n;  while (last >= first && lines[last] ~ /^[[:space:]]*$/) last--
        for (i = first; i <= last; i++) print lines[i]
      }
    '
    ;;
  *)
    echo "usage: release-notes.sh body <version> | extract" >&2
    exit 1
    ;;
esac
