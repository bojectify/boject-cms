# Schema Read-Only Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `BOJECT_SCHEMA_READONLY` — an env-var flag that disables all human-driven content-type and field mutations on a deployed CMS. Returns 403 with `{ error: 'SCHEMA_READONLY' }` from the seven schema-mutation endpoints, hides the corresponding CMS UI affordances, and adds a commented opt-in line to scaffolded `.env` files. Content-entry endpoints are deliberately unaffected.

**Architecture:** Single `assertSchemaEditable(event)` helper, modelled on the existing `enforceMutationRateLimit`, called as the first line of each mutating handler. The flag is plumbed through Nuxt's `runtimeConfig` (server) and `runtimeConfig.public` (client) so the UI can hide schema-edit affordances. Server-side enforcement is the security boundary; client hides are UX. Tests use a separate integration test file because Nuxt's `runtimeConfig` is read once at server boot — the only way to test "flag on" is to spin up a second server with the env var set.

**Tech Stack:** Nuxt 4 + Nitro (server), Vue 3 (client), Vitest with `@nuxt/test-utils/e2e` (integration), Prisma 7 (test seeding via the existing `prisma` singleton).

**Originating spec:** [`docs/superpowers/specs/2026-05-01-schema-readonly-flag-design.md`](../specs/2026-05-01-schema-readonly-flag-design.md)
**GitHub issue:** [#143](https://github.com/ness-EE/boject-cms/issues/143)
**Branch:** `schema/readonly-flag` (already checked out)

---

## File Structure

The plan creates 4 new files and modifies 14. Boundaries:

| File                                                                         | Responsibility                                                                                                                                                        |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cms/server/utils/schemaReadOnly.ts` (new)                              | The single security helper. Reads runtime config, throws 403 with `SCHEMA_READONLY` error code.                                                                       |
| `apps/cms/server/utils/schemaReadOnly.test.ts` (new)                         | Unit test for the env-var coercion edge cases (the helper itself is exercised by integration tests).                                                                  |
| `apps/cms/nuxt.config.ts` (modify)                                           | Adds `runtimeConfig.schemaReadonly` (server) + `runtimeConfig.public.schemaReadonly` (client).                                                                        |
| `apps/cms/server/api/content-types/index.post.ts` (modify)                   | Add `assertSchemaEditable(event)` as first handler line.                                                                                                              |
| `apps/cms/server/api/content-types/[id].put.ts` (modify)                     | Same.                                                                                                                                                                 |
| `apps/cms/server/api/content-types/[id].delete.ts` (modify)                  | Same.                                                                                                                                                                 |
| `apps/cms/server/api/content-types/[id]/fields/index.post.ts` (modify)       | Same.                                                                                                                                                                 |
| `apps/cms/server/api/content-types/[id]/fields/[fieldId].put.ts` (modify)    | Same.                                                                                                                                                                 |
| `apps/cms/server/api/content-types/[id]/fields/[fieldId].delete.ts` (modify) | Same.                                                                                                                                                                 |
| `apps/cms/server/api/content-types/[id]/fields/reorder.put.ts` (modify)      | Same.                                                                                                                                                                 |
| `apps/cms/server/api/content-types/content-types-readonly.test.ts` (new)     | Separate integration test file, boots the server with the flag on, asserts each gated endpoint returns 403, plus negative cases (reads, content-entries, CSRF order). |
| `apps/cms/composables/useSchemaReadonly.ts` (new)                            | Tiny Vue composable: `() => computed(() => useRuntimeConfig().public.schemaReadonly === true)`. Auto-imported.                                                        |
| `apps/cms/pages/content-types/index.vue` (modify)                            | Hide "New Content Type" CTA, render banner.                                                                                                                           |
| `apps/cms/pages/content-types/[id]/index.vue` (modify)                       | Hide field-management section + danger zone, render banner.                                                                                                           |
| `apps/cms/pages/content-types/new.vue` (modify)                              | Defensive redirect to `/content-types` when readonly.                                                                                                                 |
| `packages/create-boject-cms/src/templates/envFile.ts` (modify)               | Append commented `# BOJECT_SCHEMA_READONLY=true` line.                                                                                                                |
| `packages/create-boject-cms/tests/unit/envFile.test.ts` (modify)             | Assert the commented line is present.                                                                                                                                 |
| `CLAUDE.md` (modify)                                                         | Add `BOJECT_SCHEMA_READONLY` to the Runtime env vars list and to the Architecture authentication paragraph.                                                           |

---

## Cross-Cutting Notes

**The `useRuntimeConfig` and `createError` composables are auto-imported by Nuxt** in server routes and Vue components. You won't see them in the import block of existing handlers (e.g. `content-types/[id].put.ts`); the engineer should mirror that style — no explicit import in handler files. The new helper file `schemaReadOnly.ts` lives in `server/utils/` which is also part of Nitro's auto-import surface but explicit imports of `createError` from `h3` are present in sibling utilities (`rateLimitEndpoint.ts`) — match that style for consistency in `server/utils/`.

**lefthook runs prettier + lint + typecheck on commit.** The hooks rewrite formatting in place via `prettier --write` (so a commit may auto-fix and require re-staging). If a hook _fails_ (lint or typecheck), the commit aborts. Fix the underlying issue, re-stage, retry. Do NOT pass `--no-verify`.

**Vitest projects.** The `cms` package defines three Vitest projects: `integration` (tests under `server/api/`, `server/middleware/` — needs DB + Nuxt dev server), `unit` (utils, scripts), `storybook`. To run a single integration file:

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts
```

To run a single test by name:

```bash
pnpm --filter cms exec vitest run --project integration -t "returns 403 on POST"
```

Full integration suite (used in most "verify" steps): `pnpm test:integration`.

**Commit messages.** Conventional commits, matching recent history (`feat:`, `chore:`, `docs:`, `test:`). Each commit ends with the trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Wire `BOJECT_SCHEMA_READONLY` into Nuxt runtime config

Pure plumbing — no behaviour change yet. Adds the flag to both `runtimeConfig.schemaReadonly` (server, used by the helper) and `runtimeConfig.public.schemaReadonly` (client, used by the composable). Boolean coercion: `"true"` and `"1"` → `true`; everything else (including unset, `"false"`, `"0"`, garbage) → `false`.

**Files:**

- Modify: `apps/cms/nuxt.config.ts` (extend the `runtimeConfig` block)

- [ ] **Step 1: Edit `apps/cms/nuxt.config.ts`**

In the existing `runtimeConfig` block (currently around lines 89-112), add the new fields. The full updated block:

```ts
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL ?? '',
    schemaReadonly:
      process.env.BOJECT_SCHEMA_READONLY === 'true' ||
      process.env.BOJECT_SCHEMA_READONLY === '1',
    public: {
      schemaReadonly:
        process.env.BOJECT_SCHEMA_READONLY === 'true' ||
        process.env.BOJECT_SCHEMA_READONLY === '1',
    },
    session: {
      cookie: {
        sameSite: 'strict',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
      },
      password:
        process.env.NUXT_SESSION_PASSWORD ??
        (process.env.NODE_ENV === 'production'
          ? (() => {
              throw new Error(
                'NUXT_SESSION_PASSWORD must be set in production'
              );
            })()
          : ''),
    },
  },
