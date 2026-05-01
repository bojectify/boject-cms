# Schema-as-Code: CLI Commands & API Key Scopes

## Overview

Extend `@boject/cli` with three schema commands (`pull`, `validate`, `apply`) plus the server-side endpoints and API key scopes they require. After this spec, a developer in their project directory can run `boject schema pull` to fetch the live schema from a CMS instance and write it to `content-types/schema.boject.json`, run `boject schema validate` against the local file with no CMS required, and (rarely) run `boject schema apply` to push schema directly to a CMS via API. API keys gain a scope system so a key handed out for schema work cannot also be used to publish content.

End-to-end developer experience after this spec lands:

```
# In a scaffolded project, with .boject.config.json pointing at the dev CMS
$ boject schema pull
✓ Pulled schema from https://cms.dev.example.com
  4 content types, 23 fields
  Wrote content-types/schema.boject.json (3.2 KB)

$ git diff content-types/schema.boject.json
[diff shown]

$ git commit -am "Add 'publishedOn' field to Article"
```

For pre-commit / CI:

```
$ boject schema validate content-types/schema.boject.json
✓ Bundle valid
  4 content types, 23 fields, 0 cross-reference issues

$ boject schema validate content-types/schema.boject.json
✗ Bundle invalid
  - field.type: Article.publishDate has invalid type "DATE" (expected one of TEXT|TEXTAREA|...)
  - relation: Article.author targets unknown content type "Auther"
```

For the CI / "is the committed file stale?" check:

```
$ boject schema check
✗ Drift detected against https://cms.dev.example.com
  - Article: field 'subtitle' exists locally but not on the server
  - Article: field 'tagline' exists on the server but not locally
  Run `boject schema pull` to update the local file.
```

Parent specs:

- [`2026-05-01-schema-readonly-flag-design.md`](./2026-05-01-schema-readonly-flag-design.md) — the read-only enforcement that makes the "where do I edit?" question unambiguous.
- [`2026-05-01-schema-as-code-planner-design.md`](./2026-05-01-schema-as-code-planner-design.md) — `validate` and `check` use the planner.
- [`2026-05-01-schema-as-code-applier-design.md`](./2026-05-01-schema-as-code-applier-design.md) — `apply` uses the applier via a new HTTP endpoint.
- [`2026-05-01-schema-as-code-entrypoint-design.md`](./2026-05-01-schema-as-code-entrypoint-design.md) — the entrypoint apply makes `boject schema apply` redundant in the normal flow; the CLI command is the escape hatch for headless / one-off scenarios.

## Approach

**Three commands, one config file.** The `.boject.config.json` (committed) declares the CMS URL and the schema path. The API key lives in `.env` (gitignored). With both populated, all three commands work with no flags day-to-day.

**HTTP everywhere — no SSH.** The CLI is a network client. `pull` hits `GET /api/schema/export`. `apply` hits `POST /api/schema/apply`. The CLI never touches a database directly. This is the same shape as `@boject/cli upgrade` already established.

**API key scopes.** API keys gain a `scopes: string[]` field. The schema endpoints require `schema:read` (for export) or `schema:write` (for apply). Scopes also retroactively classify the existing GraphQL endpoint behaviour as `content:read`. Existing keys are migrated to `["content:read"]` (current behaviour) with no functional change.

**`validate` is offline-only by design.** The `validate` command does **not** talk to a CMS. It reads the file, calls `validateBundle`, and runs the planner against an empty snapshot to catch cross-reference bugs (RELATION pointing at a type missing from the same bundle). This makes it safe to run as a pre-commit hook without a CMS available.

**`check` is the drift detector.** Separate from `validate`. `check` does talk to a CMS — it pulls the live schema and compares against the committed file. Designed for CI ("the committed schema matches what dev currently has") and for the rare ad-hoc "have I forgotten to export?" prompt.

## Scope

**In:**

- New CLI commands in `packages/boject-cli/src/commands/`:
  - `schemaPull.ts` — fetches schema from a CMS, writes to a file.
  - `schemaValidate.ts` — validates a local file, no network.
  - `schemaApply.ts` — pushes a local file to a CMS.
  - `schemaCheck.ts` — diffs a local file against a CMS.
