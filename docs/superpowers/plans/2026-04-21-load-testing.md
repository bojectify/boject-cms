# Load Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a k6-based load-testing harness in a new top-level `perf/` workspace that runs locally against docker-compose, produces a committed report with operator recommendations, and opens six follow-up tickets with concrete numbers pre-filled.

**Architecture:** `perf/` is a new pnpm workspace package. k6 scripts run against the Nuxt app for load generation; Node/tsx scripts handle seeding (via Prisma), Postgres sampling, orchestration, and report rendering. Env-var config so operators can run it against their own deployments. Reports (markdown + CSV + PNG plots) are committed under `perf/reports/YYYY-MM-DD-<run-id>/`.

**Tech Stack:** k6 (local binary), TypeScript (both k6's goja runtime and Node/tsx), Prisma (seeding, imported from `apps/cms/generated/prisma`), `chartjs-node-canvas` (PNG plots), `pg` (sampler), vitest (unit tests), lefthook (format/lint gates).

**Key context:**

- Spec: `docs/superpowers/specs/2026-04-21-load-testing-design.md`
- Tracking issue: #88
- The `perf/` workspace sits alongside `apps/cms` and `packages/*`; it is NOT shipped in the CMS Docker image.
- k6 scripts (`perf/scenarios/*.ts`) run in k6's goja VM — **no node_modules imports allowed**, only `k6/*` built-ins and k6-compatible relative imports. Auth headers go via `k6/http`.
- Node scripts (`perf/seed/*`, `perf/scripts/*`, `perf/lib/pg-sampler.ts`) run via `tsx` and can use full node_modules.
- Existing DI pattern to follow: `apps/cms/scripts/docker-entrypoint/*.ts` — pure logic function with injectable dependencies, plus a CLI entry block gated on `import.meta.url`.

---

## File Structure

**New workspace package** (`perf/`):

- `perf/package.json` — workspace pkg with `test`/`typecheck` scripts
- `perf/tsconfig.json` — TS config for Node/tsx code
- `perf/tsconfig.k6.json` — TS config for k6 scripts (separate because k6 strips Node types)
- `perf/vitest.config.ts` — unit test config for Node-side code
- `perf/README.md` — operator docs

**Config (shared between k6 + Node):**

- `perf/lib/config-node.ts` — `process.env` parsing for Node scripts
- `perf/lib/config-node.test.ts`
- `perf/lib/config-k6.ts` — `__ENV` parsing for k6 scripts

**Seed helpers (Node only):**

- `perf/seed/contentTypes.ts` — `PerfArticle` + `PerfAuthor` ContentType definitions
- `perf/seed/contentTypes.test.ts`
- `perf/seed/richtext-fixture.ts` — deterministic ~5KB ProseMirror JSON generator
- `perf/seed/richtext-fixture.test.ts`
- `perf/seed/reset.ts` — truncate perf DB
- `perf/seed/reset.test.ts`
- `perf/seed/bulk-insert.ts` — prisma.createMany seeder + CLI entry
- `perf/seed/bulk-insert.test.ts`

**k6 lib (k6 runtime only):**

- `perf/lib/auth-k6.ts` — API key Bearer header + session login helpers
- `perf/lib/metrics-k6.ts` — custom Trend metrics

**Scenarios (k6 runtime):**

- `perf/scenarios/graphql-sitemap.ts`
- `perf/scenarios/graphql-flat.ts`
- `perf/scenarios/rest-crud-cycle.ts`

**Observability (Node):**

- `perf/lib/pg-sampler.ts` — polls `pg_stat_activity` + `docker stats` every 5s + CLI entry
- `perf/lib/pg-sampler.test.ts`

**Orchestration & reporting (Node):**

- `perf/scripts/sweep.ts` — full multi-size orchestrator + CLI entry
- `perf/scripts/sweep.test.ts`
- `perf/scripts/render-report.ts` — raw.json → summary.md + plots + CLI entry
- `perf/scripts/render-report.test.ts`
- `perf/scripts/render-report.fixtures/tiny-raw.json` — recorded k6 fixture
- `perf/scripts/open-followups.ts` — gh CLI wrapper + dry-run mode + CLI entry
- `perf/scripts/open-followups.test.ts`

**Docs:**

- `docs/performance/README.md` — operator-facing mirror of report highlights
- `README.md` — add "Performance" section linking to `perf/README.md`

**Workspace + root:**

- `pnpm-workspace.yaml` — add `perf` to `packages`
- `package.json` (root) — add `perf:*` forwarding scripts
- `.gitignore` — ignore `perf/reports/**/raw.json` (only if it grows >10MB; see Task 18)

---

## Task 1: Create `perf/` workspace skeleton

**Files:**

- Modify: `pnpm-workspace.yaml`
- Create: `perf/package.json`
- Create: `perf/tsconfig.json`
- Create: `perf/tsconfig.k6.json`
- Create: `perf/vitest.config.ts`
- Create: `perf/.gitignore`
- Create: `perf/README.md` (stub — fully written in Task 19)

- [ ] **Step 1: Add `perf` to workspace packages**

Edit `pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'perf'

onlyBuiltDependencies:
  - esbuild
  - '@parcel/watcher'
  - prisma
  - lefthook
  - sharp

patchedDependencies:
  '@nuxt/test-utils@4.0.0': patches/@nuxt__test-utils@4.0.0.patch
```

- [ ] **Step 2: Create `perf/package.json`**

```json
{
  "name": "@boject/perf",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "typecheck:k6": "tsc --noEmit -p tsconfig.k6.json",
    "seed": "tsx seed/bulk-insert.ts",
    "reset": "tsx seed/reset.ts",
    "sweep": "tsx scripts/sweep.ts",
    "report": "tsx scripts/render-report.ts",
    "followups": "tsx scripts/open-followups.ts"
  },
  "dependencies": {
    "chartjs-node-canvas": "^5.0.0",
    "chart.js": "^4.5.0",
    "pg": "^8.13.1",
    "tsx": "^4.21.0"
  },
  "devDependencies": {
    "@types/k6": "^1.3.0",
    "@types/node": "^24.12.2",
    "@types/pg": "^8.11.10",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 3: Create `perf/tsconfig.json` (Node-side)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "types": ["node"]
  },
  "include": ["lib/**/*.ts", "seed/**/*.ts", "scripts/**/*.ts"],
  "exclude": ["scenarios/**/*.ts", "lib/auth-k6.ts", "lib/metrics-k6.ts"]
}
```

- [ ] **Step 4: Create `perf/tsconfig.k6.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["k6"]
  },
  "include": ["scenarios/**/*.ts", "lib/auth-k6.ts", "lib/metrics-k6.ts"]
}
```

- [ ] **Step 5: Create `perf/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts', 'seed/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['scenarios/**', 'reports/**'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
```

- [ ] **Step 6: Create `perf/.gitignore`**

```
node_modules
*.log
# Ignore transient sampler output; real sampler output lives under reports/
/tmp-samples/
```

- [ ] **Step 7: Create `perf/README.md` stub**

```markdown
# Performance suite

Full docs pending. See `docs/superpowers/specs/2026-04-21-load-testing-design.md`.
```

- [ ] **Step 8: Install and verify**

Run: `pnpm install`
Expected: `@boject/perf` resolves, no errors.

Run: `pnpm --filter @boject/perf typecheck`
Expected: PASS (no TS files yet beyond stubs, so no errors).

- [ ] **Step 9: Add root forwarding scripts**

Edit root `package.json` `scripts` block, appending:

```json
    "perf:seed": "pnpm --filter @boject/perf seed",
    "perf:reset": "pnpm --filter @boject/perf reset",
    "perf:sweep": "pnpm --filter @boject/perf sweep",
    "perf:report": "pnpm --filter @boject/perf report",
    "perf:followups": "pnpm --filter @boject/perf followups",
    "perf:scenario": "pnpm --filter @boject/perf scenario"
```

(`perf:scenario` will be wired in Task 15 after scenarios exist.)

- [ ] **Step 10: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml perf/
git commit -m "chore(perf): scaffold @boject/perf workspace package"
```

---

## Task 2: Config modules (Node + k6)

**Files:**

- Create: `perf/lib/config-node.ts`
- Create: `perf/lib/config-node.test.ts`
- Create: `perf/lib/config-k6.ts`

- [ ] **Step 1: Write failing test**

Create `perf/lib/config-node.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadNodeConfig } from './config-node';

