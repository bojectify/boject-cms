import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// #499: decides whether a PR's changed files can change the CMS image, so the
// `image-smoke` CI job only builds + smoke-tests the image when it could.
const SCRIPT = fileURLToPath(
  new URL('./image-inputs-changed.sh', import.meta.url)
);

function changed(paths: string[]): string {
  return execFileSync('bash', [SCRIPT], {
    input: paths.join('\n'),
    encoding: 'utf8',
  }).trim();
}

describe('image-inputs-changed.sh (#499)', () => {
  it.each([
    'apps/cms/server/api/graphql/graphql.ts',
    'apps/cms/Dockerfile',
    'starters/sport.boject.json',
    'patches/some-pkg.patch',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'package.json',
    'LICENSE',
    '.dockerignore',
    '.github/workflows/ci.yml',
    'scripts/image-inputs-changed.sh',
  ])('%s changes the image', (p) => {
    expect(changed([p])).toBe('true');
  });

  it.each([
    'README.md',
    'CONTRIBUTING.md',
    'packages/boject-cli/src/index.ts',
    'packages/create-boject-cms/package.json',
    'apps/cms-legacy/index.ts',
    '.github/workflows/publish-cms-image.yml',
    'scripts/release-notes.sh',
  ])('%s does not', (p) => {
    expect(changed([p])).toBe('false');
  });

  it('is true when any one path matches', () => {
    expect(changed(['README.md', 'apps/cms/nuxt.config.ts'])).toBe('true');
  });

  it('is false for no input', () => {
    expect(changed([])).toBe('false');
  });

  it('ignores blank lines', () => {
    expect(changed(['', 'docs/x.md', ''])).toBe('false');
  });
});
