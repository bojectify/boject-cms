# Schema-as-Code CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four `boject schema` CLI commands (`pull`, `validate`, `apply`, `check`), the two HTTP endpoints they require (`GET /api/schema/export`, `POST /api/schema/apply`), and an `ApiKey.scopes` system that lets operators issue narrow keys (read-only schema, write schema, content read, etc.).

**Architecture:** REST endpoints return / accept portable bundles (no UUIDs). The CLI is a thin HTTP client; it loads a committed `.boject.config.json` (CMS URL + schema path) and reads the API key from `BOJECT_API_KEY` env. API keys gain a `scopes: String[]` column via a Prisma migration; existing keys are backfilled to `["content:read"]` so GraphQL keeps working unchanged. A new `assertApiKeyScope(event, scope)` helper gates the new endpoints (and is wired into the GraphQL handler for the existing `content:read` requirement). The CLI's `apply` command supports `--dry-run` via a `dryRun` body flag that runs the applier inside a transaction that always rolls back, returning the plan to the caller.

**Tech Stack:** TypeScript, Node 24, Vitest, Prisma 7 driver-adapter, h3 (Nuxt server), node:http (CLI HTTP), tsx, tsup.

**Originating spec:** [`docs/superpowers/specs/2026-05-01-schema-as-code-cli-design.md`](../specs/2026-05-01-schema-as-code-cli-design.md)
**Branch:** `feat/145-schema-as-code-cli` (already created off `main`)
**Parents shipped:**

- Spec 1 — schema-readonly-flag (PR #150)
- Spec 2 — schema-as-code planner (PR #152)
- Spec 3 — schema-as-code applier (PR #154)
- Spec 4 — schema-as-code entrypoint (PR #155)

**Children that consume this:** None — this is the last spec in the schema-as-code stack.

---

## File Structure

| File                                                                  | Responsibility                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cms/prisma/schema/auth.prisma` (modify)                         | Add `scopes String[] @default([])` to `ApiKey`.                                                                                                                                                                |
| `apps/cms/prisma/migrations/<ts>_apikey_scopes/migration.sql` (new)   | `ALTER TABLE ... ADD COLUMN`. Backfill existing keys to `['content:read']`.                                                                                                                                    |
| `apps/cms/server/utils/validateApiKey.ts` (modify)                    | `ValidateApiKeyResult` carries `scopes: string[]` on success. Selects the column.                                                                                                                              |
| `apps/cms/server/utils/assertApiKeyScope.ts` (new)                    | `assertApiKeyScope(event, scope)` — pure function on `event.context.apiKeyScopes`, throws 403 INSUFFICIENT_SCOPE.                                                                                              |
| `apps/cms/server/utils/assertApiKeyScope.test.ts` (new)               | Unit tests on the helper (no h3 round-trip — feed a synthetic event).                                                                                                                                          |
| `apps/cms/server/middleware/auth.ts` (modify)                         | Stash `scopes` in `event.context.apiKeyScopes` after successful API key auth. Allow non-GET on `/api/schema/apply` for API keys (the endpoint asserts `schema:write` itself).                                  |
| `apps/cms/server/api/graphql/graphql.ts` (modify)                     | After `validateApiKey`, check `content:read` is present; reject with 403 INSUFFICIENT_SCOPE otherwise. (Backfill ensures every existing key has it.)                                                           |
| `apps/cms/server/api/graphql/graphql.test.ts` (modify)                | Add tests asserting a key without `content:read` is rejected.                                                                                                                                                  |
| `apps/cms/scripts/manage-api-keys/index.ts` (modify)                  | `pnpm apikey:create <name> --scopes <csv>` (default `content:read`). `apikey:list` shows a `Scopes` column.                                                                                                    |
| `apps/cms/scripts/content-bundle/applySchema.ts` (modify)             | Add `dryRun?: boolean` to `ApplySchemaOptions`. When set, applier runs every mutation inside the existing transaction, then throws a sentinel to roll back, returning the captured plan/applied to the caller. |
| `apps/cms/scripts/content-bundle/applySchema.test.ts` (modify)        | New `describe('dryRun')` block: bundle with content-type create + dryRun → result `{ changed: true, applied: { contentTypesCreated: 1, ... } }` AND DB unchanged.                                              |
| `apps/cms/server/api/schema/export.get.ts` (new)                      | `GET /api/schema/export`. Calls `exportBundle(prisma, { mode: 'schema', portable: true })`. Session OR API key with `schema:read`.                                                                             |
| `apps/cms/server/api/schema/apply.post.ts` (new)                      | `POST /api/schema/apply`. Body `{ bundle, allowDestructive?, dryRun? }`. Session OR API key with `schema:write`. Honours `BOJECT_SCHEMA_READONLY` (Spec 1). Translates applier errors to HTTP.                 |
| `apps/cms/server/api/schema/schema.test.ts` (new)                     | Integration tests for both endpoints.                                                                                                                                                                          |
| `packages/boject-cli/src/config.ts` (new)                             | `loadProjectConfig(cwd): { config, configPath }` — walks up to find `.boject.config.json`. Pure(ish) — takes an `fs` shim for testability.                                                                     |
| `packages/boject-cli/src/api.ts` (new)                                | `getSchema({ url, apiKey })` and `applySchema({ url, apiKey, bundle, allowDestructive?, dryRun? })`. Tiny `node:fetch` wrappers; throws typed errors for HTTP non-2xx.                                         |
| `packages/boject-cli/src/commands/schemaPull.ts` (new)                | `runSchemaPull` — config + flags → fetch → write file.                                                                                                                                                         |
| `packages/boject-cli/src/commands/schemaValidate.ts` (new)            | `runSchemaValidate` — read file → `validateBundle` + `planSchema` against empty snapshot. **No network.**                                                                                                      |
| `packages/boject-cli/src/commands/schemaApply.ts` (new)               | `runSchemaApply` — config + flags → POST → render result. `--dry-run` and one auto-retry on `SCHEMA_CHANGED_DURING_APPLY`.                                                                                     |
| `packages/boject-cli/src/commands/schemaCheck.ts` (new)               | `runSchemaCheck` — pull live + diff against on-disk → exit 0/1.                                                                                                                                                |
| `packages/boject-cli/src/index.ts` (modify)                           | Wire the four `schema` subcommands.                                                                                                                                                                            |
| `packages/boject-cli/tests/unit/config.test.ts` (new)                 | Walk-up resolution, malformed JSON, missing required keys.                                                                                                                                                     |
| `packages/boject-cli/tests/unit/schemaPull.test.ts` (new)             | Inject HTTP fixture; assert file written with body bytes verbatim.                                                                                                                                             |
| `packages/boject-cli/tests/unit/schemaValidate.test.ts` (new)         | Valid + invalid (planner cross-ref) fixtures; no network.                                                                                                                                                      |
| `packages/boject-cli/tests/unit/schemaApply.test.ts` (new)            | HTTP fixture; assert request body, dry-run output, blocker rendering, retry-once-on-race.                                                                                                                      |
| `packages/boject-cli/tests/unit/schemaCheck.test.ts` (new)            | HTTP fixture serving a slightly-different bundle; assert diff exit 1.                                                                                                                                          |
| `packages/boject-cli/tests/e2e/schemaCommands.test.ts` (new)          | One end-to-end flow against an in-process `node:http` mock. Built CLI via `execFile`, mirrors `upgrade.test.ts`.                                                                                               |
| `packages/boject-cli/package.json` (modify)                           | Add a workspace `dependencies` entry for the bundle types if needed (probably copy local types into `boject-cli/src/types.ts` to keep CLI publishable standalone — see notes).                                 |
| `packages/create-boject-cms/src/templates/bojectConfig.ts` (new)      | Render `.boject.config.json` with `cms.url` and `schema.path`.                                                                                                                                                 |
| `packages/create-boject-cms/tests/unit/bojectConfig.test.ts` (new)    | Renderer tests (paths, escapes).                                                                                                                                                                               |
| `packages/create-boject-cms/src/templates/envFile.ts` (modify)        | Append a commented `# BOJECT_API_KEY=` line with one-line explanatory comment.                                                                                                                                 |
| `packages/create-boject-cms/tests/unit/envFile.test.ts` (modify)      | Assert the new line is present + not enabled by default.                                                                                                                                                       |
| `packages/create-boject-cms/src/writeProject.ts` (modify)             | Always write `.boject.config.json`.                                                                                                                                                                            |
| `packages/create-boject-cms/tests/unit/writeProject.test.ts` (modify) | Assert `.boject.config.json` exists in the scaffold output.                                                                                                                                                    |
| `packages/create-boject-cms/tests/e2e/scaffold.test.ts` (modify)      | File-set assertion grows by `'.boject.config.json'`.                                                                                                                                                           |
| `CLAUDE.md` (modify)                                                  | Document the four CLI commands, two new endpoints, scope system, `.boject.config.json` shape, `BOJECT_API_KEY` env var, and the new key files.                                                                 |

---

## Cross-Cutting Notes

**Vitest projects.** All new CMS server tests (`schema.test.ts`, additions to `graphql.test.ts`) live in the **integration** project. The applier `dryRun` test extends `applySchema.test.ts` which is in the **unit** project (DB-backed but no Nuxt server — runs via the unit project's `boject_test` connection, same pattern as the rest of `applySchema.test.ts`). The `assertApiKeyScope.test.ts` is a pure unit test (no DB).

**CLI types.** The CLI is published standalone to npm; it cannot import from `apps/cms/scripts/content-bundle/types.ts`. Define a minimal `Bundle` / `BundleField` / `BundleContentType` interface duplication in `packages/boject-cli/src/types.ts`. Same approach as Plan B's CLI when it copies types from `@prisma/...`. Keep the CLI-side types narrow — the CLI only needs the `Bundle` shape sufficient to validate (count types/fields) and serialise (write file). Full validation against `validateBundle`'s logic happens server-side; the CLI's `validate` command reuses the planner / validator from the published `@boject/cms-tools` if we publish one — for this plan, we vendor the validator + planner via a build-time copy or duplicate the small validation surface inside `packages/boject-cli/src/validate.ts`. **Decision (v1):** Vendor the bundle validator + planner into the CLI by copying them at build time via a `tsup.config.ts` hook (Task 14). The functions are pure and have no Nuxt/Prisma deps, so vendoring is mechanical. Document that any change to `validate.ts` / `planSchema.ts` must rebuild the CLI.

**Run the new tests:**

```bash
# CLI unit tests (Node, no Nuxt)
pnpm --filter @boject/cli test:unit

# CLI E2E (builds the CLI first, then runs through node:http mock)
pnpm --filter @boject/cli test:e2e

# CMS schema endpoint integration tests
pnpm --filter cms exec vitest run --project integration server/api/schema

# applySchema dryRun unit tests (DB-backed)
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/applySchema.test.ts
```

**Migration path.** `prisma migrate dev` requires an interactive terminal and is unreliable in agentic contexts. Use the manual flow used elsewhere in this stack:

```bash
mkdir -p apps/cms/prisma/migrations/<timestamp>_apikey_scopes
# Hand-write migration.sql (alter + backfill)
pnpm prisma:generate
pnpx prisma migrate deploy --schema apps/cms/prisma/schema   # CI; in dev:
pnpx prisma migrate deploy --schema apps/cms/prisma/schema   # idempotent
```

`<timestamp>` should be of the form `20260502120000` (one second past the latest existing migration in `apps/cms/prisma/migrations/`).

**Auth middleware quirk.** The current middleware (`apps/cms/server/middleware/auth.ts:42-47`) blocks all non-GET/HEAD requests authenticated via API key. We need to relax this for `POST /api/schema/apply` — the endpoint itself asserts `schema:write` so the blanket block is overcautious. Don't change other endpoints' behaviour.

**API key scope storage.** Postgres `text[]` columns. Prisma represents these as `String[]`. The migration backfills via a single UPDATE that targets keys with empty/null arrays. The default in the model is `[]` so newly-created keys MUST be passed explicit scopes by the create CLI (which defaults to `content:read` itself for backwards compat).

**Endpoint readonly behaviour.** `POST /api/schema/apply` calls `assertSchemaEditable(event)` exactly like the other schema-mutation endpoints. Tests assert this 403 path.

**Conventional commits.** Each commit ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. Use `feat:` / `fix:` / `chore:` / `docs:` / `test:` prefixes.

**lefthook on commit.** Pre-commit runs prettier + lint + per-package typecheck on staged files. If a hook rewrites formatting, re-stage and retry. If a hook fails, fix the underlying issue. Do NOT pass `--no-verify`.

**pnpm only.** Never `npm` / `npx` (use `pnpm` / `pnpx`).

---

### Task 1: Prisma migration — `ApiKey.scopes`

Schema change + hand-written migration + regenerated client.

**Files:**

- Modify: `apps/cms/prisma/schema/auth.prisma`
- Create: `apps/cms/prisma/migrations/20260502120000_apikey_scopes/migration.sql`

- [ ] **Step 1: Update the Prisma schema**

In `apps/cms/prisma/schema/auth.prisma`, modify the `ApiKey` model:

```prisma
model ApiKey {
  id         String    @id @default(uuid())
  name       String
  keyHash    String    @unique
  keyPrefix  String
  revokedAt  DateTime?
  lastUsedAt DateTime?
  scopes     String[]  @default([])
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
}
```

- [ ] **Step 2: Create the migration directory + SQL**

```bash
mkdir -p apps/cms/prisma/migrations/20260502120000_apikey_scopes
```

`apps/cms/prisma/migrations/20260502120000_apikey_scopes/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill all existing keys to retain GraphQL access. Newly-created
-- keys go through the explicit --scopes flag, so the default-empty
-- column is the safer default for new rows.
UPDATE "ApiKey" SET "scopes" = ARRAY['content:read'] WHERE COALESCE(array_length("scopes", 1), 0) = 0;
```

- [ ] **Step 3: Apply the migration locally**

```bash
pnpm db:up    # ensure local Postgres is running
pnpx prisma migrate deploy --schema apps/cms/prisma/schema
```

Expected: "1 migration found in apps/cms/prisma/migrations" → "Applying migration `20260502120000_apikey_scopes`" → "All migrations have been successfully applied."

- [ ] **Step 4: Regenerate the Prisma client + Pothos types**

```bash
pnpm prisma:generate
```

Expected: clean.

- [ ] **Step 5: Reset + reseed the test DB so integration tests pick up the new column**

```bash
DATABASE_URL=postgresql://boject:boject@localhost:5432/boject_test pnpx prisma migrate reset --schema apps/cms/prisma/schema --force --skip-seed
pnpm prisma:seed:test
```

If the test DB doesn't exist yet, the existing globalSetup will handle it on the next test run; this step is just to make sure subsequent unit tests against `boject_test` see the new column. Skip if your local doesn't have `boject_test` yet.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/prisma/schema/auth.prisma apps/cms/prisma/migrations/20260502120000_apikey_scopes
git commit -m "$(cat <<'EOF'
feat(api-keys): add scopes column with content:read backfill

Spec 5 requires API keys to declare what they can do. Adds a
String[] scopes column defaulting to [] for new rows; the migration
backfills every existing key to ['content:read'] so the GraphQL
endpoint keeps working unchanged on this deploy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `validateApiKey` returns scopes

Extend the API key validation result so scope-aware code paths can branch on the loaded key's scopes without an extra DB roundtrip.

**Files:**

- Modify: `apps/cms/server/utils/validateApiKey.ts`

- [ ] **Step 1: Update `ApiKeyClient` and `ValidateApiKeyResult`**

```ts
export type ValidateApiKeyResult =
  | {
      valid: true;
      apiKeyId: string;
      keyPrefix: string;
      scopes: string[];
    }
  | { valid: false; message: string };

export type ApiKeyClient = {
  apiKey: {
    findUnique: (args: { where: { keyHash: string } }) => Promise<{
      id: string;
      keyPrefix: string;
      revokedAt: Date | null;
      scopes: string[];
    } | null>;
    update: (args: {
      where: { id: string };
      data: { lastUsedAt: Date };
    }) => Promise<unknown>;
  };
};
```

- [ ] **Step 2: Return the scopes in the success branch**

Change the success return to:

```ts
return {
  valid: true,
  apiKeyId: apiKey.id,
  keyPrefix: apiKey.keyPrefix,
  scopes: apiKey.scopes ?? [],
};
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter cms typecheck
```

Expected: clean. If there are call-sites of `result.scopes` etc that were missing, fix them — but at this point only `validateApiKey` itself has changed, so no callers should break.

- [ ] **Step 4: Run the existing API key auth tests**

```bash
pnpm --filter cms exec vitest run --project integration server/api/auth/auth.test.ts
pnpm --filter cms exec vitest run --project integration server/api/graphql/graphql.test.ts
```

Expected: green (existing behaviour unchanged because we only added a field).

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/utils/validateApiKey.ts
git commit -m "$(cat <<'EOF'
feat(api-keys): validateApiKey returns scopes on success

ValidateApiKeyResult.success now carries scopes: string[] so the
auth middleware can stash them on event.context for per-endpoint
scope assertions. No behaviour change yet — callers don't read the
field — but the contract is in place for the next tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `assertApiKeyScope` helper

Pure helper that gates a request handler on the resolved API key's scope set. Stash scopes on `event.context` so handlers can call `assertApiKeyScope(event, 'schema:read')` without re-fetching.

**Files:**

- Create: `apps/cms/server/utils/assertApiKeyScope.ts`
- Create: `apps/cms/server/utils/assertApiKeyScope.test.ts`
- Modify: `apps/cms/server/middleware/auth.ts`

- [ ] **Step 1: Write the failing tests**

`apps/cms/server/utils/assertApiKeyScope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertApiKeyScope } from './assertApiKeyScope';

function fakeEvent(opts: {
  authMethod?: 'session' | 'apikey';
  scopes?: string[];
}) {
  return {
    context: {
      authMethod: opts.authMethod ?? 'apikey',
      apiKeyScopes: opts.scopes,
    },
  } as unknown as Parameters<typeof assertApiKeyScope>[0];
}

describe('assertApiKeyScope', () => {
  it('passes session-authed events through unchanged', () => {
    expect(() =>
      assertApiKeyScope(fakeEvent({ authMethod: 'session' }), 'schema:read')
    ).not.toThrow();
  });

  it('passes when the API key has the required scope', () => {
    expect(() =>
      assertApiKeyScope(fakeEvent({ scopes: ['schema:read'] }), 'schema:read')
    ).not.toThrow();
  });

  it('throws 403 INSUFFICIENT_SCOPE when the scope is missing', () => {
    let thrown: { statusCode?: number; data?: unknown } | undefined;
    try {
      assertApiKeyScope(fakeEvent({ scopes: ['content:read'] }), 'schema:read');
    } catch (err) {
      thrown = err as typeof thrown;
    }
    expect(thrown?.statusCode).toBe(403);
    expect((thrown?.data as { error: string }).error).toBe(
      'INSUFFICIENT_SCOPE'
    );
    expect((thrown?.data as { required: string }).required).toBe('schema:read');
  });

  it('throws when scopes are missing entirely', () => {
    expect(() =>
      assertApiKeyScope(fakeEvent({ scopes: undefined }), 'schema:read')
    ).toThrow();
  });
});
```

- [ ] **Step 2: Create the helper**

`apps/cms/server/utils/assertApiKeyScope.ts`:

```ts
import type { H3Event } from 'h3';
import { createError } from 'h3';

/**
 * Throw 403 INSUFFICIENT_SCOPE if the request is API-key-authed and
 * the resolved key doesn't carry `scope`. Session-authed requests
 * pass through (CMS users have full authority — scopes are an API
 * key construct only).
 *
 * Auth middleware stashes scopes at event.context.apiKeyScopes during
 * key validation. Handlers call this as the first line of work.
 */
export function assertApiKeyScope(event: H3Event, scope: string): void {
  if (event.context.authMethod !== 'apikey') return;
  const scopes = event.context.apiKeyScopes;
  if (Array.isArray(scopes) && scopes.includes(scope)) return;
  throw createError({
    statusCode: 403,
    statusMessage: `API key missing required scope: ${scope}`,
    data: { error: 'INSUFFICIENT_SCOPE', required: scope },
  });
}
```

- [ ] **Step 3: Stash scopes on the event in auth middleware**

Modify `apps/cms/server/middleware/auth.ts` — find the API key success branch (currently sets `event.context.authMethod = 'apikey'`) and update it:

```ts
// Fall back to API key auth (read-only access by default)
const result = await validateApiKey(event);
if (result.valid) {
  event.context.authMethod = 'apikey';
  event.context.apiKeyScopes = result.scopes;
  const method = getMethod(event);
  if (method !== 'GET' && method !== 'HEAD') {
    // Allow non-GET on the schema apply endpoint specifically; the
    // endpoint asserts `schema:write` itself. Other endpoints stay
    // read-only for API keys.
    const path = getRequestURL(event).pathname;
    if (path !== '/api/schema/apply') {
      throw createError({
        statusCode: 403,
        message: 'API keys have read-only access',
      });
    }
  }
  return;
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter cms exec vitest run --project unit server/utils/assertApiKeyScope.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 5: Run the existing auth + GraphQL integration tests**

```bash
pnpm --filter cms exec vitest run --project integration server/api/auth server/api/graphql server/middleware/csrf.test.ts
```

Expected: green. No semantic change yet — the middleware still gates non-GET API key requests except for the now-allowed `/api/schema/apply` (which doesn't exist yet, so no test exercises it).

- [ ] **Step 6: Commit**

```bash
git add apps/cms/server/utils/assertApiKeyScope.ts apps/cms/server/utils/assertApiKeyScope.test.ts apps/cms/server/middleware/auth.ts
git commit -m "$(cat <<'EOF'
feat(api-keys): assertApiKeyScope helper + auth middleware wiring

Adds the per-handler scope check used by Spec 5's new schema endpoints
(and retroactively by GraphQL in the next task). Auth middleware
stashes scopes on event.context.apiKeyScopes after a successful key
validation, and the read-only-API-key gate gets a single carve-out
for /api/schema/apply (which asserts schema:write itself).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: GraphQL endpoint asserts `content:read`

Backfilled keys all have it, so this is a defence-in-depth wire-up plus tests asserting the regression guard.

**Files:**

- Modify: `apps/cms/server/api/graphql/graphql.ts`
- Modify: `apps/cms/server/api/graphql/graphql.test.ts`

- [ ] **Step 1: Add a failing test**

In `apps/cms/server/api/graphql/graphql.test.ts`, append (inside the existing top-level `describe`):

```ts
it('rejects api keys without content:read scope', async () => {
  const { prisma } = await import('../../utils/prisma');
  // Manually create a key with empty scopes — bypasses the CLI default.
  const { generateApiKey, hashApiKey } = await import('../../utils/apiKey');
  const raw = generateApiKey();
  await prisma.apiKey.create({
    data: {
      name: 'test-no-scope',
      keyHash: hashApiKey(raw),
      keyPrefix: raw.slice(0, 11),
      scopes: [],
    },
  });
  const res = await fetch('http://localhost:3000/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${raw}`,
    },
    body: JSON.stringify({ query: '{ __typename }' }),
  });
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body.error).toBe('INSUFFICIENT_SCOPE');
});
```

(NOTE: The exact import path / port number may need to be tweaked to match the existing test file's bootstrap. Look at the file's existing tests for the canonical pattern.)

- [ ] **Step 2: Run the test, verify it FAILS**

```bash
pnpm --filter cms exec vitest run --project integration server/api/graphql/graphql.test.ts
```

Expected: the new test fails (currently the GraphQL endpoint accepts any valid key in production mode).

- [ ] **Step 3: Wire `assertApiKeyScope` into the GraphQL handler**

Modify `apps/cms/server/api/graphql/graphql.ts`:

```ts
import { createYoga } from 'graphql-yoga';
import { defineEventHandler, setResponseStatus } from 'h3';
import { maxDepthPlugin } from '@escape.tech/graphql-armor-max-depth';
import { getSchema } from '../../graphql/schema';
import { validateApiKey } from '../../utils/validateApiKey';
import { enforceGraphqlRateLimit } from '../../utils/rateLimitEndpoint';