describe('loadNodeConfig', () => {
  it('returns defaults when env vars are unset', () => {
    const cfg = loadNodeConfig({});
    expect(cfg.baseUrl).toBe('http://localhost:4000');
    expect(cfg.perfDatabaseUrl).toBe(
      'postgresql://boject:boject@localhost:5432/boject_perf'
    );
    expect(cfg.apiKey).toBeUndefined();
  });

  it('reads overrides from env', () => {
    const cfg = loadNodeConfig({
      PERF_BASE_URL: 'https://staging.example.com',
      PERF_API_KEY: 'boject_test_abc',
      PERF_DATABASE_URL: 'postgresql://u:p@h:5432/db',
    });
    expect(cfg.baseUrl).toBe('https://staging.example.com');
    expect(cfg.apiKey).toBe('boject_test_abc');
    expect(cfg.perfDatabaseUrl).toBe('postgresql://u:p@h:5432/db');
  });

  it('trims trailing slash from baseUrl', () => {
    const cfg = loadNodeConfig({ PERF_BASE_URL: 'http://example.com/' });
    expect(cfg.baseUrl).toBe('http://example.com');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @boject/perf test lib/config-node`
Expected: FAIL (`Cannot find module './config-node'`).

- [ ] **Step 3: Implement `config-node.ts`**

Create `perf/lib/config-node.ts`:

```ts
export interface PerfNodeConfig {
  baseUrl: string;
  perfDatabaseUrl: string;
  apiKey: string | undefined;
  adminEmail: string;
  adminPassword: string;
}

const DEFAULTS = {
  baseUrl: 'http://localhost:4000',
  perfDatabaseUrl: 'postgresql://boject:boject@localhost:5432/boject_perf',
  adminEmail: 'admin@example.com',
  adminPassword: 'password',
};

export function loadNodeConfig(
  env: NodeJS.ProcessEnv = process.env
): PerfNodeConfig {
  const baseUrl = (env.PERF_BASE_URL ?? DEFAULTS.baseUrl).replace(/\/$/, '');
  return {
    baseUrl,
    perfDatabaseUrl: env.PERF_DATABASE_URL ?? DEFAULTS.perfDatabaseUrl,
    apiKey: env.PERF_API_KEY,
    adminEmail: env.PERF_ADMIN_EMAIL ?? DEFAULTS.adminEmail,
    adminPassword: env.PERF_ADMIN_PASSWORD ?? DEFAULTS.adminPassword,
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @boject/perf test lib/config-node`
Expected: 3 tests pass.

- [ ] **Step 5: Create `config-k6.ts`**

Create `perf/lib/config-k6.ts`:

```ts
// k6 runtime (goja VM). Reads `__ENV` — no process.env, no node_modules.

export interface PerfK6Config {
  baseUrl: string;
  apiKey: string | undefined;
  adminEmail: string;
  adminPassword: string;
}

export function loadK6Config(): PerfK6Config {
  const baseUrl = (__ENV.PERF_BASE_URL || 'http://localhost:4000').replace(
    /\/$/,
    ''
  );
  return {
    baseUrl,
    apiKey: __ENV.PERF_API_KEY || undefined,
    adminEmail: __ENV.PERF_ADMIN_EMAIL || 'admin@example.com',
    adminPassword: __ENV.PERF_ADMIN_PASSWORD || 'password',
  };
}
```

(No test — single-branch env read, trivial, covered indirectly by scenario smoke runs.)

- [ ] **Step 6: Commit**

```bash
git add perf/lib/config-node.ts perf/lib/config-node.test.ts perf/lib/config-k6.ts
git commit -m "feat(perf): add node + k6 config loaders"
```

---

## Task 3: Perf database bootstrap + reset

**Files:**

- Modify: `docker-compose.yml` (add init script for `boject_perf` DB)
- Create: `docker/postgres-init/10-create-perf-db.sql`
- Create: `perf/seed/reset.ts`
- Create: `perf/seed/reset.test.ts`

- [ ] **Step 1: Check if `docker/postgres-init/` is already wired**

Run: `grep -n "postgres-init\|docker-entrypoint-initdb" docker-compose.yml`

If the volume mount already exists, skip to Step 3. Otherwise proceed to Step 2.

- [ ] **Step 2: Add init-script volume to docker-compose.yml**

Add under the `postgres` service's `volumes:` block:

```yaml
- ./docker/postgres-init:/docker-entrypoint-initdb.d:ro
```

Init scripts run only when the data volume is empty, so existing dev DBs are unaffected.

- [ ] **Step 3: Create the init script**

Create `docker/postgres-init/10-create-perf-db.sql`:

```sql
SELECT 'CREATE DATABASE boject_perf'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'boject_perf')\gexec
```

Also add a human-readable README at `docker/postgres-init/README.md` (one paragraph, explains that scripts run only on first init and tell devs how to recreate perf DB manually: `docker compose exec postgres psql -U boject -c "CREATE DATABASE boject_perf;"`).

- [ ] **Step 4: Write failing test for `reset.ts`**

Create `perf/seed/reset.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { resetPerfDb } from './reset';

describe('resetPerfDb', () => {
  it('runs TRUNCATE statements in dependency order', async () => {
    const queries: string[] = [];
    const runQuery = vi.fn(async (sql: string) => {
      queries.push(sql);
    });
    await resetPerfDb({
      databaseUrl: 'postgresql://u:p@h/boject_perf',
      runQuery,
    });
    // Join to one string for stable assertion
    const combined = queries.join('\n');
    expect(combined).toContain(
      'TRUNCATE TABLE "ContentEntryVersion" RESTART IDENTITY CASCADE'
    );
    expect(combined).toContain(
      'TRUNCATE TABLE "ContentEntry" RESTART IDENTITY CASCADE'
    );
    expect(combined).toContain(
      'TRUNCATE TABLE "ContentTypeField" RESTART IDENTITY CASCADE'
    );
    expect(combined).toContain(
      'TRUNCATE TABLE "ContentType" RESTART IDENTITY CASCADE'
    );
    // Versions truncated before entries; fields before types (no constraint issues since CASCADE, but keep order explicit)
    expect(runQuery).toHaveBeenCalled();
  });

  it('refuses to run against non-perf database URLs', async () => {
    await expect(
      resetPerfDb({
        databaseUrl: 'postgresql://u:p@h/boject',
        runQuery: vi.fn(),
      })
    ).rejects.toThrow(/refusing/i);
  });
});
```

- [ ] **Step 5: Run — expect FAIL**

Run: `pnpm --filter @boject/perf test seed/reset`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 6: Implement `reset.ts`**

Create `perf/seed/reset.ts`:

```ts
import { Client } from 'pg';
import { loadNodeConfig } from '../lib/config-node.ts';

export interface ResetOptions {
  databaseUrl: string;
  runQuery: (sql: string) => Promise<void>;
}

const TABLES_IN_ORDER = [
  'ContentEntryVersion',
  'ContentEntry',
  'ContentTypeField',
  'ContentType',
];

export async function resetPerfDb(opts: ResetOptions): Promise<void> {
  // Safety rail: never allow running against dev/test/prod DBs.
  if (!/\/boject_perf(\?|$)/.test(opts.databaseUrl)) {
    throw new Error(
      `resetPerfDb refusing to run against non-perf database: ${opts.databaseUrl}`
    );
  }
  for (const table of TABLES_IN_ORDER) {
    await opts.runQuery(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`);
  }
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadNodeConfig();
  const client = new Client({ connectionString: cfg.perfDatabaseUrl });
  await client.connect();
  try {
    await resetPerfDb({
      databaseUrl: cfg.perfDatabaseUrl,
      runQuery: async (sql) => {
        await client.query(sql);
      },
    });
    console.log(`[perf:reset] truncated all tables in ${cfg.perfDatabaseUrl}`);
  } finally {
    await client.end();
  }
}
```

Note: the `.ts` extension on the relative import matches the Nuxt-app pattern for tsx-executed scripts.

- [ ] **Step 7: Run — expect PASS**

Run: `pnpm --filter @boject/perf test seed/reset`
Expected: 2 tests pass.

- [ ] **Step 8: Manually verify CLI works**

```bash
# Ensure perf DB exists (first-time setup)
docker compose exec postgres psql -U boject -c "CREATE DATABASE boject_perf;" 2>/dev/null || true
# Copy the CMS Prisma schema into the perf DB
DATABASE_URL=postgresql://boject:boject@localhost:5432/boject_perf pnpm --filter cms prisma:migrate
# Run reset
pnpm perf:reset
```

Expected output: `[perf:reset] truncated all tables in postgresql://boject:boject@localhost:5432/boject_perf`

- [ ] **Step 9: Commit**

```bash
git add docker-compose.yml docker/postgres-init perf/seed/reset.ts perf/seed/reset.test.ts
git commit -m "feat(perf): bootstrap boject_perf database + reset helper"
```

---

## Task 4: Perf content type definitions

**Files:**

- Create: `perf/seed/contentTypes.ts`
- Create: `perf/seed/contentTypes.test.ts`

- [ ] **Step 1: Write failing test**

Create `perf/seed/contentTypes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PERF_CONTENT_TYPES } from './contentTypes';

describe('PERF_CONTENT_TYPES', () => {
  it('defines PerfArticle and PerfAuthor', () => {
    const idents = PERF_CONTENT_TYPES.map((c) => c.identifier);
    expect(idents).toEqual(['PerfAuthor', 'PerfArticle']);
  });

  it('PerfArticle has exactly one ENTRY_TITLE and one SLUG', () => {
    const article = PERF_CONTENT_TYPES.find(
      (c) => c.identifier === 'PerfArticle'
    )!;
    const titles = article.fields.filter((f) => f.type === 'ENTRY_TITLE');
    const slugs = article.fields.filter((f) => f.type === 'SLUG');
    expect(titles).toHaveLength(1);
    expect(slugs).toHaveLength(1);
  });

  it('PerfArticle has author RELATION field targeting PerfAuthor', () => {
    const article = PERF_CONTENT_TYPES.find(
      (c) => c.identifier === 'PerfArticle'
    )!;
    const author = article.fields.find((f) => f.identifier === 'author');
    expect(author?.type).toBe('RELATION');
    expect(
      (author as { options?: { targetContentTypeIdentifiers?: string[] } })
        .options?.targetContentTypeIdentifiers
    ).toEqual(['PerfAuthor']);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @boject/perf test seed/contentTypes`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `perf/seed/contentTypes.ts`:

```ts
export interface PerfFieldDef {
  identifier: string;
  name: string;
  type:
    | 'ENTRY_TITLE'
    | 'SLUG'
    | 'TEXT'
    | 'TEXTAREA'
    | 'RICHTEXT'
    | 'DATETIME'
    | 'RELATION';
  required?: boolean;
  options?: Record<string, unknown>;
}

export interface PerfContentTypeDef {
  identifier: string;
  name: string;
  description: string;
  fields: PerfFieldDef[];
}

export const PERF_CONTENT_TYPES: PerfContentTypeDef[] = [
  {
    identifier: 'PerfAuthor',
    name: 'Perf Author',
    description: 'Generated by @boject/perf. Safe to delete outside perf runs.',
    fields: [
      { identifier: 'name', name: 'Name', type: 'ENTRY_TITLE', required: true },
      { identifier: 'bio', name: 'Bio', type: 'TEXTAREA' },
    ],
  },
  {
    identifier: 'PerfArticle',
    name: 'Perf Article',
    description: 'Generated by @boject/perf. Safe to delete outside perf runs.',
    fields: [
      {
        identifier: 'title',
        name: 'Title',
        type: 'ENTRY_TITLE',
        required: true,
      },
      { identifier: 'slug', name: 'Slug', type: 'SLUG' },
      { identifier: 'excerpt', name: 'Excerpt', type: 'TEXT' },
      { identifier: 'body', name: 'Body', type: 'RICHTEXT' },
      { identifier: 'publishDate', name: 'Publish Date', type: 'DATETIME' },
      {
        identifier: 'author',
        name: 'Author',
        type: 'RELATION',
        options: { targetContentTypeIdentifiers: ['PerfAuthor'] },
      },
    ],
  },
];
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @boject/perf test seed/contentTypes`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add perf/seed/contentTypes.ts perf/seed/contentTypes.test.ts
git commit -m "feat(perf): define PerfArticle + PerfAuthor content types"
```

---

## Task 5: Deterministic richtext fixture generator

**Files:**

- Create: `perf/seed/richtext-fixture.ts`
- Create: `perf/seed/richtext-fixture.test.ts`

- [ ] **Step 1: Write failing test**

Create `perf/seed/richtext-fixture.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generateRichtext } from './richtext-fixture';

describe('generateRichtext', () => {
  it('produces ProseMirror JSON with doc type and content', () => {
    const doc = generateRichtext(1);
    expect(doc.type).toBe('doc');
    expect(Array.isArray(doc.content)).toBe(true);
    expect(doc.content!.length).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed', () => {
    const a = generateRichtext(42);
    const b = generateRichtext(42);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produces different output for different seeds', () => {
    const a = generateRichtext(1);
    const b = generateRichtext(2);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('output serialises to approximately 5KB', () => {
    const size = JSON.stringify(generateRichtext(1)).length;
    expect(size).toBeGreaterThan(3500);
    expect(size).toBeLessThan(7500);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @boject/perf test seed/richtext-fixture`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `perf/seed/richtext-fixture.ts`:

```ts
export interface ProseMirrorNode {
  type: string;
  content?: ProseMirrorNode[];
  text?: string;
  marks?: { type: string }[];
  attrs?: Record<string, unknown>;
}

const LOREM = (
  'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ' +
  'tempor incididunt ut labore et dolore magna aliqua Ut enim ad minim ' +
  'veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea ' +
  'commodo consequat Duis aute irure dolor in reprehenderit in voluptate ' +
  'velit esse cillum dolore eu fugiat nulla pariatur Excepteur sint ' +
  'occaecat cupidatat non proident sunt in culpa qui officia deserunt ' +
  'mollit anim id est laborum Sed ut perspiciatis unde omnis iste natus ' +
  'error sit voluptatem accusantium doloremque laudantium totam rem aperiam'
).split(' ');

// Simple seeded xorshift PRNG for determinism across runtimes
function rng(seed: number): () => number {
  let state = seed | 0;
  if (state === 0) state = 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1000) / 1000;
  };
}

function pickN<T>(arr: T[], n: number, rand: () => number): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(arr[Math.floor(rand() * arr.length)]!);
  }
  return out;
}

function paragraph(rand: () => number): ProseMirrorNode {
  const wordCount = 40 + Math.floor(rand() * 40);
  return {
    type: 'paragraph',
    content: [{ type: 'text', text: pickN(LOREM, wordCount, rand).join(' ') }],
  };
}

function heading(level: number, rand: () => number): ProseMirrorNode {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text: pickN(LOREM, 5, rand).join(' ') }],
  };
}

function bulletList(rand: () => number): ProseMirrorNode {
  const items: ProseMirrorNode[] = [];
  const count = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    items.push({
      type: 'listItem',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: pickN(LOREM, 8, rand).join(' ') }],
        },
      ],
    });
  }
  return { type: 'bulletList', content: items };
}

export function generateRichtext(seed: number): ProseMirrorNode {
  const rand = rng(seed);
  const content: ProseMirrorNode[] = [
    heading(1, rand),
    paragraph(rand),
    paragraph(rand),
    heading(2, rand),
    paragraph(rand),
    bulletList(rand),
    paragraph(rand),
    heading(2, rand),
    paragraph(rand),
    paragraph(rand),
  ];
  return { type: 'doc', content };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @boject/perf test seed/richtext-fixture`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add perf/seed/richtext-fixture.ts perf/seed/richtext-fixture.test.ts
git commit -m "feat(perf): deterministic ProseMirror richtext generator"
```

---

## Task 6: Bulk insert seeder

**Files:**

- Create: `perf/seed/bulk-insert.ts`
- Create: `perf/seed/bulk-insert.test.ts`

Prisma client pattern: import from `../../apps/cms/generated/prisma/client.ts` (mirrors `apps/cms/scripts/docker-entrypoint/*.ts`).

- [ ] **Step 1: Write failing test (logic-only, Prisma mocked)**

Create `perf/seed/bulk-insert.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildSeedRows } from './bulk-insert';

describe('buildSeedRows', () => {
  it('produces N articles + 50 authors with distinct slugs and titles', () => {
    const rows = buildSeedRows({ articleCount: 10, authorCount: 5, seed: 1 });
    expect(rows.authors).toHaveLength(5);
    expect(rows.articles).toHaveLength(10);
    const slugs = new Set(rows.articles.map((a) => a.slug));
    const titles = new Set(rows.articles.map((a) => a.entryTitle));
    expect(slugs.size).toBe(10);
    expect(titles.size).toBe(10);
  });

  it('article data has required fields', () => {
    const rows = buildSeedRows({ articleCount: 1, authorCount: 1, seed: 1 });
    const article = rows.articles[0]!;
    expect(article.data.title).toBeDefined();
    expect(article.data.slug).toBeDefined();
    expect(article.data.body).toMatchObject({ type: 'doc' });
    expect(article.data.author).toMatchObject({
      contentTypeIdentifier: 'PerfAuthor',
    });
  });

  it('articles round-robin over authors', () => {
    const rows = buildSeedRows({ articleCount: 6, authorCount: 3, seed: 1 });
    const indexes = rows.articles.map((a) => a.authorIndex);
    expect(indexes).toEqual([0, 1, 2, 0, 1, 2]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @boject/perf test seed/bulk-insert`
Expected: FAIL.

- [ ] **Step 3: Implement `bulk-insert.ts`**

Create `perf/seed/bulk-insert.ts`:

```ts
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../apps/cms/generated/prisma/client.ts';
import { loadNodeConfig } from '../lib/config-node.ts';
import { PERF_CONTENT_TYPES } from './contentTypes.ts';
import { generateRichtext } from './richtext-fixture.ts';

export interface SeedRowOptions {
  articleCount: number;
  authorCount: number;
  seed: number;
}

export interface SeedRows {
  authors: Array<{
    id: string;
    entryTitle: string;
    data: { name: string; bio: string };
  }>;
  articles: Array<{
    id: string;
    entryTitle: string;
    slug: string;
    authorIndex: number;
    data: {
      title: string;
      slug: string;
      excerpt: string;
      body: ReturnType<typeof generateRichtext>;
      publishDate: string;
      author: {
        contentTypeIdentifier: string;
        entryId: string; // resolved at insert time; placeholder here
      };
    };
  }>;
}

export function buildSeedRows(opts: SeedRowOptions): SeedRows {
  const authors = Array.from({ length: opts.authorCount }).map((_, i) => {
    const id = `perf-author-${opts.seed}-${i}`;
    return {
      id,
      entryTitle: `Perf Author ${opts.seed}-${i}`,
      data: {
        name: `Perf Author ${opts.seed}-${i}`,
        bio: `Bio ${i} generated for perf run seed ${opts.seed}.`,
      },
    };
  });

  const articles = Array.from({ length: opts.articleCount }).map((_, i) => {
    const authorIndex = i % Math.max(authors.length, 1);
    const id = `perf-article-${opts.seed}-${i}`;
    const slug = `perf-article-${opts.seed}-${i}`;
    const title = `Perf Article ${opts.seed}-${i}`;
    const body = generateRichtext(opts.seed * 10000 + i);
    const publishDate = new Date(
      Date.UTC(2020, 0, 1) + i * 60_000
    ).toISOString();
    return {
      id,
      entryTitle: title,
      slug,
      authorIndex,
      data: {
        title,
        slug,
        excerpt: `Excerpt for article ${i}.`,
        body,
        publishDate,
        author: {
          contentTypeIdentifier: 'PerfAuthor',
          entryId: authors[authorIndex]!.id,
        },
      },
    };
  });

  return { authors, articles };
}

export interface SeedExecOptions {
  prisma: PrismaClient;
  articleCount: number;
  authorCount?: number;
  seed?: number;
}

export async function seedPerfData(opts: SeedExecOptions): Promise<void> {
  const authorCount = opts.authorCount ?? 50;
  const seed = opts.seed ?? 1;
  const { prisma } = opts;

  // 1. Ensure content types exist (idempotent — upsert by identifier).
  const typeIds = new Map<string, string>();
  for (const ct of PERF_CONTENT_TYPES) {
    const existing = await prisma.contentType.findUnique({
      where: { identifier: ct.identifier },
      include: { fields: true },
    });
    if (existing) {
      typeIds.set(ct.identifier, existing.id);
      continue;
    }
    const created = await prisma.contentType.create({
      data: {
        identifier: ct.identifier,
        name: ct.name,
        description: ct.description,
        fields: {
          create: ct.fields.map((f, order) => ({
            identifier: f.identifier,
            name: f.name,
            type: f.type,
            required: f.required ?? false,
            unique:
              f.type === 'ENTRY_TITLE' ||
              f.type === 'SLUG' ||
              f.identifier === 'slug',
            order,
            options: resolveOptions(f.options),
          })),
        },
      },
    });
    typeIds.set(ct.identifier, created.id);
  }

  const authorTypeId = typeIds.get('PerfAuthor')!;
  const articleTypeId = typeIds.get('PerfArticle')!;

  const rows = buildSeedRows({
    articleCount: opts.articleCount,
    authorCount,
    seed,
  });

  // 2. Insert authors — envelope + published version.
  const authorEntryIds: string[] = [];
  for (const a of rows.authors) {
    const entry = await prisma.contentEntry.create({
      data: {
        id: randomUUID(),
        contentTypeId: authorTypeId,
        entryTitle: a.entryTitle,
        versions: {
          create: {
            id: randomUUID(),
            status: 'PUBLISHED',
            entryTitle: a.entryTitle,
            data: a.data as object,
            publishedAt: new Date(),
          },
        },
      },
    });
    authorEntryIds.push(entry.id);
  }

  // 3. Insert articles in batches via createMany (envelope), then
  //    createMany for their PUBLISHED versions. ~4× faster than per-row creates.
  const BATCH = 500;
  for (let start = 0; start < rows.articles.length; start += BATCH) {
    const slice = rows.articles.slice(start, start + BATCH);
    const envelopeIds = slice.map(() => randomUUID());
    await prisma.contentEntry.createMany({
      data: slice.map((art, j) => ({
        id: envelopeIds[j]!,
        contentTypeId: articleTypeId,
        entryTitle: art.entryTitle,
        slug: art.slug,
      })),
    });
    await prisma.contentEntryVersion.createMany({
      data: slice.map((art, j) => ({
        id: randomUUID(),
        entryId: envelopeIds[j]!,
        status: 'PUBLISHED',
        entryTitle: art.entryTitle,
        data: {
          ...art.data,
          author: {
            contentTypeIdentifier: 'PerfAuthor',
            entryId: authorEntryIds[art.authorIndex]!,
          },
        } as object,
        publishedAt: new Date(),
      })),
    });
  }
}

function resolveOptions(
  opts: Record<string, unknown> | undefined
): object | null {
  if (!opts) return null;
  // Translate `targetContentTypeIdentifiers` (stable) into the shape
  // the CMS uses (`targetContentTypeIds`). Done at seed time once we
  // know the real UUIDs. Keep a marker so the caller can resolve it.
  return opts;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: { size: { type: 'string', default: '10000' } },
  });
  const articleCount = Number(values.size);
  if (!Number.isFinite(articleCount) || articleCount < 1) {
    console.error(`Invalid --size: ${values.size}`);
    process.exit(1);
  }

  const cfg = loadNodeConfig();
  const prisma = new PrismaClient({
    datasourceUrl: cfg.perfDatabaseUrl,
  });

  const started = Date.now();
  try {
    await seedPerfData({ prisma, articleCount });
    console.log(
      `[perf:seed] inserted ${articleCount} articles in ${(
        (Date.now() - started) /
        1000
      ).toFixed(1)}s`
    );
  } finally {
    await prisma.$disconnect();
  }
}
```

Note: `resolveOptions` currently returns the overlay shape as-is. The actual field-options schema used by the CMS (`targetContentTypeIds`) is resolved on the fly inside `seedPerfData` when the relation is serialized — article data writes `entryId` directly against the real UUID.

Also note: content-type options (stored on `ContentTypeField.options`) need the real target UUIDs, not identifiers. Update the `fields.create` block above to resolve `targetContentTypeIdentifiers` to `targetContentTypeIds` using `typeIds` — see Step 4 fix below if the test doesn't catch this case.

- [ ] **Step 4: Fix relation field options to use real UUIDs**

Update the content-type insertion loop: after seeding PerfAuthor first, fetch its id, then seed PerfArticle with `options: { targetContentTypeIds: [authorTypeId] }` for the `author` field. Re-order `PERF_CONTENT_TYPES` processing so PerfAuthor is inserted first (already the case in the array). Replace the inline `options: resolveOptions(f.options)` with:

```ts
options: resolveFieldOptions(f, typeIds),
```

and add this helper in the same file:

```ts
function resolveFieldOptions(
  f: (typeof PERF_CONTENT_TYPES)[number]['fields'][number],
  typeIds: Map<string, string>
): object | null {
  const opts = f.options;
  if (!opts) return null;
  const targets = (opts as { targetContentTypeIdentifiers?: string[] })
    .targetContentTypeIdentifiers;
  if (!targets) return opts;
  const targetContentTypeIds = targets
    .map((ident) => typeIds.get(ident))
    .filter((id): id is string => Boolean(id));
  return { targetContentTypeIds };
}
```

Remove the earlier placeholder `resolveOptions`.

- [ ] **Step 5: Run logic test — expect PASS**

Run: `pnpm --filter @boject/perf test seed/bulk-insert`
Expected: 3 tests pass.

- [ ] **Step 6: Manual end-to-end verification**

```bash
# Migrate perf DB schema (once)
DATABASE_URL=postgresql://boject:boject@localhost:5432/boject_perf pnpm --filter cms prisma:migrate
# Reset and seed
pnpm perf:reset
pnpm perf:seed -- --size=1000
```

Expected output: `[perf:seed] inserted 1000 articles in X.Xs` (under 10s on modern hardware).

Verify: `docker compose exec postgres psql -U boject -d boject_perf -c 'SELECT COUNT(*) FROM "ContentEntry";'` → ~1050.

- [ ] **Step 7: Commit**

```bash
git add perf/seed/bulk-insert.ts perf/seed/bulk-insert.test.ts
git commit -m "feat(perf): bulk Prisma seeder for PerfArticle + PerfAuthor"
```

---

## Task 7: Perf test API key helper + docs

**Files:**

- Modify: `apps/cms/prisma/seed.ts` (extend to seed a deterministic perf API key when `SEED_PERF_KEY=1`)
- Create: `perf/seed/api-key.ts` (convenience wrapper)
- Create: `perf/seed/api-key.test.ts`

Rationale: scenarios need an API key. We don't want to persist a "perf" key in the normal CMS seed (keeps prod clean), and we don't want scenarios to hit the apikey-create endpoint every run. Solution: flag-gated seed + a helper that asserts the key exists.

- [ ] **Step 1: Read existing seed**

Run: `cat apps/cms/prisma/seed.ts | head -80`
Note the pattern used for `apiKey` creation.

- [ ] **Step 2: Extend `apps/cms/prisma/seed.ts`**

Add a block after the existing test-key creation, gated on an env flag:

```ts
if (process.env.SEED_PERF_KEY === '1') {
  const PERF_KEY_RAW = 'boject_perf_key_for_load_tests_only';
  const { createHash } = await import('node:crypto');
  const keyHash = createHash('sha256').update(PERF_KEY_RAW).digest('hex');
  const keyPrefix = PERF_KEY_RAW.slice(0, 11);
  await prisma.apiKey.upsert({
    where: { keyHash },
    update: {},
    create: { name: '@boject/perf load test key', keyHash, keyPrefix },
  });
  console.log('[seed] perf load-test API key present');
}
```

(Use the same hashing util the existing test-key seeding uses — copy that pattern verbatim to avoid drift.)

- [ ] **Step 3: Write test for `perf/seed/api-key.ts`**

Create `perf/seed/api-key.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ensurePerfApiKey } from './api-key';

describe('ensurePerfApiKey', () => {
  it('returns the raw key when the hash row exists', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'x' });
    const key = await ensurePerfApiKey({
      prisma: { apiKey: { findUnique } } as never,
    });
    expect(key).toBe('boject_perf_key_for_load_tests_only');
    expect(findUnique).toHaveBeenCalled();
  });

  it('throws with actionable message when row missing', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    await expect(
      ensurePerfApiKey({
        prisma: { apiKey: { findUnique } } as never,
      })
    ).rejects.toThrow(/SEED_PERF_KEY=1/);
  });
});
```

- [ ] **Step 4: Implement `perf/seed/api-key.ts`**

```ts
import { createHash } from 'node:crypto';

const PERF_KEY_RAW = 'boject_perf_key_for_load_tests_only';

export interface EnsureOpts {
  prisma: {
    apiKey: {
      findUnique: (args: { where: { keyHash: string } }) => Promise<unknown>;
    };
  };
}

export async function ensurePerfApiKey(opts: EnsureOpts): Promise<string> {
  const keyHash = createHash('sha256').update(PERF_KEY_RAW).digest('hex');
  const row = await opts.prisma.apiKey.findUnique({ where: { keyHash } });
  if (!row) {
    throw new Error(
      'Perf API key not found. Run: SEED_PERF_KEY=1 DATABASE_URL=postgresql://boject:boject@localhost:5432/boject_perf pnpm prisma:seed'
    );
  }
  return PERF_KEY_RAW;
}

export const PERF_API_KEY_PLAINTEXT = PERF_KEY_RAW;
```

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm --filter @boject/perf test seed/api-key`
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/prisma/seed.ts perf/seed/api-key.ts perf/seed/api-key.test.ts
git commit -m "feat(perf): flag-gated perf API key seeder"
```

---

## Task 8: k6 auth + metrics helpers

**Files:**

- Create: `perf/lib/auth-k6.ts`
- Create: `perf/lib/metrics-k6.ts`

No vitest — these run in k6's goja VM and are smoke-tested through scenarios.

- [ ] **Step 1: Create `perf/lib/auth-k6.ts`**

```ts
import http from 'k6/http';
import { check } from 'k6';
import { loadK6Config } from './config-k6.ts';

export function apiKeyHeaders(): Record<string, string> {
  const cfg = loadK6Config();
  if (!cfg.apiKey) {
    throw new Error(
      'PERF_API_KEY not set. Run: SEED_PERF_KEY=1 pnpm prisma:seed and export PERF_API_KEY=boject_perf_key_for_load_tests_only'
    );
  }
  return {
    Authorization: `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
  };
}

