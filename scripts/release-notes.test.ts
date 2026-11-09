import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// #513: the release PR carries a hand-written `## Release notes` section that
// release-tag.sh puts above GitHub's generated notes.
const SCRIPT = fileURLToPath(new URL('./release-notes.sh', import.meta.url));

function sh(args: string[], input = ''): string {
  return execFileSync('bash', [SCRIPT, ...args], { input, encoding: 'utf8' });
}

describe('release-notes.sh body', () => {
  const body = sh(['body', '1.2.3']);

  it('has a Release notes section with a prompt comment', () => {
    expect(body).toMatch(/^## Release notes$/m);
    expect(body).toMatch(/<!--[\s\S]*upgrade steps[\s\S]*-->/);
  });

  it('keeps the release instructions, with no stray backslashes', () => {
    expect(body).toContain('`v1.2.3`');
    expect(body).toContain('bash scripts/release-tag.sh');
    expect(body).not.toContain('\\`');
  });

  it('extracts to nothing when left untouched', () => {
    expect(sh(['extract'], body)).toBe('');
  });
});

describe('release-notes.sh extract', () => {
  it('returns the section text, trimmed, without comments', () => {
    const body = [
      'Unified version bump.',
      '',
      '## Release notes',
      '',
      '<!-- prompt',
      'spanning lines -->',
      '**Upgrade steps**',
      '- Add `.env.local` to `.gitignore`.',
      '',
      '## Next steps',
      'run release-tag',
    ].join('\n');
    expect(sh(['extract'], body)).toBe(
      '**Upgrade steps**\n- Add `.env.local` to `.gitignore`.\n'
    );
  });

  it('keeps ## headings written inside the notes; only "## Next steps" ends the section', () => {
    const body = [
      '## Release notes',
      '',
      '<!-- prompt -->',
      '',
      '## Upgrade notes',
      '- Do the thing.',
      '',
      '## Next steps',
      'run release-tag',
    ].join('\n');
    expect(sh(['extract'], body)).toBe('## Upgrade notes\n- Do the thing.\n');
  });

  it('runs to the end of the body when "## Next steps" is absent', () => {
    expect(
      sh(['extract'], '## Release notes\nOnly this.\n## Other\nAnd this.\n')
    ).toBe('Only this.\n## Other\nAnd this.\n');
  });

  it('returns nothing when there is no Release notes section', () => {
    expect(sh(['extract'], '## Summary\nnope\n')).toBe('');
  });

  it('handles CRLF bodies (GitHub API)', () => {
    expect(
      sh(['extract'], '## Release notes\r\n\r\nNote.\r\n\r\n## Next steps\r\n')
    ).toBe('Note.\n');
  });
});