const yoga = createYoga({
  schema: () => getSchema(),
  graphqlEndpoint: '/api/graphql',
  graphiql: process.env.NODE_ENV !== 'production',
  plugins: [maxDepthPlugin({ n: 15 })],
});

export default defineEventHandler(async (event) => {
  const { req, res } = event.node;

  if (process.env.NODE_ENV !== 'production') {
    return yoga(req, res);
  }

  const result = await validateApiKey(event);
  if (!result.valid) {
    setResponseStatus(event, 401);
    return { error: result.message };
  }

  if (!result.scopes.includes('content:read')) {
    setResponseStatus(event, 403);
    return { error: 'INSUFFICIENT_SCOPE', required: 'content:read' };
  }

  enforceGraphqlRateLimit(event, result.apiKeyId);
  return yoga(req, res);
});
```

(GraphQL doesn't go through auth middleware — it has its own gate — so this handler does the scope check directly without relying on `event.context.apiKeyScopes`.)

- [ ] **Step 4: Run, verify GREEN**

```bash
pnpm --filter cms exec vitest run --project integration server/api/graphql/graphql.test.ts
```

Expected: all tests including the new one pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/graphql/graphql.ts apps/cms/server/api/graphql/graphql.test.ts
git commit -m "$(cat <<'EOF'
feat(api-keys): graphql endpoint asserts content:read scope

Defence in depth: GraphQL has always been the canonical "external app
reads content" use case, and the migration's backfill already gives
every existing key content:read — but a key created today with empty
scopes (or with --scopes schema:read only) shouldn't be able to
exfiltrate content via GraphQL. Add the explicit gate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `manage-api-keys` CLI grows a `--scopes` flag

Operators issuing keys need to pick scopes at creation time. The `list` view needs to surface them so revocation decisions aren't blind.

**Files:**

- Modify: `apps/cms/scripts/manage-api-keys/index.ts`

- [ ] **Step 1: Update the help text**

Find the existing `HELP` constant and replace its `Usage` block:

```ts
const HELP = `manage-api-keys — create, list, and revoke API keys

Usage:
  pnpm apikey:create <name> [--scopes <csv>]   Create a new API key (prints raw key once)
  pnpm apikey:list                             List all API keys (prefix, name, status, scopes, last used)
  pnpm apikey:revoke <prefix>                  Revoke an API key by its prefix

Flags:
  --scopes <csv>   Comma-separated list of scopes for the new key.
                   Recognised scopes: content:read, schema:read, schema:write.
                   Default: content:read.
  --help, -h       Show this help message.

Notes:
  - Keys are SHA-256 hashed in the database; the raw key is only shown at
    create time. Store it somewhere safe — it cannot be recovered later.
  - Revocation is a soft delete (sets revokedAt). The row stays for audit.
  - Requires DATABASE_URL in the environment (loaded via .env).

Examples:
  pnpm apikey:create "Mobile app backend"
  pnpm apikey:create "CI runner" --scopes schema:read,schema:write
  pnpm apikey:list
  pnpm apikey:revoke boject_a1b
`;
```

- [ ] **Step 2: Parse `--scopes` when creating**

Find the existing argument parser (or add `parseArgs`) at the top of the script. Replace the create branch with:

```ts
import { parseArgs } from 'node:util';

const RECOGNISED_SCOPES = new Set([
  'content:read',
  'schema:read',
  'schema:write',
]);

function parseScopes(input: string | undefined): string[] {
  if (!input) return ['content:read'];
  const parts = input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return ['content:read'];
  for (const p of parts) {
    if (!RECOGNISED_SCOPES.has(p)) {
      throw new Error(
        `Unknown scope "${p}". Recognised: ${[...RECOGNISED_SCOPES].join(', ')}.`
      );
    }
  }
  return parts;
}