```

The duplicated coercion expression is intentional — Nuxt parses `runtimeConfig` at build time and substitutes the actual values. Extracting the boolean to a const above `defineNuxtConfig` would also work but adds a top-level statement; the inline form keeps everything inside the config block.

- [ ] **Step 2: Verify the dev server still boots**

Run: `pnpm --filter cms exec nuxi prepare`
Expected: Exit 0. Generates `.nuxt/` types — confirms the runtime config shape is valid.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/nuxt.config.ts
git commit -m "$(cat <<'EOF'
feat(server): wire BOJECT_SCHEMA_READONLY into runtime config

Adds schemaReadonly to both server-side and public runtime config.
No behaviour change yet — the helper that consumes this lands in the
next commit, the endpoint guards in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Create the `assertSchemaEditable` helper

Pure helper module modelled on `enforceMutationRateLimit` (its sibling in `server/utils/`). Throws a 403 with `data.error === 'SCHEMA_READONLY'` when the flag is on, no-op otherwise. The helper itself is small enough to be exercised by integration tests rather than unit tests — but we add a tiny isolated unit test for the boolean-coercion expression so the env-var contract has explicit coverage.

**Files:**

- Create: `apps/cms/server/utils/schemaReadOnly.ts`
- Create: `apps/cms/server/utils/schemaReadOnly.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `apps/cms/server/utils/schemaReadOnly.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { coerceSchemaReadonly } from './schemaReadOnly';

describe('coerceSchemaReadonly', () => {
  it('returns true for "true"', () => {
    expect(coerceSchemaReadonly('true')).toBe(true);
  });

  it('returns true for "1"', () => {
    expect(coerceSchemaReadonly('1')).toBe(true);
  });

  it('returns false for undefined', () => {
    expect(coerceSchemaReadonly(undefined)).toBe(false);
  });

  it('returns false for the empty string', () => {
    expect(coerceSchemaReadonly('')).toBe(false);
  });

  it('returns false for "false"', () => {
    expect(coerceSchemaReadonly('false')).toBe(false);
  });

  it('returns false for "0"', () => {
    expect(coerceSchemaReadonly('0')).toBe(false);
  });

  it('returns false for an unrelated string', () => {
    expect(coerceSchemaReadonly('yes')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm --filter cms exec vitest run --project unit server/utils/schemaReadOnly.test.ts
```

Expected: FAIL with "Failed to resolve import" or similar — `schemaReadOnly` doesn't exist yet.

- [ ] **Step 3: Create the helper**

Create `apps/cms/server/utils/schemaReadOnly.ts`:

```ts
import type { H3Event } from 'h3';
import { createError } from 'h3';

/**
 * Coerce the BOJECT_SCHEMA_READONLY env var into a boolean.
 * "true" / "1" → true; everything else (including unset) → false.
 *
 * Exported separately from `assertSchemaEditable` so the coercion
 * contract has its own unit test surface — the helper itself runs
 * inside a request and is exercised by integration tests.
 */
export function coerceSchemaReadonly(value: unknown): boolean {
  return value === 'true' || value === '1';
}

/**
 * Throw a 403 if BOJECT_SCHEMA_READONLY is on. Insert as the first
 * line of any handler that mutates content-type or field schema —
 * before rate-limit and CSRF guards, so locked-environment requests
 * don't burn the editor's rate-limit bucket.
 *
 * Content-entry endpoints are deliberately NOT gated. The flag draws
 * a line at "schema editing" only.
 */
export function assertSchemaEditable(event: H3Event): void {
  const config = useRuntimeConfig(event);
  if (config.schemaReadonly === true) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Schema is read-only on this environment',
      data: { error: 'SCHEMA_READONLY' },
    });
  }
}
```

`useRuntimeConfig` is auto-imported by Nuxt in server-side code; no import is required. `createError` from `h3` is imported explicitly to match the style in `rateLimitEndpoint.ts`.

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm --filter cms exec vitest run --project unit server/utils/schemaReadOnly.test.ts
```

Expected: PASS — 7/7 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/utils/schemaReadOnly.ts apps/cms/server/utils/schemaReadOnly.test.ts
git commit -m "$(cat <<'EOF'
feat(server): add assertSchemaEditable helper

Mirrors the shape of enforceMutationRateLimit. Throws a 403 with
{ error: 'SCHEMA_READONLY' } when runtimeConfig.schemaReadonly is
true. Exported coerceSchemaReadonly() carries the env-var contract
and is unit-tested directly.

No callers wired yet — the endpoint guards land in the next 7
commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Set up the readonly integration test file

Boots a Nuxt dev server with `BOJECT_SCHEMA_READONLY=true` set, seeds one content type via direct Prisma so the negative tests (content-entries, GETs) have real data to act on, and shares a session cookie helper with the existing `content-types.test.ts` style. This is infrastructure only — the per-endpoint tests land in Tasks 4-10.

**Why a separate file?** Nuxt reads `runtimeConfig` once at server boot. The existing `content-types.test.ts` boots the server with the flag unset; we cannot mutate it mid-suite. The new file boots a second server with the flag set.

**Files:**

- Create: `apps/cms/server/api/content-types/content-types-readonly.test.ts`

- [ ] **Step 1: Create the test file with the setup scaffolding (no per-endpoint tests yet)**

```ts
// apps/cms/server/api/content-types/content-types-readonly.test.ts
//
// Integration tests for the BOJECT_SCHEMA_READONLY flag.
//
// IMPORTANT: This file boots a second Nuxt dev server with the flag
// set. Setting BOJECT_SCHEMA_READONLY at module scope (before
// `setup()` is called) ensures Nitro picks it up when reading
// runtimeConfig at server boot. Do not move this assignment inside
// `describe` or `beforeAll` — it must run before `setup`.
process.env.BOJECT_SCHEMA_READONLY = 'true';

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { resetRateLimitStore } from '../../utils/rateLimit';
import { prisma } from '../../utils/prisma';

