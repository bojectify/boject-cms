# Schema-as-Code Entrypoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Spec 3 `applySchema()` into the container entrypoint so a directory of bundle files (pointed at by `BOJECT_SCHEMA_DIR`) is converged on every boot. Update `create-boject-cms` to scaffold that directory, mount it, and ship the chosen starter as the first committed schema. After this lands, the deploy story is "edit `content-types/schema.boject.json`, commit, redeploy."

**Architecture:** A new standalone script `apps/cms/scripts/docker-entrypoint/apply-schema.ts` mirrors the existing `import-starter.ts`: pure `applySchemaIfConfigured(prisma, opts)` function (testable with a fake `applySchemaFn` + `readDir` / `readFile`) plus a CLI entry that reads env, sets up Prisma, and either exits 0 (no-op) or 1 (error). The shell entrypoint inserts a new step 5 between starter import and Nuxt boot. The scaffolder grows a `content-types/` template that always ships (empty bundle for the `none` choice; copy of the chosen starter otherwise), plus compose / env / README updates.

**Tech Stack:** TypeScript, `tsx`, Prisma 7 driver-adapter pattern, Vitest unit project (DB-backed tests follow the existing `applySchema.test.ts` and `import-starter.test.ts` patterns), bash, Docker.

**Originating spec:** [`docs/superpowers/specs/2026-05-01-schema-as-code-entrypoint-design.md`](../specs/2026-05-01-schema-as-code-entrypoint-design.md)
**Branch:** `feat/145-schema-as-code-entrypoint` (already created off `main`)
**Parents shipped:**