async function create(name: string, scopes: string[]) {
  const { raw, hash, prefix } = generateApiKey();
  await prisma.apiKey.create({
    data: { name, keyHash: hash, keyPrefix: prefix, scopes },
  });

  console.log('API key created successfully.\n');
  console.log(`  Name:   ${name}`);
  console.log(`  Prefix: ${prefix}`);
  console.log(`  Scopes: ${scopes.join(', ')}`);
  console.log(`  Key:    ${raw}`);
  console.log('\nSave this key now — it cannot be retrieved again after this.');
}
```

Then in the dispatch (the `switch (subcommand)` or its equivalent — look at the existing file structure):

```ts
case 'create': {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      scopes: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) { console.log(HELP); return; }
  if (positionals.length !== 1) {
    console.error('Usage: pnpm apikey:create <name> [--scopes <csv>]');
    process.exit(1);
  }
  await create(positionals[0]!, parseScopes(values.scopes));
  break;
}
```

- [ ] **Step 3: Update `list` to show scopes**

Replace the print loop in `list()`:

```ts
console.log(
  'Prefix'.padEnd(14) +
    'Name'.padEnd(24) +
    'Status'.padEnd(10) +
    'Scopes'.padEnd(34) +
    'Last Used'.padEnd(22) +
    'Created'
);
console.log('-'.repeat(118));

for (const key of keys) {
  const status = key.revokedAt ? 'REVOKED' : 'ACTIVE';
  const lastUsed = key.lastUsedAt
    ? key.lastUsedAt.toISOString().slice(0, 19)
    : 'Never';
  const created = key.createdAt.toISOString().slice(0, 19);
  const scopes = (key.scopes ?? []).join(',') || '(none)';
  console.log(
    key.keyPrefix.padEnd(14) +
      key.name.padEnd(24) +
      status.padEnd(10) +
      scopes.padEnd(34) +
      lastUsed.padEnd(22) +
      created
  );
}
```

- [ ] **Step 4: Smoke-test the CLI manually**

```bash
pnpm apikey:create test-scopes --scopes schema:read,schema:write
pnpm apikey:list
pnpm apikey:revoke boject_<prefix from output>
```

Expected: create prints `Scopes: schema:read, schema:write`, list shows the new key with the right scopes, revoke flips it to REVOKED.

- [ ] **Step 5: Typecheck + lint**

```bash
pnpm --filter cms typecheck
pnpm --filter cms lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/scripts/manage-api-keys/index.ts
git commit -m "$(cat <<'EOF'
feat(api-keys): apikey:create accepts --scopes; apikey:list shows them

Default scopes for new keys is content:read (matches the migration
backfill — keys created without explicit scopes can still hit
GraphQL). Recognised scopes: content:read, schema:read, schema:write.
Unknown scopes are rejected at create time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `applySchema` — `dryRun` option

Adds `dryRun: true` to `ApplySchemaOptions`. When set, the applier executes the planning + every mutation, then throws a sentinel inside the transaction to roll everything back, returning the captured plan/applied result.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/applySchema.ts`
- Modify: `apps/cms/scripts/content-bundle/applySchema.test.ts`

- [ ] **Step 1: Add the failing tests**

In `apps/cms/scripts/content-bundle/applySchema.test.ts`, add at the bottom of the outer `describe('applySchema', ...)`:

```ts
describe('dryRun', () => {
  it('returns the plan and applied counts but rolls back the transaction', async () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'DryRunArticle',
          name: 'DryRunArticle',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };

    const result = await applySchema(prisma, bundle, { dryRun: true });

    expect(result.changed).toBe(true);
    expect(result.applied.contentTypesCreated).toBe(1);
    expect(result.applied.fieldsCreated).toBe(1);

    const inDb = await prisma.contentType.findUnique({
      where: { identifier: 'DryRunArticle' },
    });
    expect(inDb).toBeNull(); // Transaction rolled back.
  });

  it('returns changed=false on a no-op without throwing', async () => {
    const result = await applySchema(prisma, emptyBundle, { dryRun: true });
    expect(result.changed).toBe(false);
  });

  it('still surfaces blockers in dryRun mode (no rollback needed because tx never started mutating)', async () => {
    // Apply once to seed.
    await applySchema(prisma, {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'BlockedDryRun',
          name: 'BlockedDryRun',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    });
    // Seed an entry so removal is a destructive blocker.
    const ct = await prisma.contentType.findUniqueOrThrow({
      where: { identifier: 'BlockedDryRun' },
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

    await expect(
      applySchema(
        prisma,
        {
          version: 2,
          exportedAt: '2026-05-01T00:00:00.000Z',
          portable: true,
          contentTypes: [],
        },
        { dryRun: true }
      )
    ).rejects.toMatchObject({ code: 'SCHEMA_APPLY_BLOCKED' });
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/applySchema.test.ts
```

Expected: the three new tests fail (`dryRun` is not in `ApplySchemaOptions`; the applier writes the type for real).

- [ ] **Step 3: Add `dryRun` to the option type and implement rollback**

In `apps/cms/scripts/content-bundle/applySchema.ts`:

```ts
export interface ApplySchemaOptions {
  allowDestructive?: boolean;
  /**
   * If true, run the planner + every mutation inside the transaction
   * but throw a sentinel before the transaction commits so the caller
   * gets back a fully-populated result without changing DB state.
   * Used by Spec 5's HTTP apply endpoint to power `boject schema apply --dry-run`.
   */
  dryRun?: boolean;
}
```

Add a sentinel at module scope:

```ts
class DryRunRollback extends Error {
  readonly code = 'DRY_RUN_ROLLBACK' as const;
}
```

Modify the body of `applySchema` so the transaction wraps a try/catch on the sentinel. The structural change is:

```ts
let captured: ApplySchemaResult | null = null;
try {
  await prisma.$transaction(async (tx) => {
    // ... existing snapshot + plan + mutation logic, building `applied` ...
    const result: ApplySchemaResult = {
      changed: isPlanNonEmpty(plan),
      plan,
      applied,
    };
    captured = result;
    if (options.dryRun) throw new DryRunRollback();
    return result;
  });
} catch (err) {
  if (err instanceof DryRunRollback) {
    // captured is set; fall through to the post-transaction return.
  } else {
    throw err;
  }
}
const txResult = captured!;
```

Apply the same `if (txResult.changed) await invalidateSchemaIfAvailable();` afterwards — but **skip** the cache invalidation when `options.dryRun` is true (no DB change, nothing to invalidate):

```ts
if (txResult.changed && !options.dryRun) {
  await invalidateSchemaIfAvailable();
}
```

Also: the no-op early return inside the transaction (`if (!isPlanNonEmpty(plan)) return ...`) needs to assign to `captured` first:

```ts
if (!isPlanNonEmpty(plan)) {
  captured = { changed: false, plan, applied: { ...ZERO_APPLIED } };
  return captured;
}
```

(The dryRun-with-blockers case already throws `SchemaApplyBlockedError` before any mutation, so no-rollback is needed — the existing throw aborts the transaction naturally and the catch-and-return-captured path doesn't apply.)

- [ ] **Step 4: Run, verify GREEN**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/applySchema.test.ts
```

Expected: all 19+3 = 22 tests pass.

- [ ] **Step 5: Run the full unit suite to catch regressions**

```bash
pnpm test:unit
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/scripts/content-bundle/applySchema.ts apps/cms/scripts/content-bundle/applySchema.test.ts
git commit -m "$(cat <<'EOF'
feat(applySchema): add dryRun option (Spec 5 prereq)

When dryRun is true, the applier performs the full plan-and-mutate
walk inside the transaction, then throws a sentinel (DryRunRollback)
to roll everything back. The captured plan/applied result is
returned to the caller — the same shape as a normal apply, just
with the DB unchanged.

Powers `boject schema apply --dry-run` and the new
POST /api/schema/apply endpoint's `dryRun` body flag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `GET /api/schema/export` endpoint

Endpoint that returns the current schema as a portable bundle. Session OR API key with `schema:read`.

**Files:**

- Create: `apps/cms/server/api/schema/export.get.ts`
- Create: `apps/cms/server/api/schema/schema.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/cms/server/api/schema/schema.test.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEST_API_KEY } from '../../test/credentials';
import { prisma } from '../../utils/prisma';
import { generateApiKey, hashApiKey } from '../../utils/apiKey';

await setup({
  rootDir: fileURLToPath(new URL('../../..', import.meta.url)),
  dev: true,
});

async function makeKey(scopes: string[]): Promise<string> {
  const raw = generateApiKey();
  await prisma.apiKey.create({
    data: {
      name: `test-${Math.random().toString(36).slice(2, 8)}`,
      keyHash: hashApiKey(raw),
      keyPrefix: raw.slice(0, 11),
      scopes,
    },
  });
  return raw;
}

describe('GET /api/schema/export', () => {
  beforeEach(async () => {
    // Reset content types so each test sees a clean schema.
    await prisma.contentEntry.deleteMany();
    await prisma.contentTypeField.deleteMany();
    await prisma.contentType.deleteMany();
  });

  afterEach(async () => {
    await prisma.apiKey.deleteMany({
      where: { name: { startsWith: 'test-' } },
    });
  });

  it('returns 401 without auth', async () => {
    const res = await fetch('/api/schema/export');
    expect(res.status).toBe(401);
  });

  it('returns 403 INSUFFICIENT_SCOPE for an api key without schema:read', async () => {
    const key = await makeKey(['content:read']);
    const res = await fetch('/api/schema/export', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.data.error).toBe('INSUFFICIENT_SCOPE');
  });

  it('returns 200 with a portable bundle for an api key with schema:read', async () => {
    await prisma.contentType.create({
      data: {
        identifier: 'TestThing',
        name: 'TestThing',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
            },
          ],
        },
      },
    });
    const key = await makeKey(['schema:read']);
    const res = await fetch('/api/schema/export', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(2);
    expect(body.portable).toBe(true);
    expect(body.contentTypes).toHaveLength(1);
    expect(body.contentTypes[0].identifier).toBe('TestThing');
    expect(body.entries).toBeUndefined();
  });

  it('returns 200 with a portable bundle for a session user', async () => {
    // Use the existing test session helper from auth.test.ts. If no
    // helper is available, the simplest path is to import the test
    // username/password and POST to /api/auth/login first, capturing
    // the cookie.
    const loginRes = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.INTEGRATION_TEST_USERNAME ?? 'admin@example.com',
        password: process.env.INTEGRATION_TEST_PASSWORD ?? 'password',
      }),
    });
    const cookie = loginRes.headers.get('set-cookie');
    if (!cookie) throw new Error('login did not return cookie');
    const res = await fetch('/api/schema/export', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
  });
});
```

(Look at `apps/cms/server/api/content-types/content-types.test.ts` for the canonical session-login pattern in this codebase — adapt if the snippet above doesn't compile.)

- [ ] **Step 2: Run, verify FAIL**

```bash
pnpm --filter cms exec vitest run --project integration server/api/schema/schema.test.ts
```

Expected: fail (endpoint doesn't exist; 404).

- [ ] **Step 3: Create the endpoint**

`apps/cms/server/api/schema/export.get.ts`:

```ts
import { defineEventHandler } from 'h3';
import { exportBundle } from '../../../scripts/content-bundle/export';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'schema:read');
  const bundle = await exportBundle(prisma, {
    mode: 'schema',
    portable: true,
  });
  return bundle;
});
```

(`prisma` is auto-imported in server routes; `mode: 'schema'` excludes entries.)

- [ ] **Step 4: Run, verify GREEN**

```bash
pnpm --filter cms exec vitest run --project integration server/api/schema/schema.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/schema/export.get.ts apps/cms/server/api/schema/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /api/schema/export — portable bundle endpoint

Returns the current schema as a portable Bundle. Session OR API key
with schema:read. Powers `boject schema pull` and `boject schema check`.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `POST /api/schema/apply` endpoint

The HTTP shim around `applySchema`. Session OR API key with `schema:write`. Honours `BOJECT_SCHEMA_READONLY`. Translates applier exceptions to HTTP responses.

**Files:**

