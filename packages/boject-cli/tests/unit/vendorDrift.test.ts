import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');

const PAIRS: Array<{ canonical: string; vendored: string }> = [
  {
    canonical: 'perf/lib/config-k6.ts',
    vendored: 'packages/boject-cli/src/vendor/perf/lib/config-k6.ts',
  },
  {
    canonical: 'perf/lib/auth-k6.ts',
    vendored: 'packages/boject-cli/src/vendor/perf/lib/auth-k6.ts',
  },
  {
    canonical: 'perf/lib/metrics-k6.ts',
    vendored: 'packages/boject-cli/src/vendor/perf/lib/metrics-k6.ts',
  },
  {
    canonical: 'perf/lib/pg-sampler.ts',
    vendored: 'packages/boject-cli/src/vendor/perf/lib/pg-sampler.ts',
  },
  {
    canonical: 'perf/scenarios/graphql-flat.ts',
    vendored: 'packages/boject-cli/src/vendor/perf/scenarios/graphql-flat.ts',
  },
  {
    canonical: 'perf/scenarios/graphql-sitemap.ts',
    vendored:
      'packages/boject-cli/src/vendor/perf/scenarios/graphql-sitemap.ts',
  },
  {
    canonical: 'perf/scenarios/rest-crud-cycle.ts',
    vendored:
      'packages/boject-cli/src/vendor/perf/scenarios/rest-crud-cycle.ts',
  },
  {
    canonical: 'apps/cms/utils/apiKeyScopes.ts',
    vendored: 'packages/boject-cli/src/vendor/apiKeyScopes.ts',
  },
  {
    canonical: 'apps/cms/utils/slugify.ts',
    vendored: 'packages/boject-cli/src/vendor/slugify.ts',
  },
];

describe('vendored files are byte-identical to canonicals', () => {
  for (const pair of PAIRS) {
    it(`${pair.vendored} matches ${pair.canonical}`, async () => {
      const a = await readFile(resolve(REPO_ROOT, pair.canonical), 'utf8');
      const b = await readFile(resolve(REPO_ROOT, pair.vendored), 'utf8');
      expect(b).toBe(a);
    });
  }
});