- Spec 1 — schema-readonly-flag (PR #150)
- Bundle-format prereq — `unique` flag round-trip (PR #151)
- Spec 2 — schema-as-code planner (PR #152)
- Planner edge-cases — options equality + snapshot perf (PR #153)
- Spec 3 — schema-as-code applier (PR #154)

**Children that consume this:** Spec 5 (CLI HTTP surface — `boject schema apply` / `export` / `check`).

---

## File Structure

| File                                                                        | Responsibility                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cms/scripts/docker-entrypoint/apply-schema.ts` (new)                  | The entrypoint script. Exports `applySchemaIfConfigured(prisma, opts)` (pure, dependency-injected) plus a CLI entry that wires up `PrismaPg` + `applySchema` from env. Mirrors the existing `import-starter.ts` shape exactly — same module structure, same `if (import.meta.url === ...)` guard. |
| `apps/cms/scripts/docker-entrypoint/apply-schema.test.ts` (new)             | Unit tests on `applySchemaIfConfigured` with a fake `applySchemaFn` + injected `readDir` / `readFile`. Pure — no DB. Mirrors `import-starter.test.ts` test conventions.                                                                                                                           |
| `apps/cms/scripts/docker-entrypoint/apply-schema.integration.test.ts` (new) | DB-backed tests against `boject_test`. Real Prisma + real `applySchema`, fixture bundles written to an `os.tmpdir()` directory per test. Lives in the unit Vitest project (`scripts/**/*.test.ts` glob) — same pattern as `applySchema.test.ts` from Spec 3.                                      |
| `apps/cms/scripts/docker-entrypoint/import-starter.ts` (modify)             | Add a one-paragraph header comment explaining how this script's first-boot lifecycle differs from `apply-schema.ts`'s every-boot lifecycle. No behavioural change.                                                                                                                                |
| `apps/cms/docker/entrypoint.sh` (modify)                                    | Renumber existing steps from `1/5..5/5` to `1/6..6/6` and insert a new step 5: `tsx scripts/docker-entrypoint/apply-schema.ts`.                                                                                                                                                                   |
| `apps/cms/Dockerfile` (modify)                                              | Add `mkdir -p /app/content-types` + `chown -R cms:cms /app/content-types` to the runtime stage so a `:ro` bind mount onto that path works on first boot. Docker requires the target dir to exist before mounting read-only.                                                                       |
| `apps/cms/docker/smoke-test.sh` (modify)                                    | Extend with three new assertions: second-boot is a no-op (`done — 1 file applied, 0 total changes`); edit-then-restart applies the change; remove-with-entries blocker fails the boot.                                                                                                            |
| `packages/create-boject-cms/src/templates/contentTypes.ts` (new)            | Pure renderer: given a `StarterChoice`, returns the bytes for `content-types/schema.boject.json`. For `none` → an empty bundle stub. For `base/sport/rugby` → a marker telling the writer to copy the starter file byte-for-byte.                                                                 |
| `packages/create-boject-cms/src/templates/contentTypes.test.ts` (new)       | Unit tests on the renderer.                                                                                                                                                                                                                                                                       |
| `packages/create-boject-cms/src/render.ts` (modify)                         | Re-export the new `renderContentTypesBundle` (or whatever the helper ends up named).                                                                                                                                                                                                              |
| `packages/create-boject-cms/src/writeProject.ts` (modify)                   | Always write `content-types/schema.boject.json`. For `none`, use the empty-bundle stub. For starters, copy from `startersSourceDir/<starter>.boject.json` directly (byte-for-byte preserves the canonical export).                                                                                |
| `packages/create-boject-cms/tests/unit/writeProject.test.ts` (modify)       | Add assertions that `content-types/schema.boject.json` exists and matches expected content for each starter choice.                                                                                                                                                                               |
| `packages/create-boject-cms/src/templates/dockerCompose.ts` (modify)        | Always add `./content-types:/app/content-types:ro` to the `cms` service `volumes` block (regardless of starter choice — the dir is always present after scaffold).                                                                                                                                |
| `packages/create-boject-cms/src/templates/dockerCompose.test.ts` (modify)   | Assert the bind mount line is present in every rendered output.                                                                                                                                                                                                                                   |
| `packages/create-boject-cms/src/templates/envFile.ts` (modify)              | Always emit `BOJECT_SCHEMA_DIR=/app/content-types`. Add a commented `# BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true` line with one-line explanatory comment.                                                                                                                                              |
| `packages/create-boject-cms/src/templates/envFile.test.ts` (modify)         | Assert both lines are present.                                                                                                                                                                                                                                                                    |
| `packages/create-boject-cms/src/templates/readme.ts` (modify)               | Add a "Content types" section explaining schema-as-code briefly.                                                                                                                                                                                                                                  |
| `packages/create-boject-cms/src/templates/readme.test.ts` (modify)          | Assert the new section is present.                                                                                                                                                                                                                                                                |
| `starters/README.md` (modify)                                               | Add a one-paragraph note: starter bundles are also valid `BOJECT_SCHEMA_DIR` content; the scaffolder copies the chosen starter into `<project>/content-types/schema.boject.json`.                                                                                                                 |
| `CLAUDE.md` (modify)                                                        | Document `BOJECT_SCHEMA_DIR` in the runtime env vars list. Update the **Entrypoint** bullet to reflect the 6-step boot sequence. Add a **Schema-as-code apply at boot** bullet under Architecture. Add the new key files.                                                                         |

---

## Cross-Cutting Notes

**Vitest projects.** Both new test files (`apply-schema.test.ts` and `apply-schema.integration.test.ts`) live under `apps/cms/scripts/docker-entrypoint/` and run in the **unit** project (no `globalSetup`). The integration-style file resets the DB itself in `beforeEach`, exactly like `applySchema.test.ts` does. Naming: keep the `*.integration.test.ts` suffix purely as a hint to readers that this file talks to Postgres — Vitest doesn't care; the glob `scripts/**/*.test.ts` picks up both. (The repo's "integration" project is reserved for `server/api/**` and `server/middleware/**` — REST endpoint tests with `globalSetup`. Don't put DB-backed entrypoint tests there.)

**Run the new tests:**

```bash
# Unit tests on the pure function
pnpm --filter cms exec vitest run --project unit scripts/docker-entrypoint/apply-schema.test.ts

# DB-backed tests
pnpm --filter cms exec vitest run --project unit scripts/docker-entrypoint/apply-schema.integration.test.ts
```

**Postgres needed.** `pnpm db:up` before the integration-style file. The pure unit file does not need Postgres.

**No Nuxt or h3 imports in `apply-schema.ts`.** The script runs from `tsx` standalone via the docker entrypoint. Use the same relative-path import shape as `import-starter.ts` — `import type { PrismaClient } from '../../generated/prisma/client'`. Do not use the `#prisma` alias here (that's a Nuxt-resolved path; entrypoint scripts run outside the Nuxt build).

**Why a separate `applySchemaFn` injection instead of importing `applySchema` directly.** The pure function has to be unit-testable without spinning up Postgres. Following the `import-starter.ts` precedent, the function takes the applier as a constructor arg; the CLI entry block passes the real `applySchema` from `../content-bundle/applySchema`. The CLI entry is glue code — not unit-tested, exercised by the smoke test instead.

**`applied` counter shape.** The applier returns `ApplySchemaResult.applied = { contentTypesCreated, contentTypesUpdated, contentTypesRemoved, fieldsCreated, fieldsUpdated, fieldsRemoved }`. The script aggregates these across files for the grand-total log line. Total changes = sum of all six counters across all files.

**Bundle path is `/app/content-types` — not `/starters` or `/app/starters`.** The existing `BOJECT_INITIAL_STARTER` mount uses `/starters` (host-side) — historical inconsistency. The new mount sticks with the spec-mandated `/app/content-types`. Don't try to "fix" the starter mount path — that's an unrelated change.

**Read-only mount.** The container does not write to `/app/content-types`. Tests assert the script reads files but never opens them for writing. The `:ro` flag on the bind mount enforces this at the OS level.

**Fail loud, fail fast.** Any error thrown by `applySchema` (validation, blocker, concurrency, anything else) propagates up to the CLI entry and exits the script with code 1. The shell `set -euo pipefail` then halts the entrypoint — the container crashes. The spec's contract: a bad schema PR manifests as "container won't boot" so deploy pipelines roll back. This mandates that any caught/swallowed error inside the script is a bug.

**Conventional commits.** Each commit ends with the trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. Use `feat:` / `fix:` / `chore:` / `docs:` / `test:` prefixes matching recent history.

**lefthook on commit.** Pre-commit runs prettier + lint + per-package typecheck on staged files. If a hook rewrites formatting, re-stage and retry. If a hook fails, fix the underlying issue. Do NOT pass `--no-verify`.

**pnpm only.** Never `npm` / `npx`.

---

### Task 1: `apply-schema.ts` skeleton + skip-when-unconfigured

Pure function `applySchemaIfConfigured(prisma, opts)` that handles the "nothing to do" cases:

- `dirPath` is `undefined` (env var unset) → return `{ applied: false, reason: 'no-dir', files: 0, totalChanges: 0 }`.
- Directory exists but has no `.boject.json` files → return `{ applied: false, reason: 'no-bundles', files: 0, totalChanges: 0 }`.
- (Empty directory is a special case of the no-bundles branch — same return.)

No call to `applySchemaFn` happens in any of these branches.

**Files:**

- Create: `apps/cms/scripts/docker-entrypoint/apply-schema.ts`
- Create: `apps/cms/scripts/docker-entrypoint/apply-schema.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/cms/scripts/docker-entrypoint/apply-schema.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { applySchemaIfConfigured } from './apply-schema';

const NOOP_LOGGER = { info: vi.fn(), error: vi.fn() };

describe('applySchemaIfConfigured', () => {
  it('skips when dirPath is undefined', async () => {
    const applySchemaFn = vi.fn();
    const readDir = vi.fn();
    const readFile = vi.fn();

    const result = await applySchemaIfConfigured(
      {} as Parameters<typeof applySchemaIfConfigured>[0],
      {
        dirPath: undefined,
        allowDestructive: false,
        applySchemaFn,
        readDir,
        readFile,
        logger: NOOP_LOGGER,
      }
    );

    expect(result).toEqual({
      applied: false,
      reason: 'no-dir',
      files: 0,
      totalChanges: 0,
    });
    expect(applySchemaFn).not.toHaveBeenCalled();
    expect(readDir).not.toHaveBeenCalled();
  });

  it('skips when the directory contains no .boject.json files', async () => {
    const applySchemaFn = vi.fn();
    const readDir = vi.fn().mockResolvedValue(['README.md', 'notes.txt']);
    const readFile = vi.fn();

    const result = await applySchemaIfConfigured(
      {} as Parameters<typeof applySchemaIfConfigured>[0],
      {
        dirPath: '/app/content-types',
        allowDestructive: false,
        applySchemaFn,
        readDir,
        readFile,
        logger: NOOP_LOGGER,
      }
    );

    expect(result).toEqual({
      applied: false,
      reason: 'no-bundles',
      files: 0,
      totalChanges: 0,
    });
    expect(applySchemaFn).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('skips when the directory is empty (special case of no-bundles)', async () => {
    const applySchemaFn = vi.fn();
    const readDir = vi.fn().mockResolvedValue([]);
    const readFile = vi.fn();

    const result = await applySchemaIfConfigured(
      {} as Parameters<typeof applySchemaIfConfigured>[0],
      {
        dirPath: '/app/content-types',
        allowDestructive: false,
        applySchemaFn,
        readDir,
        readFile,
        logger: NOOP_LOGGER,
      }
    );

    expect(result).toEqual({
      applied: false,
      reason: 'no-bundles',
      files: 0,
      totalChanges: 0,
    });
  });
});
```

- [ ] **Step 2: Run, verify it FAILS**

```bash
pnpm --filter cms exec vitest run --project unit scripts/docker-entrypoint/apply-schema.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the skeleton**

`apps/cms/scripts/docker-entrypoint/apply-schema.ts`:

```ts
// apps/cms/scripts/docker-entrypoint/apply-schema.ts
//
// Every-boot schema apply. Reads each *.boject.json file in
// BOJECT_SCHEMA_DIR (alphabetical order), runs the Spec 3 applier
// against each, and aggregates per-file results into a grand total.
//
// Lifecycle distinction:
// - import-starter.ts runs ONCE on first boot when ContentType is empty;
//   it imports both schema and entries (e.g. SiteSettings seed).
// - apply-schema.ts (this file) runs on EVERY boot, idempotent,
//   schema-only, and is gated by the planner refusing destructive ops
//   without BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true.

import type { PrismaClient } from '../../generated/prisma/client';
import type {
  ApplySchemaOptions,
  ApplySchemaResult,
} from '../content-bundle/applySchema';
import type { Bundle } from '../content-bundle/types';

export type ApplySchemaFn = (
  prisma: PrismaClient,
  bundle: Bundle,
  options?: ApplySchemaOptions
) => Promise<ApplySchemaResult>;

export interface ApplySchemaLogger {
  info: (msg: string) => void;
  error: (msg: string) => void;
}

export interface ApplySchemaIfConfiguredInput {
  /** Bundle directory path. Undefined = env var unset = skip. */
  dirPath: string | undefined;
  /** Forwarded to each applySchema call. */
  allowDestructive: boolean;
  /** Injected applier (real applySchema in production, mock in tests). */
  applySchemaFn: ApplySchemaFn;
  /** Directory listing (defaults to fs.readdir). */
  readDir: (path: string) => Promise<string[]>;
  /** File read (defaults to fs.readFile UTF-8). */
  readFile: (path: string) => Promise<string>;
  /** Logger surface; production uses console. */
  logger: ApplySchemaLogger;
}

export interface ApplySchemaIfConfiguredResult {
  applied: boolean;
  reason: 'no-dir' | 'no-bundles' | 'applied';
  files: number;
  totalChanges: number;
}

export async function applySchemaIfConfigured(
  _prisma: PrismaClient,
  input: ApplySchemaIfConfiguredInput
): Promise<ApplySchemaIfConfiguredResult> {
  if (!input.dirPath) {
    return { applied: false, reason: 'no-dir', files: 0, totalChanges: 0 };
  }
  const entries = await input.readDir(input.dirPath);
  const bundles = entries
    .filter((name) => name.endsWith('.boject.json'))
    .sort();
  if (bundles.length === 0) {
    return { applied: false, reason: 'no-bundles', files: 0, totalChanges: 0 };
  }
  // Apply walk lands in Task 2.
  return {
    applied: true,
    reason: 'applied',
    files: bundles.length,
    totalChanges: 0,
  };
}
```

The `_prisma` parameter is unused at this stage; later tasks consume it. The `import.meta.url === ...` CLI entry block lands in Task 6.

- [ ] **Step 4: Run, verify GREEN** (3/3 tests pass).

The third "applied" return value at the bottom is unreached by these tests — that's fine. Task 2 will exercise it.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/docker-entrypoint/apply-schema.ts apps/cms/scripts/docker-entrypoint/apply-schema.test.ts
git commit -m "$(cat <<'EOF'
feat(entrypoint): apply-schema skeleton — skip when no dir / no bundles

Pure function applySchemaIfConfigured(prisma, opts) with three
short-circuit paths:
- dirPath undefined (env var unset) → reason: 'no-dir'
- empty directory → reason: 'no-bundles'
- directory with no *.boject.json files → reason: 'no-bundles'

Subsequent tasks add the file-walk + applier invocation, summary
logging, fail-fast on errors, and the CLI entry block.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: File walk + alphabetical apply order

Add the per-file apply loop. `applySchemaFn` is called once per `.boject.json` file in alphabetical order, and per-file results are aggregated into the grand-total `totalChanges`.

**Files:**

- Modify: `apps/cms/scripts/docker-entrypoint/apply-schema.ts`
- Modify: `apps/cms/scripts/docker-entrypoint/apply-schema.test.ts`

- [ ] **Step 1: Add the failing tests**

Append inside the outer `describe('applySchemaIfConfigured', ...)` block:

```ts
const ZERO_APPLIED = {
  contentTypesCreated: 0,
  contentTypesUpdated: 0,
  contentTypesRemoved: 0,
  fieldsCreated: 0,
  fieldsUpdated: 0,
  fieldsRemoved: 0,
};

const EMPTY_PLAN = {
  contentTypes: { create: [], update: [], remove: [] },
  fields: { create: [], update: [], remove: [] },
  warnings: [],
  blockers: [],
};

const SAMPLE_BUNDLE_JSON = JSON.stringify({
  version: 2,
  exportedAt: '2026-05-01T00:00:00.000Z',
  portable: true,
  contentTypes: [],
});

it('reads files in alphabetical order and calls applySchema once per file', async () => {
  const callOrder: string[] = [];
  const applySchemaFn = vi.fn().mockImplementation(async () => {
    return { changed: false, plan: EMPTY_PLAN, applied: { ...ZERO_APPLIED } };
  });
  const readDir = vi
    .fn()
    .mockResolvedValue([
      'b.boject.json',
      'a.boject.json',
      'README.md',
      'c.boject.json',
    ]);
  const readFile = vi.fn().mockImplementation(async (p: string) => {
    callOrder.push(p);
    return SAMPLE_BUNDLE_JSON;
  });

  const result = await applySchemaIfConfigured(
    {} as Parameters<typeof applySchemaIfConfigured>[0],
    {
      dirPath: '/app/content-types',
      allowDestructive: false,
      applySchemaFn,
      readDir,
      readFile,
      logger: NOOP_LOGGER,
    }
  );

  expect(callOrder).toEqual([
    '/app/content-types/a.boject.json',
    '/app/content-types/b.boject.json',
    '/app/content-types/c.boject.json',
  ]);
  expect(applySchemaFn).toHaveBeenCalledTimes(3);
  expect(result).toEqual({
    applied: true,
    reason: 'applied',
    files: 3,
    totalChanges: 0,
  });
});

it('aggregates totalChanges across all files', async () => {
  const applySchemaFn = vi
    .fn()
    .mockResolvedValueOnce({
      changed: true,
      plan: EMPTY_PLAN,
      applied: {
        ...ZERO_APPLIED,
        contentTypesCreated: 1,
        fieldsCreated: 2,
      },
    })
    .mockResolvedValueOnce({
      changed: true,
      plan: EMPTY_PLAN,
      applied: {
        ...ZERO_APPLIED,
        fieldsUpdated: 3,
      },
    });
  const readDir = vi.fn().mockResolvedValue(['a.boject.json', 'b.boject.json']);
  const readFile = vi.fn().mockResolvedValue(SAMPLE_BUNDLE_JSON);

  const result = await applySchemaIfConfigured(
    {} as Parameters<typeof applySchemaIfConfigured>[0],
    {
      dirPath: '/app/content-types',
      allowDestructive: false,
      applySchemaFn,
      readDir,
      readFile,
      logger: NOOP_LOGGER,
    }
  );

  expect(result.totalChanges).toBe(6); // 1 + 2 + 3
  expect(result.files).toBe(2);
});
```

- [ ] **Step 2: Run, verify they FAIL**

`applySchemaFn` is never called by the skeleton — both tests fail.

- [ ] **Step 3: Implement the apply walk**

Replace the placeholder return at the bottom of `applySchemaIfConfigured` with:

```ts
let totalChanges = 0;
for (const name of bundles) {
  const fullPath = `${input.dirPath}/${name}`;
  const raw = await input.readFile(fullPath);
  const bundle = JSON.parse(raw) as Bundle;
  const result = await input.applySchemaFn(_prisma, bundle, {
    allowDestructive: input.allowDestructive,
  });
  totalChanges += sumApplied(result.applied);
}
return {
  applied: true,
  reason: 'applied',
  files: bundles.length,
  totalChanges,
};
```

Add a helper at the bottom of the file (outside `applySchemaIfConfigured`):

```ts
function sumApplied(applied: ApplySchemaResult['applied']): number {
  return (
    applied.contentTypesCreated +
    applied.contentTypesUpdated +
    applied.contentTypesRemoved +
    applied.fieldsCreated +
    applied.fieldsUpdated +
    applied.fieldsRemoved
  );
}
```

Rename the leading `_prisma` to `prisma` now that it's actually used.

- [ ] **Step 4: Run, verify GREEN** (5/5 tests pass — the original 3 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/docker-entrypoint/apply-schema.ts apps/cms/scripts/docker-entrypoint/apply-schema.test.ts
git commit -m "$(cat <<'EOF'
feat(entrypoint): apply-schema reads bundle dir, applies in alphabetical order

Walks the directory, filters to *.boject.json files, sorts by name
(deterministic — operators can prefix with 00-, 10-, etc. if they want
explicit ordering), reads + parses each, and calls the injected
applySchemaFn once per file. Per-file applied counters are summed into
the result's totalChanges so the eventual summary log line can render
a grand total.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `allowDestructive` option forwarding

Verify the `allowDestructive` value passed into `applySchemaIfConfigured` is forwarded into every per-file `applySchemaFn` call. (Task 2 already wired it through structurally — this task pins the contract with a test so a future refactor can't quietly drop it.)

**Files:**

- Modify: `apps/cms/scripts/docker-entrypoint/apply-schema.test.ts`

- [ ] **Step 1: Add the test**

```ts
it('forwards allowDestructive into every per-file applySchema call', async () => {
  const applySchemaFn = vi.fn().mockResolvedValue({
    changed: false,
    plan: EMPTY_PLAN,
    applied: { ...ZERO_APPLIED },
  });
  const readDir = vi.fn().mockResolvedValue(['a.boject.json', 'b.boject.json']);
  const readFile = vi.fn().mockResolvedValue(SAMPLE_BUNDLE_JSON);

  await applySchemaIfConfigured(
    {} as Parameters<typeof applySchemaIfConfigured>[0],
    {
      dirPath: '/app/content-types',
      allowDestructive: true,
      applySchemaFn,
      readDir,
      readFile,
      logger: NOOP_LOGGER,
    }
  );

  expect(applySchemaFn).toHaveBeenCalledTimes(2);
  expect(applySchemaFn.mock.calls[0]![2]).toEqual({ allowDestructive: true });
  expect(applySchemaFn.mock.calls[1]![2]).toEqual({ allowDestructive: true });
});
```

- [ ] **Step 2: Run, verify it PASSES** (the wiring from Task 2 already does the right thing).

If the test FAILS, the production code is broken — investigate before proceeding. The `applySchemaFn` call site in Task 2 already passes `{ allowDestructive: input.allowDestructive }`, so the test should be green out of the gate.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/scripts/docker-entrypoint/apply-schema.test.ts
git commit -m "$(cat <<'EOF'
test(entrypoint): pin allowDestructive forwarding in apply-schema

Regression test that asserts the allowDestructive flag passed into
applySchemaIfConfigured is forwarded into every per-file applySchema
call. The CLI entry (Task 6) reads this from BOJECT_ALLOW_DESTRUCTIVE_SCHEMA
and passes it through.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Logging — per-file and grand-total summary

Each successfully-applied file logs one line; after the loop, a grand-total summary line lands. Format matches the spec:

```
[apply-schema] schema.boject.json: 1 created, 2 updated, 0 removed
[apply-schema] done — 1 file applied, 3 total changes
```

For no-op applies (`changed: false`), the per-file line uses `(no-op)` instead of zeros — easier to scan.

The script also logs the entry banner ("BOJECT_SCHEMA_DIR=...") and the file count ("reading N file(s): ..."). All log lines go through the injected `logger.info`.

**Files:**

- Modify: `apps/cms/scripts/docker-entrypoint/apply-schema.ts`
- Modify: `apps/cms/scripts/docker-entrypoint/apply-schema.test.ts`

- [ ] **Step 1: Add the failing tests**

```ts
it('logs entry banner, per-file summaries, and grand total', async () => {
  const logger = { info: vi.fn(), error: vi.fn() };
  const applySchemaFn = vi
    .fn()
    .mockResolvedValueOnce({
      changed: true,
      plan: EMPTY_PLAN,
      applied: {
        ...ZERO_APPLIED,
        contentTypesCreated: 1,
        contentTypesUpdated: 2,
      },
    })
    .mockResolvedValueOnce({
      changed: false,
      plan: EMPTY_PLAN,
      applied: { ...ZERO_APPLIED },
    });
  const readDir = vi.fn().mockResolvedValue(['a.boject.json', 'b.boject.json']);
  const readFile = vi.fn().mockResolvedValue(SAMPLE_BUNDLE_JSON);

  await applySchemaIfConfigured(
    {} as Parameters<typeof applySchemaIfConfigured>[0],
    {
      dirPath: '/app/content-types',
      allowDestructive: false,
      applySchemaFn,
      readDir,
      readFile,
      logger,
    }
  );

  const lines = logger.info.mock.calls.map((c) => c[0] as string);
  expect(lines).toContain(
    '[apply-schema] BOJECT_SCHEMA_DIR=/app/content-types'
  );
  expect(lines).toContain(
    '[apply-schema] reading 2 files: a.boject.json, b.boject.json'
  );
  expect(lines).toContain(
    '[apply-schema] a.boject.json: 1 created, 2 updated, 0 removed'
  );
  expect(lines).toContain('[apply-schema] b.boject.json: (no-op)');
  expect(lines).toContain(
    '[apply-schema] done — 2 files applied, 3 total changes'
  );
});

it('logs the singular form for one file', async () => {
  const logger = { info: vi.fn(), error: vi.fn() };
  const applySchemaFn = vi.fn().mockResolvedValue({
    changed: false,
    plan: EMPTY_PLAN,
    applied: { ...ZERO_APPLIED },
  });
  const readDir = vi.fn().mockResolvedValue(['schema.boject.json']);
  const readFile = vi.fn().mockResolvedValue(SAMPLE_BUNDLE_JSON);

  await applySchemaIfConfigured(
    {} as Parameters<typeof applySchemaIfConfigured>[0],
    {
      dirPath: '/app/content-types',
      allowDestructive: false,
      applySchemaFn,
      readDir,
      readFile,
      logger,
    }
  );

  const lines = logger.info.mock.calls.map((c) => c[0] as string);
  expect(lines).toContain('[apply-schema] reading 1 file: schema.boject.json');
  expect(lines).toContain(
    '[apply-schema] done — 1 file applied, 0 total changes'
  );
});

it('logs a skip line when no dir is configured', async () => {
  const logger = { info: vi.fn(), error: vi.fn() };
  await applySchemaIfConfigured(
    {} as Parameters<typeof applySchemaIfConfigured>[0],
    {
      dirPath: undefined,
      allowDestructive: false,
      applySchemaFn: vi.fn(),
      readDir: vi.fn(),
      readFile: vi.fn(),
      logger,
    }
  );
  expect(logger.info).toHaveBeenCalledWith(
    '[apply-schema] BOJECT_SCHEMA_DIR not set — skipping'
  );
});

it('logs a skip line when the dir has no bundles', async () => {
  const logger = { info: vi.fn(), error: vi.fn() };
  await applySchemaIfConfigured(
    {} as Parameters<typeof applySchemaIfConfigured>[0],
    {
      dirPath: '/app/content-types',
      allowDestructive: false,
      applySchemaFn: vi.fn(),
      readDir: vi.fn().mockResolvedValue(['README.md']),
      readFile: vi.fn(),
      logger,
    }
  );
  expect(logger.info).toHaveBeenCalledWith(
    '[apply-schema] no .boject.json files in /app/content-types — skipping'
  );
});
```

- [ ] **Step 2: Run, verify they FAIL**

The function currently doesn't call `logger.info` at all.

- [ ] **Step 3: Add the logging calls**

Inside `applySchemaIfConfigured`:

```ts
// At the top, before the dirPath check:
if (!input.dirPath) {
  input.logger.info('[apply-schema] BOJECT_SCHEMA_DIR not set — skipping');
  return { applied: false, reason: 'no-dir', files: 0, totalChanges: 0 };
}

input.logger.info(`[apply-schema] BOJECT_SCHEMA_DIR=${input.dirPath}`);

const entries = await input.readDir(input.dirPath);
const bundles = entries.filter((name) => name.endsWith('.boject.json')).sort();

if (bundles.length === 0) {
  input.logger.info(
    `[apply-schema] no .boject.json files in ${input.dirPath} — skipping`
  );
  return { applied: false, reason: 'no-bundles', files: 0, totalChanges: 0 };
}

input.logger.info(
  `[apply-schema] reading ${bundles.length} ${bundles.length === 1 ? 'file' : 'files'}: ${bundles.join(', ')}`
);

let totalChanges = 0;
for (const name of bundles) {
  const fullPath = `${input.dirPath}/${name}`;
  const raw = await input.readFile(fullPath);
  const bundle = JSON.parse(raw) as Bundle;
  const result = await input.applySchemaFn(prisma, bundle, {
    allowDestructive: input.allowDestructive,
  });
  const fileChanges = sumApplied(result.applied);
  totalChanges += fileChanges;
  if (result.changed) {
    input.logger.info(
      `[apply-schema] ${name}: ${result.applied.contentTypesCreated + result.applied.fieldsCreated} created, ${result.applied.contentTypesUpdated + result.applied.fieldsUpdated} updated, ${result.applied.contentTypesRemoved + result.applied.fieldsRemoved} removed`
    );
  } else {
    input.logger.info(`[apply-schema] ${name}: (no-op)`);
  }
}

input.logger.info(
  `[apply-schema] done — ${bundles.length} ${bundles.length === 1 ? 'file' : 'files'} applied, ${totalChanges} total changes`
);

return {
  applied: true,
  reason: 'applied',
  files: bundles.length,
  totalChanges,
};
```

The per-file count format collapses content-type and field counters per verb. If the spec's "1 created, 2 updated, 0 removed" needs to differentiate types from fields, revisit; the simpler aggregated form is what the spec's example shows.

- [ ] **Step 4: Run, verify GREEN** (9/9 — original 6 + 4 new in this task; the "no skip log" test from Task 1 now also implicitly checks the new banner doesn't fire).

If a Task 1 test breaks because the function now logs additional banners that weren't expected: that's a Task 1 test that asserted "logger.info NOT called". Update that test to allow the skip-line log (Task 4 is what added the line, so the Task 1 expectations need to be updated to match). If a Task 1 test asserted nothing about the logger, it stays green.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/docker-entrypoint/apply-schema.ts apps/cms/scripts/docker-entrypoint/apply-schema.test.ts
git commit -m "$(cat <<'EOF'
feat(entrypoint): apply-schema logs per-file and grand-total summaries

Adds structured log output:
- [apply-schema] BOJECT_SCHEMA_DIR=<path>
- [apply-schema] reading N file(s): <list>
- [apply-schema] <file>: N created, N updated, N removed   (or "(no-op)")
- [apply-schema] done — N file(s) applied, N total changes

Skip cases also log: "BOJECT_SCHEMA_DIR not set" or "no .boject.json
files in <dir>". All log lines go through the injected logger so
tests can assert the output verbatim.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Fail-fast on errors + blocker detail logging

If any per-file `applySchemaFn` call rejects, stop the loop and rethrow. For `SchemaApplyBlockedError` specifically, log each blocker's `code`, `path`, and `message` on its own indented line before rethrowing — operators reading deploy logs need to see what got rejected.

**Files:**

- Modify: `apps/cms/scripts/docker-entrypoint/apply-schema.ts`
- Modify: `apps/cms/scripts/docker-entrypoint/apply-schema.test.ts`

- [ ] **Step 1: Add the failing tests**

```ts
import { SchemaApplyBlockedError } from '../content-bundle/applySchemaErrors';

it('throws on the first failing file and does not continue', async () => {
  const applySchemaFn = vi
    .fn()
    .mockResolvedValueOnce({
      changed: true,
      plan: EMPTY_PLAN,
      applied: {
        ...ZERO_APPLIED,
        contentTypesCreated: 1,
      },
    })
    .mockRejectedValueOnce(new Error('boom'));
  const readDir = vi
    .fn()
    .mockResolvedValue(['a.boject.json', 'b.boject.json', 'c.boject.json']);
  const readFile = vi.fn().mockResolvedValue(SAMPLE_BUNDLE_JSON);

  await expect(
    applySchemaIfConfigured(
      {} as Parameters<typeof applySchemaIfConfigured>[0],
      {
        dirPath: '/app/content-types',
        allowDestructive: false,
        applySchemaFn,
        readDir,
        readFile,
        logger: NOOP_LOGGER,
      }
    )
  ).rejects.toThrow('boom');

  // a applied, b failed, c never attempted.
  expect(applySchemaFn).toHaveBeenCalledTimes(2);
});

it('logs each blocker on a SchemaApplyBlockedError before rethrowing', async () => {
  const blockers = [
    {
      code: 'CONTENT_TYPE_REMOVAL_WITH_ENTRIES' as const,
      message: 'Tag has 4 entries',
      path: 'contentTypes.Tag',
    },
    {
      code: 'FIELD_TYPE_CHANGE' as const,
      message: 'cannot change DATETIME to TEXT',
      path: 'contentTypes.Article.fields.publishDate',
    },
  ];
  const blockedPlan = { ...EMPTY_PLAN, blockers };
  const applySchemaFn = vi
    .fn()
    .mockRejectedValueOnce(new SchemaApplyBlockedError(blockers, blockedPlan));
  const readDir = vi.fn().mockResolvedValue(['schema.boject.json']);
  const readFile = vi.fn().mockResolvedValue(SAMPLE_BUNDLE_JSON);
  const logger = { info: vi.fn(), error: vi.fn() };

  await expect(
    applySchemaIfConfigured(
      {} as Parameters<typeof applySchemaIfConfigured>[0],
      {
        dirPath: '/app/content-types',
        allowDestructive: false,
        applySchemaFn,
        readDir,
        readFile,
        logger,
      }
    )
  ).rejects.toBeInstanceOf(SchemaApplyBlockedError);

  const errLines = logger.error.mock.calls.map((c) => c[0] as string);
  expect(errLines).toContain('[apply-schema] schema.boject.json: BLOCKED');
  expect(errLines).toContain(
    '  - CONTENT_TYPE_REMOVAL_WITH_ENTRIES at contentTypes.Tag: Tag has 4 entries'
  );
  expect(errLines).toContain(
    '  - FIELD_TYPE_CHANGE at contentTypes.Article.fields.publishDate: cannot change DATETIME to TEXT'
  );
});
```

NOTE: `SchemaApplyBlockedError`'s `BlockerCode` union — the codes used above (`CONTENT_TYPE_REMOVAL_WITH_ENTRIES`, `FIELD_TYPE_CHANGE`) must exist. Verify by reading `apps/cms/scripts/content-bundle/schemaPlan.types.ts` first; if the unions don't include those exact codes, swap to ones that do.

- [ ] **Step 2: Run, verify they FAIL**

The current loop doesn't catch / log blockers; it lets the rejection propagate without logging.

- [ ] **Step 3: Add the try/catch with blocker logging**

Wrap the per-file apply call:

```ts
import { SchemaApplyBlockedError } from '../content-bundle/applySchemaErrors';

// ... inside the for loop:
let result: ApplySchemaResult;
try {
  result = await input.applySchemaFn(prisma, bundle, {
    allowDestructive: input.allowDestructive,
  });
} catch (err) {
  if (err instanceof SchemaApplyBlockedError) {
    input.logger.error(`[apply-schema] ${name}: BLOCKED`);
    for (const b of err.blockers) {
      input.logger.error(`  - ${b.code} at ${b.path}: ${b.message}`);
    }
  } else {
    input.logger.error(
      `[apply-schema] ${name}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  throw err;
}
```

The non-blocker branch's log line means generic errors also surface a one-liner before propagating, which is friendlier than a bare stack trace in container logs.

- [ ] **Step 4: Run, verify GREEN** (11/11 — 9 from Task 4 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/docker-entrypoint/apply-schema.ts apps/cms/scripts/docker-entrypoint/apply-schema.test.ts
git commit -m "$(cat <<'EOF'
feat(entrypoint): apply-schema fails fast on errors and logs blockers

Wraps each per-file applySchema call in a try/catch. On any error,
log a one-line error before rethrowing so the loop stops and the
caller (the CLI entry, Task 6) can exit with non-zero status. For
SchemaApplyBlockedError specifically, log each blocker's code/path/
message on its own indented line so operators can see exactly what
got rejected without grepping a stack trace.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: CLI entry block

The `if (import.meta.url === \`file://${process.argv[1]}\`)`block that wires environment vars to function arguments and instantiates the real`PrismaClient`+`applySchema`. Mirrors `import-starter.ts`'s entry block exactly.

This block is glue code — it uses dynamic imports to avoid pulling Prisma into the test-time module graph. Not unit-tested at the script level; the smoke test (Task 10) and the integration tests (Task 7) exercise it instead.

**Files:**

- Modify: `apps/cms/scripts/docker-entrypoint/apply-schema.ts`

- [ ] **Step 1: Append the CLI entry block**

At the bottom of `apply-schema.ts`, after the `sumApplied` helper:

```ts
// CLI entry — only runs when this file is invoked directly (e.g. from
// the docker entrypoint via `tsx scripts/docker-entrypoint/apply-schema.ts`).
if (import.meta.url === `file://${process.argv[1]}`) {
  const dirPath = process.env.BOJECT_SCHEMA_DIR;
  const allowDestructive =
    process.env.BOJECT_ALLOW_DESTRUCTIVE_SCHEMA === 'true' ||
    process.env.BOJECT_ALLOW_DESTRUCTIVE_SCHEMA === '1';

  const { PrismaClient } = await import('../../generated/prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { applySchema } = await import('../content-bundle/applySchema');
  const { readdir, readFile } = await import('node:fs/promises');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[apply-schema] DATABASE_URL must be set');
    process.exit(1);
  }
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    await applySchemaIfConfigured(prisma, {
      dirPath,
      allowDestructive,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: {
        info: (msg) => console.log(msg),
        error: (msg) => console.error(msg),
      },
    });
  } catch (err) {
    // Per-file blocker / error details were already logged by
    // applySchemaIfConfigured. Just exit non-zero so the shell
    // entrypoint halts and the container restarts (or the deploy
    // pipeline rolls back).
    if (!(err instanceof Error)) console.error(String(err));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
```

NOTE: the `readdir` returned shape. Node's `fs/promises.readdir(path)` (no options) returns `string[]`. If the lint/types complain, use `readdir(p, { withFileTypes: false })` to be explicit.

- [ ] **Step 2: Run the existing tests, verify still GREEN**

```bash
pnpm --filter cms exec vitest run --project unit scripts/docker-entrypoint/apply-schema.test.ts
```

Expected: 11/11 still pass. The CLI block is guarded by the `import.meta.url ===` check, which is false during test imports.

Also typecheck the file directly:

```bash
pnpm --filter cms typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/scripts/docker-entrypoint/apply-schema.ts
git commit -m "$(cat <<'EOF'
feat(entrypoint): apply-schema CLI entry — wires env to function args

Standalone tsx-runnable entry. Reads BOJECT_SCHEMA_DIR and
BOJECT_ALLOW_DESTRUCTIVE_SCHEMA from env, instantiates Prisma via
PrismaPg adapter, calls applySchemaIfConfigured with real applySchema
+ node:fs/promises. On error, logs were already emitted by
applySchemaIfConfigured; the entry just exits 1 so the shell
entrypoint halts the boot.

Same dynamic-import pattern as import-starter.ts to keep Prisma out
of the test-time module graph.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: DB-backed integration tests

End-to-end tests against a real Postgres + the real `applySchema`. Each test writes a fixture bundle to a tempdir, then calls `applySchemaIfConfigured` with the real applier and the real `node:fs/promises` readers.

Five tests from the spec:

1. Apply a schema bundle to an empty DB.
2. No-op when the bundle matches current state.
3. Apply a diff (add field) when the bundle is updated.
4. Refuse without `--allow-destructive` when removing a type.
5. Apply the removal with `--allow-destructive`.

**Files:**

- Create: `apps/cms/scripts/docker-entrypoint/apply-schema.integration.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { applySchema } from '../content-bundle/applySchema';
import { SchemaApplyBlockedError } from '../content-bundle/applySchemaErrors';
import { applySchemaIfConfigured } from './apply-schema';

const url = 'postgresql://boject:boject@localhost:5432/boject_test';
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

const NOOP_LOGGER = { info: () => {}, error: () => {} };

const ARTICLE_BUNDLE = {
  version: 2 as const,
  exportedAt: '2026-05-01T00:00:00.000Z',
  portable: true as const,
  contentTypes: [
    {
      id: null,
      identifier: 'Article',
      name: 'Article',
      description: null,
      fields: [
        {
          id: null,
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE' as const,
          required: true,
          order: 0,
          options: null,
        },
      ],
    },
  ],
};

const ARTICLE_BUNDLE_WITH_TAGLINE = {
  ...ARTICLE_BUNDLE,
  contentTypes: [
    {
      ...ARTICLE_BUNDLE.contentTypes[0]!,
      fields: [
        ...ARTICLE_BUNDLE.contentTypes[0]!.fields,
        {
          id: null,
          identifier: 'tagline',
          name: 'Tagline',
          type: 'TEXT' as const,
          required: false,
          order: 1,
          options: null,
        },
      ],
    },
  ],
};

const EMPTY_BUNDLE = {
  version: 2 as const,
  exportedAt: '2026-05-01T00:00:00.000Z',
  portable: true as const,
  contentTypes: [],
};

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

async function makeDir(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'apply-schema-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), JSON.stringify(content), 'utf8');
  }
  return dir;
}

const tempDirs: string[] = [];
async function tempDir(files: Record<string, unknown>): Promise<string> {
  const d = await makeDir(files);
  tempDirs.push(d);
  return d;
}

describe('apply-schema (integration)', () => {
  beforeEach(async () => {
    await reset();
  });

  afterAll(async () => {
    await reset();
    for (const d of tempDirs) await rm(d, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it('applies a schema bundle to an empty DB', async () => {
    const dir = await tempDir({
      'schema.boject.json': ARTICLE_BUNDLE,
    });

    const result = await applySchemaIfConfigured(prisma, {
      dirPath: dir,
      allowDestructive: false,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });

    expect(result.applied).toBe(true);
    expect(result.files).toBe(1);
    expect(result.totalChanges).toBeGreaterThan(0);

    const ct = await prisma.contentType.findUnique({
      where: { identifier: 'Article' },
      include: { fields: true },
    });
    expect(ct).not.toBeNull();
    expect(ct!.fields).toHaveLength(1);
  });

  it('is a no-op when the bundle matches current state', async () => {
    // First boot: apply.
    const dir = await tempDir({
      'schema.boject.json': ARTICLE_BUNDLE,
    });
    await applySchemaIfConfigured(prisma, {
      dirPath: dir,
      allowDestructive: false,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });

    // Second call: no-op.
    const result = await applySchemaIfConfigured(prisma, {
      dirPath: dir,
      allowDestructive: false,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });

    expect(result.applied).toBe(true);
    expect(result.totalChanges).toBe(0);
  });

  it('applies a diff (add field) when the bundle is updated', async () => {
    // First apply.
    const initialDir = await tempDir({
      'schema.boject.json': ARTICLE_BUNDLE,
    });
    await applySchemaIfConfigured(prisma, {
      dirPath: initialDir,
      allowDestructive: false,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });

    // Re-apply with the field added.
    const updatedDir = await tempDir({
      'schema.boject.json': ARTICLE_BUNDLE_WITH_TAGLINE,
    });
    const result = await applySchemaIfConfigured(prisma, {
      dirPath: updatedDir,
      allowDestructive: false,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });

    expect(result.totalChanges).toBe(1);
    const tagline = await prisma.contentTypeField.findFirst({
      where: { identifier: 'tagline' },
    });
    expect(tagline).not.toBeNull();
  });

  it('refuses without allowDestructive when removing a type with entries', async () => {
    // Seed Article + an entry.
    const dir = await tempDir({
      'schema.boject.json': ARTICLE_BUNDLE,
    });
    await applySchemaIfConfigured(prisma, {
      dirPath: dir,
      allowDestructive: false,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });
    const ct = await prisma.contentType.findUniqueOrThrow({
      where: { identifier: 'Article' },
    });
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ct.id,
        entryTitle: 'X',
        slug: 'x',
        versions: {
          create: {
            data: { title: 'X' },
            entryTitle: 'X',
            status: 'PUBLISHED',
          },
        },
      },
    });

    // Apply an empty bundle → would remove Article → blocked.
    const removalDir = await tempDir({
      'schema.boject.json': EMPTY_BUNDLE,
    });
    await expect(
      applySchemaIfConfigured(prisma, {
        dirPath: removalDir,
        allowDestructive: false,
        applySchemaFn: applySchema,
        readDir: (p) => readdir(p),
        readFile: (p) => readFile(p, 'utf8'),
        logger: NOOP_LOGGER,
      })
    ).rejects.toBeInstanceOf(SchemaApplyBlockedError);

    // DB unchanged.
    const stillThere = await prisma.contentType.findUnique({
      where: { identifier: 'Article' },
    });
    expect(stillThere).not.toBeNull();
  });

  it('applies the removal with allowDestructive (no entries)', async () => {
    // Seed Article (no entries).
    const dir = await tempDir({
      'schema.boject.json': ARTICLE_BUNDLE,
    });
    await applySchemaIfConfigured(prisma, {
      dirPath: dir,
      allowDestructive: false,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });

    const removalDir = await tempDir({
      'schema.boject.json': EMPTY_BUNDLE,
    });
    const result = await applySchemaIfConfigured(prisma, {
      dirPath: removalDir,
      allowDestructive: true,
      applySchemaFn: applySchema,
      readDir: (p) => readdir(p),
      readFile: (p) => readFile(p, 'utf8'),
      logger: NOOP_LOGGER,
    });

    expect(result.totalChanges).toBe(1);
    const gone = await prisma.contentType.findUnique({
      where: { identifier: 'Article' },
    });
    expect(gone).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify GREEN immediately** (5/5 pass).

```bash
pnpm db:up
pnpm --filter cms exec vitest run --project unit scripts/docker-entrypoint/apply-schema.integration.test.ts
```

These tests don't add any new production code — they're integration tests on the function the previous tasks built. Expected: 5/5 pass first run. If any fails, debug — likely cause is a fixture-shape mismatch with the Bundle / BundleField types.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/scripts/docker-entrypoint/apply-schema.integration.test.ts
git commit -m "$(cat <<'EOF'
test(entrypoint): apply-schema DB-backed integration tests

Five end-to-end tests against boject_test using the real applySchema:
1. Apply to empty DB.
2. No-op on second call with same bundle.
3. Add-field diff applies one change.
4. Removal with entries is blocked without allowDestructive.
5. Removal without entries succeeds with allowDestructive.

Each test writes a fixture bundle to a tempdir via mkdtemp; tempdirs
are cleaned up in afterAll. Lives in the unit Vitest project (no
globalSetup) following the applySchema.test.ts precedent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Wire `apply-schema.ts` into `entrypoint.sh`

Renumber the existing 5 steps to 6, and insert a new step 5 between starter import and Nuxt boot. The script invocation matches the surrounding pattern (no `if` guard — the script handles "skip when no dir" internally).

**Files:**

- Modify: `apps/cms/docker/entrypoint.sh`

- [ ] **Step 1: Apply the change**

Edit `entrypoint.sh` so it reads:

```bash
#!/usr/bin/env bash
set -euo pipefail

log() {
  echo "[entrypoint] $*"
}

: "${DATABASE_URL:?DATABASE_URL must be set}"

log "step 1/6: waiting for database"
tsx scripts/docker-entrypoint/wait-for-db.ts

log "step 2/6: applying migrations"
prisma migrate deploy --schema prisma/schema

log "step 3/6: seeding admin if needed"
if [[ -n "${BOJECT_ADMIN_EMAIL:-}" && -n "${BOJECT_ADMIN_PASSWORD:-}" ]]; then
  tsx scripts/docker-entrypoint/seed-admin.ts
else
  log "skipping admin seed — BOJECT_ADMIN_EMAIL or BOJECT_ADMIN_PASSWORD not set"
fi

log "step 4/6: importing starter if needed"
tsx scripts/docker-entrypoint/import-starter.ts

log "step 5/6: applying schema-as-code"
tsx scripts/docker-entrypoint/apply-schema.ts

log "step 6/6: starting nuxt server"
exec node .output/server/index.mjs
```

- [ ] **Step 2: Static syntax check**

```bash
bash -n apps/cms/docker/entrypoint.sh
```

Expected: silent (exit 0). The smoke test (Task 10) is the runtime verification.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/docker/entrypoint.sh
git commit -m "$(cat <<'EOF'
feat(entrypoint): wire apply-schema into the docker entrypoint

Inserts a new step 5/6 between the starter import and the Nuxt boot.
The script handles "BOJECT_SCHEMA_DIR not set" internally and exits
0, so the entrypoint runs unchanged on projects that don't opt in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Dockerfile — ensure `/app/content-types` exists

Read-only bind mounts require the target directory to exist in the image. Add a single `mkdir -p /app/content-types` to the runtime stage and chown to the `cms` user for consistency.

**Files:**

- Modify: `apps/cms/Dockerfile`

- [ ] **Step 1: Apply the change**

Find the existing `RUN ... mkdir -p /app/storage/...` block in the runtime stage. Extend it to include the content-types dir, OR add a sibling `RUN` directly after — whichever produces the cleaner diff. Recommended:

```dockerfile
# Storage dir + entrypoint perms
RUN chmod +x ./apps/cms/docker/entrypoint.sh \
 && mkdir -p /app/storage/images/originals /app/storage/images/transforms \
 && mkdir -p /app/content-types \
 && chown -R cms:cms /app/storage /app/content-types
```

The single `RUN` keeps the layer count unchanged.

- [ ] **Step 2: Static check**

```bash
docker build -f apps/cms/Dockerfile -t boject/cms:plan-task9-check . --no-cache --target runtime 2>&1 | tail -20
```

Optional — only if Docker is available locally. The smoke test in Task 10 is the canonical verification. If the build fails, fix and retry; if it succeeds, the image is good.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/Dockerfile
git commit -m "$(cat <<'EOF'
feat(entrypoint): pre-create /app/content-types in runtime image

Read-only bind mounts (./content-types:/app/content-types:ro from the
scaffolded compose) require the target dir to exist in the image.
Add the mkdir + chown to the same RUN as /app/storage so layer count
stays the same.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Smoke-test extension

Extend `apps/cms/docker/smoke-test.sh` with three new checks:

1. **First-boot apply-schema is a no-op** (the starter created the schema in step 4, so step 5 sees zero diffs).
2. **Mutate the bundle, restart, assert the change applied.**
3. **Mutate the bundle to remove a type with entries, restart, assert non-zero exit + blocker logged.**

The existing test mounts `${REPO_ROOT}/starters:/starters:ro` for `BOJECT_INITIAL_STARTER`. Add a parallel mount for `${REPO_ROOT}/<test_dir>/content-types:/app/content-types:ro` plus the env var `BOJECT_SCHEMA_DIR=/app/content-types`. Use a freshly-created temp dir under the smoke test's working area so we can mutate it between restarts.

**Files:**

- Modify: `apps/cms/docker/smoke-test.sh`

- [ ] **Step 1: Edit the smoke test**

Read the existing script first to see how it sets variables and traps cleanup. Add a `CONTENT_DIR` variable near the top:

```bash
CONTENT_DIR="$(mktemp -d -t boject-cms-smoke-content-XXXXXX)"
```

Add it to the `cleanup()` function:

```bash
rm -rf "$CONTENT_DIR" 2>/dev/null || true
```

Before starting the cms container, copy the base starter into `$CONTENT_DIR`:

```bash
cp "$REPO_ROOT/starters/base.boject.json" "$CONTENT_DIR/schema.boject.json"
```

Update the `docker run -d --name "$APP_NAME" ...` invocation to add:

```bash
  -e BOJECT_SCHEMA_DIR=/app/content-types \
  -v "$CONTENT_DIR:/app/content-types:ro" \
```

After the existing first-boot success block (the one that asserts "imported"), add:

```bash
# step 5/6 first-boot expectation: starter already created the schema,
# so apply-schema is a no-op against the just-imported state.
if ! grep -q "\\[apply-schema\\] done — 1 file applied, 0 total changes" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected first-boot apply-schema no-op"
  echo "$logs" | tail -50
  exit 1
fi
```

After the existing restart-idempotency block (the one that asserts "skipped — users already exist"), add:

```bash
# Step 5/6 second-boot expectation: still a no-op.
if ! grep -q "\\[apply-schema\\] done — 1 file applied, 0 total changes" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected second-boot apply-schema no-op"
  echo "$logs" | tail -50
  exit 1
fi

echo "[smoke-test] mutating schema bundle to add a field, restarting"
# Insert a new field into the first content type. Use jq to keep the JSON valid.
tmp_bundle="$(mktemp)"
jq '.contentTypes[0].fields += [{
      "id": null,
      "identifier": "smokeTestField",
      "name": "Smoke Test Field",
      "type": "TEXT",
      "required": false,
      "order": 99,
      "options": null
    }]' "$CONTENT_DIR/schema.boject.json" > "$tmp_bundle"
mv "$tmp_bundle" "$CONTENT_DIR/schema.boject.json"

docker restart "$APP_NAME" >/dev/null
for i in {1..60}; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4010/ 2>/dev/null || echo "000")
  if [[ "$code" == "200" || "$code" == "302" ]]; then
    break
  fi
  sleep 1
done

logs=$(docker logs --since 1m "$APP_NAME" 2>&1)
if ! grep -q "\\[apply-schema\\] schema.boject.json: 1 created, 0 updated, 0 removed" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected apply-schema to create the new field"
  echo "$logs" | tail -50
  exit 1
fi

echo "[smoke-test] mutating bundle to remove the first content type, restarting (expect blocker)"
# Drop all content types. The base starter seeds at least one entry
# (SiteSettings), so removal will be blocked.
jq '.contentTypes = []' "$CONTENT_DIR/schema.boject.json" > "$tmp_bundle"
mv "$tmp_bundle" "$CONTENT_DIR/schema.boject.json"

# Restart will exit non-zero because the apply-schema script throws and
# entrypoint.sh has `set -e`. Docker should mark the container as exited.
docker restart "$APP_NAME" >/dev/null
sleep 5

state=$(docker inspect --format '{{.State.Status}}' "$APP_NAME")
if [[ "$state" != "exited" && "$state" != "restarting" ]]; then
  echo "[smoke-test] FAIL: expected container to exit on blocker, got state=$state"
  docker logs "$APP_NAME" | tail -50
  exit 1
fi

logs=$(docker logs --since 30s "$APP_NAME" 2>&1)
if ! grep -q "\\[apply-schema\\] schema.boject.json: BLOCKED" <<<"$logs"; then
  echo "[smoke-test] FAIL: expected BLOCKED log line"
  echo "$logs" | tail -50
  exit 1
fi

echo "[smoke-test] all schema-as-code assertions passed"
```

`jq` is a runtime dep of the smoke test; CI environments running this will need it installed. If `jq` is not available in the smoke-test environment, fall back to a Node one-liner:

```bash
node -e "const f='$CONTENT_DIR/schema.boject.json';const b=require(f);b.contentTypes[0].fields.push({id:null,identifier:'smokeTestField',name:'Smoke Test Field',type:'TEXT',required:false,order:99,options:null});require('node:fs').writeFileSync(f,JSON.stringify(b));"
```

Choose one approach; document the dep in the smoke-test header comment.

- [ ] **Step 2: Static check**

```bash
bash -n apps/cms/docker/smoke-test.sh
```

Expected: silent.

- [ ] **Step 3: (Optional) Run the smoke test locally if Docker is available**

```bash
bash apps/cms/docker/smoke-test.sh
```

Expected: ends with "all schema-as-code assertions passed" + the existing closing log lines. Total runtime several minutes.

If you can't run Docker locally, skip the local run — CI will exercise it on push.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/docker/smoke-test.sh
git commit -m "$(cat <<'EOF'
test(entrypoint): smoke-test schema-as-code first-boot, edit-restart, blocker

Extends the existing smoke test with three new assertions covering
the apply-schema entrypoint script:

1. First-boot apply-schema is a no-op (the starter already created
   the same schema in step 4).
2. Mutating the bundle (add field) and restarting applies the change.
3. Mutating the bundle to remove a type that has entries fails the
   boot — container exits non-zero and the BLOCKED log line is
   present.

The smoke test now bind-mounts a temp dir as /app/content-types so
the bundle can be mutated between restarts. jq (or a node fallback)
is used to edit the JSON in place.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Scaffolder — `contentTypes.ts` template

A pure renderer that returns the bytes for `<project>/content-types/schema.boject.json`. For the `none` starter choice, the bytes are an empty bundle stub. For starters, the renderer returns the `'copy'` marker — `writeProject.ts` (Task 12) interprets that as "copy from `startersSourceDir`."

Why a marker rather than the renderer reading the file: keeps `contentTypes.ts` pure (testable without filesystem fixtures). The "copy from disk" branch lives where the rest of the file I/O lives.

**Files:**

- Create: `packages/create-boject-cms/src/templates/contentTypes.ts`
- Create: `packages/create-boject-cms/src/templates/contentTypes.test.ts`
- Modify: `packages/create-boject-cms/src/render.ts`

- [ ] **Step 1: Write the failing test**

`packages/create-boject-cms/src/templates/contentTypes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderContentTypesBundle } from './contentTypes.js';

describe('renderContentTypesBundle', () => {
  it('returns the empty bundle stub for the "none" starter', () => {
    const out = renderContentTypesBundle({ starter: 'none' });
    expect(out.kind).toBe('content');
    if (out.kind !== 'content') throw new Error('unreachable');
    const parsed = JSON.parse(out.content);
    expect(parsed.version).toBe(2);
    expect(parsed.portable).toBe(true);
    expect(parsed.contentTypes).toEqual([]);
    expect(typeof parsed.exportedAt).toBe('string');
    expect(parsed.exportedAt).toMatch(/T.*Z$/);
  });

  it('returns a copy directive for non-none starters', () => {
    for (const starter of ['base', 'sport', 'rugby'] as const) {
      const out = renderContentTypesBundle({ starter });
      expect(out).toEqual({
        kind: 'copy',
        sourceFilename: `${starter}.boject.json`,
      });
    }
  });
});
```

- [ ] **Step 2: Run, verify it FAILS**

```bash
pnpm --filter create-boject-cms exec vitest run src/templates/contentTypes.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the renderer**

`packages/create-boject-cms/src/templates/contentTypes.ts`:

```ts
import type { StarterChoice } from './envFile.js';

export interface ContentTypesBundleParams {
  starter: StarterChoice;
}

export type ContentTypesBundleResult =
  | { kind: 'content'; content: string }
  | { kind: 'copy'; sourceFilename: string };

export function renderContentTypesBundle({
  starter,
}: ContentTypesBundleParams): ContentTypesBundleResult {
  if (starter === 'none') {
    const stub = {
      version: 2,
      exportedAt: new Date().toISOString(),
      portable: true,
      contentTypes: [],
    };
    return { kind: 'content', content: JSON.stringify(stub, null, 2) + '\n' };
  }
  return { kind: 'copy', sourceFilename: `${starter}.boject.json` };
}
```

The trailing newline matches the formatter convention in `starters/`. The `JSON.stringify(..., null, 2)` keeps the file diff-friendly even though it's machine-generated.

- [ ] **Step 4: Add the re-export**

In `packages/create-boject-cms/src/render.ts`, add:

```ts
export { renderContentTypesBundle } from './templates/contentTypes.js';
export type { ContentTypesBundleResult } from './templates/contentTypes.js';
```

- [ ] **Step 5: Run, verify GREEN** (2/2 pass).

- [ ] **Step 6: Commit**

```bash
git add packages/create-boject-cms/src/templates/contentTypes.ts packages/create-boject-cms/src/templates/contentTypes.test.ts packages/create-boject-cms/src/render.ts
git commit -m "$(cat <<'EOF'
feat(scaffolder): renderContentTypesBundle template

Pure renderer for the project's content-types/schema.boject.json file:
- For starter "none", returns an empty bundle stub as inline content.
- For base/sport/rugby starters, returns a "copy" directive so
  writeProject can copy the canonical starter file byte-for-byte.

Keeps the renderer side-effect-free; the actual file I/O lives in
writeProject.ts where the rest of the scaffolder's filesystem work is.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Scaffolder — wire content-types into `writeProject.ts`

Always create `<project>/content-types/`. For `none`, write the inline empty-bundle stub. For starters, copy the canonical bundle from `startersSourceDir`. Update `writeProject.test.ts` to assert both branches.

**Files:**

- Modify: `packages/create-boject-cms/src/writeProject.ts`
- Modify: `packages/create-boject-cms/tests/unit/writeProject.test.ts`

- [ ] **Step 1: Add the failing tests**

Read `packages/create-boject-cms/tests/unit/writeProject.test.ts` first to see the existing test structure (it likely uses `mkdtemp` for the target dir + a fixture for `startersSourceDir`).

Append two new tests inside the existing top-level `describe(...)` block:

```ts
it('writes content-types/schema.boject.json copying the chosen starter', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'cbc-write-'));
  await writeProject({
    targetDir,
    starter: 'base',
    imageTag: 'boject/cms:dev',
    force: false,
    startersSourceDir: SAMPLE_STARTERS_DIR,
  });
  const written = await readFile(
    join(targetDir, 'content-types', 'schema.boject.json'),
    'utf8'
  );
  const expected = await readFile(
    join(SAMPLE_STARTERS_DIR, 'base.boject.json'),
    'utf8'
  );
  expect(written).toBe(expected);
});

it('writes the empty-bundle stub for the "none" starter', async () => {
  const targetDir = await mkdtemp(join(tmpdir(), 'cbc-write-'));
  await writeProject({
    targetDir,
    starter: 'none',
    imageTag: 'boject/cms:dev',
    force: false,
    startersSourceDir: SAMPLE_STARTERS_DIR,
  });
  const written = await readFile(
    join(targetDir, 'content-types', 'schema.boject.json'),
    'utf8'
  );
  const parsed = JSON.parse(written);
  expect(parsed.version).toBe(2);
  expect(parsed.contentTypes).toEqual([]);
});
```

If the existing test file doesn't have a `SAMPLE_STARTERS_DIR` constant, look for a fixtures path in `tests/unit/fixtures/` or adapt to whatever the existing tests use. The base starter file lives at `starters/base.boject.json` at the repo root — the existing tests should have a way to point `startersSourceDir` at it.

- [ ] **Step 2: Run, verify they FAIL**

```bash
pnpm --filter create-boject-cms exec vitest run tests/unit/writeProject.test.ts
```

Expected: both new tests fail because the production code doesn't yet write the content-types dir.

- [ ] **Step 3: Wire into `writeProject.ts`**

Modify `packages/create-boject-cms/src/writeProject.ts`:

```ts
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  GITIGNORE,
  renderContentTypesBundle,
  renderDockerCompose,
  renderEnvFile,
  renderPackageJson,
  renderReadme,
  type StarterChoice,
} from './render.js';
// ... rest of imports unchanged
```

Inside the `writeProject` function, after the existing starter-copy block (or at the end of the function — pick a sensible place that keeps related I/O together):

```ts
// Always create content-types/ for BOJECT_SCHEMA_DIR (Spec 4).
const contentTypesTarget = join(targetDir, 'content-types');
await mkdir(contentTypesTarget, { recursive: true });
const bundleResult = renderContentTypesBundle({ starter });
if (bundleResult.kind === 'content') {
  await writeFile(
    join(contentTypesTarget, 'schema.boject.json'),
    bundleResult.content
  );
} else {
  await copyFile(
    join(startersSourceDir, bundleResult.sourceFilename),
    join(contentTypesTarget, 'schema.boject.json')
  );
}
```

- [ ] **Step 4: Run, verify GREEN** (existing tests + 2 new all pass).

- [ ] **Step 5: Commit**

```bash
git add packages/create-boject-cms/src/writeProject.ts packages/create-boject-cms/tests/unit/writeProject.test.ts
git commit -m "$(cat <<'EOF'
feat(scaffolder): always write content-types/schema.boject.json

For the "none" starter choice, write an empty bundle stub. For base/
sport/rugby, copy the canonical starter file byte-for-byte. The dir
is always created so the docker-compose bind mount has a valid host
target on first boot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Scaffolder — `dockerCompose.ts` adds the bind mount

Always add `./content-types:/app/content-types:ro` to the `cms` service `volumes`, regardless of starter choice (Task 12 always creates the dir, so the mount always has a target).

**Files:**

- Modify: `packages/create-boject-cms/src/templates/dockerCompose.ts`
- Modify: `packages/create-boject-cms/tests/unit/dockerCompose.test.ts`

- [ ] **Step 1: Add the failing tests**

Read `packages/create-boject-cms/tests/unit/dockerCompose.test.ts` first to see the existing test structure. Append:

```ts
it('always includes the content-types bind mount', () => {
  for (const starter of ['base', 'sport', 'rugby', 'none'] as const) {
    const out = renderDockerCompose({
      imageTag: 'boject/cms:dev',
      starter,
    });
    expect(out).toContain('./content-types:/app/content-types:ro');
  }
});
```

- [ ] **Step 2: Run, verify it FAILS**

```bash
pnpm --filter create-boject-cms exec vitest run tests/unit/dockerCompose.test.ts
```

- [ ] **Step 3: Update the template**

In `packages/create-boject-cms/src/templates/dockerCompose.ts`, add the new mount line to the `cms` service `volumes` block. The starter mount is conditional; the new mount is unconditional.

```ts
return `services:
  cms:
    image: ${imageTag}
    restart: unless-stopped
    ports:
      - '4000:3000'
    env_file:
      - .env
    depends_on:
      - db
    volumes:
      - storage:/app/storage
      - ./content-types:/app/content-types:ro
${starterMount}  db:
    image: postgres:17
    ...
```

The new line goes between the storage volume and the conditional starter mount so the file structure stays predictable. Don't disturb the existing `${starterMount}` template var.

- [ ] **Step 4: Run, verify GREEN** (existing tests + 1 new pass).

- [ ] **Step 5: Commit**

```bash
git add packages/create-boject-cms/src/templates/dockerCompose.ts packages/create-boject-cms/tests/unit/dockerCompose.test.ts
git commit -m "$(cat <<'EOF'
feat(scaffolder): mount content-types/ read-only in scaffolded compose

The schema-as-code dir is always present (writeProject always creates
it — empty bundle for "none", copy-of-starter otherwise), so the bind
mount is unconditional. Read-only because exports go through the API,
not the filesystem.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Scaffolder — `envFile.ts` adds `BOJECT_SCHEMA_DIR` and the commented destructive flag

Always emit `BOJECT_SCHEMA_DIR=/app/content-types`. Add a commented `# BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true` line with a one-line explanatory comment so operators discover the flag when they read `.env`.

**Files:**

- Modify: `packages/create-boject-cms/src/templates/envFile.ts`
- Modify: `packages/create-boject-cms/tests/unit/envFile.test.ts`

- [ ] **Step 1: Add the failing tests**

Read the existing `envFile.test.ts` first. Append:

```ts
it('always includes BOJECT_SCHEMA_DIR=/app/content-types', () => {
  for (const starter of ['base', 'sport', 'rugby', 'none'] as const) {
    const out = renderEnvFile({
      sessionPassword: 'pw1',
      adminPassword: 'pw2',
      starter,
    });
    expect(out).toContain('BOJECT_SCHEMA_DIR=/app/content-types');
  }
});

it('includes the commented BOJECT_ALLOW_DESTRUCTIVE_SCHEMA line with a comment', () => {
  const out = renderEnvFile({
    sessionPassword: 'pw1',
    adminPassword: 'pw2',
    starter: 'base',
  });
  expect(out).toContain('# BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true');
  // The comment block above the line should explain when to enable it.
  expect(out).toMatch(/destructive|removal/i);
});
```

- [ ] **Step 2: Run, verify they FAIL**

- [ ] **Step 3: Update the template**

In `packages/create-boject-cms/src/templates/envFile.ts`:

```ts
export function renderEnvFile({
  sessionPassword,
  adminPassword,
  starter,
}: EnvFileParams): string {
  const lines = [
    'DATABASE_URL=postgresql://boject:boject@db:5432/boject',
    `NUXT_SESSION_PASSWORD=${sessionPassword}`,
    'BOJECT_ADMIN_EMAIL=admin@local',
    `BOJECT_ADMIN_PASSWORD=${adminPassword}`,
    'STORAGE_DRIVER=local',
    'BOJECT_SCHEMA_DIR=/app/content-types',
  ];
  if (starter !== 'none') {
    lines.push(`BOJECT_INITIAL_STARTER=/starters/${starter}.boject.json`);
  }
  lines.push(
    '',
    '# Set to "true" on production / staging to disable schema editing in the UI.',
    '# Schema changes should flow from git on locked environments.',
    '# BOJECT_SCHEMA_READONLY=true',
    '',
    '# Allow destructive schema changes (removing content types or fields)',
    '# during the every-boot apply. Default off — only additive changes apply',
    '# automatically. Flip this on for environments where bundle removals are',
    '# expected to take effect.',
    '# BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true'
  );
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Run, verify GREEN** (existing + 2 new pass).

- [ ] **Step 5: Commit**

```bash
git add packages/create-boject-cms/src/templates/envFile.ts packages/create-boject-cms/tests/unit/envFile.test.ts
git commit -m "$(cat <<'EOF'
feat(scaffolder): add BOJECT_SCHEMA_DIR to scaffolded .env

Always sets BOJECT_SCHEMA_DIR=/app/content-types so the entrypoint's
apply-schema script picks up the bundle dir. Adds a commented
BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true line with a comment block
explaining when to enable it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Scaffolder — `readme.ts` "Content types" section

Add a brief "Content types" section explaining the schema-as-code workflow: edit in the CMS UI, export via the CLI (Spec 5 — forward reference), commit `content-types/schema.boject.json`. For now (pre-Spec-5), the user can hand-edit the file and restart.

**Files:**

- Modify: `packages/create-boject-cms/src/templates/readme.ts`
- Modify: `packages/create-boject-cms/tests/unit/readme.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `readme.test.ts`:

```ts
it('includes a Content types section explaining schema-as-code', () => {
  const out = renderReadme({ starter: 'base', adminEmail: 'admin@local' });
  expect(out).toContain('## Content types');
  expect(out).toContain('content-types/schema.boject.json');
});
```

- [ ] **Step 2: Run, verify it FAILS**

- [ ] **Step 3: Update the template**

In `packages/create-boject-cms/src/templates/readme.ts`, add a new section before the "Stop the CMS" section:

```ts
return `# boject-cms

A new boject-cms project scaffolded by \`create-boject-cms\`.

## Start the CMS

\`\`\`bash
docker compose up -d
\`\`\`

${starterLine}Once the container is healthy, log in at http://localhost:4000/login with:

- Email: \`${adminEmail}\`
- Password: see \`BOJECT_ADMIN_PASSWORD\` in \`.env\`

## Content types

Your content type schema lives in \`content-types/schema.boject.json\` and is
applied to the database on every container boot. Edit it via the CMS UI in
development; commit the file alongside your code so production deploys converge
to the same schema. Destructive changes (removing types or fields) are blocked
by default — set \`BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true\` in \`.env\` to allow them.

## Stop the CMS

\`\`\`bash
docker compose down
\`\`\`

## Upgrade the CMS image

\`\`\`bash
pnpm upgrade
\`\`\`

This runs \`npx @boject/cli@latest upgrade\` to rewrite the pinned image tag in \`docker-compose.yml\` and restart the container.
`;
```

- [ ] **Step 4: Run, verify GREEN** (existing + 1 new pass).

- [ ] **Step 5: Commit**

```bash
git add packages/create-boject-cms/src/templates/readme.ts packages/create-boject-cms/tests/unit/readme.test.ts
git commit -m "$(cat <<'EOF'
feat(scaffolder): scaffolded README documents schema-as-code workflow

New "Content types" section explaining that content-types/schema.boject.json
is applied on every boot and should be committed alongside code. Notes the
default-off destructive flag so users discover it without grepping the env file.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Cross-references — `import-starter.ts` comment + `starters/README.md` note

Two small doc-only changes that orient future readers:

1. `apps/cms/scripts/docker-entrypoint/import-starter.ts` — add a header comment block referencing `apply-schema.ts` and clarifying the lifecycle distinction (first-boot seed vs. every-boot apply). Recently-added Spec 4 readers will be confused by the two scripts otherwise.
2. `starters/README.md` — note that starter bundles are also valid `BOJECT_SCHEMA_DIR` content (same JSON shape) and that `create-boject-cms` copies the chosen starter into `<project>/content-types/schema.boject.json` automatically.

**Files:**

- Modify: `apps/cms/scripts/docker-entrypoint/import-starter.ts`
- Modify: `starters/README.md`

- [ ] **Step 1: Edit `import-starter.ts`**

At the top of the file, replace any leading blank line with:

```ts
// apps/cms/scripts/docker-entrypoint/import-starter.ts
//
// FIRST-BOOT seed. Imports BOJECT_INITIAL_STARTER (a single bundle file
// path) into an empty CMS — both schema and entries (e.g. SiteSettings).
// Gated by "ContentType table is empty"; on every subsequent boot this
// script is a no-op and apply-schema.ts (every-boot, schema-only,
// idempotent) takes over. See `apply-schema.ts` for the long-lived
// schema-as-code lifecycle.

import type { PrismaClient } from '../../generated/prisma/client';
// ... rest unchanged
```

No code change.

- [ ] **Step 2: Edit `starters/README.md`**

Read the existing `starters/README.md` first to see the structure. Add a section at an appropriate place (probably under an existing "Usage" section or near the bottom):

```markdown
## Use as schema-as-code source

The same JSON files in this directory are valid `BOJECT_SCHEMA_DIR` content
(see [the entrypoint design](../docs/superpowers/specs/2026-05-01-schema-as-code-entrypoint-design.md)).
When you scaffold a project with `create-boject-cms`, the chosen starter is
copied byte-for-byte into `<project>/content-types/schema.boject.json` and
becomes the source of truth for the project's schema going forward.
```

(If `starters/README.md` already documents this in some form, expand the existing section rather than duplicating.)

- [ ] **Step 3: Run typecheck + lint to make sure nothing regressed**

```bash
pnpm typecheck
pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add apps/cms/scripts/docker-entrypoint/import-starter.ts starters/README.md
git commit -m "$(cat <<'EOF'
docs(entrypoint): cross-reference apply-schema and import-starter lifecycles

- import-starter.ts gets a header comment clarifying it's the
  first-boot seed and pointing readers at apply-schema.ts for the
  every-boot schema convergence story.
- starters/README.md notes that starter bundles double as valid
  BOJECT_SCHEMA_DIR content and that the scaffolder copies the chosen
  starter into the project's content-types/ directory.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: CLAUDE.md + final verification + PR

Document the new env var, the updated entrypoint flow, the new key files, and the architecture bullet. Run the full verification pipeline. Push and open the PR.

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md — runtime env vars line**

Find the existing `**Runtime env vars:**` paragraph (under the **Docker image** section). After the existing `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA` mention (added in Spec 3's PR #154), insert:

```
`BOJECT_SCHEMA_DIR` (optional, host path mounted into the container at `/app/content-types`; the entrypoint runs `applySchema` against every `*.boject.json` file in this directory in alphabetical order on every boot — idempotent, fail-fast on blockers; defaults to unset which skips the step entirely),
```

- [ ] **Step 2: Update CLAUDE.md — Entrypoint bullet**

Find the existing `**Entrypoint:**` bullet under Docker image. Update to reflect the 6-step boot:

```
- **Entrypoint:** `apps/cms/docker/entrypoint.sh`. Six steps: (1) waits for `DATABASE_URL`, (2) runs `prisma migrate deploy`, (3) seeds admin from `BOJECT_ADMIN_EMAIL` + `BOJECT_ADMIN_PASSWORD` if `User` table is empty, (4) imports `BOJECT_INITIAL_STARTER` bundle if `ContentType` table is empty (first-boot seed — schema + entries), (5) applies every `*.boject.json` file in `BOJECT_SCHEMA_DIR` via `applySchema` (every-boot, schema-only, idempotent — see `apply-schema.ts`), (6) execs Nuxt. Steps 3, 4, and 5 are independently gated and idempotent on re-run.
```

- [ ] **Step 3: Update CLAUDE.md — Architecture bullet**

After the existing `**Schema-as-code applier**` bullet (added in Spec 3's PR #154), add:

```markdown
- **Schema-as-code apply at boot** — `apps/cms/scripts/docker-entrypoint/apply-schema.ts::applySchemaIfConfigured(prisma, opts)` is the entrypoint script that walks `BOJECT_SCHEMA_DIR` (alphabetical order) and runs `applySchema` against every `*.boject.json` file, aggregating per-file changes into a grand-total summary log. Forwards `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA` into each apply call. Fail-fast: any `SchemaApplyBlockedError` (or any other error) logs the blockers / message and exits non-zero, halting the entrypoint via `set -e` and crashing the container so deploy pipelines can roll back. Skip cases (no env var / no bundles in dir) log and return `{ applied: false }` so projects without schema-as-code adoption boot unchanged. The scaffolder (`create-boject-cms`) writes `<project>/content-types/schema.boject.json` populated from the chosen starter, mounts it `:ro` into the container, and sets `BOJECT_SCHEMA_DIR=/app/content-types` in `.env` so a fresh project gets schema-as-code without manual setup.
```

- [ ] **Step 4: Update CLAUDE.md — Key Files**

In the "Key Files" section, after the existing `apps/cms/scripts/docker-entrypoint/` entries (or near them — find where `import-starter.ts` is referenced and group nearby), add:

```
- `apps/cms/scripts/docker-entrypoint/apply-schema.ts` — every-boot schema-as-code applier (calls `applySchema` on each bundle in `BOJECT_SCHEMA_DIR`)
- `apps/cms/scripts/docker-entrypoint/apply-schema.test.ts` — pure unit tests with fake applier + injected fs readers
- `apps/cms/scripts/docker-entrypoint/apply-schema.integration.test.ts` — DB-backed integration tests against `boject_test`
- `packages/create-boject-cms/src/templates/contentTypes.ts` — scaffolder template that emits the project's initial `content-types/schema.boject.json` (empty stub for "none", copy directive for starters)
```

If the existing CLAUDE.md doesn't already list `import-starter.ts` etc., slot the new entries in alphabetical order under whatever section makes sense (likely near the existing `apps/cms/scripts/...` references).

- [ ] **Step 5: Format CLAUDE.md**

```bash
pnpm exec prettier --write CLAUDE.md
```

- [ ] **Step 6: Full unit suite**

```bash
pnpm test:unit
```

Expected: all green (existing + the new `apply-schema.test.ts`, `apply-schema.integration.test.ts`, `contentTypes.test.ts`, plus the additions to `writeProject.test.ts`, `dockerCompose.test.ts`, `envFile.test.ts`, `readme.test.ts`).

- [ ] **Step 7: Full integration suite**

```bash
pnpm test:integration
```

Expected: all green. The applier-from-script doesn't add to the integration project, but the existing suite must still pass.

- [ ] **Step 8: Typecheck**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 9: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 10: Format check on changed files**

```bash
git diff --name-only main..HEAD | xargs pnpm exec prettier --check
```

Expected: clean.

- [ ] **Step 11: Commit the docs**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude): document schema-as-code entrypoint integration

- BOJECT_SCHEMA_DIR added to the runtime env vars line.
- Entrypoint bullet updated to reflect the 6-step boot sequence.
- New "Schema-as-code apply at boot" architecture bullet covering
  the apply-schema.ts script + scaffolder integration.
- New Key Files entries for apply-schema.ts, its test files, and
  the new scaffolder content-types template.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 12: Push**

```bash
git push -u origin feat/145-schema-as-code-entrypoint
```

- [ ] **Step 13: Open PR**

```bash
gh pr create --title "feat: schema-as-code entrypoint + scaffolder integration" --body "$(cat <<'EOF'
## Summary

Implements Spec 4 of the schema-as-code stack — wires the Spec 3 `applySchema()` into the container entrypoint, and updates the `create-boject-cms` scaffolder so a fresh project's content types live in git from day one.

After this lands, the deploy story is: edit `content-types/schema.boject.json`, commit, redeploy. The container converges the schema on every boot; destructive changes are blocked unless `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true` is set.

This unblocks Spec 5 (CLI HTTP surface — `boject schema apply` / `export` / `check`).

## What lands

**Entrypoint script** (`apps/cms/scripts/docker-entrypoint/apply-schema.ts`):
- Pure `applySchemaIfConfigured(prisma, opts)` with injected `applySchemaFn` + `readDir` / `readFile` for unit testability.
- CLI entry block wires real `PrismaClient` + `applySchema` from env, exits 1 on any error.
- Walks `BOJECT_SCHEMA_DIR` in alphabetical order, applies each `*.boject.json` file, aggregates per-file `applied` counters into a grand-total summary log.
- Forwards `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA` into each apply call.
- Fail-fast on blockers: logs each blocker's code/path/message before rethrowing.

**Shell entrypoint** (`apps/cms/docker/entrypoint.sh`):
- Renumbered from 5 to 6 steps; new step 5 runs `apply-schema.ts` between starter import and Nuxt boot.

**Dockerfile**:
- `mkdir -p /app/content-types` in the runtime stage so `:ro` bind mounts work on first boot.

**Smoke test** (`apps/cms/docker/smoke-test.sh`):
- First-boot apply-schema is a no-op (starter already created the schema).
- Mutating the bundle and restarting applies the change.
- Mutating the bundle to remove a type with entries fails the boot with a BLOCKED log line.

**Scaffolder** (`packages/create-boject-cms`):
- `contentTypes.ts` template (empty stub for "none"; copy directive for starters).
- `writeProject.ts` always writes `content-types/schema.boject.json`.
- `dockerCompose.ts` always adds the `./content-types:/app/content-types:ro` bind mount.
- `envFile.ts` always emits `BOJECT_SCHEMA_DIR=/app/content-types` plus a commented `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA` line with explanatory comment.
- `readme.ts` adds a "Content types" section explaining the workflow.

**Cross-reference docs**:
- `import-starter.ts` header comment clarifies the first-boot vs. every-boot lifecycle distinction.
- `starters/README.md` notes that starter bundles double as `BOJECT_SCHEMA_DIR` content.

## Coverage

- Unit tests for `applySchemaIfConfigured`: skip cases (no dir / no bundles / empty dir), alphabetical order, per-file result aggregation, `allowDestructive` forwarding, structured logging (per-file + grand-total + skip lines), fail-fast on errors with blocker detail logging.
- DB-backed integration tests: apply to empty DB, no-op, add-field diff, blocked removal, allowed removal.
- Smoke test extensions for the three Docker-level scenarios above.
- Scaffolder unit tests: contentTypes renderer (both branches), writeProject's content-types directory write (both branches), compose mount, env var, README section.

## Test plan

- [x] Unit tests for the pure `applySchemaIfConfigured` function.
- [x] DB-backed integration tests for the script + real applier + real fs.
- [x] Smoke test extensions for the Docker-level boot scenarios.
- [x] Scaffolder template + writeProject tests.
- [x] Full unit + integration suites green.
- [x] Typecheck, lint, prettier all clean.

## Follow-ups (for Spec 5 CLI)

- The CLI surface (`boject schema apply` / `export` / `check`) consumes the same applier through HTTP; this PR does not change the API surface.
- A `boject schema check` CI step that compares the committed file against the running CMS lives in Spec 5.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Self-Review

**Spec coverage check:**

- ✅ New script `apps/cms/scripts/docker-entrypoint/apply-schema.ts` with both pure function and CLI entry → Tasks 1-6.
- ✅ Reads `BOJECT_SCHEMA_DIR` and skips when unset → Task 1 + Task 6.
- ✅ Reads `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA` and defaults to false → Task 6.
- ✅ Lists `*.boject.json` files sorted alphabetically → Task 2.
- ✅ Calls `applySchema(prisma, bundle, { allowDestructive })` per file → Tasks 2, 3.
- ✅ Logs `applied` counters → Task 4.
- ✅ Exits 1 on any apply error → Task 5 + Task 6.
- ✅ Logs grand-total summary → Task 4.
- ✅ Renumber `entrypoint.sh` and insert step 5 → Task 8.
- ✅ Dockerfile creates `/app/content-types` → Task 9.
- ✅ Smoke-test extension (second-boot no-op, edit-restart applies, blocker fails boot) → Task 10.
- ✅ Scaffolder writes `content-types/schema.boject.json` (empty for `none`, copy of starter otherwise) → Tasks 11, 12.
- ✅ Scaffolder adds `./content-types:/app/content-types:ro` to compose → Task 13.
- ✅ Scaffolder adds `BOJECT_SCHEMA_DIR=/app/content-types` to `.env` → Task 14.
- ✅ Scaffolder adds commented `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true` → Task 14.
- ✅ Scaffolder updates README → Task 15.
- ✅ `import-starter.ts` cross-reference comment → Task 16.
- ✅ `starters/README.md` schema-as-code note → Task 16.
- ✅ CLAUDE.md updates → Task 17.
- ✅ Integration tests (the 5 from spec) → Task 7.
- ✅ Unit tests covering the spec's `describe('applySchemaIfConfigured')` list → Tasks 1-5 (each `it(...)` from the spec list maps to a test in those tasks).

**Out-of-scope (spec-confirmed):**

- Hot-reload of schema during a single container lifetime — explicit out.
- CI drift detection between dev CMS and committed file — Spec 5.
- Runtime "apply from inside the running container" — Spec 5.
- Migration path for existing scaffolded projects to gain the schema dir — documented manual step in spec, not in this plan.

**Placeholder scan:**

- Each code block is real code with imports/exports/types matching upstream files.
- Each bash command has expected output where relevant.
- No "similar to Task N" — every task has full context.
- One forward reference to Spec 5 in the README template — labeled clearly.

**Type/symbol consistency:**

- `applySchemaIfConfigured`, `ApplySchemaIfConfiguredInput`, `ApplySchemaIfConfiguredResult`, `ApplySchemaFn`, `ApplySchemaLogger`, `sumApplied`, `renderContentTypesBundle`, `ContentTypesBundleResult` — referenced consistently across tasks.
- `BOJECT_SCHEMA_DIR`, `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA`, `/app/content-types` paths consistent.
- Reuses Spec 3's exports verbatim: `applySchema`, `ApplySchemaOptions`, `ApplySchemaResult`, `SchemaApplyBlockedError`. No invented re-exports.
- `StarterChoice` reused from `envFile.ts` (existing).

**Risk notes:**

- **Smoke test `jq` dep.** Task 10 uses `jq` to mutate the bundle JSON between restarts. If the smoke-test environment doesn't have `jq`, the documented fallback is a `node -e` one-liner. Implementer should pick one, document the dep in the smoke test header, and stick with it.
- **The `applySchemaFn` injection pattern in Task 1.** The spec shows the function with positional `(prisma, opts)` shape; the plan threads `applySchemaFn` through `opts` to keep the production CLI entry clean. If the implementer prefers a different injection shape (e.g. a top-level module-scope `let _applySchema = applySchema; export const __setApplySchemaForTests = ...`), reject it — the dependency-injection-via-options pattern matches `import-starter.ts` and is the precedent.
- **Per-file log line counts in Task 4.** The plan collapses `contentTypesCreated + fieldsCreated` into one "created" count. If the spec or operator preference wants per-axis breakdown (e.g. "1 type created, 2 fields created, 0 removed"), the format change is a one-line edit in Task 4's logging code — but the spec's example shows the collapsed form, so go with that unless feedback says otherwise.
- **Removing-type-with-entries blocker (smoke Task 10).** The base starter seeds at least one entry (SiteSettings), so removing all content types triggers the entries blocker. If the base starter's seed entries change in a future PR and the test starts passing through (because no entries exist), update the smoke test accordingly.

---

## Plan Done — Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-05-01-schema-as-code-entrypoint.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Fresh subagent per task, two-stage review between tasks. Same pattern that landed PRs #150, #151, #152, #153, #154.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