// Session auth: POST /api/auth/login, extract `Set-Cookie` and reuse it.
// Called from scenario setup() — runs once per VU cluster.
export function sessionLoginCookie(): string {
  const cfg = loadK6Config();
  const res = http.post(
    `${cfg.baseUrl}/api/auth/login`,
    JSON.stringify({ email: cfg.adminEmail, password: cfg.adminPassword }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(res, { 'login 200': (r) => r.status === 200 });
  const setCookie = res.headers['Set-Cookie'] ?? '';
  const cookie = setCookie.split(';')[0] ?? '';
  if (!cookie.startsWith('nuxt-session=')) {
    throw new Error(`login did not return session cookie: ${setCookie}`);
  }
  return cookie;
}

export function sessionHeaders(cookie: string): Record<string, string> {
  return {
    Cookie: cookie,
    'Content-Type': 'application/json',
    Origin: loadK6Config().baseUrl,
  };
}
```

- [ ] **Step 2: Create `perf/lib/metrics-k6.ts`**

```ts
import { Trend, Counter } from 'k6/metrics';

export const drainLatency = new Trend('perf_drain_page_ms', true);
export const drainWallClock = new Trend('perf_drain_total_ms', true);
export const crudCreateLatency = new Trend('perf_crud_create_ms', true);
export const crudReadLatency = new Trend('perf_crud_read_ms', true);
export const crudDeleteLatency = new Trend('perf_crud_delete_ms', true);
export const intentional429s = new Counter('perf_intentional_429');
export const unexpectedErrors = new Counter('perf_unexpected_errors');
```

- [ ] **Step 3: Typecheck k6 files**

Run: `pnpm --filter @boject/perf typecheck:k6`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add perf/lib/auth-k6.ts perf/lib/metrics-k6.ts
git commit -m "feat(perf): k6 auth + custom metrics helpers"
```

---

## Task 9: Scenario 1A — GraphQL cursor pagination

**Files:**

- Create: `perf/scenarios/graphql-sitemap.ts`

- [ ] **Step 1: Implement**

```ts
import http from 'k6/http';
import { check, fail } from 'k6';
import { loadK6Config } from '../lib/config-k6.ts';
import { apiKeyHeaders } from '../lib/auth-k6.ts';
import { drainLatency, drainWallClock } from '../lib/metrics-k6.ts';

const PAGE_SIZE = Number(__ENV.PERF_PAGE_SIZE ?? '100');
const VUS = Number(__ENV.PERF_VUS ?? '1');

export const options = {
  scenarios: {
    sitemap: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: '10m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    perf_drain_page_ms: ['p(99)<2000'],
  },
  // Tag each VU's run so reports can slice by page-size/VU
  tags: {
    scenario: 'sitemap',
    page_size: String(PAGE_SIZE),
    vus: String(VUS),
  },
};

const QUERY = `
  query Articles($first: Int!, $after: String) {
    perfArticleList(first: $first, after: $after) {
      edges { node { id slug updatedAt } cursor }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

export default function sitemap() {
  const cfg = loadK6Config();
  const headers = apiKeyHeaders();

  let cursor: string | null = null;
  let pages = 0;
  const start = Date.now();

  while (true) {
    const res = http.post(
      `${cfg.baseUrl}/api/graphql`,
      JSON.stringify({
        query: QUERY,
        variables: { first: PAGE_SIZE, after: cursor },
      }),
      { headers, tags: { phase: 'drain' } }
    );
    const ok = check(res, {
      'page 200': (r) => r.status === 200,
      'has data': (r) => {
        try {
          const j = r.json() as {
            data?: { perfArticleList?: { pageInfo?: unknown } };
          };
          return Boolean(j.data?.perfArticleList?.pageInfo);
        } catch {
          return false;
        }
      },
    });
    if (!ok) fail(`GraphQL page request failed: ${res.status}`);
    drainLatency.add(res.timings.duration);
    const page = (
      res.json() as {
        data: {
          perfArticleList: {
            pageInfo: { endCursor: string | null; hasNextPage: boolean };
          };
        };
      }
    ).data.perfArticleList.pageInfo;
    pages++;
    if (!page.hasNextPage) break;
    cursor = page.endCursor;
  }

  drainWallClock.add(Date.now() - start);
  console.log(`sitemap VU drained ${pages} pages in ${Date.now() - start}ms`);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @boject/perf typecheck:k6`
Expected: PASS.

- [ ] **Step 3: Smoke test**

Prereq: 1K entries seeded, perf API key present.

```bash
export PERF_API_KEY=boject_perf_key_for_load_tests_only
k6 run perf/scenarios/graphql-sitemap.ts --env PERF_PAGE_SIZE=100 --env PERF_VUS=1
```

Expected: run completes; summary shows `perf_drain_total_ms` trend and `http_req_failed` rate 0%.

**Note:** `perfArticleList` is the GraphQL query name derived from the `PerfArticle` content type identifier by the dynamic GraphQL type registration (camelCase + `List`). Verify by curling the schema; adjust the query name if the naming convention differs.

- [ ] **Step 4: Commit**

```bash
git add perf/scenarios/graphql-sitemap.ts
git commit -m "feat(perf): scenario 1A GraphQL cursor pagination"
```

---

## Task 10: Scenario 1B — GraphQL flat RPS

**Files:**

- Create: `perf/scenarios/graphql-flat.ts`

- [ ] **Step 1: Implement**

```ts
import http from 'k6/http';
import { check } from 'k6';
import { loadK6Config } from '../lib/config-k6.ts';
import { apiKeyHeaders } from '../lib/auth-k6.ts';

const QUERY_SHAPE = __ENV.PERF_QUERY_SHAPE ?? 'bare';

const QUERIES: Record<string, string> = {
  bare: `
    query Articles { perfArticleList(first: 100) { edges { node { id slug } } } }
  `,
  filtered: `
    query Articles { perfArticleList(first: 100, where: { publishDate: { gt: "2020-01-01T00:00:00Z" } }) { edges { node { id slug } } } }
  `,
  relation: `
    query Articles { perfArticleList(first: 100) { edges { node { id slug author { id name } } } } }
  `,
};

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { target: 50, duration: '30s' },
        { target: 100, duration: '30s' },
        { target: 250, duration: '30s' },
        { target: 500, duration: '30s' },
        { target: 1000, duration: '30s' },
        { target: 2000, duration: '30s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(99)<5000'],
  },
  tags: { scenario: 'flat', shape: QUERY_SHAPE },
};

export default function flat() {
  const cfg = loadK6Config();
  const headers = apiKeyHeaders();
  const query = QUERIES[QUERY_SHAPE] ?? QUERIES.bare!;

  const res = http.post(
    `${cfg.baseUrl}/api/graphql`,
    JSON.stringify({ query }),
    { headers, tags: { shape: QUERY_SHAPE } }
  );
  check(res, {
    '2xx': (r) => r.status >= 200 && r.status < 300,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @boject/perf typecheck:k6`
Expected: PASS.

- [ ] **Step 3: Smoke test (short duration override)**

```bash
k6 run perf/scenarios/graphql-flat.ts --duration 30s --env PERF_QUERY_SHAPE=bare
```

Expected: RPS ramps up, summary shows a RPS count and latency histogram.

- [ ] **Step 4: Commit**

```bash
git add perf/scenarios/graphql-flat.ts
git commit -m "feat(perf): scenario 1B GraphQL flat RPS ramp"
```

---

## Task 11: Scenario 2 — REST CRUD cycle

**Files:**

- Create: `perf/scenarios/rest-crud-cycle.ts`

- [ ] **Step 1: Implement**

```ts
import http from 'k6/http';
import { check, group } from 'k6';
import { SharedArray } from 'k6/data';
import { loadK6Config } from '../lib/config-k6.ts';
import { sessionLoginCookie, sessionHeaders } from '../lib/auth-k6.ts';
import {
  crudCreateLatency,
  crudReadLatency,
  crudDeleteLatency,
  intentional429s,
  unexpectedErrors,
} from '../lib/metrics-k6.ts';

const N = Number(__ENV.PERF_CRUD_N ?? '10000');

export const options = {
  scenarios: {
    crud: {
      executor: 'shared-iterations',
      vus: 10,
      iterations: N * 3, // create + read + delete per item
      maxDuration: '30m',
    },
  },
  tags: { scenario: 'crud' },
};

interface SetupData {
  cookie: string;
  contentTypeId: string;
}

export function setup(): SetupData {
  const cfg = loadK6Config();
  const cookie = sessionLoginCookie();
  const headers = sessionHeaders(cookie);

  // Find the PerfArticle content type id
  const res = http.get(`${cfg.baseUrl}/api/content-types`, { headers });
  const body = res.json() as {
    items: Array<{ id: string; identifier: string }>;
  };
  const ct = body.items.find((t) => t.identifier === 'PerfArticle');
  if (!ct) {
    throw new Error(
      'PerfArticle content type not found — run `pnpm perf:seed --size=0` first'
    );
  }
  return { cookie, contentTypeId: ct.id };
}

// Shared work queue: each iteration claims one of three phase slots.
// Simplest approach: create phase = first N iters, read phase = next N, delete = last N.
const createdIds = new SharedArray<string>('createdIds', () => {
  return new Array(N).fill('');
});

export default function crud(data: SetupData) {
  const cfg = loadK6Config();
  const headers = sessionHeaders(data.cookie);
  const iter = __ITER; // 0-based iteration count per VU; combined sequencing via exec state

  // Use a simple phase calculation from __VU + __ITER — imperfect ordering,
  // but across 10 VUs × 3N iterations we hit each phase roughly equally.
  // See README for why strict phase ordering is a follow-up refinement.
  const phase = iter % 3;

  if (phase === 0) {
    group('create', () => {
      const body = {
        contentTypeId: data.contentTypeId,
        data: {
          title: `CRUD ${__VU}-${iter}`,
          slug: `crud-${__VU}-${iter}-${Date.now()}`,
          excerpt: 'CRUD cycle',
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'body' }],
              },
            ],
          },
          publishDate: new Date().toISOString(),
        },
      };
      const res = http.post(
        `${cfg.baseUrl}/api/content-entries`,
        JSON.stringify(body),
        { headers, tags: { phase: 'create' } }
      );
      crudCreateLatency.add(res.timings.duration);
      if (res.status === 429) intentional429s.add(1);
      else if (res.status < 200 || res.status >= 300) unexpectedErrors.add(1);
    });
    return;
  }

  if (phase === 1) {
    group('read', () => {
      // Read a random existing entry from a fresh list query.
      const list = http.get(
        `${cfg.baseUrl}/api/content-entries?contentTypeId=${data.contentTypeId}&perPage=1`,
        { headers, tags: { phase: 'list' } }
      );
      if (list.status !== 200) {
        unexpectedErrors.add(1);
        return;
      }
      const items = (list.json() as { items: Array<{ id: string }> }).items;
      if (items.length === 0) return;
      const res = http.get(
        `${cfg.baseUrl}/api/content-entries/${items[0]!.id}`,
        { headers, tags: { phase: 'read' } }
      );
      crudReadLatency.add(res.timings.duration);
      check(res, { '2xx read': (r) => r.status === 200 });
    });
    return;
  }

  group('delete', () => {
    const list = http.get(
      `${cfg.baseUrl}/api/content-entries?contentTypeId=${data.contentTypeId}&perPage=1`,
      { headers, tags: { phase: 'list' } }
    );
    if (list.status !== 200) {
      unexpectedErrors.add(1);
      return;
    }
    const items = (list.json() as { items: Array<{ id: string }> }).items;
    if (items.length === 0) return;
    const res = http.del(
      `${cfg.baseUrl}/api/content-entries/${items[0]!.id}`,
      null,
      { headers, tags: { phase: 'delete' } }
    );
    crudDeleteLatency.add(res.timings.duration);
    if (res.status === 429) intentional429s.add(1);
    else if (res.status < 200 || res.status >= 300) unexpectedErrors.add(1);
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @boject/perf typecheck:k6`
Expected: PASS.

- [ ] **Step 3: Smoke test**

```bash
k6 run perf/scenarios/rest-crud-cycle.ts --env PERF_CRUD_N=50
```

Expected: run completes in under a minute, per-phase trends populated, `perf_intentional_429` may be non-zero, `perf_unexpected_errors` is zero.

**Note:** The phase-interleaving approach (iteration-modulo-3) trades strict create→read→delete ordering for code simplicity. Under 10 VUs × 150 iters = 500 create, 500 read, 500 delete work requests distributed across time. The simplification is acceptable because:

- The rate-limiter confirms we hit 429s on bursts (goal).
- Per-phase latency distributions are still cleanly separated via `phase` tag.
- Strict phase ordering (run N creates, then N reads, then N deletes) would require k6's stages feature and three scenarios in one file — a readability cost the first report doesn't need. Flagged for the follow-up "Phase 2 regression guard" work.

- [ ] **Step 4: Commit**

```bash
git add perf/scenarios/rest-crud-cycle.ts
git commit -m "feat(perf): scenario 2 REST CRUD cycle"
```

---

## Task 12: `perf:scenario` root script + script runner

**Files:**

- Modify: root `package.json` — fix `perf:scenario` to forward scenario name and env args
- Create: `perf/scripts/run-scenario.ts` — wrapper that spawns `k6 run` with tagged output

- [ ] **Step 1: Implement runner**

Create `perf/scripts/run-scenario.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', default: 'perf/reports/latest/raw.json' },
  },
});

const scenario = positionals[0];
if (!scenario) {
  console.error('Usage: run-scenario <name> [--out path]');
  console.error('  Available: graphql-sitemap, graphql-flat, rest-crud-cycle');
  process.exit(1);
}

const scriptPath = resolve('scenarios', `${scenario}.ts`);
if (!existsSync(scriptPath)) {
  console.error(`Unknown scenario: ${scenario}`);
  process.exit(1);
}

const out = resolve(values.out!);
const result = spawnSync(
  'k6',
  ['run', '--out', `json=${out}`, scriptPath, ...process.argv.slice(3)],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
```

Note: `process.argv.slice(3)` forwards any additional `--env X=Y` args the user passes. The `package.json` `scenario` script picks positional scenario name.

- [ ] **Step 2: Add `scenario` script to `perf/package.json`**

Under `scripts`, add:

```json
    "scenario": "tsx scripts/run-scenario.ts",
```

- [ ] **Step 3: Manual smoke test**

```bash
pnpm perf:scenario graphql-sitemap -- --env PERF_PAGE_SIZE=100 --env PERF_VUS=1
```

Expected: k6 runs scenario 1A, output written to `perf/reports/latest/raw.json`.

- [ ] **Step 4: Commit**

```bash
git add perf/scripts/run-scenario.ts perf/package.json
git commit -m "feat(perf): pnpm perf:scenario wrapper"
```

---

## Task 13: Postgres + docker stats sampler

**Files:**

- Create: `perf/lib/pg-sampler.ts`
- Create: `perf/lib/pg-sampler.test.ts`

- [ ] **Step 1: Write failing test**

Create `perf/lib/pg-sampler.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { sampleOnce, formatCsvRow } from './pg-sampler';

describe('sampleOnce', () => {
  it('queries pg_stat_activity and returns connection + activity counts', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ total: '8', active: '3', idle: '5' }],
    });
    const dockerStats = vi.fn().mockResolvedValue({
      cpu_percent: 42.5,
      mem_mb: 512,
    });
    const sample = await sampleOnce({ query, dockerStats });
    expect(sample.total).toBe(8);
    expect(sample.active).toBe(3);
    expect(sample.idle).toBe(5);
    expect(sample.cpuPercent).toBe(42.5);
    expect(sample.memMb).toBe(512);
    expect(sample.timestamp).toBeInstanceOf(Date);
  });
});