- `.boject.config.json` shape:
  ```json
  {
    "cms": {
      "url": "https://cms.dev.example.com"
    },
    "schema": {
      "path": "content-types/schema.boject.json"
    }
  }
  ```
  Loaded by a new `packages/boject-cli/src/config.ts` helper. The CLI walks up from CWD looking for `.boject.config.json`. API key from `BOJECT_API_KEY` env (or the existing project-level `.env` loaded via `dotenv`).
- New API endpoints:
  - `GET /api/schema/export` — returns a portable bundle of current schema. Requires `schema:read`. Available from session **or** API key auth (operators can hit it from a browser as well as from the CLI).
  - `POST /api/schema/apply` — accepts a bundle in the body, runs the applier. Requires `schema:write`. Body schema: `{ bundle: Bundle, allowDestructive?: boolean }`. Response: `ApplySchemaResult` on success; `400` with `{ error, blockers, plan }` on `SchemaApplyBlockedError`. Gated by `BOJECT_SCHEMA_READONLY` (the readonly flag from Spec 1 also blocks this — the CLI is no exception).
- API key scopes:
  - New `ApiKey.scopes: String[]` Prisma field, default `["content:read"]`. Migration created via `prisma migrate diff` + `migrate deploy`.
  - `validateApiKey()` (existing) returns the loaded key including `scopes`.
  - New helper `apps/cms/server/utils/assertApiKeyScope.ts::assertApiKeyScope(event, scope)` — checks the resolved key's scopes; throws 403 with `{ error: 'INSUFFICIENT_SCOPE', required: scope }` if missing.
  - `apps/cms/scripts/manage-api-keys/` CLI: `pnpm apikey:create` gains a `--scopes` flag (comma-separated). Default `content:read`. `apikey:list` shows scopes alongside other fields.
  - The graphql gate (`/api/graphql`) keeps its current behaviour but explicitly checks `content:read`. Keys without it are rejected from GraphQL — but every existing key is migrated to include it, so behaviour is preserved.
- UI changes in `apps/cms/pages/api-keys/` (or wherever existing key management lives — to be discovered) so admins can pick scopes when creating a key. If no UI exists yet, scope of this spec is the CLI flag and the migration; UI is deferred.
- Tests:
  - Unit tests for each new CLI command (mocked HTTP via `node:http`-based fixtures, same pattern as `@boject/cli upgrade`).
  - Integration tests for the two new API endpoints (auth gates, scope enforcement, applier integration, readonly flag interaction).

**Out (deferred):**

- An in-CMS "Pull schema to project" button. Worth doing once the CLI flow is solid and we see how operators actually work.
- Migration files / rename detection. Documented limitation — out of all four schema-as-code specs.
- Self-hostable npm registry / private mirror for `@boject/cli`. Plan D's release pipeline already covers ghcr.io + public npm.
- Per-resource scopes (`content-types:write`, `content-entries:read`, etc.). Two scopes (`schema:*` and `content:*`) are sufficient for the foreseeable use cases. Splinter further only when there's pull.

## Design Decisions

### Two new HTTP endpoints, not GraphQL

The schema endpoints are operational, not consumer-facing. GraphQL is for content reads by external apps. Keeping the schema export/apply on simple REST mirrors the rest of `/api/content-types/*` and `/api/content-entries/*`, plays well with the existing `validateApiKey` middleware, and keeps the CLI's HTTP code uniform.

### Export endpoint is portable-mode only

`GET /api/schema/export` always returns `portable: true` bundles — no UUIDs in the payload. This matches what `boject schema pull` writes to disk and what `applySchema` (Spec 3) expects. There is no flag for non-portable export from this endpoint; one-shot transfers using non-portable mode go through the existing `pnpm content:export` CLI on the server side.

### Apply endpoint is gated by `BOJECT_SCHEMA_READONLY`

