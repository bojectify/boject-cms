// PR type label from a conventional-commit PR title (#513). Used by
// .github/workflows/pr-labels.yml so .github/release.yml can group the
// generated release notes; plain ESM so the workflow can import it with no
// build step. Unit-tested in scripts/pr-type-label.test.ts.

/** Every label labelForTitle can return — the workflow removes stale ones. */
export const TYPE_LABELS = new Set([
  'type: feature',
  'type: fix',
  'type: chore',
  'documentation',
  'release',
]);

const CHORE_TYPES = new Set([
  'chore',
  'ci',
  'build',
  'refactor',
  'test',
  'perf',
  'style',
  'revert',
]);

/**
 * @param {string} title
 * @returns {string | null} the label for the title's conventional-commit type,
 *   or null when the title isn't conventional.
 */
export function labelForTitle(title) {
  const match = /^([a-z]+)(\([^)]*\))?!?:\s/.exec(title.trim());
  if (!match) return null;
  const [, type, scope] = match;
  if (type === 'chore' && scope === '(release)') return 'release';
  if (type === 'feat') return 'type: feature';
  if (type === 'fix') return 'type: fix';
  if (type === 'docs') return 'documentation';
  if (CHORE_TYPES.has(type)) return 'type: chore';
  return null;
}
