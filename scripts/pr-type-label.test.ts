import { describe, expect, it } from 'vitest';
import { TYPE_LABELS, labelForTitle } from './pr-type-label.mjs';

describe('labelForTitle (#513)', () => {
  it.each([
    ['feat: JSON field type (#497)', 'type: feature'],
    ['feat(cli): load .env.local (#505)', 'type: feature'],
    ['fix(cli): health-check cms.url (#503)', 'type: fix'],
    ['fix!: breaking fix', 'type: fix'],
    ['docs(#510): entrypoint step lists', 'documentation'],
    ['chore: drop pre-push hooks (#516)', 'type: chore'],
    ['ci: pin runner to ubuntu-24.04', 'type: chore'],
    ['build(deps): bump undici', 'type: chore'],
    ['chore(deps): bump sharp from 0.34.5 to 0.35.4', 'type: chore'],
    ['refactor: tidy', 'type: chore'],
    ['test: more coverage', 'type: chore'],
    ['perf: faster', 'type: chore'],
    ['chore(release): publish v0.0.3', 'release'],
  ])('%s → %s', (title, label) => {
    expect(labelForTitle(title)).toBe(label);
  });

  it.each(['Update README', 'WIP', ''])(
    'returns null for a non-conventional title (%j)',
    (title) => {
      expect(labelForTitle(title)).toBeNull();
    }
  );

  it('lists every label it can return, so stale ones can be removed', () => {
    expect([...TYPE_LABELS].sort()).toEqual(
      [
        'documentation',
        'release',
        'type: chore',
        'type: feature',
        'type: fix',
      ].sort()
    );
  });
});