- Create: `apps/cms/server/api/schema/apply.post.ts`
- Modify: `apps/cms/server/api/schema/schema.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `schema.test.ts` (inside the same outer file, new `describe` block):

```ts
describe('POST /api/schema/apply', () => {
  beforeEach(async () => {
    await prisma.contentEntry.deleteMany();
    await prisma.contentTypeField.deleteMany();
    await prisma.contentType.deleteMany();
  });

  afterEach(async () => {
    await prisma.apiKey.deleteMany({
      where: { name: { startsWith: 'test-' } },
    });
  });

  const SAMPLE: { bundle: unknown } = {
    bundle: {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'ApiApplyArticle',
          name: 'ApiApplyArticle',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    },
  };

  it('returns 401 without auth', async () => {
    const res = await fetch('/api/schema/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SAMPLE),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 INSUFFICIENT_SCOPE for a key without schema:write', async () => {
    const key = await makeKey(['schema:read']);
    const res = await fetch('/api/schema/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(SAMPLE),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.data.error).toBe('INSUFFICIENT_SCOPE');
  });

  it('returns 200 with apply result on success (api key)', async () => {
    const key = await makeKey(['schema:write']);
    const res = await fetch('/api/schema/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(SAMPLE),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changed).toBe(true);
    expect(body.applied.contentTypesCreated).toBe(1);
    const inDb = await prisma.contentType.findUnique({
      where: { identifier: 'ApiApplyArticle' },
    });
    expect(inDb).not.toBeNull();
  });

  it('returns 400 BUNDLE_INVALID for a malformed bundle', async () => {
    const key = await makeKey(['schema:write']);
    const res = await fetch('/api/schema/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        bundle: {
          version: 2,
          exportedAt: 'x',
          portable: true,
          contentTypes: [{ identifier: 'X' }],
        },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data.error).toBe('BUNDLE_INVALID');
    expect(Array.isArray(body.data.errors)).toBe(true);
  });

  it('returns 400 SCHEMA_APPLY_BLOCKED with blockers and plan', async () => {
    // Seed a type + entry, then send an empty bundle without
    // allowDestructive — the planner blocks the removal.
    await prisma.contentType.create({
      data: {
        identifier: 'BlockedType',
        name: 'BlockedType',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
            },
          ],
        },
      },
    });
    const ct = await prisma.contentType.findUniqueOrThrow({
      where: { identifier: 'BlockedType' },
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
    const key = await makeKey(['schema:write']);
    const res = await fetch('/api/schema/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        bundle: {
          version: 2,
          exportedAt: '2026-05-01T00:00:00.000Z',
          portable: true,
          contentTypes: [],
        },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data.error).toBe('SCHEMA_APPLY_BLOCKED');
    expect(Array.isArray(body.data.blockers)).toBe(true);
    expect(body.data.blockers[0].code).toBe(
      'CONTENT_TYPE_REMOVAL_WITH_ENTRIES'
    );
  });

  it('honours dryRun in the body — returns success without mutating', async () => {
    const key = await makeKey(['schema:write']);
    const res = await fetch('/api/schema/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ ...SAMPLE, dryRun: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changed).toBe(true);
    expect(body.applied.contentTypesCreated).toBe(1);
    const inDb = await prisma.contentType.findUnique({
      where: { identifier: 'ApiApplyArticle' },
    });
    expect(inDb).toBeNull();
  });

  it('returns 403 SCHEMA_READONLY when the readonly flag is on', async () => {
    process.env.BOJECT_SCHEMA_READONLY = 'true';
    try {
      const key = await makeKey(['schema:write']);
      const res = await fetch('/api/schema/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(SAMPLE),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.data.error).toBe('SCHEMA_READONLY');
    } finally {
      delete process.env.BOJECT_SCHEMA_READONLY;
    }
  });
});
```

NOTE: The `BOJECT_SCHEMA_READONLY` test depends on whether `useRuntimeConfig` snapshots the env at startup or reads it per-request. If the existing readonly tests in `apps/cms/server/api/content-types/content-types.test.ts` (or wherever Spec 1 added them) work via env flipping, mirror that pattern. If they require a separate Nuxt `setup()` call, do the same here. The simplest fallback: read `process.env.BOJECT_SCHEMA_READONLY` directly in the apply handler instead of going through `useRuntimeConfig` — see Step 3.

- [ ] **Step 2: Run, verify FAIL**

```bash
pnpm --filter cms exec vitest run --project integration server/api/schema/schema.test.ts
```

Expected: fail.

- [ ] **Step 3: Create the apply endpoint**

`apps/cms/server/api/schema/apply.post.ts`:

```ts
import { defineEventHandler, readBody, createError } from 'h3';
import { applySchema } from '../../../scripts/content-bundle/applySchema';
import {
  SchemaApplyValidationError,
  SchemaApplyBlockedError,
  SchemaChangedDuringApplyError,
} from '../../../scripts/content-bundle/applySchemaErrors';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';
import { assertSchemaEditable } from '../../utils/schemaReadOnly';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

interface ApplyRequestBody {
  bundle?: unknown;
  allowDestructive?: boolean;
  dryRun?: boolean;
}

export default defineEventHandler(async (event) => {
  assertSchemaEditable(event);
  assertApiKeyScope(event, 'schema:write');
  enforceMutationRateLimit(event, 'schema-apply');

  const body = (await readBody<ApplyRequestBody>(event)) ?? {};
  if (!body.bundle || typeof body.bundle !== 'object') {
    throw createError({
      statusCode: 400,
      data: { error: 'BAD_REQUEST', message: 'Body must include `bundle`.' },
    });
  }

  try {
    const result = await applySchema(prisma, body.bundle as never, {
      allowDestructive: body.allowDestructive === true,
      dryRun: body.dryRun === true,
    });
    return result;
  } catch (err) {
    if (err instanceof SchemaApplyValidationError) {
      throw createError({
        statusCode: 400,
        data: { error: err.code, errors: err.errors },
      });
    }
    if (err instanceof SchemaApplyBlockedError) {
      throw createError({
        statusCode: 400,
        data: { error: err.code, blockers: err.blockers, plan: err.plan },
      });
    }
    if (err instanceof SchemaChangedDuringApplyError) {
      throw createError({
        statusCode: 409,
        data: { error: err.code },
      });
    }
    throw err;
  }
});
```

- [ ] **Step 4: Run, verify GREEN**

```bash
pnpm --filter cms exec vitest run --project integration server/api/schema/schema.test.ts
```

Expected: every test in both `describe` blocks (export + apply) passes.

If the SCHEMA_READONLY env-flip test fails because `useRuntimeConfig` is cached: read the env var directly in `assertSchemaEditable` for now (or restructure the test to set the env before `setup()`). The fall-back approach is to read `process.env.BOJECT_SCHEMA_READONLY` directly — which is what the entrypoint applier does, so the patterns are consistent.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/schema/apply.post.ts apps/cms/server/api/schema/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /api/schema/apply — HTTP wrapper around applySchema

Translates applier exceptions to HTTP shapes:
- BUNDLE_INVALID         → 400 with errors[]
- SCHEMA_APPLY_BLOCKED   → 400 with blockers[] and plan
- SCHEMA_CHANGED_DURING_APPLY → 409
- DRY_RUN_ROLLBACK is internal — never bubbles up.

Honours BOJECT_SCHEMA_READONLY (Spec 1) and requires schema:write
when authed via API key. Body shape: { bundle, allowDestructive?,
dryRun? }.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: CLI — `loadProjectConfig` walks up to find `.boject.config.json`

Pure-ish helper (with an injectable `fs` shim) that finds and parses the project config.

**Files:**

- Create: `packages/boject-cli/src/config.ts`
- Create: `packages/boject-cli/tests/unit/config.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/boject-cli/tests/unit/config.test.ts`:

```ts
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProjectConfig } from '../../src/config.js';

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-cli-config-'));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('loadProjectConfig', () => {
  it('finds .boject.config.json in the cwd', async () => {
    await writeFile(
      join(workDir, '.boject.config.json'),
      JSON.stringify({
        cms: { url: 'http://localhost:4000' },
        schema: { path: 'content-types/schema.boject.json' },
      })
    );
    const result = await loadProjectConfig(workDir);
    expect(result.config.cms.url).toBe('http://localhost:4000');
    expect(result.config.schema.path).toBe('content-types/schema.boject.json');
    expect(result.configPath).toBe(join(workDir, '.boject.config.json'));
  });

  it('walks up to find .boject.config.json from a subdirectory', async () => {
    await writeFile(
      join(workDir, '.boject.config.json'),
      JSON.stringify({
        cms: { url: 'http://localhost:4000' },
        schema: { path: 'content-types/schema.boject.json' },
      })
    );
    const sub = join(workDir, 'apps', 'cms', 'server');
    await mkdir(sub, { recursive: true });
    const result = await loadProjectConfig(sub);
    expect(result.configPath).toBe(join(workDir, '.boject.config.json'));
  });

  it('throws when no config is found', async () => {
    await expect(loadProjectConfig(workDir)).rejects.toThrow(
      /No .boject.config.json/
    );
  });

  it('throws when the config is invalid JSON', async () => {
    await writeFile(join(workDir, '.boject.config.json'), '{invalid');
    await expect(loadProjectConfig(workDir)).rejects.toThrow(/parse/i);
  });

  it('throws when required fields are missing', async () => {
    await writeFile(
      join(workDir, '.boject.config.json'),
      JSON.stringify({ cms: { url: 'http://localhost:4000' } })
    );
    await expect(loadProjectConfig(workDir)).rejects.toThrow(/schema\.path/);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
pnpm --filter @boject/cli exec vitest run tests/unit/config.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create the helper**

`packages/boject-cli/src/config.ts`:

```ts
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface ProjectConfig {
  cms: { url: string };
  schema: { path: string };
}

export interface LoadResult {
  config: ProjectConfig;
  configPath: string;
}

const FILENAME = '.boject.config.json';

/**
 * Walk up from `cwd` looking for .boject.config.json. Returns the
 * parsed config and the absolute path it was loaded from. Throws if
 * no config is found, parsing fails, or required keys are missing.
 */
export async function loadProjectConfig(cwd: string): Promise<LoadResult> {
  let dir = cwd;
  // Bound the walk by the filesystem root.
  while (true) {
    const candidate = join(dir, FILENAME);
    try {
      await stat(candidate);
      const raw = await readFile(candidate, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(
          `Failed to parse ${candidate}: ${(err as Error).message}`
        );
      }
      return {
        config: validateConfig(parsed, candidate),
        configPath: candidate,
      };
    } catch (err) {
      // ENOENT — keep walking. Other errors (permission, invalid JSON
      // already handled above) bubble up.
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code?: string }).code !== 'ENOENT'
      ) {
        throw err;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `No .boject.config.json found in ${cwd} or any parent directory.`
      );
    }
    dir = parent;
  }
}

function validateConfig(parsed: unknown, path: string): ProjectConfig {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${path}: top-level value must be an object`);
  }
  const obj = parsed as Record<string, unknown>;
  const cms = obj.cms as { url?: unknown } | undefined;
  if (!cms || typeof cms.url !== 'string' || cms.url.length === 0) {
    throw new Error(`${path}: missing or invalid cms.url`);
  }
  const schema = obj.schema as { path?: unknown } | undefined;
  if (!schema || typeof schema.path !== 'string' || schema.path.length === 0) {
    throw new Error(`${path}: missing or invalid schema.path`);
  }
  return { cms: { url: cms.url }, schema: { path: schema.path } };
}
```

- [ ] **Step 4: Run, verify GREEN**

```bash
pnpm --filter @boject/cli exec vitest run tests/unit/config.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/boject-cli/src/config.ts packages/boject-cli/tests/unit/config.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): loadProjectConfig walks up from CWD to find .boject.config.json

Mirror of how Prettier/ESLint/Vitest find their configs. The CLI
will use this for all four schema commands so a developer running
`boject schema pull` from a subdirectory still picks up the project
root's config.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: CLI — HTTP client (`api.ts`)

Tiny `fetch` wrappers for the two endpoints. Uniform error handling so commands can switch on `error.code`.

**Files:**

- Create: `packages/boject-cli/src/api.ts`
- Create: `packages/boject-cli/src/types.ts` (minimal Bundle types — see Cross-Cutting Notes)

- [ ] **Step 1: Define the minimal types**

`packages/boject-cli/src/types.ts`:

```ts
// Minimal duplication of apps/cms/scripts/content-bundle/types.ts —
// the CLI is published standalone and cannot depend on Nuxt-side
// modules. Keep this file in sync with the canonical types when
// they change.

export interface BundleField {
  id: string | null;
  identifier: string;
  name: string;
  type: string; // FieldType — keep loose at the CLI layer
  required: boolean;
  unique?: boolean;
  order: number;
  options: Record<string, unknown> | null;
}

export interface BundleContentType {
  id: string | null;
  identifier: string;
  name: string;
  description: string | null;
  fields: BundleField[];
}

export interface Bundle {
  version: number;
  exportedAt: string;
  portable: boolean;
  contentTypes?: BundleContentType[];
  entries?: unknown[];
}

export interface ApplySchemaResultLike {
  changed: boolean;
  applied: {
    contentTypesCreated: number;
    contentTypesUpdated: number;
    contentTypesRemoved: number;
    fieldsCreated: number;
    fieldsUpdated: number;
    fieldsRemoved: number;
  };
  plan?: unknown;
}

export interface BlockerLike {
  code: string;
  message: string;
  path: string;
}
```

- [ ] **Step 2: Create the HTTP client**

`packages/boject-cli/src/api.ts`:

```ts
import type { ApplySchemaResultLike, BlockerLike, Bundle } from './types.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly data?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface ApiContext {
  baseUrl: string;
  apiKey: string;
}

/**
 * Wrap fetch so transport / non-2xx errors come back as HttpError
 * with a code field the CLI commands can switch on. The server
 * returns { error, ... } payloads under `data.<error>` — we flatten
 * that to top-level for ergonomics.
 */
async function callJson<T>(
  ctx: ApiContext,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const data =
      (parsed && typeof parsed === 'object' && 'data' in parsed
        ? (parsed as { data: unknown }).data
        : parsed) ?? null;
    const code =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: string }).error)
        : `HTTP_${res.status}`;
    const message =
      (parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message: string }).message)
        : null) ?? `${method} ${path} returned ${res.status}`;
    throw new HttpError(res.status, code, message, data);
  }
  return parsed as T;
}

export function getSchemaBundle(ctx: ApiContext): Promise<Bundle> {
  return callJson<Bundle>(ctx, 'GET', '/api/schema/export');
}

export interface ApplyArgs {
  bundle: Bundle;
  allowDestructive?: boolean;
  dryRun?: boolean;
}

export function applySchemaRemote(
  ctx: ApiContext,
  args: ApplyArgs
): Promise<ApplySchemaResultLike> {
  return callJson<ApplySchemaResultLike>(
    ctx,
    'POST',
    '/api/schema/apply',
    args
  );
}

export type { Bundle, ApplySchemaResultLike, BlockerLike };
```

- [ ] **Step 3: Sanity check (no test yet — exercised via command tests)**

```bash
pnpm --filter @boject/cli typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/boject-cli/src/api.ts packages/boject-cli/src/types.ts
git commit -m "$(cat <<'EOF'
feat(cli): tiny HTTP client for /api/schema/{export,apply}

callJson wraps fetch with structured HttpError so each command can
switch on .code (BUNDLE_INVALID, SCHEMA_APPLY_BLOCKED, etc.) without
re-implementing parsing. Bundle types are duplicated locally — the
CLI is published standalone and can't import from apps/cms/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: CLI — `boject schema pull`

Fetches the bundle, writes it to disk.

**Files:**

- Create: `packages/boject-cli/src/commands/schemaPull.ts`
- Create: `packages/boject-cli/tests/unit/schemaPull.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/boject-cli/tests/unit/schemaPull.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { runSchemaPull } from '../../src/commands/schemaPull.js';

