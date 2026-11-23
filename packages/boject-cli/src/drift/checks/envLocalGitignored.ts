import { join } from 'node:path';
import type { DriftCheck } from '../types.js';

export const envLocalGitignored: DriftCheck = {
  id: 'env-local-gitignored',
  appliesFrom: '0.0.2',
  severity: 'advice',
  async run(ctx) {
    const ignored = await ctx.isGitIgnored(join(ctx.root, '.env.local'));
    if (ignored === null) {
      return { skipped: "not a git repository (or git isn't installed)" };
    }
    if (ignored) return null;
    return {
      title: ".env.local isn't gitignored",
      detail: [
        '.env.local holds your CLI API key, so it must not be committed.',
      ],
      snippets: [{ file: '.gitignore', text: '.env.local' }],
    };
  },
};