The readonly flag (Spec 1) blocks all human-driven schema edits, and `boject schema apply` is human-driven by definition (it's the CLI). On a readonly instance, the apply endpoint returns 403 with `{ error: 'SCHEMA_READONLY' }` exactly like the other gated endpoints. This is intentional — apply over HTTP and apply via the entrypoint are different surfaces with different lifecycles. The entrypoint is the production deploy mechanism; the HTTP apply is a dev-loop convenience.

This means: in production, the schema dir on disk is the _only_ way to change schema. There is no API path to bypass it. That's the property we wanted from the readonly flag in the first place.

### Scopes default to `content:read` for backwards compatibility

Existing API keys are used today for the GraphQL endpoint, which is the canonical "external app reads published content" use case. Migrating them to `["content:read"]` makes the existing behaviour explicit without changing what works. The migration runs automatically via `prisma migrate deploy` on next deploy; no manual step required.

A key created with `--scopes schema:read` cannot read content via GraphQL. A key created with `--scopes content:read,schema:read` can do both. The CLI typically uses `schema:read` for `pull` and `schema:read,schema:write` for `pull` + `apply`. Operators can issue narrower keys for narrower automation.

### Validate is offline; check is online

Splitting these is deliberate:

- `validate` answers "is this file structurally sound?" — a question with a stable answer, no CMS needed, fast enough for pre-commit.
- `check` answers "does this file match what's deployed?" — a question that depends on a live CMS and a network round-trip, suitable for CI but not for pre-commit.

If we collapsed them into one command with a `--no-network` flag, every pre-commit run would have to remember the flag. Two commands, two clear purposes.

### Config file committed, API key in .env

The `.boject.config.json` is project-level and committed (every dev hits the same dev CMS URL). The API key is per-user / per-environment and lives in `.env` (gitignored, like every other secret in the project). If a team needs different URLs per developer, the config supports a `cms.urlEnv` indirection where the URL itself comes from an env var; we'll add this only if we hit a use case (YAGNI).

### Walks up from CWD to find config

Same pattern as Prettier / ESLint / Vitest. A developer running `boject schema pull` from `apps/cms/` (a subdirectory) still finds the project root's `.boject.config.json`. No `--cwd` flag needed for the common case.

### `apply` exists but `schema:apply` is rare

The CLI's `apply` command is the escape hatch — for headless flows, scripted setup, or pushing schema to a fresh staging instance. The 99% workflow is "edit in dev, export, commit, deploy" — which means the entrypoint apply runs automatically on staging/prod and `boject schema apply` is unused. We ship `apply` for completeness and for the cases where running a deploy is too heavyweight. Documenting it as "you probably want the entrypoint" sets expectations correctly.

### `pull` always overwrites

`boject schema pull` does not merge, does not three-way diff. It overwrites `content-types/schema.boject.json` with whatever the CMS currently has. The user reviews via `git diff` and either commits or `git checkout -- content-types/schema.boject.json` to revert. Trying to be smarter than git here would just hide the diff.

## Endpoint Contracts

### `GET /api/schema/export`

**Auth:** session OR API key with `schema:read`.

**Response:** `200 application/json` — a `Bundle` with `portable: true`, `contentTypes` populated, `entries` omitted.

```json
{
  "version": 2,
  "exportedAt": "2026-05-01T10:23:11.000Z",
  "portable": true,
  "contentTypes": [
    /* ... */
  ]
}
```

**Errors:**

- `401` — auth missing or invalid.
- `403 INSUFFICIENT_SCOPE` — API key missing `schema:read`.

### `POST /api/schema/apply`

**Auth:** session OR API key with `schema:write`.

**Body:**

```json
{
  "bundle": {
    /* Bundle */
  },
  "allowDestructive": false
}
```

**Response (success):** `200` with `ApplySchemaResult` from Spec 3.

**Errors:**

- `400 BUNDLE_INVALID` — `validateBundle` failed; `data.errors` lists issues.
- `400 SCHEMA_APPLY_BLOCKED` — planner produced blockers; `data.blockers` and `data.plan` returned for the CLI to render.
- `403 SCHEMA_READONLY` — readonly flag is on (Spec 1).
- `403 INSUFFICIENT_SCOPE` — API key missing `schema:write`.
- `409 SCHEMA_CHANGED_DURING_APPLY` — race during apply; CLI re-runs.
- `429` — rate limited.

Both endpoints are bucketed by `enforceMutationRateLimit` (apply) and the existing GraphQL-style rate limit pattern (export — though reads are cheap, a runaway pull script shouldn't DoS the CMS).

## CLI Command Contracts

### `boject schema pull [--out <path>] [--url <url>]`

1. Load `.boject.config.json` from CWD upward.
2. Resolve URL (flag > config > error) and API key (env > error).
3. `GET <url>/api/schema/export` with `Authorization: Bearer <key>`.
4. Write the response body to the resolved path.
5. Print summary: type count, field count, bytes written.

Exit 0 on success; 1 on any failure.

### `boject schema validate [<path>]`

1. Resolve path (arg > config > error).
2. Read file, parse JSON.
3. Call `validateBundle`.
4. Call `planSchema(bundle, emptySnapshot)` to surface cross-reference errors.
5. Print summary or errors.

Exit 0 if valid; 1 if invalid. **No network.**

### `boject schema apply [<path>] [--allow-destructive] [--dry-run]`

1. Resolve path, URL, API key.
2. Read file.
3. If `--dry-run`: `POST /api/schema/apply` with the bundle and parse the `400 SCHEMA_APPLY_BLOCKED` response (or 200 success) without committing — the endpoint accepts a `dryRun` flag in the body, internally rolls back the transaction. Print plan summary.
4. Otherwise: `POST /api/schema/apply` and print apply result.
5. On `SCHEMA_APPLY_BLOCKED`: render blockers grouped by code, exit 1.
6. On `SCHEMA_CHANGED_DURING_APPLY`: re-run once automatically; on second failure, exit 1 with a "schema changed concurrently — retry" message.

### `boject schema check [<path>]`

1. Resolve path, URL, API key.
2. `pull` into a temp file (or in-memory).
3. Compute a deep diff vs. the on-disk path.
4. Print human-readable diff; exit 0 if equal, 1 if different.

CI usage: `boject schema check && echo "schema in sync"`.

## API Key Scopes — Migration

New schema state for `ApiKey`:

```prisma
model ApiKey {
  // ... existing fields ...
  scopes String[] @default([])
}
```

Migration SQL (created via `prisma migrate diff` + `prisma migrate deploy`):

```sql
ALTER TABLE "ApiKey" ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill all existing keys to retain GraphQL access:
UPDATE "ApiKey" SET "scopes" = ARRAY['content:read'] WHERE array_length("scopes", 1) IS NULL OR "scopes" = ARRAY[]::TEXT[];
```

The default in the schema is `[]` so newly created keys go through the explicit `--scopes` flag (no accidental over-scoping). The backfill handles existing keys.

`apps/cms/scripts/manage-api-keys/index.ts` adds:

```
pnpm apikey:create <name> --scopes content:read              # default-ish
pnpm apikey:create <name> --scopes schema:read               # CLI pull only
pnpm apikey:create <name> --scopes schema:read,schema:write  # CLI full
pnpm apikey:list                                             # shows scopes column
```

Recognised scopes (v1):

- `content:read` — query content via GraphQL.
- `schema:read` — `GET /api/schema/export`.
- `schema:write` — `POST /api/schema/apply`.

Unknown scopes are accepted at create time (forward compatibility) but never grant access — `assertApiKeyScope` checks against an explicit allow-list.

## Files Added or Modified

| File                                                                       | Change                                                                                                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `packages/boject-cli/src/commands/schemaPull.ts` (new)                     | The pull command.                                                                                                                  |
| `packages/boject-cli/src/commands/schemaValidate.ts` (new)                 | The validate command.                                                                                                              |
| `packages/boject-cli/src/commands/schemaApply.ts` (new)                    | The apply command.                                                                                                                 |
| `packages/boject-cli/src/commands/schemaCheck.ts` (new)                    | The check command.                                                                                                                 |
| `packages/boject-cli/src/config.ts` (new)                                  | Loads `.boject.config.json` walking up from CWD.                                                                                   |
| `packages/boject-cli/src/api.ts` (new)                                     | Tiny HTTP client for `/api/schema/export` and `/api/schema/apply` with `Authorization: Bearer` header.                             |
| `packages/boject-cli/src/index.ts`                                         | Wire the four new commands into argv dispatch.                                                                                     |
| `packages/boject-cli/tests/unit/schemaPull.test.ts` (new)                  | Mock HTTP, assert file write.                                                                                                      |
| `packages/boject-cli/tests/unit/schemaValidate.test.ts` (new)              | Offline; valid + invalid fixtures.                                                                                                 |
| `packages/boject-cli/tests/unit/schemaApply.test.ts` (new)                 | Mock HTTP, assert request body, assert blocker rendering.                                                                          |
| `packages/boject-cli/tests/unit/schemaCheck.test.ts` (new)                 | Mock HTTP, assert diff rendering.                                                                                                  |
| `packages/boject-cli/tests/e2e/schemaCommands.test.ts` (new)               | One end-to-end flow: pull → edit → check → apply against an in-process mock server.                                                |
| `apps/cms/server/api/schema/export.get.ts` (new)                           | `GET /api/schema/export`.                                                                                                          |
| `apps/cms/server/api/schema/apply.post.ts` (new)                           | `POST /api/schema/apply`. Honours `--dry-run` semantics via a body flag.                                                           |
| `apps/cms/server/api/schema/schema.test.ts` (new)                          | Integration tests for both endpoints.                                                                                              |
| `apps/cms/server/utils/validateApiKey.ts`                                  | Extend the returned key shape to include `scopes`.                                                                                 |
| `apps/cms/server/utils/assertApiKeyScope.ts` (new)                         | `assertApiKeyScope(event, scope)`.                                                                                                 |
| `apps/cms/server/middleware/auth.ts`                                       | Add `schema:*` to the recognised-scope allow-list. (No behaviour change to other endpoints — they don't call `assertApiKeyScope`.) |
| `apps/cms/server/api/graphql/graphql.ts`                                   | Call `assertApiKeyScope(event, 'content:read')` after key validation. (Backfilled keys all have it; no regression.)                |
| `apps/cms/prisma/schema/auth.prisma`                                       | Add `scopes String[] @default([])` to `ApiKey`.                                                                                    |
| `apps/cms/prisma/migrations/<timestamp>_apikey_scopes/migration.sql` (new) | The migration above.                                                                                                               |
| `apps/cms/scripts/manage-api-keys/index.ts`                                | Add `--scopes` flag to `create`; show scopes in `list`.                                                                            |
| `packages/create-boject-cms/src/templates/dotEnv.ts`                       | Add commented `# BOJECT_API_KEY=` line for local CLI use.                                                                          |
| `packages/create-boject-cms/src/templates/bojectConfig.ts` (new)           | Write `.boject.config.json` at scaffold time, pointing at `http://localhost:4000`.                                                 |
| `packages/create-boject-cms/src/index.ts`                                  | Wire the new template.                                                                                                             |
| `CLAUDE.md`                                                                | Document the four CLI commands, the two new API endpoints, the API key scope system, and `.boject.config.json` shape.              |

## Test Plan

**CLI unit tests** mirror the existing `@boject/cli upgrade` pattern: mocked HTTP via `node:http` fixtures on a random port, fixture compose / config files in temp directories.

**API integration tests** in `schema.test.ts`:

```typescript
describe('GET /api/schema/export', () => {
  it('returns 401 without auth');
  it('returns 403 INSUFFICIENT_SCOPE for an api key without schema:read');
  it('returns 200 with a portable bundle for a session user');
  it('returns 200 with a portable bundle for an api key with schema:read');
  it('omits entries from the response');
});

describe('POST /api/schema/apply', () => {
  it('returns 401 without auth');
  it('returns 403 INSUFFICIENT_SCOPE for a key without schema:write');
  it('returns 403 SCHEMA_READONLY when the readonly flag is on');
  it('returns 400 BUNDLE_INVALID for a malformed bundle');
  it('returns 400 SCHEMA_APPLY_BLOCKED with blockers and plan');
  it('returns 200 with apply result on success');
  it('honours allowDestructive in the body');
  it('honours dryRun in the body (no DB changes)');
});

describe('api key scopes', () => {
  it('migrated existing keys to ["content:read"]');
  it('rejects graphql calls from a key without content:read');
  it('apikey:create accepts comma-separated scopes');
  it('apikey:list shows scopes');
});
```

**E2E test** in `packages/boject-cli/tests/e2e/schemaCommands.test.ts`:

1. Start an in-process HTTP server mocking `/api/schema/export` and `/api/schema/apply`.
2. Write a fixture project (`.boject.config.json`, `content-types/`).
3. Run `boject schema pull` — assert file written.
4. Mutate the fixture file. Run `boject schema check` — assert drift detected.
5. Run `boject schema apply` — assert apply request sent with the local file's bundle.
6. Run `boject schema validate` against a malformed file — assert exit 1 with the right error code.

## Out of Scope

- In-CMS "Pull schema to project" button (deferred — see overview).
- A `boject schema diff` command (use `git diff content-types/schema.boject.json` after `pull`).
- Authentication via session cookie from the CLI (would require a login flow). API keys are the canonical mechanism for non-browser callers.
- Auto-discovery of multiple environments from one config (e.g. dev / staging / prod URLs in the config and a `--env` flag). One CMS per project root keeps the mental model tight; multi-env teams can use environment variables or per-shell aliases.
- Telemetry / usage metrics for CLI commands.