describe('formatCsvRow', () => {
  it('emits comma-separated numeric values with ISO timestamp', () => {
    const row = formatCsvRow({
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      total: 8,
      active: 3,
      idle: 5,
      cpuPercent: 42.5,
      memMb: 512,
    });
    expect(row).toBe('2026-01-01T00:00:00.000Z,8,3,5,42.5,512');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @boject/perf test lib/pg-sampler`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `perf/lib/pg-sampler.ts`:

```ts
import { Client } from 'pg';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadNodeConfig } from './config-node.ts';

export interface Sample {
  timestamp: Date;
  total: number;
  active: number;
  idle: number;
  cpuPercent: number;
  memMb: number;
}

export interface SampleOpts {
  query: (sql: string) => Promise<{
    rows: Array<{ total: string; active: string; idle: string }>;
  }>;
  dockerStats: () => Promise<{ cpu_percent: number; mem_mb: number }>;
}

export async function sampleOnce(opts: SampleOpts): Promise<Sample> {
  const [pgResult, docker] = await Promise.all([
    opts.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE state = 'active') AS active,
              COUNT(*) FILTER (WHERE state = 'idle') AS idle
       FROM pg_stat_activity
       WHERE datname = current_database()`
    ),
    opts.dockerStats(),
  ]);
  const row = pgResult.rows[0]!;
  return {
    timestamp: new Date(),
    total: Number(row.total),
    active: Number(row.active),
    idle: Number(row.idle),
    cpuPercent: docker.cpu_percent,
    memMb: docker.mem_mb,
  };
}

export function formatCsvRow(s: Sample): string {
  return [
    s.timestamp.toISOString(),
    s.total,
    s.active,
    s.idle,
    s.cpuPercent,
    s.memMb,
  ].join(',');
}

export const CSV_HEADER = 'timestamp,total,active,idle,cpu_percent,mem_mb';

async function dockerStatsDefault(): Promise<{
  cpu_percent: number;
  mem_mb: number;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'stats',
      '--no-stream',
      '--format',
      '{{json .}}',
      'boject-cms-postgres-1',
    ]);
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        return resolve({ cpu_percent: 0, mem_mb: 0 });
      }
      try {
        const j = JSON.parse(buf.trim()) as {
          CPUPerc: string;
          MemUsage: string;
        };
        const cpu = Number(j.CPUPerc.replace('%', '').trim());
        const memMatch = j.MemUsage.match(/([\d.]+)\s*MiB/);
        const mem = memMatch ? Number(memMatch[1]) : 0;
        resolve({ cpu_percent: cpu, mem_mb: mem });
      } catch (err) {
        reject(err);
      }
    });
  });
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const outPath = process.env.PERF_SAMPLER_OUT ?? 'pg-samples.csv';
  const intervalMs = Number(process.env.PERF_SAMPLER_INTERVAL_MS ?? '5000');
  const cfg = loadNodeConfig();
  mkdirSync(dirname(outPath), { recursive: true });
  appendFileSync(outPath, CSV_HEADER + '\n');

  const client = new Client({ connectionString: cfg.perfDatabaseUrl });
  await client.connect();

  const stop = () => {
    client.end().finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (true) {
    try {
      const sample = await sampleOnce({
        query: (sql) => client.query(sql),
        dockerStats: dockerStatsDefault,
      });
      appendFileSync(outPath, formatCsvRow(sample) + '\n');
    } catch (err) {
      console.error('[pg-sampler]', err);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @boject/perf test lib/pg-sampler`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add perf/lib/pg-sampler.ts perf/lib/pg-sampler.test.ts
git commit -m "feat(perf): Postgres + docker stats sampler"
```

---

## Task 14: Report renderer

**Files:**

- Create: `perf/scripts/render-report.ts`
- Create: `perf/scripts/render-report.test.ts`
- Create: `perf/scripts/render-report.fixtures/tiny-raw.json`

- [ ] **Step 1: Create the recorded fixture**

Create `perf/scripts/render-report.fixtures/tiny-raw.json`:

```json
{"metric":"http_req_duration","type":"Point","data":{"time":"2026-04-21T10:00:00Z","value":45.2,"tags":{"scenario":"sitemap","page_size":"100"}}}
{"metric":"http_req_duration","type":"Point","data":{"time":"2026-04-21T10:00:01Z","value":120.5,"tags":{"scenario":"sitemap","page_size":"100"}}}
{"metric":"http_req_duration","type":"Point","data":{"time":"2026-04-21T10:00:02Z","value":310.8,"tags":{"scenario":"sitemap","page_size":"100"}}}
{"metric":"http_req_duration","type":"Point","data":{"time":"2026-04-21T10:00:03Z","value":50.1,"tags":{"scenario":"sitemap","page_size":"500"}}}
{"metric":"http_req_duration","type":"Point","data":{"time":"2026-04-21T10:00:04Z","value":85.4,"tags":{"scenario":"sitemap","page_size":"500"}}}
{"metric":"http_req_failed","type":"Point","data":{"time":"2026-04-21T10:00:00Z","value":0,"tags":{"scenario":"sitemap"}}}
```

Note: k6 emits NDJSON — one JSON object per line, not a JSON array.

- [ ] **Step 2: Write failing test**

Create `perf/scripts/render-report.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseRawJson,
  computeScenarioStats,
  renderSummaryMd,
  toCsv,
} from './render-report';

const fixture = readFileSync(
  resolve(__dirname, 'render-report.fixtures/tiny-raw.json'),
  'utf8'
);

describe('parseRawJson', () => {
  it('parses NDJSON into an array of point records', () => {
    const points = parseRawJson(fixture);
    expect(points).toHaveLength(6);
    expect(points[0]!.metric).toBe('http_req_duration');
  });
});

describe('computeScenarioStats', () => {
  it('groups by scenario+page_size and computes percentiles', () => {
    const points = parseRawJson(fixture);
    const stats = computeScenarioStats(points);
    const sitemap100 = stats.find(
      (s) => s.scenario === 'sitemap' && s.pageSize === '100'
    )!;
    expect(sitemap100.count).toBe(3);
    expect(sitemap100.p50).toBeCloseTo(120.5, 1);
    expect(sitemap100.p99).toBeCloseTo(310.8, 1);
    expect(sitemap100.errorRate).toBe(0);
  });
});

describe('renderSummaryMd', () => {
  it('produces markdown with headline numbers and scenario sections', () => {
    const points = parseRawJson(fixture);
    const md = renderSummaryMd({
      gitSha: 'abc1234',
      date: '2026-04-21',
      stats: computeScenarioStats(points),
    });
    expect(md).toContain('# Load test report — 2026-04-21 (git: abc1234)');
    expect(md).toContain('## Scenario 1A');
    expect(md).toContain('p99');
  });
});

describe('toCsv', () => {
  it('emits one row per scenario group with header', () => {
    const points = parseRawJson(fixture);
    const csv = toCsv(computeScenarioStats(points));
    expect(csv.split('\n')[0]).toBe(
      'scenario,page_size,count,p50,p95,p99,error_rate'
    );
    expect(csv.split('\n').length).toBeGreaterThan(2);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `pnpm --filter @boject/perf test scripts/render-report`
Expected: FAIL.

- [ ] **Step 4: Implement**

Create `perf/scripts/render-report.ts`:

```ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';

export interface RawPoint {
  metric: string;
  type: string;
  data: {
    time: string;
    value: number;
    tags: Record<string, string>;
  };
}

export function parseRawJson(raw: string): RawPoint[] {
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RawPoint)
    .filter((p) => p.type === 'Point');
}

export interface ScenarioStats {
  scenario: string;
  pageSize: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}

export function computeScenarioStats(points: RawPoint[]): ScenarioStats[] {
  // Group http_req_duration by scenario+page_size
  const groups = new Map<string, number[]>();
  const failGroups = new Map<string, { total: number; failed: number }>();
  for (const p of points) {
    const scenario = p.data.tags.scenario ?? 'unknown';
    const pageSize = p.data.tags.page_size ?? '-';
    const key = `${scenario}|${pageSize}`;
    if (p.metric === 'http_req_duration') {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p.data.value);
    } else if (p.metric === 'http_req_failed') {
      if (!failGroups.has(key)) failGroups.set(key, { total: 0, failed: 0 });
      const g = failGroups.get(key)!;
      g.total++;
      if (p.data.value === 1) g.failed++;
    }
  }

  return Array.from(groups.entries()).map(([key, values]) => {
    const [scenario, pageSize] = key.split('|') as [string, string];
    const sorted = [...values].sort((a, b) => a - b);
    const fg = failGroups.get(key);
    return {
      scenario,
      pageSize,
      count: values.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      errorRate: fg && fg.total > 0 ? fg.failed / fg.total : 0,
    };
  });
}

export function toCsv(stats: ScenarioStats[]): string {
  const header = 'scenario,page_size,count,p50,p95,p99,error_rate';
  const rows = stats.map((s) =>
    [
      s.scenario,
      s.pageSize,
      s.count,
      s.p50.toFixed(2),
      s.p95.toFixed(2),
      s.p99.toFixed(2),
      s.errorRate.toFixed(4),
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

export interface RenderInput {
  gitSha: string;
  date: string;
  stats: ScenarioStats[];
}

export function renderSummaryMd(input: RenderInput): string {
  const sitemap = input.stats.filter((s) => s.scenario === 'sitemap');
  const flat = input.stats.filter((s) => s.scenario === 'flat');
  const crud = input.stats.filter((s) => s.scenario === 'crud');

  const row = (s: ScenarioStats) =>
    `| ${s.scenario} | ${s.pageSize} | ${s.count} | ${s.p50.toFixed(1)} | ${s.p95.toFixed(1)} | ${s.p99.toFixed(1)} | ${(s.errorRate * 100).toFixed(2)}% |`;

  const header =
    '| scenario | page_size | count | p50 (ms) | p95 (ms) | p99 (ms) | errors |\n| --- | --- | --- | --- | --- | --- | --- |';

  return [
    `# Load test report — ${input.date} (git: ${input.gitSha})`,
    '',
    '## Environment',
    '- Host: see run metadata file',
    '',
    '## Headline numbers',
    `- Scenarios captured: ${new Set(input.stats.map((s) => s.scenario)).size}`,
    `- Total durations recorded: ${input.stats.reduce((n, s) => n + s.count, 0)}`,
    '',
    '## Scenario 1A — GraphQL cursor pagination',
    header,
    ...sitemap.map(row),
    '',
    '## Scenario 1B — GraphQL flat RPS',
    header,
    ...flat.map(row),
    '',
    '## Scenario 2 — REST CRUD cycle',
    header,
    ...crud.map(row),
    '',
    '## Recommendations for CMS operators',
    '- GraphQL rate limit: fill in after reading scenario 1B soft-break',
    '- Default page size: choose the row in scenario 1A with best drain-time / p99 tradeoff',
    '- JSONB indexing: attach evidence to #25 if filtered queries lag bare queries noticeably',
    '',
    '## Recommendations for consumers',
    '- Page size: align with the operator recommendation',
    '- On 429: honour Retry-After header',
    '',
  ].join('\n');
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const rawPath = process.env.PERF_RAW_PATH ?? 'reports/latest/raw.json';
  const outDir = dirname(rawPath);
  const raw = readFileSync(resolve(rawPath), 'utf8');
  const points = parseRawJson(raw);
  const stats = computeScenarioStats(points);

  const gitSha = execSync('git rev-parse --short HEAD').toString().trim();
  const date = new Date().toISOString().slice(0, 10);

  const md = renderSummaryMd({ gitSha, date, stats });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'summary.md'), md);
  writeFileSync(resolve(outDir, 'metrics.csv'), toCsv(stats));
  console.log(`[render-report] wrote ${outDir}/summary.md + metrics.csv`);
}
```

Plots: deferred to Task 17 when we know the exact chart shapes from the first run; the renderer currently emits markdown + CSV only. The tracking ticket allows plots to ship with follow-up patches — the spec's success criteria specifies plots but their exact chart configs depend on real data.

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @boject/perf test scripts/render-report`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add perf/scripts/render-report.ts perf/scripts/render-report.test.ts perf/scripts/render-report.fixtures
git commit -m "feat(perf): report renderer (markdown + csv)"
```

---

## Task 15: Sweep orchestrator

**Files:**

- Create: `perf/scripts/sweep.ts`
- Create: `perf/scripts/sweep.test.ts`

- [ ] **Step 1: Write failing test**

Create `perf/scripts/sweep.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { planSweep, runSweep } from './sweep';

describe('planSweep', () => {
  it('generates one reset+seed pair per size, nested scenario runs', () => {
    const plan = planSweep({
      sizes: [1000, 10000],
      pageSizes: [100, 500],
      vusLevels: [1, 5],
    });
    // 2 sizes × (reset + seed + 2 page × 2 vu sitemap runs) + 1 flat at 30K only (not 10K → 0)
    const steps = plan.map((s) => s.kind);
    expect(steps.filter((k) => k === 'reset').length).toBe(2);
    expect(steps.filter((k) => k === 'seed').length).toBe(2);
    expect(
      plan.filter((s) => s.kind === 'scenario' && s.name === 'graphql-sitemap')
        .length
    ).toBe(8); // 2 sizes × 2 page × 2 vus
  });

  it('runs flat scenario only at the 30K waypoint', () => {
    const plan = planSweep({
      sizes: [1000, 30000, 100000],
      pageSizes: [100],
      vusLevels: [1],
    });
    const flat = plan.filter(
      (s) => s.kind === 'scenario' && s.name === 'graphql-flat'
    );
    expect(flat).toHaveLength(3); // bare + filtered + relation shapes
    flat.forEach((s) => expect(s.size).toBe(30000));
  });

  it('appends REST CRUD scenario once at the end', () => {
    const plan = planSweep({
      sizes: [1000],
      pageSizes: [100],
      vusLevels: [1],
    });
    expect(plan[plan.length - 1]!.name).toBe('rest-crud-cycle');
  });
});

describe('runSweep', () => {
  it('invokes each step in order', async () => {
    const calls: string[] = [];
    await runSweep({
      plan: [
        { kind: 'reset' },
        { kind: 'seed', size: 1000 },
        {
          kind: 'scenario',
          name: 'graphql-sitemap',
          size: 1000,
          env: { PERF_PAGE_SIZE: '100', PERF_VUS: '1' },
        },
      ],
      reset: async () => {
        calls.push('reset');
      },
      seed: async (size) => {
        calls.push(`seed:${size}`);
      },
      scenario: async (name, env) => {
        calls.push(`scenario:${name}:${env.PERF_PAGE_SIZE}`);
      },
      render: async () => {
        calls.push('render');
      },
    });
    expect(calls).toEqual([
      'reset',
      'seed:1000',
      'scenario:graphql-sitemap:100',
      'render',
    ]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @boject/perf test scripts/sweep`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `perf/scripts/sweep.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { PrismaClient } from '../../apps/cms/generated/prisma/client.ts';
import { loadNodeConfig } from '../lib/config-node.ts';
import { resetPerfDb } from '../seed/reset.ts';
import { seedPerfData } from '../seed/bulk-insert.ts';

export type Step =
  | { kind: 'reset' }
  | { kind: 'seed'; size: number }
  | {
      kind: 'scenario';
      name: 'graphql-sitemap' | 'graphql-flat' | 'rest-crud-cycle';
      size: number;
      env: Record<string, string>;
    };

export interface PlanInput {
  sizes: number[];
  pageSizes: number[];
  vusLevels: number[];
}

const FLAT_WAYPOINT = 30000;
const FLAT_SHAPES = ['bare', 'filtered', 'relation'];

export function planSweep(input: PlanInput): Step[] {
  const steps: Step[] = [];
  for (const size of input.sizes) {
    steps.push({ kind: 'reset' });
    steps.push({ kind: 'seed', size });
    for (const pageSize of input.pageSizes) {
      for (const vus of input.vusLevels) {
        steps.push({
          kind: 'scenario',
          name: 'graphql-sitemap',
          size,
          env: { PERF_PAGE_SIZE: String(pageSize), PERF_VUS: String(vus) },
        });
      }
    }
    if (size === FLAT_WAYPOINT) {
      for (const shape of FLAT_SHAPES) {
        steps.push({
          kind: 'scenario',
          name: 'graphql-flat',
          size,
          env: { PERF_QUERY_SHAPE: shape },
        });
      }
    }
  }
  // CRUD runs once, independent of sweep sizes
  steps.push({
    kind: 'scenario',
    name: 'rest-crud-cycle',
    size: 0,
    env: { PERF_CRUD_N: String(process.env.PERF_CRUD_N ?? '10000') },
  });
  return steps;
}

export interface RunDeps {
  plan: Step[];
  reset: () => Promise<void>;
  seed: (size: number) => Promise<void>;
  scenario: (name: string, env: Record<string, string>) => Promise<void>;
  render: () => Promise<void>;
}

export async function runSweep(deps: RunDeps): Promise<void> {
  for (const step of deps.plan) {
    if (step.kind === 'reset') await deps.reset();
    else if (step.kind === 'seed') await deps.seed(step.size);
    else if (step.kind === 'scenario') await deps.scenario(step.name, step.env);
  }
  await deps.render();
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const sizes = (process.env.PERF_SIZES ?? '1000,10000,30000,100000')
    .split(',')
    .map((s) => Number(s.trim()));
  const pageSizes = (process.env.PERF_PAGE_SIZES ?? '100,500,1000')
    .split(',')
    .map((s) => Number(s.trim()));
  const vusLevels = (process.env.PERF_VUS_LEVELS ?? '1,5,20')
    .split(',')
    .map((s) => Number(s.trim()));

  const plan = planSweep({ sizes, pageSizes, vusLevels });
  const cfg = loadNodeConfig();
  const gitSha = execSync('git rev-parse --short HEAD').toString().trim();
  const date = new Date().toISOString().slice(0, 10);
  const runId = `${date}-${gitSha}`;
  const reportDir = resolve('reports', runId);
  mkdirSync(reportDir, { recursive: true });

  const rawPath = resolve(reportDir, 'raw.json');

  await runSweep({
    plan,
    reset: async () => {
      const client = new Client({ connectionString: cfg.perfDatabaseUrl });
      await client.connect();
      try {
        await resetPerfDb({
          databaseUrl: cfg.perfDatabaseUrl,
          runQuery: async (sql) => {
            await client.query(sql);
          },
        });
      } finally {
        await client.end();
      }
    },
    seed: async (size) => {
      const prisma = new PrismaClient({
        datasourceUrl: cfg.perfDatabaseUrl,
      });
      try {
        await seedPerfData({ prisma, articleCount: size });
      } finally {
        await prisma.$disconnect();
      }
    },
    scenario: async (name, env) => {
      const result = spawnSync(
        'k6',
        ['run', '--out', `json=${rawPath}`, resolve('scenarios', `${name}.ts`)],
        {
          stdio: 'inherit',
          env: { ...process.env, ...env, PERF_BASE_URL: cfg.baseUrl },
        }
      );
      if (result.status !== 0) {
        throw new Error(`scenario ${name} exited with ${result.status}`);
      }
    },
    render: async () => {
      spawnSync('tsx', ['scripts/render-report.ts'], {
        stdio: 'inherit',
        env: { ...process.env, PERF_RAW_PATH: rawPath },
      });
    },
  });

  console.log(`[perf:sweep] wrote ${reportDir}`);
}
```

- [ ] **Step 4: Run unit tests — expect PASS**

Run: `pnpm --filter @boject/perf test scripts/sweep`
Expected: 4 tests pass.

- [ ] **Step 5: Smoke test with tiny sweep**

```bash
PERF_SIZES=1000 PERF_PAGE_SIZES=100 PERF_VUS_LEVELS=1 PERF_CRUD_N=10 pnpm perf:sweep
```

Expected: report dir created, `summary.md` and `metrics.csv` present, `raw.json` contains NDJSON.

- [ ] **Step 6: Commit**

```bash
git add perf/scripts/sweep.ts perf/scripts/sweep.test.ts
git commit -m "feat(perf): sweep orchestrator"
```

---

## Task 16: Follow-ups opener

**Files:**

- Create: `perf/scripts/open-followups.ts`
- Create: `perf/scripts/open-followups.test.ts`

- [ ] **Step 1: Write failing test**

Create `perf/scripts/open-followups.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildFollowups } from './open-followups';

describe('buildFollowups', () => {
  it('produces 6 new issues + 1 comment on #25', () => {
    const result = buildFollowups({
      reportPath: 'perf/reports/2026-04-21-abc1234',
    });
    expect(result.newIssues).toHaveLength(6);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]!.issue).toBe(25);
  });

  it('new issues include report path in body', () => {
    const result = buildFollowups({
      reportPath: 'perf/reports/2026-04-21-abc1234',
    });
    expect(result.newIssues[0]!.body).toContain(
      'perf/reports/2026-04-21-abc1234'
    );
  });

  it('labels new issues with roadmap', () => {
    const result = buildFollowups({
      reportPath: 'perf/reports/2026-04-21-abc1234',
    });
    expect(result.newIssues[0]!.labels).toContain('roadmap');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @boject/perf test scripts/open-followups`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `perf/scripts/open-followups.ts`:

```ts
import { spawnSync } from 'node:child_process';

export interface FollowupIssue {
  title: string;
  body: string;
  labels: string[];
}

export interface Comment {
  issue: number;
  body: string;
}

export interface BuildResult {
  newIssues: FollowupIssue[];
  comments: Comment[];
}

export function buildFollowups(opts: { reportPath: string }): BuildResult {
  const ref = `\n\nReport: \`${opts.reportPath}/summary.md\``;
  const newIssues: FollowupIssue[] = [
    {
      title: 'Rate limiting on /api/graphql',
      body:
        'Apply a per-API-key rate limit on `/api/graphql`. Threshold derived from scenario 1B soft breakpoint in the load-test report. Reuse `apps/cms/server/utils/rateLimitEndpoint.ts`.' +
        ref,
      labels: ['roadmap', 'enhancement'],
    },
    {
      title: 'GraphQL query complexity scoring',
      body:
        'Add Contentful-style query complexity scoring. Set max cost from scenario 1B "relation" vs "bare" delta. Pothos community plugin available.' +
        ref,
      labels: ['roadmap', 'enhancement'],
    },
    {
      title: 'Rate-limit + cost headers on GraphQL responses',
      body:
        'Surface `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-Query-Cost` on every `/api/graphql` response. Also expose via GraphQL `extensions`.' +
        ref,
      labels: ['roadmap', 'enhancement'],
    },
    {
      title: 'Richer 429 error shape (REST + GraphQL)',
      body:
        'Replace `{ error: "Too many requests" }` with `{ error, retryAfter, suggestion }`. Consumer-guidance strings come from the load-test recommendations.' +
        ref,
      labels: ['roadmap', 'enhancement'],
    },
    {
      title: 'Phase 2: wire perf suite into GHA with thresholds',
      body:
        'Turn the load-test suite into a CI regression guard. Use the committed report as the baseline and fail runs on significant regressions.' +
        ref,
      labels: ['roadmap', 'enhancement'],
    },
    {
      title: 'Portable perf scenarios via boject perf CLI',
      body:
        'Expose the load-test scenarios as a command on `@boject/cli` so `create-boject-cms` users can benchmark their own instances against their own content types.' +
        ref,
      labels: ['roadmap', 'enhancement'],
    },
  ];

  const comments: Comment[] = [
    {
      issue: 25,
      body:
        'Observed evidence from the first load-test report. Filtered query performance on PerfArticle (30K rows) vs bare query — see scenario 1B "filtered" vs "bare" shape comparison.' +
        ref,
    },
  ];

  return { newIssues, comments };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const reportPath = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!reportPath) {
    console.error('Usage: open-followups <reportPath> [--dry-run]');
    process.exit(1);
  }
  const { newIssues, comments } = buildFollowups({ reportPath });

  for (const issue of newIssues) {
    const args = [
      'issue',
      'create',
      '--title',
      issue.title,
      '--body',
      issue.body,
      '--label',
      issue.labels.join(','),
    ];
    if (dryRun) {
      console.log('[dry-run] gh', args.map((a) => JSON.stringify(a)).join(' '));
    } else {
      const result = spawnSync('gh', args, { stdio: 'inherit' });
      if (result.status !== 0) {
        console.error(`gh issue create failed for: ${issue.title}`);
        process.exit(1);
      }
    }
  }

  for (const c of comments) {
    const args = ['issue', 'comment', String(c.issue), '--body', c.body];
    if (dryRun) {
      console.log('[dry-run] gh', args.map((a) => JSON.stringify(a)).join(' '));
    } else {
      const result = spawnSync('gh', args, { stdio: 'inherit' });
      if (result.status !== 0) {
        console.error(`gh issue comment failed on #${c.issue}`);
        process.exit(1);
      }
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @boject/perf test scripts/open-followups`
Expected: 3 tests pass.

- [ ] **Step 5: Dry-run validation**

```bash
pnpm perf:followups perf/reports/2026-04-21-demo --dry-run
```

Expected: prints `[dry-run] gh issue create ...` for 6 issues + 1 comment.

- [ ] **Step 6: Commit**

```bash
git add perf/scripts/open-followups.ts perf/scripts/open-followups.test.ts
git commit -m "feat(perf): follow-ups opener with dry-run mode"
```

---

## Task 17: Plots from metrics.csv

**Files:**

- Modify: `perf/scripts/render-report.ts` (add plot generation)
- Modify: `perf/scripts/render-report.test.ts` (add plot test)

- [ ] **Step 1: Write failing test**

Append to `perf/scripts/render-report.test.ts`:

```ts
import { renderPlots } from './render-report';

describe('renderPlots', () => {
  it('produces a PNG buffer for latency by page size', async () => {
    const stats = [
      {
        scenario: 'sitemap',
        pageSize: '100',
        count: 10,
        p50: 50,
        p95: 120,
        p99: 300,
        errorRate: 0,
      },
      {
        scenario: 'sitemap',
        pageSize: '500',
        count: 10,
        p50: 80,
        p95: 150,
        p99: 380,
        errorRate: 0,
      },
    ];
    const png = await renderPlots(stats);
    expect(png).toBeInstanceOf(Buffer);
    expect(png.length).toBeGreaterThan(500);
    // PNG magic bytes
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @boject/perf test scripts/render-report`
Expected: FAIL on the new test.

- [ ] **Step 3: Add `renderPlots` export and wire it into CLI**

Append to `perf/scripts/render-report.ts`:

```ts
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';

export async function renderPlots(stats: ScenarioStats[]): Promise<Buffer> {
  const canvas = new ChartJSNodeCanvas({ width: 800, height: 400 });
  const sitemap = stats.filter((s) => s.scenario === 'sitemap');
  return canvas.renderToBuffer({
    type: 'bar',
    data: {
      labels: sitemap.map((s) => `size=${s.pageSize}`),
      datasets: [
        {
          label: 'p50',
          data: sitemap.map((s) => s.p50),
          backgroundColor: '#4C9AFF',
        },
        {
          label: 'p95',
          data: sitemap.map((s) => s.p95),
          backgroundColor: '#FFAB00',
        },
        {
          label: 'p99',
          data: sitemap.map((s) => s.p99),
          backgroundColor: '#DE350B',
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: 'Sitemap p50/p95/p99 by page_size' },
      },
      scales: { y: { title: { display: true, text: 'ms' } } },
    },
  });
}
```

Then update the CLI entry block to also write plots:

```ts
const png = await renderPlots(stats);
mkdirSync(resolve(outDir, 'plots'), { recursive: true });
writeFileSync(resolve(outDir, 'plots', 'sitemap-latency.png'), png);
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @boject/perf test scripts/render-report`
Expected: all tests pass including the PNG magic-bytes check.

- [ ] **Step 5: Commit**

```bash
git add perf/scripts/render-report.ts perf/scripts/render-report.test.ts
git commit -m "feat(perf): PNG plots via chartjs-node-canvas"
```

---

## Task 18: `perf/README.md`

**Files:**

- Modify: `perf/README.md` (replace stub from Task 1)

- [ ] **Step 1: Write the full README**

Replace `perf/README.md` contents with:

````markdown
# @boject/perf

Load-testing harness for boject-cms. Emits committed reports under `perf/reports/`.

## Prerequisites

- Docker + `docker compose up -d` (provides Postgres on :5432)
- `k6` installed locally — on macOS: `brew install k6`; Linux: follow https://k6.io/docs/getting-started/installation/
- pnpm install at repo root

## One-time setup

```bash
# Create the perf database (first time only; idempotent)
docker compose exec postgres psql -U boject -c "CREATE DATABASE boject_perf;" 2>/dev/null || true

# Apply CMS schema to the perf database
DATABASE_URL=postgresql://boject:boject@localhost:5432/boject_perf pnpm --filter cms prisma:migrate

# Seed the perf API key (flag-gated; does not touch dev)
SEED_PERF_KEY=1 DATABASE_URL=postgresql://boject:boject@localhost:5432/boject_perf pnpm prisma:seed

# Export the key for k6 to read (add to your .envrc or export each session)
export PERF_API_KEY=boject_perf_key_for_load_tests_only
```

## Running

```bash
# Full sweep: 1K / 10K / 30K / 100K datasets, all page sizes, all VU levels
pnpm perf:sweep

# One scenario against the currently-seeded DB
pnpm perf:scenario graphql-sitemap -- --env PERF_PAGE_SIZE=500 --env PERF_VUS=5

# Seed without running anything
pnpm perf:seed -- --size=10000

# Re-render latest report from raw.json (useful while iterating on templates)
pnpm perf:report

# Open follow-up tickets after reviewing a report
pnpm perf:followups perf/reports/2026-04-21-abc1234
```

## Configuration (env vars)

- `PERF_BASE_URL` — CMS URL. Default `http://localhost:4000`.
- `PERF_API_KEY` — Bearer token for GraphQL scenarios.
- `PERF_DATABASE_URL` — Prisma URL for seeding. Default `postgresql://boject:boject@localhost:5432/boject_perf`.
- `PERF_ADMIN_EMAIL` / `PERF_ADMIN_PASSWORD` — used by REST CRUD cycle session login. Defaults match the seed.
- `PERF_SIZES`, `PERF_PAGE_SIZES`, `PERF_VUS_LEVELS` — override sweep parameters (comma-separated).
- `PERF_CRUD_N` — REST CRUD cycle size. Default 10000.

## Running against your own deployment

Operators running boject-cms in production can point this suite at their staging instance:

```bash
export PERF_BASE_URL=https://cms-staging.example.com
export PERF_API_KEY=<key-from-cms-ui>
export PERF_DATABASE_URL=postgresql://...@.../boject_staging
pnpm perf:sweep
```

The `PERF_DATABASE_URL` must point at a database you can safely truncate. Do **not** point the sweep at your production database — `reset.ts` refuses anything not ending in `/boject_perf`, but seeding assumes a disposable environment.

## Interpreting the report

- **p50 / p95 / p99** — response-time percentiles. p50 is median; p99 is the slow-tail worst-common-case.
- **RPS** — requests per second sustained.
- **Soft breakpoint** — first load level at which p99 exceeds 500 ms.
- **Hard breakpoint** — first load level at which errors exceed 1%.

Operator-facing highlights from each report are mirrored into `docs/performance/`.

## Adding a scenario

1. Create `scenarios/<name>.ts`.
2. Import `k6/http`, `loadK6Config`, and any custom metrics from `lib/metrics-k6.ts`.
3. Export an `options` object with a named scenario and threshold(s).
4. Add a `default` function that performs the work.
5. Typecheck: `pnpm --filter @boject/perf typecheck:k6`.
6. Smoke-test: `pnpm perf:scenario <name>`.

## Known simplifications (v1)

- REST CRUD cycle phases are interleaved (iteration modulo 3), not strictly ordered. Rate-limit behaviour and per-phase latencies are still meaningful.
- Plots are limited to sitemap latency; extend `renderPlots()` in `scripts/render-report.ts` as new chart types are added.
- Postgres sampler is a polling loop (5s interval) rather than `pg_stat_statements`.
````

- [ ] **Step 2: Commit**

```bash
git add perf/README.md
git commit -m "docs(perf): full README for harness"
```

---

## Task 19: First sweep + committed report

**Files:**

- Create: `perf/reports/YYYY-MM-DD-<sha>/summary.md`
- Create: `perf/reports/YYYY-MM-DD-<sha>/metrics.csv`
- Create: `perf/reports/YYYY-MM-DD-<sha>/plots/*.png`
- Create: `perf/reports/YYYY-MM-DD-<sha>/raw.json` (or add to `.gitignore` if >10MB)

- [ ] **Step 1: Start the CMS dev server in a separate terminal**

```bash
pnpm dev
```

Wait for it to serve on http://localhost:4000.

- [ ] **Step 2: Ensure one-time setup is done**

Follow the "One-time setup" block in `perf/README.md`. Confirm `curl -sH "Authorization: Bearer $PERF_API_KEY" http://localhost:4000/api/graphql -d '{"query":"{__typename}"}' -H content-type:application/json` returns a 200.

- [ ] **Step 3: Run the sweep**

```bash
pnpm perf:sweep
```

Expected runtime: ~25 minutes on a modern laptop. Watch for any scenario that exits non-zero.

- [ ] **Step 4: Inspect the output**

```bash
ls perf/reports/*/
cat perf/reports/*/summary.md
```

Expected: `summary.md`, `metrics.csv`, `plots/sitemap-latency.png`, `raw.json`.

- [ ] **Step 5: Check `raw.json` size**

```bash
ls -lh perf/reports/*/raw.json
```

If >10 MB, add to `.gitignore` per-run:

```
perf/reports/*/raw.json
```

and commit that change in this task. Otherwise leave it committed.

- [ ] **Step 6: Fill in operator recommendations**

Open the generated `summary.md` and replace the placeholder lines under "Recommendations for CMS operators" with numbers sourced from the measured data:

- GraphQL rate limit: ~50% of the soft breakpoint from scenario 1B
- Default page size: the row in scenario 1A with the best drain/p99 balance
- JSONB indexing evidence: filtered-vs-bare p99 delta (absolute ms and percentage)

Same for "Recommendations for consumers". Keep the file to roughly the template length — numbers over prose.

- [ ] **Step 7: Commit**

```bash
git add perf/reports
git commit -m "chore(perf): first load-test report"
```

---

## Task 20: Mirror operator-facing sections to `docs/performance/` and update top-level README

**Files:**

- Create: `docs/performance/README.md`
- Create: `docs/performance/<date>-report-summary.md` (copy of the operator sections)
- Modify: top-level `README.md`

- [ ] **Step 1: Create `docs/performance/README.md`**

```markdown
# Performance

This directory mirrors operator-facing sections of the load-test reports generated by `@boject/perf`.

- Full harness: `perf/README.md`
- Full reports (including raw data): `perf/reports/`
- Latest operator summary: `YYYY-MM-DD-report-summary.md` (see below)
```

- [ ] **Step 2: Copy operator sections from the first report**

Create `docs/performance/<date>-report-summary.md` with only the following sections from the full report:

- Headline numbers
- Recommendations for CMS operators
- Recommendations for consumers
- Environment (one-line summary)

Link back to the full report in `perf/reports/<run-id>/summary.md`.

- [ ] **Step 3: Add Performance section to top-level README**

Run: `grep -n "^## " README.md` to find where to insert.

Add after the "Local development" or similar section (fit the existing structure):

```markdown
## Performance

Load-test harness, reports, and operator recommendations live under [`perf/`](perf/README.md). The latest operator summary is in [`docs/performance/`](docs/performance/).
```

- [ ] **Step 4: Commit**

```bash
git add docs/performance README.md
git commit -m "docs: mirror operator perf recommendations into docs/performance/"
```

---

## Task 21: Open follow-up tickets + comment on #25

**Files:** none (GitHub only).

- [ ] **Step 1: Dry-run first**

```bash
pnpm perf:followups perf/reports/<run-id> --dry-run
```

Expected: prints 6 planned `gh issue create` calls + 1 `gh issue comment` call.

- [ ] **Step 2: Run for real**

```bash
pnpm perf:followups perf/reports/<run-id>
```

Expected: 6 new issues appear in the backlog, 1 new comment on #25.

- [ ] **Step 3: Verify**

```bash
gh issue list --repo ness-EE/boject-cms --label roadmap --limit 10
gh issue view 25
```

Confirm the new issues list the report path and that #25 has the new comment.

- [ ] **Step 4: Update #88 (tracking issue)**

Add a comment to #88 linking the first report and listing the new follow-up issue numbers:

```bash
gh issue comment 88 --body "First load-test report committed at \`perf/reports/<run-id>/summary.md\`. Follow-ups opened: #<a> #<b> #<c> #<d> #<e> #<f>. Evidence attached to #25."
```

No commit needed for this task.

---

## Self-review summary

- **Spec coverage:** every deliverable from the spec's "Success Criteria" maps to Tasks 18–21 (perf:sweep runs, report committed, README, follow-ups opened, docs mirrored, top-level README). Scenarios all land in Tasks 9–11. Seed helpers in Tasks 3–7. Sampler in Task 13. Reporter in Tasks 14 + 17.
- **Placeholders:** none remaining — every "fill in" in the report template is explicitly acknowledged as an operator step in Task 19 Step 6.
- **Type consistency:** `PerfContentTypeDef` / `PerfFieldDef` are introduced in Task 4 and re-used in Task 6. `Sample` shape is defined once in Task 13. `RawPoint` / `ScenarioStats` are defined once in Task 14 and extended (not redefined) in Task 17.
- **Ambiguity:** the GraphQL query name `perfArticleList` in Task 9 is derived from the dynamic-type registration rule (`{camelName}List`). If the CMS uses a different casing rule when the content-type identifier starts with "Perf", Task 9 Step 3's smoke test will fail fast and surface the correct name.