let _sessionCookie: string | null = null;

async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: TEST_USERNAME,
      password: TEST_PASSWORD,
    }),
    headers: { 'Content-Type': 'application/json' },
  });
  const cookies = response.headers.getSetCookie();
  _sessionCookie = cookies.join('; ');
  return _sessionCookie;
}

interface SeededContentType {
  id: string;
  fieldId: string;
}

let seeded: SeededContentType;

describe('Schema read-only flag (BOJECT_SCHEMA_READONLY=true)', async () => {
  await setup({ dev: true });

  beforeAll(async () => {
    // Seed via direct Prisma so we have real IDs to poke. Direct DB
    // writes bypass the readonly guard (it lives in the HTTP handlers,
    // not at the model layer) — that's correct: the entrypoint's
    // boot-time apply path also goes via Prisma directly and must
    // continue to work even on a readonly instance.
    const ct = await prisma.contentType.create({
      data: {
        name: `Readonly Seed ${Date.now()}`,
        identifier: `ReadonlySeed${Date.now()}`,
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              unique: true,
              order: 0,
            },
          ],
        },
      },
      include: { fields: true },
    });
    seeded = { id: ct.id, fieldId: ct.fields[0]!.id };
  });

  beforeEach(() => {
    resetRateLimitStore();
  });

  // Per-endpoint tests land in Tasks 4-10.
  // Negative tests (reads, content-entries, CSRF order) land in Task 11.

  it('placeholder — file boots and seeds successfully', () => {
    expect(seeded.id).toBeDefined();
    expect(seeded.fieldId).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the new test file, verify it boots**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts
```

Expected: PASS — placeholder test green. The server boots with the flag on; seed inserts; cleanup happens in the existing `vitest.globalSetup.ts` flow that resets the test DB between runs.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/server/api/content-types/content-types-readonly.test.ts
git commit -m "$(cat <<'EOF'
test(content-types): scaffolding for readonly-flag integration tests

Boots a second Nuxt dev server with BOJECT_SCHEMA_READONLY=true and
seeds one content type via direct Prisma. Per-endpoint assertions
land in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Gate `POST /api/content-types`

First of seven endpoint guards. Standard TDD shape: failing test → add helper line → green → commit.

**Files:**

- Modify: `apps/cms/server/api/content-types/content-types-readonly.test.ts`
- Modify: `apps/cms/server/api/content-types/index.post.ts`

- [ ] **Step 1: Write the failing test**

In `content-types-readonly.test.ts`, replace the placeholder test with the first real assertion. After the `beforeEach` block, add:

```ts
it('returns 403 SCHEMA_READONLY on POST /api/content-types', async () => {
  const cookie = await getSessionCookie();
  const res = await fetch('/api/content-types', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Should Not Create ${Date.now()}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
      ],
    }),
  });
  expect(res.status).toBe(403);
  const body = (await res.json()) as { data?: { error?: string } };
  expect(body.data?.error).toBe('SCHEMA_READONLY');
});
```

Delete the `it('placeholder ...'` test — it's served its purpose.

- [ ] **Step 2: Run the test, verify it fails**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts -t "POST /api/content-types"
```

Expected: FAIL — `expected 403, received 201`. The handler currently has no guard; it creates the content type and returns it.

- [ ] **Step 3: Add the guard to the handler**

Edit `apps/cms/server/api/content-types/index.post.ts`. Add the import at the top and the call as the first line of the handler.

The import block at the top of the file currently looks like:

```ts
import type { FieldType } from '#prisma';
import {
  assertStringLength,
  assertIdentifier,
  assertFieldIdentifier,
  toPascalCase,
  isUuid,
} from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { invalidateSchema } from '../../graphql/schema';
import { resolveUniqueFlag } from '../../utils/validateFieldUnique';
```

Add one line:

```ts
import { assertSchemaEditable } from '../../utils/schemaReadOnly';
```

Then in the handler (currently line 31), the existing first line is `enforceMutationRateLimit(event, 'content-types.post');`. Insert the new check **before** it:

```ts
export default defineEventHandler(async (event) => {
  assertSchemaEditable(event);
  enforceMutationRateLimit(event, 'content-types.post');
  // ... rest of handler unchanged
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts -t "POST /api/content-types"
```

Expected: PASS.

- [ ] **Step 5: Verify the existing non-readonly tests still pass**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types.test.ts -t "POST /api/content-types"
```

Expected: PASS — the existing POST tests still run with the flag unset (default off), so the new guard is a no-op.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/server/api/content-types/content-types-readonly.test.ts apps/cms/server/api/content-types/index.post.ts
git commit -m "$(cat <<'EOF'
feat(content-types): gate POST /api/content-types on readonly flag

Returns 403 SCHEMA_READONLY when BOJECT_SCHEMA_READONLY is on.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Gate `PUT /api/content-types/[id]`

**Files:**

- Modify: `apps/cms/server/api/content-types/content-types-readonly.test.ts`
- Modify: `apps/cms/server/api/content-types/[id].put.ts`

- [ ] **Step 1: Write the failing test**

In `content-types-readonly.test.ts`, after the previous test, add:

```ts
it('returns 403 SCHEMA_READONLY on PUT /api/content-types/[id]', async () => {
  const cookie = await getSessionCookie();
  const res = await fetch(`/api/content-types/${seeded.id}`, {
    method: 'PUT',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Renamed' }),
  });
  expect(res.status).toBe(403);
  const body = (await res.json()) as { data?: { error?: string } };
  expect(body.data?.error).toBe('SCHEMA_READONLY');
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts -t "PUT /api/content-types"
```

Expected: FAIL — `expected 403, received 200`.

- [ ] **Step 3: Add the guard**

Edit `apps/cms/server/api/content-types/[id].put.ts`. Add the import:

```ts
import { assertSchemaEditable } from '../../utils/schemaReadOnly';
```

Insert the call as the first line of the handler:

```ts
export default defineEventHandler(async (event) => {
  assertSchemaEditable(event);
  enforceMutationRateLimit(event, 'content-types.put');
  // ... rest unchanged
```

- [ ] **Step 4: Run, verify it passes**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts -t "PUT /api/content-types"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/content-types/content-types-readonly.test.ts apps/cms/server/api/content-types/[id].put.ts
git commit -m "$(cat <<'EOF'
feat(content-types): gate PUT /api/content-types/[id] on readonly flag

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Gate `DELETE /api/content-types/[id]`

**Files:**

- Modify: `apps/cms/server/api/content-types/content-types-readonly.test.ts`
- Modify: `apps/cms/server/api/content-types/[id].delete.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('returns 403 SCHEMA_READONLY on DELETE /api/content-types/[id]', async () => {
  const cookie = await getSessionCookie();
  // Create a fresh content type via direct Prisma so we have a
  // disposable target — the seeded type is reused by negative tests.
  const target = await prisma.contentType.create({
    data: {
      name: `Disposable ${Date.now()}`,
      identifier: `Disposable${Date.now()}`,
      fields: {
        create: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
            unique: true,
            order: 0,
          },
        ],
      },
    },
  });
  const res = await fetch(`/api/content-types/${target.id}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  expect(res.status).toBe(403);
  const body = (await res.json()) as { data?: { error?: string } };
  expect(body.data?.error).toBe('SCHEMA_READONLY');
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts -t "DELETE /api/content-types"
```

Expected: FAIL — `expected 403, received 200`.

- [ ] **Step 3: Add the guard**

Edit `apps/cms/server/api/content-types/[id].delete.ts`. Add the import:

```ts
import { assertSchemaEditable } from '../../utils/schemaReadOnly';
```

Insert the call as the first line of the handler:

```ts
export default defineEventHandler(async (event) => {
  assertSchemaEditable(event);
  enforceMutationRateLimit(event, 'content-types.delete');
  // ... rest unchanged
```

- [ ] **Step 4: Run, verify it passes**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts -t "DELETE /api/content-types"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/content-types/content-types-readonly.test.ts apps/cms/server/api/content-types/[id].delete.ts
git commit -m "$(cat <<'EOF'
feat(content-types): gate DELETE /api/content-types/[id] on readonly flag

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Gate `POST /api/content-types/[id]/fields`

**Files:**

- Modify: `apps/cms/server/api/content-types/content-types-readonly.test.ts`
- Modify: `apps/cms/server/api/content-types/[id]/fields/index.post.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('returns 403 SCHEMA_READONLY on POST /api/content-types/[id]/fields', async () => {
  const cookie = await getSessionCookie();
  const res = await fetch(`/api/content-types/${seeded.id}/fields`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'shouldNotCreate',
      name: 'Should Not Create',
      type: 'TEXT',
    }),
  });
  expect(res.status).toBe(403);
  const body = (await res.json()) as { data?: { error?: string } };
  expect(body.data?.error).toBe('SCHEMA_READONLY');
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts -t "POST /api/content-types/\\[id\\]/fields"
```

Expected: FAIL — `expected 403, received 201`.

- [ ] **Step 3: Add the guard**

Edit `apps/cms/server/api/content-types/[id]/fields/index.post.ts`. Add the import (note the deeper relative path — this file is two levels deeper than `content-types/index.post.ts`):

```ts
import { assertSchemaEditable } from '../../../../utils/schemaReadOnly';
```

Insert the call:

```ts
export default defineEventHandler(async (event) => {
  assertSchemaEditable(event);
  enforceMutationRateLimit(event, 'content-type-fields.post');
  // ... rest unchanged
```

- [ ] **Step 4: Run, verify it passes**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts -t "POST /api/content-types/\\[id\\]/fields"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/content-types/content-types-readonly.test.ts apps/cms/server/api/content-types/\[id\]/fields/index.post.ts
git commit -m "$(cat <<'EOF'
feat(content-types): gate POST /api/content-types/[id]/fields on readonly flag

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Gate `PUT /api/content-types/[id]/fields/[fieldId]`

**Files:**

- Modify: `apps/cms/server/api/content-types/content-types-readonly.test.ts`
- Modify: `apps/cms/server/api/content-types/[id]/fields/[fieldId].put.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('returns 403 SCHEMA_READONLY on PUT /api/content-types/[id]/fields/[fieldId]', async () => {
  const cookie = await getSessionCookie();
  const res = await fetch(
    `/api/content-types/${seeded.id}/fields/${seeded.fieldId}`,
    {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed Title' }),
    }
  );
  expect(res.status).toBe(403);
  const body = (await res.json()) as { data?: { error?: string } };
  expect(body.data?.error).toBe('SCHEMA_READONLY');
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts -t "PUT /api/content-types/\\[id\\]/fields/\\[fieldId\\]"
```

Expected: FAIL — `expected 403, received 200`.

- [ ] **Step 3: Add the guard**

Edit `apps/cms/server/api/content-types/[id]/fields/[fieldId].put.ts`. Add the import:

```ts
import { assertSchemaEditable } from '../../../../utils/schemaReadOnly';
```

Insert:

```ts
export default defineEventHandler(async (event) => {
  assertSchemaEditable(event);
  enforceMutationRateLimit(event, 'content-type-fields.put');
  // ... rest unchanged
```

- [ ] **Step 4: Run, verify it passes**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts -t "PUT /api/content-types/\\[id\\]/fields/\\[fieldId\\]"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/content-types/content-types-readonly.test.ts apps/cms/server/api/content-types/\[id\]/fields/\[fieldId\].put.ts
git commit -m "$(cat <<'EOF'
feat(content-types): gate PUT /api/content-types/[id]/fields/[fieldId] on readonly flag

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Gate `DELETE /api/content-types/[id]/fields/[fieldId]`

**Files:**

- Modify: `apps/cms/server/api/content-types/content-types-readonly.test.ts`
- Modify: `apps/cms/server/api/content-types/[id]/fields/[fieldId].delete.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('returns 403 SCHEMA_READONLY on DELETE /api/content-types/[id]/fields/[fieldId]', async () => {
  const cookie = await getSessionCookie();
  // Add a disposable field to the seeded type via direct Prisma —
  // we need a non-ENTRY_TITLE field because deleting the only
  // ENTRY_TITLE is otherwise blocked at handler layer with 400.
  const field = await prisma.contentTypeField.create({
    data: {
      contentTypeId: seeded.id,
      identifier: `disposable${Date.now()}`,
      name: 'Disposable',
      type: 'TEXT',
      required: false,
      unique: false,
      order: 99,
    },
  });
  const res = await fetch(
    `/api/content-types/${seeded.id}/fields/${field.id}`,
    { method: 'DELETE', headers: { cookie } }
  );
  expect(res.status).toBe(403);
  const body = (await res.json()) as { data?: { error?: string } };
  expect(body.data?.error).toBe('SCHEMA_READONLY');
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts -t "DELETE /api/content-types/\\[id\\]/fields/\\[fieldId\\]"
```

Expected: FAIL — `expected 403, received 200`.

- [ ] **Step 3: Add the guard**

Edit `apps/cms/server/api/content-types/[id]/fields/[fieldId].delete.ts`. Add the import:

```ts
import { assertSchemaEditable } from '../../../../utils/schemaReadOnly';
```

Insert:

```ts
export default defineEventHandler(async (event) => {
  assertSchemaEditable(event);
  enforceMutationRateLimit(event, 'content-type-fields.delete');
  // ... rest unchanged
```

- [ ] **Step 4: Run, verify it passes**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts -t "DELETE /api/content-types/\\[id\\]/fields/\\[fieldId\\]"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/content-types/content-types-readonly.test.ts apps/cms/server/api/content-types/\[id\]/fields/\[fieldId\].delete.ts
git commit -m "$(cat <<'EOF'
feat(content-types): gate DELETE /api/content-types/[id]/fields/[fieldId] on readonly flag

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Gate `PUT /api/content-types/[id]/fields/reorder`

**Files:**

- Modify: `apps/cms/server/api/content-types/content-types-readonly.test.ts`
- Modify: `apps/cms/server/api/content-types/[id]/fields/reorder.put.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('returns 403 SCHEMA_READONLY on PUT /api/content-types/[id]/fields/reorder', async () => {
  const cookie = await getSessionCookie();
  const res = await fetch(`/api/content-types/${seeded.id}/fields/reorder`, {
    method: 'PUT',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: [{ id: seeded.fieldId, order: 0 }],
    }),
  });
  expect(res.status).toBe(403);
  const body = (await res.json()) as { data?: { error?: string } };
  expect(body.data?.error).toBe('SCHEMA_READONLY');
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts -t "fields/reorder"
```

Expected: FAIL — `expected 403, received 200`.

- [ ] **Step 3: Add the guard**

Edit `apps/cms/server/api/content-types/[id]/fields/reorder.put.ts`. Add the import:

```ts
import { assertSchemaEditable } from '../../../../utils/schemaReadOnly';
```

Insert:

```ts
export default defineEventHandler(async (event) => {
  assertSchemaEditable(event);
  enforceMutationRateLimit(event, 'content-type-fields.reorder');
  // ... rest unchanged
```

- [ ] **Step 4: Run, verify it passes**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts -t "fields/reorder"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/content-types/content-types-readonly.test.ts apps/cms/server/api/content-types/\[id\]/fields/reorder.put.ts
git commit -m "$(cat <<'EOF'
feat(content-types): gate PUT /api/content-types/[id]/fields/reorder on readonly flag

That's all 7 schema-mutation endpoints gated. The next commit adds
negative tests proving the boundary stops at schema (reads, content-
entries, and CSRF order are unaffected).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Negative tests — reads, content-entries, CSRF precedence

Verifies the boundary the spec drew: schema mutations are blocked, everything else is unaffected. Three tests:

1. `GET /api/content-types` still returns 200 (reads unaffected).
2. `POST /api/content-entries` against the seeded content type still returns 201 (content-entry mutations unaffected — the readonly flag is schema-only).
3. CSRF precedence: a request with a wrong-origin header is rejected by CSRF middleware _before_ the readonly guard fires (proves global middleware order, not just spec design intent).

**Files:**

- Modify: `apps/cms/server/api/content-types/content-types-readonly.test.ts`

- [ ] **Step 1: Write the three failing/passing tests**

Add to the same `describe` block, after the gate tests:

```ts
describe('boundary — non-schema endpoints unaffected', () => {
  it('GET /api/content-types still returns 200', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch('/api/content-types', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
  });

  it('POST /api/content-entries succeeds against the seeded type', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch('/api/content-entries', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentTypeId: seeded.id,
        data: { title: `Entry ${Date.now()}` },
      }),
    });
    // Content-entry mutations are deliberately not gated by the
    // readonly flag — the flag draws a line at schema editing only.
    expect(res.status).toBe(201);
  });
});

describe('guard order', () => {
  it('CSRF middleware runs before the readonly guard', async () => {
    const cookie = await getSessionCookie();
    // CSRF middleware rejects same-origin-mismatch with 403 before
    // the handler runs. Without a valid Origin/Referer, this fails
    // CSRF; if the readonly guard fired first, the data.error would
    // be SCHEMA_READONLY. We expect a CSRF-shaped 403 instead.
    const res = await fetch('/api/content-types', {
      method: 'POST',
      headers: {
        cookie,
        'Content-Type': 'application/json',
        // Mismatched origin to trigger CSRF rejection
        Origin: 'https://evil.example.com',
      },
      body: JSON.stringify({
        name: `Should Not Reach Handler ${Date.now()}`,
        fields: [],
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data?: { error?: string } };
    // CSRF rejection has no data.error === 'SCHEMA_READONLY' marker.
    // If this assertion fails (data.error IS 'SCHEMA_READONLY'), the
    // readonly guard ran before CSRF, which would be a regression.
    expect(body.data?.error).not.toBe('SCHEMA_READONLY');
  });
});
```

- [ ] **Step 2: Run the negative tests**

```bash
pnpm --filter cms exec vitest run --project integration server/api/content-types/content-types-readonly.test.ts
```

Expected: PASS — all three pass with no further code changes. The first two were already correct (the helper is only in schema endpoints). The third documents the global-middleware ordering.

- [ ] **Step 3: Run the full integration suite to catch regressions**

```bash
pnpm test:integration
```

Expected: All green. Total run time ~30-60s.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/server/api/content-types/content-types-readonly.test.ts
git commit -m "$(cat <<'EOF'
test(content-types): negative tests for readonly flag boundary

Documents the line the flag draws:
- GETs unaffected
- /api/content-entries mutations unaffected
- CSRF middleware precedes the readonly guard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Add `useSchemaReadonly` composable

Tiny Vue composable that wraps `useRuntimeConfig().public.schemaReadonly` as a reactive boolean. Auto-imported by Nuxt because it lives in `composables/`.

**Files:**

- Create: `apps/cms/composables/useSchemaReadonly.ts`

- [ ] **Step 1: Create the composable**

```ts
// apps/cms/composables/useSchemaReadonly.ts
//
// Reactive boolean reflecting the BOJECT_SCHEMA_READONLY flag on the
// running deployment. UI-only — the security boundary is the server
// helper at server/utils/schemaReadOnly.ts. Use this composable to
// hide affordances pre-emptively; the 403 still fires if a user
// crafts a request manually.

export function useSchemaReadonly() {
  const config = useRuntimeConfig();
  return computed(() => config.public.schemaReadonly === true);
}
```

`useRuntimeConfig` and `computed` are auto-imported by Nuxt; no explicit import needed.

- [ ] **Step 2: Verify the composable compiles**

```bash
pnpm --filter cms exec nuxi prepare
```

Expected: Exit 0. Generates types reflecting the new auto-import.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/composables/useSchemaReadonly.ts
git commit -m "$(cat <<'EOF'
feat(client): add useSchemaReadonly composable

Reactive boolean over runtimeConfig.public.schemaReadonly. UI hides
in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Hide CTAs and add banner on `/content-types`

Wraps the "New Content Type" button in `v-if="!schemaReadonly"` and adds a banner above the table when the flag is on.

**Files:**

- Modify: `apps/cms/pages/content-types/index.vue`

- [ ] **Step 1: Edit the page**

In `apps/cms/pages/content-types/index.vue`, add the composable to the `<script setup>` block (after `const { formatDate } = useContentTable();`):

```ts
const schemaReadonly = useSchemaReadonly();
```

In the `<template>`, replace the existing header div:

```vue
<div class="flex items-center justify-between mb-4">
  <h1 class="text-2xl font-bold">Content Types</h1>
  <UButton to="/content-types/new" icon="i-lucide-plus">
    New Content Type
  </UButton>
</div>
```

…with:

```vue
<div class="flex items-center justify-between mb-4">
  <h1 class="text-2xl font-bold">Content Types</h1>
  <UButton
    v-if="!schemaReadonly"
    to="/content-types/new"
    icon="i-lucide-plus"
  >
    New Content Type
  </UButton>
</div>
<UAlert
  v-if="schemaReadonly"
  color="info"
  icon="i-lucide-lock"
  title="Schema is read-only on this environment"
  description="Edit in dev and deploy via git."
  class="mb-4"
/>
```

- [ ] **Step 2: Smoke check by running the dev server**

In one terminal:

```bash
docker compose up -d
BOJECT_SCHEMA_READONLY=true pnpm dev
```

Open `http://localhost:4000/content-types`. Expected: banner visible, no "New Content Type" button. Stop the dev server (Ctrl-C) when done.

Then re-run without the flag:

```bash
pnpm dev
```

Expected: button visible, no banner. Stop the dev server.

(Skip the smoke check if you trust the v-if; the security boundary is on the server.)

- [ ] **Step 3: Commit**

```bash
git add apps/cms/pages/content-types/index.vue
git commit -m "$(cat <<'EOF'
feat(client): hide schema CTAs on /content-types when readonly

Replaces the "New Content Type" button with an info banner when
BOJECT_SCHEMA_READONLY is on. Server-side guard (already shipped)
remains the security boundary; this is UX.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Hide field management and danger zone on `/content-types/[id]`

Wraps the field-management section (Add Field button, draggable fields list, danger zone delete) in `v-if="!schemaReadonly"`. The page's name/description form continues to render but its Save button is also hidden — saving requires `PUT /api/content-types/[id]` which is now gated server-side, so the button would error on click.

**Files:**

- Modify: `apps/cms/pages/content-types/[id]/index.vue`

- [ ] **Step 1: Edit the page**

In `<script setup>` (after `const toast = useToast();`), add:

```ts
const schemaReadonly = useSchemaReadonly();
```

In the `<template>`:

1. Wrap the Save UButton (currently inside the `<div class="flex gap-2">` at the top) with `v-if="!schemaReadonly"`:

```vue
<UButton
  v-if="!schemaReadonly"
  :loading="isSaving"
  icon="i-lucide-save"
  @click="handleSave"
>
  Save
</UButton>
```

2. Add a banner immediately after the page header `</div>` and before the `<UAlert v-if="saveError"`:

```vue
<UAlert
  v-if="schemaReadonly"
  color="info"
  icon="i-lucide-lock"
  title="Schema is read-only on this environment"
  description="Edit in dev and deploy via git."
  class="mb-6"
/>
```

3. Wrap the fields-section header (the flex row with `<USeparator class="flex-1" /> <span>Fields</span> <UButton ... openAddFieldModal>`), the `<draggable>` block, and the danger-zone `<div class="pt-8">` block in a single `v-if="!schemaReadonly"` wrapper. Easiest is to wrap the existing markup in a fragment-like template:

```vue
<template v-if="!schemaReadonly">
  <div class="flex items-center gap-4">
    <USeparator class="flex-1" />
    <span class="text-sm font-medium text-muted shrink-0">Fields</span>
    <UButton
      size="xs"
      variant="outline"
      icon="i-lucide-plus"
      @click="openAddFieldModal"
    >
      Add Field
    </UButton>
    <USeparator class="flex-1" />
  </div>

  <draggable
    v-model="draggableFields"
    item-key="id"
    handle=".drag-handle"
    animation="150"
    class="space-y-3"
    @end="onFieldReorder"
  >
    <!-- ... existing template #item content unchanged ... -->
  </draggable>

  <div class="pt-8">
    <USeparator color="error" />
    <div class="flex items-center justify-between pt-4">
      <!-- ... existing danger zone content unchanged ... -->
    </div>
  </div>
</template>
```

The form-input section (Name / Identifier / Description) renders unconditionally — it's harmless when readonly because the Save button is hidden. (A purist alternative would also `:disabled` the inputs, but that's UX paint we don't need; the server enforces the boundary.)

4. Make the FieldModal harmless when readonly: change its `:open` binding:

```vue
<FieldModal :open="fieldModalOpen && !schemaReadonly" ... />
```

This is belt-and-braces — the only triggers for `fieldModalOpen = true` (`openAddFieldModal`, `openEditFieldModal`) live inside the now-hidden `v-if` block, so the modal can't open by user action. The extra guard keeps the modal closed even if a stale `fieldModalOpen.value === true` somehow leaks across an HMR session in dev.

- [ ] **Step 2: Smoke check**

Same as Task 13: `BOJECT_SCHEMA_READONLY=true pnpm dev`, navigate to a content-type detail page, confirm no field-management section, no danger zone, no Save button. Banner is visible. Restart without the flag, confirm everything renders.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/pages/content-types/[id]/index.vue
git commit -m "$(cat <<'EOF'
feat(client): hide schema editing on /content-types/[id] when readonly

Hides the Save button, field-management section, and danger zone.
Adds a banner. The form inputs still render (harmless without a
Save button).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Defensive redirect on `/content-types/new`

The link to this page is hidden when readonly, but the URL is still reachable directly. Add a route middleware that redirects to `/content-types` if the flag is on.

**Files:**

- Modify: `apps/cms/pages/content-types/new.vue`

- [ ] **Step 1: Read the existing page**

```bash
sed -n '1,30p' apps/cms/pages/content-types/new.vue
```

(The skill instruction discourages `sed` for reading files, but here it's a quick inline check the engineer runs by eye; the actual edit uses the Edit tool or an editor.)

- [ ] **Step 2: Add the redirect at the top of `<script setup>`**

Insert at the very top of the existing `<script setup lang="ts">` block (before any other code):

```ts
const schemaReadonly = useSchemaReadonly();
if (import.meta.server && schemaReadonly.value) {
  await navigateTo('/content-types', { redirectCode: 302 });
}
```

The `import.meta.server` guard ensures the redirect runs during SSR (no flash of the form on direct nav). On the client, the user reaching this URL via direct nav also hits SSR first; on subsequent client-side navigation the page is unreachable because the link is hidden.

- [ ] **Step 3: Smoke check**

`BOJECT_SCHEMA_READONLY=true pnpm dev`, navigate to `http://localhost:4000/content-types/new` directly. Expected: 302 redirect, browser ends up on `/content-types`.

- [ ] **Step 4: Commit**

```bash
git add apps/cms/pages/content-types/new.vue
git commit -m "$(cat <<'EOF'
feat(client): redirect /content-types/new when readonly

Defence in depth — the link to this page is hidden when the flag is
on, but the URL is still reachable directly. Redirect to the list
page during SSR.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Scaffolder — commented opt-in line in generated `.env`

`renderEnvFile` currently emits no readonly line. Add a commented `# BOJECT_SCHEMA_READONLY=true` block with a brief comment so users discover the flag. Keep it commented (default off) so freshly scaffolded projects stay editable.

**Files:**

- Modify: `packages/create-boject-cms/src/templates/envFile.ts`
- Modify: `packages/create-boject-cms/tests/unit/envFile.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/create-boject-cms/tests/unit/envFile.test.ts`, add two `it` blocks at the bottom of the existing `describe('renderEnvFile', ...)`:

```ts
it('includes a commented BOJECT_SCHEMA_READONLY opt-in line', () => {
  const env = renderEnvFile({ ...baseParams, starter: 'base' });
  expect(env).toMatch(/^# BOJECT_SCHEMA_READONLY=true$/m);
});

it('does not enable BOJECT_SCHEMA_READONLY by default', () => {
  const env = renderEnvFile({ ...baseParams, starter: 'base' });
  // Match a non-commented assignment specifically — the commented
  // form is allowed and asserted above.
  expect(env).not.toMatch(/^BOJECT_SCHEMA_READONLY=/m);
});
```

- [ ] **Step 2: Run the tests, verify they fail**

```bash
pnpm --filter create-boject-cms test -t "renderEnvFile"
```

Expected: FAIL — first test missing the commented line; second test passes by accident (no such line exists at all).

- [ ] **Step 3: Update the template**

Edit `packages/create-boject-cms/src/templates/envFile.ts` to append the commented block. The full updated `renderEnvFile`:

```ts
export type StarterChoice = 'base' | 'sport' | 'rugby' | 'none';

export interface EnvFileParams {
  sessionPassword: string;
  adminPassword: string;
  starter: StarterChoice;
}

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
  ];
  if (starter !== 'none') {
    lines.push(`BOJECT_INITIAL_STARTER=/starters/${starter}.boject.json`);
  }
  lines.push(
    '',
    '# Set to "true" on production / staging to disable schema editing in the UI.',
    '# Schema changes should flow from git on locked environments.',
    '# BOJECT_SCHEMA_READONLY=true'
  );
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
pnpm --filter create-boject-cms test -t "renderEnvFile"
```

Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/create-boject-cms/src/templates/envFile.ts packages/create-boject-cms/tests/unit/envFile.test.ts
git commit -m "$(cat <<'EOF'
feat(scaffolder): document BOJECT_SCHEMA_READONLY in generated .env

Commented opt-in block at the bottom of the template. Default off,
discoverable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Update `CLAUDE.md`

Two additions: the env var goes in the "Runtime env vars" list under Docker image, and a one-paragraph summary lands in a new "Schema editing lock" subsection so future readers find it via grep.

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the env var to the runtime env list**

Find the bullet starting `**Runtime env vars:**` (currently in the "Docker image" section). Insert `BOJECT_SCHEMA_READONLY` after `STORAGE_DRIVER` (alphabetical-ish, fits the section). The relevant fragment:

```markdown
- **Runtime env vars:** `DATABASE_URL` (required), `NUXT_SESSION_PASSWORD` (required — production build throws without it), `BOJECT_ADMIN_EMAIL` + `BOJECT_ADMIN_PASSWORD` (required to seed first-boot admin; ...), `BOJECT_INITIAL_STARTER` (optional, path to starter bundle mounted into the container), `BOJECT_SCHEMA_READONLY` (optional, `true`/`1` disables schema editing endpoints + UI affordances; defaults to off), `STORAGE_DRIVER` (`local`/`s3`/`r2`), ...
```

- [ ] **Step 2: Add a subsection under Architecture / Authentication**

Find the long `**Authentication**` bullet in the Architecture list. Add a new top-level Architecture bullet immediately after it:

```markdown
- **Schema editing lock** — `BOJECT_SCHEMA_READONLY=true` disables all human-driven content-type and field mutations on a deployed CMS. The server-side helper `apps/cms/server/utils/schemaReadOnly.ts::assertSchemaEditable(event)` runs as the first line of the seven schema-mutation handlers (`POST /api/content-types`, `PUT/DELETE /api/content-types/[id]`, all `[id]/fields/*`) and throws a 403 with `{ error: 'SCHEMA_READONLY' }`. The client-side composable `useSchemaReadonly()` (auto-imported) hides corresponding UI affordances. Content-entry endpoints are deliberately not gated — the flag draws a line at "schema editing" only.
```

- [ ] **Step 3: Verify formatting**

```bash
pnpm format CLAUDE.md
```

Expected: "All matched files use Prettier code style!" If Prettier wants to rewrap, run `pnpm format:fix CLAUDE.md` and re-stage.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: document BOJECT_SCHEMA_READONLY in CLAUDE.md

Adds the env var to the runtime list and a dedicated architecture
bullet pointing at the helper, the gated endpoints, and the boundary.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Final verification pass

Before opening the PR, run every test surface that touches this change and confirm a clean state.

- [ ] **Step 1: Full integration suite**

```bash
pnpm test:integration
```

Expected: All green (this includes both `content-types.test.ts` and `content-types-readonly.test.ts`).

- [ ] **Step 2: Full unit suite**

```bash
pnpm test:unit
```

Expected: All green (includes `schemaReadOnly.test.ts`, `envFile.test.ts`).

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: Exit 0.

- [ ] **Step 4: Lint**

```bash
pnpm lint
```

Expected: No errors.

- [ ] **Step 5: Format check**

```bash
pnpm format
```

Expected: No diffs.

- [ ] **Step 6: Push the branch**

```bash
git push -u origin schema/readonly-flag
```

- [ ] **Step 7: Open the PR**

```bash
gh pr create --title "feat: schema read-only flag (BOJECT_SCHEMA_READONLY)" --body "$(cat <<'EOF'
## Summary

Closes #143. Implements the read-only-schema flag — the foundation
for the schema-as-code work specified in
`docs/superpowers/specs/2026-05-01-schema-readonly-flag-design.md`.

- New env var `BOJECT_SCHEMA_READONLY` (default off).
- Server-side helper `assertSchemaEditable(event)` invoked in 7
  schema-mutation endpoints. Returns 403 with
  `{ error: 'SCHEMA_READONLY' }`.
- Client-side composable `useSchemaReadonly()` powers UI hides on
  `/content-types`, `/content-types/[id]`, and a defensive redirect
  on `/content-types/new`.
- Scaffolder emits a commented opt-in line in generated `.env`.
- Content-entry endpoints are deliberately unaffected — the flag
  draws a line at schema editing only.

## Test plan

- [x] All 7 endpoints return 403 with the flag on (new
      `content-types-readonly.test.ts`).
- [x] All existing endpoint tests pass with the flag off (no
      regressions in `content-types.test.ts`).
- [x] Boundary tests: GETs unaffected, content-entries unaffected,
      CSRF middleware precedes the readonly guard.
- [x] Unit tests on the env-var coercion + scaffolder template.
- [x] Smoke-tested in dev: banner renders, CTAs hide, redirect fires.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Done.

---

## Self-Review

**Spec coverage check:**

- ✅ Server-side helper + 7 endpoint guards: Tasks 2, 4–10.
- ✅ 403 with `data.error === 'SCHEMA_READONLY'`: asserted in Tasks 4–10.
- ✅ `runtimeConfig.public.schemaReadonly`: Task 1.
- ✅ Banner + hidden CTAs on `/content-types` and `/content-types/[id]`: Tasks 13, 14.
- ✅ Defensive redirect on `/content-types/new`: Task 15.
- ✅ Integration tests for every gated endpoint + boundary tests: Tasks 4–11.
- ✅ Scaffolder commented opt-in: Task 16.
- ✅ `CLAUDE.md` documentation: Task 17.
- ✅ Order of guards (assertSchemaEditable before rate limit): asserted in handler edits in Tasks 4–10; CSRF precedence verified in Task 11.

**Placeholder scan:** All 18 tasks have full code blocks for code steps; all bash commands include exact paths and expected output keywords. No "similar to Task N" references — each endpoint task repeats its own full code.

**Type/symbol consistency:** `assertSchemaEditable`, `coerceSchemaReadonly`, `useSchemaReadonly`, `schemaReadonly` (config field), `BOJECT_SCHEMA_READONLY` (env var), `SCHEMA_READONLY` (error code) — same names everywhere they appear.

---

## Plan Done — Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-05-01-schema-readonly-flag.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