let server: Server;
let port: number;
const responder: { value: (req: Request) => Response } = {
  value: () => new Response('not configured', { status: 500 }),
};

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) headers.set(k, v.join(','));
      else if (typeof v === 'string') headers.set(k, v);
    }
    const url = `http://localhost${req.url ?? '/'}`;
    const request = new Request(url, { method: req.method, headers });
    const response = await responder.value(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no addr');
  port = addr.port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-pull-'));
  await writeFile(
    join(workDir, '.boject.config.json'),
    JSON.stringify({
      cms: { url: `http://localhost:${port}` },
      schema: { path: 'content-types/schema.boject.json' },
    })
  );
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const lines: string[] = [];
const stdout = (l: string) => lines.push(l);
const stderr = (l: string) => lines.push(l);

beforeEach(() => {
  lines.length = 0;
});

describe('runSchemaPull', () => {
  it('writes the response body to <project>/<schema.path>', async () => {
    const bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'X',
          name: 'X',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'name',
              name: 'Name',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };
    responder.value = () =>
      new Response(JSON.stringify(bundle), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const result = await runSchemaPull({
      cwd: workDir,
      apiKey: 'boject_test_key',
      stdout,
      stderr,
    });
    expect(result.exitCode).toBe(0);
    const written = await readFile(
      join(workDir, 'content-types/schema.boject.json'),
      'utf8'
    );
    expect(JSON.parse(written)).toEqual(bundle);
  });

  it('exits 1 when the API returns 401', async () => {
    responder.value = () =>
      new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
      });
    const result = await runSchemaPull({
      cwd: workDir,
      apiKey: 'boject_bad',
      stdout,
      stderr,
    });
    expect(result.exitCode).toBe(1);
    expect(lines.some((l) => /401|unauthor/i.test(l))).toBe(true);
  });

  it('exits 1 with a clear message when no .boject.config.json is present', async () => {
    await rm(join(workDir, '.boject.config.json'));
    const result = await runSchemaPull({
      cwd: workDir,
      apiKey: 'boject_test_key',
      stdout,
      stderr,
    });
    expect(result.exitCode).toBe(1);
    expect(lines.some((l) => /\.boject\.config\.json/.test(l))).toBe(true);
  });

  it('honours --out and --url flags overriding config', async () => {
    responder.value = () =>
      new Response(
        JSON.stringify({
          version: 2,
          exportedAt: 'x',
          portable: true,
          contentTypes: [],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    await mkdir(join(workDir, 'custom'), { recursive: true });
    const result = await runSchemaPull({
      cwd: workDir,
      apiKey: 'boject_test_key',
      flags: { out: 'custom/out.json', url: `http://localhost:${port}` },
      stdout,
      stderr,
    });
    expect(result.exitCode).toBe(0);
    const written = await readFile(join(workDir, 'custom/out.json'), 'utf8');
    expect(JSON.parse(written).version).toBe(2);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
pnpm --filter @boject/cli exec vitest run tests/unit/schemaPull.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create the command**

`packages/boject-cli/src/commands/schemaPull.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { loadProjectConfig } from '../config.js';
import { getSchemaBundle, HttpError } from '../api.js';

export interface SchemaPullFlags {
  out?: string;
  url?: string;
}

export interface SchemaPullParams {
  cwd: string;
  apiKey: string | undefined;
  flags?: SchemaPullFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface SchemaPullResult {
  exitCode: 0 | 1;
}

export async function runSchemaPull(
  params: SchemaPullParams
): Promise<SchemaPullResult> {
  const flags = params.flags ?? {};

  if (!params.apiKey) {
    params.stderr('Error: BOJECT_API_KEY is not set.');
    return { exitCode: 1 };
  }

  let config: Awaited<ReturnType<typeof loadProjectConfig>>;
  try {
    config = await loadProjectConfig(params.cwd);
  } catch (err) {
    params.stderr(`Error: ${(err as Error).message}`);
    return { exitCode: 1 };
  }

  const url = flags.url ?? config.config.cms.url;
  const outRel = flags.out ?? config.config.schema.path;
  const outAbs = isAbsolute(outRel)
    ? outRel
    : resolve(dirname(config.configPath), outRel);

  let bundle: Awaited<ReturnType<typeof getSchemaBundle>>;
  try {
    bundle = await getSchemaBundle({ baseUrl: url, apiKey: params.apiKey });
  } catch (err) {
    if (err instanceof HttpError) {
      params.stderr(`Error: ${err.status} ${err.code} — ${err.message}`);
    } else {
      params.stderr(`Error: ${(err as Error).message}`);
    }
    return { exitCode: 1 };
  }

  await mkdir(dirname(outAbs), { recursive: true });
  const body = JSON.stringify(bundle, null, 2) + '\n';
  await writeFile(outAbs, body);

  const types = bundle.contentTypes?.length ?? 0;
  const fields =
    bundle.contentTypes?.reduce((sum, ct) => sum + ct.fields.length, 0) ?? 0;
  params.stdout(`✓ Pulled schema from ${url}`);
  params.stdout(
    `  ${types} content type${types === 1 ? '' : 's'}, ${fields} field${fields === 1 ? '' : 's'}`
  );
  params.stdout(`  Wrote ${outAbs} (${Buffer.byteLength(body)} bytes)`);
  return { exitCode: 0 };
}
```

- [ ] **Step 4: Run, verify GREEN**

```bash
pnpm --filter @boject/cli exec vitest run tests/unit/schemaPull.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/boject-cli/src/commands/schemaPull.ts packages/boject-cli/tests/unit/schemaPull.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): boject schema pull — fetch bundle, write to disk

Loads .boject.config.json, GETs /api/schema/export with the API key
from BOJECT_API_KEY, writes the response body verbatim to the
configured schema path. --out and --url override the config.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: CLI — `boject schema validate` (offline)

Reads the file, validates the bundle shape, runs the planner against an empty snapshot to surface cross-reference issues. No network.

**Files:**

- Create: `packages/boject-cli/src/commands/schemaValidate.ts`
- Create: `packages/boject-cli/src/vendor/validateBundle.ts` (vendored from `apps/cms/scripts/content-bundle/validate.ts`)
- Create: `packages/boject-cli/src/vendor/planSchema.ts` (vendored from `apps/cms/scripts/content-bundle/planSchema.ts`)
- Create: `packages/boject-cli/tests/unit/schemaValidate.test.ts`

- [ ] **Step 1: Vendor the validator + planner**

The CLI cannot depend on `apps/cms/` for type / runtime reasons (separate publish boundary, no `#prisma` alias). Copy the two pure modules verbatim:

```bash
cp apps/cms/scripts/content-bundle/validate.ts packages/boject-cli/src/vendor/validateBundle.ts
cp apps/cms/scripts/content-bundle/planSchema.ts packages/boject-cli/src/vendor/planSchema.ts
cp apps/cms/scripts/content-bundle/schemaPlan.types.ts packages/boject-cli/src/vendor/schemaPlan.types.ts
cp apps/cms/scripts/content-bundle/types.ts packages/boject-cli/src/vendor/contentBundleTypes.ts
```

Update imports inside the vendored files so they resolve locally (e.g. `from './schemaPlan.types'` instead of `'./schemaPlan.types'` — the relative paths should already work after the copy, but check). The `planSchema.ts` imports `effectiveBundleUnique` from `schemaPlan.types.ts` — verify that path is fine.

The `apps/cms/scripts/content-bundle/types.ts` imports from `#prisma`. After copy, replace those `#prisma` imports with type-only string-literal aliases:

```ts
// Was: import type { ContentStatus, FieldType } from '#prisma';
export type FieldType =
  | 'ENTRY_TITLE'
  | 'SLUG'
  | 'TEXT'
  | 'TEXTAREA'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'DATETIME'
  | 'SELECT'
  | 'RICHTEXT'
  | 'RELATION'
  | 'MULTIRELATION'
  | 'IMAGE';
export type ContentStatus = 'DRAFT' | 'PUBLISHED' | 'CHANGED' | 'ARCHIVED';
```

This makes the vendored copy self-contained.

Add a header comment to each file:

```ts
// VENDORED from apps/cms/scripts/content-bundle/<file>.ts.
// The CLI is published standalone and cannot import from apps/cms/.
// Keep this file in sync when the canonical version changes.
```

- [ ] **Step 2: Write the failing tests**

`packages/boject-cli/tests/unit/schemaValidate.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runSchemaValidate } from '../../src/commands/schemaValidate.js';

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-validate-'));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const lines: string[] = [];
const stdout = (l: string) => lines.push(l);
const stderr = (l: string) => lines.push(l);
beforeEach(() => {
  lines.length = 0;
});

const VALID_BUNDLE = {
  version: 2,
  exportedAt: '2026-05-01T00:00:00.000Z',
  portable: true,
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
          type: 'ENTRY_TITLE',
          required: true,
          order: 0,
          options: null,
        },
      ],
    },
  ],
};

describe('runSchemaValidate', () => {
  it('exits 0 for a structurally-sound bundle', async () => {
    const path = join(workDir, 'schema.boject.json');
    await writeFile(path, JSON.stringify(VALID_BUNDLE));
    const r = await runSchemaValidate({ path, stdout, stderr });
    expect(r.exitCode).toBe(0);
    expect(lines.some((l) => l.includes('Bundle valid'))).toBe(true);
  });

  it('exits 1 with errors for a bundle missing a required field', async () => {
    const path = join(workDir, 'schema.boject.json');
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        exportedAt: 'x',
        portable: true,
        contentTypes: [{ identifier: 'X' /* no fields! */ }],
      })
    );
    const r = await runSchemaValidate({ path, stdout, stderr });
    expect(r.exitCode).toBe(1);
    expect(lines.some((l) => /invalid|fields/i.test(l))).toBe(true);
  });

  it('exits 1 for a RELATION pointing at a missing target type', async () => {
    const path = join(workDir, 'schema.boject.json');
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
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
                type: 'ENTRY_TITLE',
                required: true,
                order: 0,
                options: null,
              },
              {
                id: null,
                identifier: 'author',
                name: 'Author',
                type: 'RELATION',
                required: false,
                order: 1,
                options: {
                  targetContentTypeIds: [null],
                  targetContentTypeIdentifiers: ['Auther'],
                },
              },
            ],
          },
        ],
      })
    );
    const r = await runSchemaValidate({ path, stdout, stderr });
    expect(r.exitCode).toBe(1);
    expect(lines.some((l) => /Auther|target/i.test(l))).toBe(true);
  });
});
```

- [ ] **Step 3: Run, verify FAIL**

```bash
pnpm --filter @boject/cli exec vitest run tests/unit/schemaValidate.test.ts
```

Expected: module not found.

- [ ] **Step 4: Create the command**

`packages/boject-cli/src/commands/schemaValidate.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { loadProjectConfig } from '../config.js';
import { validateBundle } from '../vendor/validateBundle.js';
import { planSchema } from '../vendor/planSchema.js';
import type { Bundle } from '../vendor/contentBundleTypes.js';

export interface SchemaValidateParams {
  cwd?: string;
  path?: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface SchemaValidateResult {
  exitCode: 0 | 1;
}

const EMPTY_SNAPSHOT = {
  contentTypes: [],
  fieldUsage: new Map(),
};

export async function runSchemaValidate(
  params: SchemaValidateParams
): Promise<SchemaValidateResult> {
  let path = params.path;
  if (!path) {
    if (!params.cwd) {
      params.stderr(
        'Error: pass a path or run from inside a project with .boject.config.json'
      );
      return { exitCode: 1 };
    }
    let config: Awaited<ReturnType<typeof loadProjectConfig>>;
    try {
      config = await loadProjectConfig(params.cwd);
    } catch (err) {
      params.stderr(`Error: ${(err as Error).message}`);
      return { exitCode: 1 };
    }
    path = isAbsolute(config.config.schema.path)
      ? config.config.schema.path
      : resolve(dirname(config.configPath), config.config.schema.path);
  }

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    params.stderr(`Error reading ${path}: ${(err as Error).message}`);
    return { exitCode: 1 };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    params.stderr(`Error parsing ${path}: ${(err as Error).message}`);
    return { exitCode: 1 };
  }

  const v = validateBundle(parsed as Bundle);
  if (!v.ok) {
    params.stderr('✗ Bundle invalid');
    for (const e of v.errors) {
      params.stderr(`  - ${e.path}: ${e.message}`);
    }
    return { exitCode: 1 };
  }

  // Run the planner against an empty snapshot to surface cross-ref bugs.
  const plan = planSchema(parsed as Bundle, EMPTY_SNAPSHOT, {});
  if (plan.blockers.length > 0) {
    params.stderr('✗ Bundle invalid');
    for (const b of plan.blockers) {
      params.stderr(`  - ${b.code} at ${b.path}: ${b.message}`);
    }
    return { exitCode: 1 };
  }

  const types = (parsed as Bundle).contentTypes?.length ?? 0;
  const fields =
    (parsed as Bundle).contentTypes?.reduce(
      (sum, ct) => sum + ct.fields.length,
      0
    ) ?? 0;
  params.stdout(`✓ Bundle valid`);
  params.stdout(
    `  ${types} content type${types === 1 ? '' : 's'}, ${fields} field${fields === 1 ? '' : 's'}, 0 cross-reference issues`
  );
  return { exitCode: 0 };
}
```

(Note on `EMPTY_SNAPSHOT`: the planner type wants a richer `CurrentSchemaSnapshot`. The vendored `schemaPlan.types.ts` has the exact shape — match it. If TS complains, add the missing fields with empty values.)

- [ ] **Step 5: Run, verify GREEN**

```bash
pnpm --filter @boject/cli exec vitest run tests/unit/schemaValidate.test.ts
```

Expected: 3/3 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/boject-cli/src/commands/schemaValidate.ts packages/boject-cli/src/vendor packages/boject-cli/tests/unit/schemaValidate.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): boject schema validate — offline bundle validation

Vendors validateBundle + planSchema (pure modules, no Nuxt/Prisma)
into the CLI so the command can run against a file with no network.
Runs the planner against an empty snapshot to surface cross-reference
bugs (RELATION targets not declared in the same bundle).

Suitable for pre-commit hooks. Keep vendored files in sync when the
canonical apps/cms/scripts/content-bundle/* versions change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: CLI — `boject schema apply`

Pushes the local bundle to the CMS. `--dry-run` invokes the endpoint's `dryRun` body flag. On `SCHEMA_CHANGED_DURING_APPLY`, retry once.

**Files:**

- Create: `packages/boject-cli/src/commands/schemaApply.ts`
- Create: `packages/boject-cli/tests/unit/schemaApply.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/boject-cli/tests/unit/schemaApply.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { runSchemaApply } from '../../src/commands/schemaApply.js';

let server: Server;
let port: number;
const handler: {
  value: (
    req: import('node:http').IncomingMessage
  ) => Promise<{ status: number; body: unknown }>;
} = {
  value: async () => ({ status: 500, body: 'not configured' }),
};
const requests: Array<{ method: string; url: string; body: unknown }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c.toString()));
    req.on('end', async () => {
      let body: unknown;
      try {
        body = raw.length ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      requests.push({ method: req.method ?? '', url: req.url ?? '', body });
      const r = await handler.value(req);
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no addr');
  port = addr.port;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let workDir: string;
const lines: string[] = [];
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-apply-'));
  await writeFile(
    join(workDir, '.boject.config.json'),
    JSON.stringify({
      cms: { url: `http://localhost:${port}` },
      schema: { path: 'schema.boject.json' },
    })
  );
  await writeFile(
    join(workDir, 'schema.boject.json'),
    JSON.stringify({
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [],
    })
  );
  requests.length = 0;
  lines.length = 0;
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const stdout = (l: string) => lines.push(l);
const stderr = (l: string) => lines.push(l);

describe('runSchemaApply', () => {
  it('POSTs the bundle and prints the apply result on success', async () => {
    handler.value = async () => ({
      status: 200,
      body: {
        changed: true,
        applied: {
          contentTypesCreated: 0,
          contentTypesUpdated: 1,
          contentTypesRemoved: 0,
          fieldsCreated: 2,
          fieldsUpdated: 0,
          fieldsRemoved: 0,
        },
      },
    });
    const r = await runSchemaApply({
      cwd: workDir,
      apiKey: 'k',
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.url).toBe('/api/schema/apply');
    expect(lines.some((l) => l.includes('1 content type updated'))).toBe(true);
    expect(lines.some((l) => l.includes('2 fields created'))).toBe(true);
  });

  it('passes dryRun: true in the body when --dry-run is set', async () => {
    handler.value = async () => ({
      status: 200,
      body: {
        changed: false,
        applied: {
          contentTypesCreated: 0,
          contentTypesUpdated: 0,
          contentTypesRemoved: 0,
          fieldsCreated: 0,
          fieldsUpdated: 0,
          fieldsRemoved: 0,
        },
      },
    });
    await runSchemaApply({
      cwd: workDir,
      apiKey: 'k',
      flags: { dryRun: true },
      stdout,
      stderr,
    });
    const reqBody = requests[0]!.body as { dryRun?: boolean };
    expect(reqBody.dryRun).toBe(true);
  });

  it('renders blockers and exits 1 on SCHEMA_APPLY_BLOCKED', async () => {
    handler.value = async () => ({
      status: 400,
      body: {
        data: {
          error: 'SCHEMA_APPLY_BLOCKED',
          blockers: [
            {
              code: 'CONTENT_TYPE_REMOVAL_WITH_ENTRIES',
              message: 'Tag has 4 entries',
              path: 'contentTypes.Tag',
            },
          ],
        },
      },
    });
    const r = await runSchemaApply({
      cwd: workDir,
      apiKey: 'k',
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(
      lines.some((l) => l.includes('CONTENT_TYPE_REMOVAL_WITH_ENTRIES'))
    ).toBe(true);
    expect(lines.some((l) => l.includes('Tag has 4 entries'))).toBe(true);
  });

  it('retries once on SCHEMA_CHANGED_DURING_APPLY (409)', async () => {
    let calls = 0;
    handler.value = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 409,
          body: { data: { error: 'SCHEMA_CHANGED_DURING_APPLY' } },
        };
      }
      return {
        status: 200,
        body: {
          changed: true,
          applied: {
            contentTypesCreated: 0,
            contentTypesUpdated: 0,
            contentTypesRemoved: 0,
            fieldsCreated: 0,
            fieldsUpdated: 0,
            fieldsRemoved: 0,
          },
        },
      };
    };
    const r = await runSchemaApply({
      cwd: workDir,
      apiKey: 'k',
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(0);
    expect(requests).toHaveLength(2);
  });

  it('exits 1 if SCHEMA_CHANGED_DURING_APPLY persists across retry', async () => {
    handler.value = async () => ({
      status: 409,
      body: { data: { error: 'SCHEMA_CHANGED_DURING_APPLY' } },
    });
    const r = await runSchemaApply({
      cwd: workDir,
      apiKey: 'k',
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(requests).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
pnpm --filter @boject/cli exec vitest run tests/unit/schemaApply.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create the command**

`packages/boject-cli/src/commands/schemaApply.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { loadProjectConfig } from '../config.js';
import { applySchemaRemote, HttpError } from '../api.js';
import type { Bundle, BlockerLike } from '../types.js';

export interface SchemaApplyFlags {
  path?: string;
  url?: string;
  allowDestructive?: boolean;
  dryRun?: boolean;
}

export interface SchemaApplyParams {
  cwd: string;
  apiKey: string | undefined;
  flags?: SchemaApplyFlags;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface SchemaApplyResult {
  exitCode: 0 | 1;
}

export async function runSchemaApply(
  params: SchemaApplyParams
): Promise<SchemaApplyResult> {
  const flags = params.flags ?? {};
  if (!params.apiKey) {
    params.stderr('Error: BOJECT_API_KEY is not set.');
    return { exitCode: 1 };
  }

  let config: Awaited<ReturnType<typeof loadProjectConfig>>;
  try {
    config = await loadProjectConfig(params.cwd);
  } catch (err) {
    params.stderr(`Error: ${(err as Error).message}`);
    return { exitCode: 1 };
  }

  const url = flags.url ?? config.config.cms.url;
  const pathRel = flags.path ?? config.config.schema.path;
  const pathAbs = isAbsolute(pathRel)
    ? pathRel
    : resolve(dirname(config.configPath), pathRel);

  let raw: string;
  try {
    raw = await readFile(pathAbs, 'utf8');
  } catch (err) {
    params.stderr(`Error reading ${pathAbs}: ${(err as Error).message}`);
    return { exitCode: 1 };
  }
  let bundle: Bundle;
  try {
    bundle = JSON.parse(raw) as Bundle;
  } catch (err) {
    params.stderr(`Error parsing ${pathAbs}: ${(err as Error).message}`);
    return { exitCode: 1 };
  }

  const ctx = { baseUrl: url, apiKey: params.apiKey };
  const args = {
    bundle,
    allowDestructive: flags.allowDestructive === true,
    dryRun: flags.dryRun === true,
  };

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      const result = await applySchemaRemote(ctx, args);
      printApplyResult(result, params.stdout, flags.dryRun === true);
      return { exitCode: 0 };
    } catch (err) {
      if (
        err instanceof HttpError &&
        err.code === 'SCHEMA_CHANGED_DURING_APPLY' &&
        attempt === 1
      ) {
        params.stdout('Schema changed during apply — retrying once...');
        continue;
      }
      printApplyError(err, params.stderr);
      return { exitCode: 1 };
    }
  }
}

function printApplyResult(
  result: { changed: boolean; applied: Record<string, number> },
  stdout: (l: string) => void,
  dryRun: boolean
): void {
  const banner = dryRun ? '✓ Dry run' : '✓ Applied';
  if (!result.changed) {
    stdout(`${banner} — no changes.`);
    return;
  }
  const a = result.applied;
  stdout(banner);
  for (const [label, n] of [
    ['content type created', a.contentTypesCreated],
    ['content type updated', a.contentTypesUpdated],
    ['content type removed', a.contentTypesRemoved],
    ['field created', a.fieldsCreated],
    ['field updated', a.fieldsUpdated],
    ['field removed', a.fieldsRemoved],
  ] as const) {
    if (n === 0) continue;
    stdout(`  ${n} ${label}${n === 1 ? '' : label.endsWith('y') ? '' : 's'}`);
  }
}

function printApplyError(err: unknown, stderr: (l: string) => void): void {
  if (err instanceof HttpError && err.code === 'SCHEMA_APPLY_BLOCKED') {
    stderr('✗ Apply blocked');
    const data = err.data as { blockers?: BlockerLike[] } | null;
    for (const b of data?.blockers ?? []) {
      stderr(`  - ${b.code} at ${b.path}: ${b.message}`);
    }
    return;
  }
  if (err instanceof HttpError && err.code === 'SCHEMA_CHANGED_DURING_APPLY') {
    stderr('✗ Schema changed during apply twice in a row — re-run later.');
    return;
  }
  if (err instanceof HttpError && err.code === 'BUNDLE_INVALID') {
    stderr('✗ Bundle invalid');
    const data = err.data as {
      errors?: Array<{ path: string; message: string }>;
    } | null;
    for (const e of data?.errors ?? []) {
      stderr(`  - ${e.path}: ${e.message}`);
    }
    return;
  }
  if (err instanceof HttpError) {
    stderr(`Error: ${err.status} ${err.code} — ${err.message}`);
    return;
  }
  stderr(`Error: ${(err as Error).message}`);
}
```

- [ ] **Step 4: Run, verify GREEN**

```bash
pnpm --filter @boject/cli exec vitest run tests/unit/schemaApply.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/boject-cli/src/commands/schemaApply.ts packages/boject-cli/tests/unit/schemaApply.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): boject schema apply — push bundle, render blockers, retry on race

Reads the local bundle, POSTs /api/schema/apply, prints structured
output:
- success → "✓ Applied" + per-axis change counts
- dry-run → "✓ Dry run" with the same counts (server didn't mutate)
- BUNDLE_INVALID → list of validator errors
- SCHEMA_APPLY_BLOCKED → list of blocker codes/paths/messages
- SCHEMA_CHANGED_DURING_APPLY → auto-retry once, then surface error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: CLI — `boject schema check`

Pulls live, diffs against on-disk, exits 0/1.

**Files:**

- Create: `packages/boject-cli/src/commands/schemaCheck.ts`
- Create: `packages/boject-cli/tests/unit/schemaCheck.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/boject-cli/tests/unit/schemaCheck.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { runSchemaCheck } from '../../src/commands/schemaCheck.js';

let server: Server;
let port: number;
const remote: { value: unknown } = { value: null };

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(remote.value));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no addr');
  port = addr.port;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let workDir: string;
const lines: string[] = [];
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-check-'));
  await writeFile(
    join(workDir, '.boject.config.json'),
    JSON.stringify({
      cms: { url: `http://localhost:${port}` },
      schema: { path: 'schema.boject.json' },
    })
  );
  lines.length = 0;
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const stdout = (l: string) => lines.push(l);
const stderr = (l: string) => lines.push(l);

const TYPE = (id: string) => ({
  id: null,
  identifier: id,
  name: id,
  description: null,
  fields: [
    {
      id: null,
      identifier: 'name',
      name: 'Name',
      type: 'ENTRY_TITLE',
      required: true,
      order: 0,
      options: null,
    },
  ],
});

describe('runSchemaCheck', () => {
  it('exits 0 when local matches remote (ignoring exportedAt)', async () => {
    const bundle = {
      version: 2,
      exportedAt: 'remote-time',
      portable: true,
      contentTypes: [TYPE('Article')],
    };
    remote.value = bundle;
    await writeFile(
      join(workDir, 'schema.boject.json'),
      JSON.stringify({ ...bundle, exportedAt: 'local-time' })
    );
    const r = await runSchemaCheck({
      cwd: workDir,
      apiKey: 'k',
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(0);
    expect(lines.some((l) => l.includes('in sync'))).toBe(true);
  });

  it('exits 1 with a diff when content types differ', async () => {
    remote.value = {
      version: 2,
      exportedAt: 'remote-time',
      portable: true,
      contentTypes: [TYPE('Article'), TYPE('Tag')],
    };
    await writeFile(
      join(workDir, 'schema.boject.json'),
      JSON.stringify({
        version: 2,
        exportedAt: 'local-time',
        portable: true,
        contentTypes: [TYPE('Article')],
      })
    );
    const r = await runSchemaCheck({
      cwd: workDir,
      apiKey: 'k',
      stdout,
      stderr,
    });
    expect(r.exitCode).toBe(1);
    expect(lines.some((l) => l.includes('Tag'))).toBe(true);
    expect(lines.some((l) => /server|local/i.test(l))).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Create the command**

`packages/boject-cli/src/commands/schemaCheck.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute } from 'node:path';
import { loadProjectConfig } from '../config.js';
import { getSchemaBundle, HttpError } from '../api.js';
import type { Bundle, BundleContentType, BundleField } from '../types.js';

export interface SchemaCheckParams {
  cwd: string;
  apiKey: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface SchemaCheckResult {
  exitCode: 0 | 1;
}

export async function runSchemaCheck(
  params: SchemaCheckParams
): Promise<SchemaCheckResult> {
  if (!params.apiKey) {
    params.stderr('Error: BOJECT_API_KEY is not set.');
    return { exitCode: 1 };
  }
  let config: Awaited<ReturnType<typeof loadProjectConfig>>;
  try {
    config = await loadProjectConfig(params.cwd);
  } catch (err) {
    params.stderr(`Error: ${(err as Error).message}`);
    return { exitCode: 1 };
  }
  const url = config.config.cms.url;
  const pathRel = config.config.schema.path;
  const pathAbs = isAbsolute(pathRel)
    ? pathRel
    : resolve(dirname(config.configPath), pathRel);

  let local: Bundle;
  try {
    local = JSON.parse(await readFile(pathAbs, 'utf8')) as Bundle;
  } catch (err) {
    params.stderr(`Error reading ${pathAbs}: ${(err as Error).message}`);
    return { exitCode: 1 };
  }

  let remote: Bundle;
  try {
    remote = await getSchemaBundle({ baseUrl: url, apiKey: params.apiKey });
  } catch (err) {
    if (err instanceof HttpError) {
      params.stderr(`Error: ${err.status} ${err.code} — ${err.message}`);
    } else {
      params.stderr(`Error: ${(err as Error).message}`);
    }
    return { exitCode: 1 };
  }

  const diffs = diffBundles(local, remote);
  if (diffs.length === 0) {
    params.stdout(`✓ Schema in sync with ${url}`);
    return { exitCode: 0 };
  }
  params.stderr(`✗ Drift detected against ${url}`);
  for (const d of diffs) params.stderr(`  - ${d}`);
  params.stderr('Run `boject schema pull` to update the local file.');
  return { exitCode: 1 };
}

function diffBundles(local: Bundle, remote: Bundle): string[] {
  const out: string[] = [];
  const localTypes = new Map<string, BundleContentType>();
  for (const ct of local.contentTypes ?? []) localTypes.set(ct.identifier, ct);
  const remoteTypes = new Map<string, BundleContentType>();
  for (const ct of remote.contentTypes ?? [])
    remoteTypes.set(ct.identifier, ct);

  for (const [id, ct] of localTypes) {
    if (!remoteTypes.has(id)) {
      out.push(`${id}: type exists locally but not on the server`);
      continue;
    }
    const r = remoteTypes.get(id)!;
    out.push(...diffFields(id, ct.fields, r.fields));
  }
  for (const id of remoteTypes.keys()) {
    if (!localTypes.has(id)) {
      out.push(`${id}: type exists on the server but not locally`);
    }
  }
  return out;
}

function diffFields(
  typeId: string,
  local: BundleField[],
  remote: BundleField[]
): string[] {
  const out: string[] = [];
  const localFields = new Map(local.map((f) => [f.identifier, f]));
  const remoteFields = new Map(remote.map((f) => [f.identifier, f]));
  for (const id of localFields.keys()) {
    if (!remoteFields.has(id)) {
      out.push(`${typeId}: field '${id}' exists locally but not on the server`);
    }
  }
  for (const id of remoteFields.keys()) {
    if (!localFields.has(id)) {
      out.push(`${typeId}: field '${id}' exists on the server but not locally`);
    }
  }
  return out;
}
```

(Diff intentionally ignores `exportedAt` and field-level option diffs — `pull` and `apply` already produce identical files when in sync; deeper diffs would just add noise. We re-explore if the no-op heuristic turns out to be wrong.)

- [ ] **Step 4: Run, verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add packages/boject-cli/src/commands/schemaCheck.ts packages/boject-cli/tests/unit/schemaCheck.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): boject schema check — drift detector for CI

Pulls remote, diffs against the on-disk bundle (content types + fields,
ignoring exportedAt). Exits 0 if in sync, 1 if drift detected with a
human-readable list of additions/removals.

Designed for CI: \`boject schema check && echo "schema in sync"\`.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: CLI — wire commands into `index.ts`

Argument parser plus help text. The dispatcher pattern matches the existing `upgrade` command.

**Files:**

- Modify: `packages/boject-cli/src/index.ts`

- [ ] **Step 1: Replace `index.ts`**

```ts
import { parseArgs } from 'node:util';
import { runUpgrade, type CommandRunner } from './commands/upgrade.js';
import { runSchemaPull } from './commands/schemaPull.js';
import { runSchemaValidate } from './commands/schemaValidate.js';
import { runSchemaApply } from './commands/schemaApply.js';
import { runSchemaCheck } from './commands/schemaCheck.js';
import { spawn } from 'node:child_process';
import { CLI_VERSION } from './version.js';

const USAGE = `Usage: boject <command> [flags]

Commands:
  upgrade            Upgrade the CMS image tag in the current
                     directory's docker-compose.yml.
  schema pull        Fetch schema from a CMS to content-types/schema.boject.json.
  schema validate    Validate a local bundle (no network).
  schema apply       Push a local bundle to a CMS via API.
  schema check       Compare local schema against the live CMS.

Run \`boject <command> --help\` for command-specific flags.
`;

const SCHEMA_PULL_USAGE = `Usage: boject schema pull [--out <path>] [--url <url>]

Reads .boject.config.json (walks up from CWD), GETs <cms.url>/api/schema/export,
and writes the response to <schema.path>. Requires BOJECT_API_KEY in env.
`;

const SCHEMA_VALIDATE_USAGE = `Usage: boject schema validate [<path>]

Validates a bundle file's shape and runs the planner against an empty
snapshot to surface cross-reference issues. No network. If <path> is
omitted, falls back to the configured schema.path.
`;

const SCHEMA_APPLY_USAGE = `Usage: boject schema apply [<path>] [--allow-destructive] [--dry-run]

POSTs the bundle to <cms.url>/api/schema/apply. Requires BOJECT_API_KEY.
--dry-run runs the apply server-side but rolls back the transaction.
`;

const SCHEMA_CHECK_USAGE = `Usage: boject schema check

Pulls the live schema and diffs it against the on-disk bundle. Exits 1
on drift. Designed for CI.
`;

const nodeRunner: CommandRunner = {
  run(cmd, args, opts) {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: opts?.cwd, stdio: 'inherit' });
      child.on('close', (code) => resolve({ status: code }));
    });
  },
};

const stdout = (line: string) => process.stdout.write(`${line}\n`);
const stderr = (line: string) => process.stderr.write(`${line}\n`);

async function dispatchSchema(args: string[]): Promise<number> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(USAGE);
    return subcommand ? 0 : 1;
  }

  const apiKey = process.env.BOJECT_API_KEY;

  switch (subcommand) {
    case 'pull': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(SCHEMA_PULL_USAGE);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        allowPositionals: false,
        options: {
          out: { type: 'string' },
          url: { type: 'string' },
        },
      });
      const r = await runSchemaPull({
        cwd: process.cwd(),
        apiKey,
        flags: { out: values.out, url: values.url },
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    case 'validate': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(SCHEMA_VALIDATE_USAGE);
        return 0;
      }
      const { positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {},
      });
      const r = await runSchemaValidate({
        cwd: process.cwd(),
        path: positionals[0],
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    case 'apply': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(SCHEMA_APPLY_USAGE);
        return 0;
      }
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          'allow-destructive': { type: 'boolean', default: false },
          'dry-run': { type: 'boolean', default: false },
          url: { type: 'string' },
        },
      });
      const r = await runSchemaApply({
        cwd: process.cwd(),
        apiKey,
        flags: {
          path: positionals[0],
          url: values.url,
          allowDestructive: values['allow-destructive'] === true,
          dryRun: values['dry-run'] === true,
        },
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    case 'check': {
      if (rest.includes('--help') || rest.includes('-h')) {
        process.stdout.write(SCHEMA_CHECK_USAGE);
        return 0;
      }
      const r = await runSchemaCheck({
        cwd: process.cwd(),
        apiKey,
        stdout,
        stderr,
      });
      return r.exitCode;
    }
    default:
      process.stderr.write(`Unknown schema subcommand: ${subcommand}\n`);
      process.stdout.write(USAGE);
      return 1;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(USAGE);
    process.exit(argv.length === 0 ? 1 : 0);
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`${CLI_VERSION}\n`);
    process.exit(0);
  }

  const [command, ...rest] = argv;

  if (command === 'schema') {
    const code = await dispatchSchema(rest);
    process.exit(code);
  }

  if (command === 'upgrade') {
    const { values } = parseArgs({
      args: rest,
      allowPositionals: false,
      options: {
        to: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        check: { type: 'boolean', default: false },
      },
    });
    const { exitCode, message } = await runUpgrade({
      cwd: process.cwd(),
      runner: nodeRunner,
      flags: {
        to: values.to,
        dryRun: values['dry-run'] === true,
        check: values.check === true,
      },
      stdout,
      stderr,
    });
    const sink = exitCode === 0 ? process.stdout : process.stderr;
    sink.write(`${message}\n`);
    process.exit(exitCode);
  }

  process.stderr.write(`Unknown command: ${command}\n`);
  process.stderr.write(USAGE);
  process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Build the CLI**

```bash
pnpm --filter @boject/cli build
```

Expected: clean.

- [ ] **Step 3: Sanity-check the help text**

```bash
node packages/boject-cli/dist/index.js
node packages/boject-cli/dist/index.js schema --help
node packages/boject-cli/dist/index.js schema pull --help
```

Expected: prints the relevant usage text.

- [ ] **Step 4: Run the full CLI unit suite**

```bash
pnpm --filter @boject/cli test:unit
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/boject-cli/src/index.ts
git commit -m "$(cat <<'EOF'
feat(cli): wire \`boject schema pull|validate|apply|check\` into argv dispatch

Adds the schema subcommand router. Each subcommand has its own
--help text. Existing upgrade command unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: CLI — end-to-end test

One full flow against an in-process mock server, exercising the built CLI binary via `execFile`. Mirrors `tests/e2e/upgrade.test.ts`.

**Files:**

- Create: `packages/boject-cli/tests/e2e/schemaCommands.test.ts`

- [ ] **Step 1: Write the test**

`packages/boject-cli/tests/e2e/schemaCommands.test.ts`:

```ts
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..', '..');
const CLI_PATH = join(PACKAGE_ROOT, 'dist', 'index.js');

const BUNDLE = {
  version: 2,
  exportedAt: '2026-05-01T00:00:00.000Z',
  portable: true,
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
          type: 'ENTRY_TITLE',
          required: true,
          order: 0,
          options: null,
        },
      ],
    },
  ],
};

let server: Server;
let port: number;
const requests: Array<{ method?: string; url?: string; body?: string }> = [];

beforeAll(async () => {
  await run('pnpm', ['--filter', '@boject/cli', 'build'], {
    cwd: resolve(PACKAGE_ROOT, '..', '..'),
  });

  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk.toString()));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body });
      if (req.method === 'GET' && req.url === '/api/schema/export') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(BUNDLE));
        return;
      }
      if (req.method === 'POST' && req.url === '/api/schema/apply') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            changed: true,
            applied: {
              contentTypesCreated: 1,
              contentTypesUpdated: 0,
              contentTypesRemoved: 0,
              fieldsCreated: 1,
              fieldsUpdated: 0,
              fieldsRemoved: 0,
            },
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no addr');
  port = addr.port;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'boject-e2e-'));
  await writeFile(
    join(workDir, '.boject.config.json'),
    JSON.stringify({
      cms: { url: `http://localhost:${port}` },
      schema: { path: 'content-types/schema.boject.json' },
    })
  );
  requests.length = 0;
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('boject schema (e2e)', () => {
  it('pull → check (in sync) → apply', async () => {
    // Pull
    {
      const { stdout, stderr } = await run(
        'node',
        [CLI_PATH, 'schema', 'pull'],
        {
          cwd: workDir,
          env: { ...process.env, BOJECT_API_KEY: 'boject_e2e' },
        }
      );
      expect(stdout).toContain('Pulled schema from');
      expect(stderr).toBe('');
    }
    // Check — local matches remote.
    {
      const { stdout } = await run('node', [CLI_PATH, 'schema', 'check'], {
        cwd: workDir,
        env: { ...process.env, BOJECT_API_KEY: 'boject_e2e' },
      });
      expect(stdout).toContain('in sync');
    }
    // Apply
    {
      const { stdout } = await run('node', [CLI_PATH, 'schema', 'apply'], {
        cwd: workDir,
        env: { ...process.env, BOJECT_API_KEY: 'boject_e2e' },
      });
      expect(stdout).toContain('Applied');
    }

    // Three requests: GET (pull), GET (check), POST (apply).
    expect(requests.filter((r) => r.method === 'GET')).toHaveLength(2);
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('validate exits 1 on a malformed file with a helpful message', async () => {
    const path = join(workDir, 'broken.boject.json');
    await writeFile(path, '{not json');
    await expect(
      run('node', [CLI_PATH, 'schema', 'validate', path], { cwd: workDir })
    ).rejects.toMatchObject({ code: 1 });
  });
});
```

- [ ] **Step 2: Run, verify GREEN**

```bash
pnpm --filter @boject/cli test:e2e
```

Expected: 2/2 pass.

- [ ] **Step 3: Commit**

```bash
git add packages/boject-cli/tests/e2e/schemaCommands.test.ts
git commit -m "$(cat <<'EOF'
test(cli): e2e flow — pull → check → apply against in-process server

Builds the CLI, spins up node:http on a random port, runs the four
schema commands via execFile, and asserts request counts + output.

Mirrors the existing tests/e2e/upgrade.test.ts pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Scaffolder — `.boject.config.json` template

The scaffolded project gets a config file pointing at `http://localhost:4000` and a commented `# BOJECT_API_KEY=` line in `.env`.

**Files:**

- Create: `packages/create-boject-cms/src/templates/bojectConfig.ts`
- Create: `packages/create-boject-cms/tests/unit/bojectConfig.test.ts`
- Modify: `packages/create-boject-cms/src/render.ts` (re-export)
- Modify: `packages/create-boject-cms/src/writeProject.ts` (always write the file)
- Modify: `packages/create-boject-cms/tests/unit/writeProject.test.ts` (assert)
- Modify: `packages/create-boject-cms/tests/e2e/scaffold.test.ts` (file-set assertion)
- Modify: `packages/create-boject-cms/src/templates/envFile.ts` (add commented `BOJECT_API_KEY` line)
- Modify: `packages/create-boject-cms/tests/unit/envFile.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/create-boject-cms/tests/unit/bojectConfig.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderBojectConfig } from '../../src/templates/bojectConfig.js';

describe('renderBojectConfig', () => {
  it('emits cms.url=http://localhost:4000 by default', () => {
    const out = renderBojectConfig();
    const parsed = JSON.parse(out);
    expect(parsed.cms.url).toBe('http://localhost:4000');
  });

  it('emits schema.path=content-types/schema.boject.json', () => {
    const parsed = JSON.parse(renderBojectConfig());
    expect(parsed.schema.path).toBe('content-types/schema.boject.json');
  });

  it('ends with a trailing newline', () => {
    expect(renderBojectConfig().endsWith('\n')).toBe(true);
  });
});
```

Append to `packages/create-boject-cms/tests/unit/envFile.test.ts`:

```ts
it('includes a commented BOJECT_API_KEY line', () => {
  const env = renderEnvFile({ ...baseParams, starter: 'base' });
  expect(env).toMatch(/^# BOJECT_API_KEY=/m);
  expect(env).toMatch(/CLI|boject schema/i);
});

it('does not enable BOJECT_API_KEY by default', () => {
  const env = renderEnvFile({ ...baseParams, starter: 'base' });
  expect(env).not.toMatch(/^BOJECT_API_KEY=/m);
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
pnpm --filter create-boject-cms exec vitest run tests/unit/bojectConfig.test.ts tests/unit/envFile.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create the template**

`packages/create-boject-cms/src/templates/bojectConfig.ts`:

```ts
export function renderBojectConfig(): string {
  const obj = {
    cms: { url: 'http://localhost:4000' },
    schema: { path: 'content-types/schema.boject.json' },
  };
  return JSON.stringify(obj, null, 2) + '\n';
}
```

Re-export in `packages/create-boject-cms/src/render.ts`:

```ts
export { renderBojectConfig } from './templates/bojectConfig.js';
```

- [ ] **Step 4: Update `envFile.ts`**

In `packages/create-boject-cms/src/templates/envFile.ts`, append to the comment block:

```ts
'',
'# Set when using the boject CLI (`boject schema pull/apply/check`).',
'# Create one with: pnpm apikey:create cli --scopes schema:read,schema:write',
'# BOJECT_API_KEY=',
```

- [ ] **Step 5: Wire into `writeProject.ts`**

After the existing `content-types/schema.boject.json` block (Task 12 from Spec 4 added it):

```ts
import {
  GITIGNORE,
  renderBojectConfig,
  // ... existing imports
} from './render.js';

// Always write .boject.config.json so the @boject/cli commands work
// out of the box from the project root.
await writeFile(join(targetDir, '.boject.config.json'), renderBojectConfig());
```

- [ ] **Step 6: Update `writeProject.test.ts`**

Find the file-set assertion test (the one that lists `.env`, `.gitignore`, etc.) and add `'.boject.config.json'`:

```ts
expect(files.sort()).toEqual(
  [
    '.boject.config.json',
    '.env',
    '.gitignore',
    'README.md',
    'content-types',
    'docker-compose.yml',
    'package.json',
    'starters',
  ].sort()
);
```

- [ ] **Step 7: Update `tests/e2e/scaffold.test.ts`**

Same change — find the file-set assertion and add `.boject.config.json` to the expected list.

- [ ] **Step 8: Run, verify GREEN**

```bash
pnpm --filter create-boject-cms test:unit
pnpm --filter create-boject-cms test:e2e
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add packages/create-boject-cms/
git commit -m "$(cat <<'EOF'
feat(scaffolder): write .boject.config.json + commented BOJECT_API_KEY

A scaffolded project now has the CLI's config file out of the box,
pointing at http://localhost:4000. .env grows a commented
BOJECT_API_KEY= line with one-line guidance on how to mint a key.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: CLAUDE.md + final verification + PR

Document the new commands, endpoints, scope system, env vars, key files. Run the full pipeline. Push and PR.

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

Add to the runtime env vars line (under **Docker image**), inserting after `BOJECT_SCHEMA_DIR`:

```
`BOJECT_API_KEY` (used by the local @boject/cli; not consumed by the running CMS — set in your shell or project .env when running `boject schema *` commands),
```

Add a new bullet near the schema-as-code applier entries:

```
- **Schema-as-code CLI** — Four `boject schema` commands in `packages/boject-cli/src/commands/`: `pull` fetches the live bundle from `GET /api/schema/export`, `validate` runs `validateBundle` + an empty-snapshot planner pass offline, `apply` POSTs to `/api/schema/apply` (`--dry-run` honoured server-side), `check` diffs local vs. live for CI. All four read `.boject.config.json` (committed) and `BOJECT_API_KEY` (env). The applier core is vendored into the CLI from `apps/cms/scripts/content-bundle/{validate,planSchema,schemaPlan.types}.ts` so the CLI publishes standalone — keep `packages/boject-cli/src/vendor/` in sync when the canonical files change.
- **API key scopes** — `ApiKey.scopes: String[]` (Postgres `text[]`). Recognised: `content:read` (GraphQL), `schema:read` (`GET /api/schema/export`), `schema:write` (`POST /api/schema/apply`). Existing keys are migrated to `["content:read"]` so GraphQL keeps working unchanged. New keys: `pnpm apikey:create <name> --scopes <csv>` (default `content:read`). `apikey:list` shows a Scopes column. The middleware stashes scopes on `event.context.apiKeyScopes`; `apps/cms/server/utils/assertApiKeyScope.ts::assertApiKeyScope(event, scope)` is the per-handler gate.
- **`POST /api/schema/apply`** — HTTP wrapper around `applySchema`. Body `{ bundle, allowDestructive?, dryRun? }`. Honours `BOJECT_SCHEMA_READONLY` (returns 403). Translates applier exceptions: `BUNDLE_INVALID` → 400, `SCHEMA_APPLY_BLOCKED` → 400 with blockers/plan, `SCHEMA_CHANGED_DURING_APPLY` → 409. Session OR API key with `schema:write`.
- **`GET /api/schema/export`** — returns the current schema as a portable bundle. Session OR API key with `schema:read`.
```

Add the new files to the Key Files section (alphabetically near `apply-schema.ts`):

```
- `packages/boject-cli/src/config.ts` — loads `.boject.config.json` walking up from CWD
- `packages/boject-cli/src/api.ts` — HTTP client for `/api/schema/{export,apply}`
- `packages/boject-cli/src/commands/schemaPull.ts` / `schemaValidate.ts` / `schemaApply.ts` / `schemaCheck.ts`
- `packages/boject-cli/src/vendor/` — vendored `validateBundle` + `planSchema` + types (kept in sync with `apps/cms/scripts/content-bundle/`)
- `apps/cms/server/api/schema/export.get.ts` / `apply.post.ts` — REST endpoints
- `apps/cms/server/utils/assertApiKeyScope.ts` — per-handler scope gate
- `packages/create-boject-cms/src/templates/bojectConfig.ts` — scaffolds `.boject.config.json`
```

Update the existing **Authentication** bullet that mentions the API key middleware so it references scopes:

> ... API key auth (`Authorization: Bearer`). Keys carry a `scopes: string[]`; `validateApiKey` returns scopes alongside the id, and `assertApiKeyScope(event, scope)` gates per-endpoint access. GraphQL requires `content:read`; schema endpoints require `schema:read` / `schema:write`.

- [ ] **Step 2: Format CLAUDE.md**

```bash
pnpm exec prettier --write CLAUDE.md
```

- [ ] **Step 3: Full unit suite**

```bash
pnpm test:unit
```

Expected: all green (existing + the new ones from this plan).

- [ ] **Step 4: Full integration suite**

```bash
pnpm test:integration
```

Expected: all green.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 6: Lint**

```bash
pnpm lint
```

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude): document schema-as-code CLI, scopes, and new endpoints

- BOJECT_API_KEY added to the runtime env vars line.
- New "Schema-as-code CLI" architecture bullet listing all four commands.
- New "API key scopes" bullet covering scope storage, recognised values,
  and the assertApiKeyScope helper.
- New entries for GET /api/schema/export and POST /api/schema/apply.
- Authentication bullet updated to reference scopes.
- Key Files updated for the new CLI commands, vendor dir, and endpoints.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Push**

```bash
git push -u origin feat/145-schema-as-code-cli
```

- [ ] **Step 9: Open PR**

```bash
gh pr create --title "feat: schema-as-code CLI + endpoints + API key scopes" --body "$(cat <<'EOF'
## Summary

Implements Spec 5 of the schema-as-code stack — adds four \`boject schema\` CLI commands (\`pull\`, \`validate\`, \`apply\`, \`check\`), the two HTTP endpoints they require (\`GET /api/schema/export\`, \`POST /api/schema/apply\`), and an \`ApiKey.scopes\` system. After this lands, a developer in a scaffolded project can \`boject schema pull\` to grab the live schema, edit / commit / redeploy, and \`boject schema check\` in CI to detect drift.

This is the last spec in the schema-as-code stack.

## What lands

**API key scopes**:
- \`ApiKey.scopes: String[]\` migration with a backfill that gives every existing key \`content:read\` (so GraphQL keeps working unchanged).
- \`pnpm apikey:create <name> --scopes <csv>\` (default \`content:read\`); \`apikey:list\` shows a Scopes column.
- \`assertApiKeyScope(event, scope)\` gate; auth middleware stashes scopes on \`event.context\`.
- GraphQL endpoint asserts \`content:read\`.

**Endpoints**:
- \`GET /api/schema/export\` — portable bundle, session OR API key with \`schema:read\`.
- \`POST /api/schema/apply\` — body \`{ bundle, allowDestructive?, dryRun? }\`, honours \`BOJECT_SCHEMA_READONLY\`, translates applier exceptions to HTTP shapes.
- \`applySchema\` gains a \`dryRun\` option (used by the apply endpoint).

**CLI**:
- \`boject schema pull|validate|apply|check\` in \`packages/boject-cli/src/commands/\`.
- \`packages/boject-cli/src/vendor/\` holds copies of \`validateBundle\` + \`planSchema\` + types (CLI publishes standalone; documented sync requirement in CLAUDE.md).
- \`.boject.config.json\` shape: \`{ cms: { url }, schema: { path } }\`.
- HTTP client with structured \`HttpError(.code)\` so commands switch cleanly.

**Scaffolder**:
- Writes \`.boject.config.json\` pointing at \`http://localhost:4000\`.
- Adds a commented \`# BOJECT_API_KEY=\` line to \`.env\` with guidance on how to mint a key.

## Test plan

- [x] Unit tests for \`assertApiKeyScope\`, \`config.ts\`, each CLI command.
- [x] Integration tests for both new endpoints (auth gates, scope enforcement, applier integration, readonly flag, dryRun).
- [x] DB-backed unit tests for \`applySchema({ dryRun: true })\`.
- [x] E2E test for the full CLI flow (pull → check → apply).
- [x] Scaffolder unit + e2e tests updated for \`.boject.config.json\`.
- [x] Full unit + integration suites green.
- [x] Typecheck, lint, prettier all clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage check:**

- ✅ `boject schema pull` → Task 11.
- ✅ `boject schema validate` → Task 12 (offline, vendor planner).
- ✅ `boject schema apply` → Task 13 (incl. `--dry-run`, blocker rendering, retry on race).
- ✅ `boject schema check` → Task 14 (drift detector for CI).
- ✅ `.boject.config.json` shape + walk-up loading → Task 9.
- ✅ HTTP client → Task 10.
- ✅ CLI dispatch + help text → Task 15.
- ✅ E2E test → Task 16.
- ✅ `GET /api/schema/export` → Task 7.
- ✅ `POST /api/schema/apply` → Task 8 (incl. dryRun, allowDestructive, readonly flag).
- ✅ `applySchema` `dryRun` option (Spec 3 extension required by the apply endpoint) → Task 6.
- ✅ `ApiKey.scopes` migration with backfill → Task 1.
- ✅ `validateApiKey` returns scopes → Task 2.
- ✅ `assertApiKeyScope` helper + middleware wiring → Task 3.
- ✅ GraphQL asserts `content:read` → Task 4.
- ✅ `apikey:create --scopes` + `apikey:list` shows scopes → Task 5.
- ✅ Scaffolder writes `.boject.config.json` + commented `BOJECT_API_KEY` → Task 17.
- ✅ CLAUDE.md updates → Task 18.

**Out-of-scope (spec-confirmed):**

- In-CMS "Pull schema to project" button — explicit defer.
- Migration files / rename detection — out of all four schema-as-code specs.
- Per-resource scopes (`content-types:write`, etc.) — two scopes (`schema:*` and `content:*`) sufficient.
- Self-hosted npm registry / private mirror — Plan D covers ghcr.io + npm.

**Placeholder scan:**

- No "TBD" / "TODO" / "implement later".
- No "similar to Task N" — every task has full code blocks.
- All log lines, file paths, and commit messages spelled out verbatim.
- The one forward-looking note (Spec 5 was always the last spec; no "we'll add this in Spec 6") is fine — the spec itself confirms.

**Type/symbol consistency:**

- `loadProjectConfig`, `getSchemaBundle`, `applySchemaRemote`, `runSchemaPull/Validate/Apply/Check`, `assertApiKeyScope`, `renderBojectConfig`, `Bundle`, `BundleField`, `BundleContentType`, `ApplySchemaResultLike`, `BlockerLike`, `HttpError`, `SchemaPullParams`, `SchemaApplyFlags` — all consistent across tasks.
- `BOJECT_API_KEY`, `BOJECT_SCHEMA_DIR`, `BOJECT_SCHEMA_READONLY`, `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA` env var names match existing CLAUDE.md / scaffolder spelling.
- Recognised scope strings (`content:read`, `schema:read`, `schema:write`) match across the migration backfill, manage-api-keys CLI, and helper assertions.

**Risk notes:**

- **Vendoring sync.** The CLI's `vendor/` dir is a copy of three `apps/cms/scripts/content-bundle/` files. There's no automated drift check. The CLAUDE.md note flags this; if it becomes a problem, a future PR can add a build-time hash check. For v1, vendoring is fine — the canonical files are stable and rarely touched.
- **`useRuntimeConfig` vs. `process.env` for `BOJECT_SCHEMA_READONLY`.** The Task 8 SCHEMA_READONLY test depends on the existing Spec 1 runtime config plumbing. If Spec 1's tests flip the env per-test successfully, this one will too. If not, fall back to reading `process.env` directly — the entrypoint applier already does this.
- **Scope check for graphql is a backwards-compatible addition.** Existing keys all have `content:read` after the migration backfill, so the new gate doesn't lock anyone out. Manually-created keys without `content:read` _will_ be rejected by GraphQL — that's the intended new behaviour.
- **Dry-run reads need transactional isolation.** `applySchema({ dryRun: true })` opens a Prisma transaction, mutates inside it, then throws to roll back. Other in-flight transactions reading the schema during the dry-run window won't see the mutations. This is the same isolation level as a normal apply — safe.
- **CLI publishes standalone.** The CLI doesn't depend on workspace packages. The vendored validator + planner + types are all that's needed; the rest is `node:*` plus `semver` (existing dep) and `yaml` (existing dep, used by the upgrade command — not used by schema commands but present).

---

## Plan Done — Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-05-02-schema-as-code-cli.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Fresh subagent per task, two-stage review between tasks. Same pattern that landed PRs #150–#155.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
