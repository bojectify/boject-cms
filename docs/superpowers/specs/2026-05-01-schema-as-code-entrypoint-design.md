# Schema-as-Code: Entrypoint Integration & Scaffolder Updates

## Overview

Wire the idempotent applier (Spec 3) into the container entrypoint so schema-as-code becomes the deploy story. A new `BOJECT_SCHEMA_DIR` environment variable points at a directory of bundle JSON files mounted into the container; the entrypoint runs `applySchema` against each on every boot. Update `create-boject-cms` to scaffold the directory, mount it in the generated `docker-compose.yml`, and write the chosen starter as the initial committed schema. After this spec, a fresh project's content types live in the project's git repo by default.

The semantic contract end users see:

```
flembo-cms/
├── docker-compose.yml          # mounts ./content-types into the container
├── .env                        # BOJECT_SCHEMA_DIR=/app/content-types
└── content-types/
    └── schema.boject.json      # source of truth for content types, in git
```

Boot sequence after this spec:

```
[entrypoint] step 1/6: waiting for database
[entrypoint] step 2/6: applying migrations
[entrypoint] step 3/6: seeding admin if needed
[entrypoint] step 4/6: importing starter if needed       ← BOJECT_INITIAL_STARTER (first-boot seed, unchanged)
[entrypoint] step 5/6: applying schema-as-code           ← BOJECT_SCHEMA_DIR (every-boot apply, NEW)
[entrypoint] step 6/6: starting nuxt server
```

Parent specs: [`2026-05-01-schema-as-code-planner-design.md`](./2026-05-01-schema-as-code-planner-design.md), [`2026-05-01-schema-as-code-applier-design.md`](./2026-05-01-schema-as-code-applier-design.md).

## Approach

**Two distinct env vars, two distinct lifecycles.**

- `BOJECT_INITIAL_STARTER` (existing) — points at a single bundle file, applied **once on first boot only**, gated by "ContentType table is empty." Used to seed brand-new projects with a starter (base / sport / rugby). Imports both schema and entries (the SiteSettings seed entry, etc.). Lifecycle: first-boot only.
- `BOJECT_SCHEMA_DIR` (new) — points at a directory of bundle files, applied **on every boot, idempotent**, gated by the planner refusing destructive ops without `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA`. Used to keep the deployed schema in lockstep with git. Imports schema only. Lifecycle: every boot.

A scaffolded project has both: `BOJECT_INITIAL_STARTER` for the first-boot seed (so initial entries appear), and `BOJECT_SCHEMA_DIR` for ongoing schema-as-code. After first boot, the starter is "consumed" (the gate condition fails on subsequent boots) and the schema dir takes over as the long-lived contract.

**Apply each file in directory-sorted order.** Multiple files allowed for forward compatibility (e.g. a project might split schema into `core.boject.json` + `feature-a.boject.json`). Sorted by filename so ordering is deterministic. v1 expectation: most projects ship one file; the multi-file shape costs nothing to support and avoids a future breaking change.

**Fail loud, fail fast.** A bundle with blockers does not silently skip — the entrypoint exits non-zero, the container crashes, the orchestrator restarts it. Operators see the error in their logs immediately. Production deployments depend on this: a bad schema PR should manifest as "container won't boot" so the deploy pipeline can roll back, not as "container booted but the schema diverged."

**Scaffolder writes the initial schema file too.** The chosen starter (`base` / `sport` / `rugby`) is copied into both `starters/` (for `BOJECT_INITIAL_STARTER`) and `content-types/schema.boject.json` (for `BOJECT_SCHEMA_DIR`). Same content, two roles. After first boot the starter file is unused; after the first time the schema is exported via the CLI (Spec 5), `content-types/schema.boject.json` is overwritten with the canonical export. This means the user's first commit doesn't need to be "export the schema" — it's already there.

## Scope

**In:**

- New entrypoint script `apps/cms/scripts/docker-entrypoint/apply-schema.ts`. Same pattern as the existing `import-starter.ts`: standalone module exporting a pure `applySchemaIfConfigured` function plus a CLI entry that wires up `PrismaPg` and runs against `DATABASE_URL`.
- The script:
  1. Reads `BOJECT_SCHEMA_DIR`. If unset → log skip + exit 0.
  2. Reads `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA` (default false).
  3. Lists `*.boject.json` files in the directory, sorted by filename.
  4. For each file in order: read, parse, call `applySchema(prisma, bundle, { allowDestructive })`. Log the resulting `applied` counts. If any apply throws → exit 1.
  5. After all files apply: log a summary (e.g. "applied 1 file, 0 changes"). Exit 0.
- New shell step in `apps/cms/docker/entrypoint.sh`: between current step 4 (starter import) and current step 5 (Nuxt boot), insert `tsx scripts/docker-entrypoint/apply-schema.ts`. Renumber the existing log lines.
- Update `create-boject-cms` (the scaffolder) to:
  1. Create `<project>/content-types/` directory.
  2. Write `<project>/content-types/schema.boject.json` with the chosen starter's content (or an empty bundle for the `none` choice).
  3. Add a bind mount `./content-types:/app/content-types:ro` to the `cms` service in `docker-compose.yml`.
  4. Add `BOJECT_SCHEMA_DIR=/app/content-types` to the generated `.env`.
  5. Add a commented `# BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true` line to the generated `.env` with explanatory comment.
  6. Update the generated `README.md` to describe schema-as-code briefly: "Content types live in `content-types/`. Edit them via the CMS UI in dev, then commit."
- Update `Dockerfile` to ensure `/app/content-types` exists as a mount point (a placeholder dir baked into the image so the bind mount works on first boot — Docker requires the target to exist when read-only).
- Integration tests using a real Postgres + the Vitest `integration` project: stand up a fixture project state, run the apply-schema script entry, assert the DB matches.
- Smoke-test extension in `apps/cms/docker/smoke-test.sh`: assert that on **second** container boot, apply-schema logs a no-op (`changed=false`); and that editing the bundle file then restarting applies the change.

**Out (deferred):**

- Hot-reload of schema during a single container lifetime (operators restart for changes; the smoke-test verifies this).
- Detecting drift between dev's running CMS and the committed file (CI concern, not entrypoint concern).
- A way to apply schema from inside the running container at runtime (Spec 5 — the CLI does this via the API).

## Design Decisions

### Two env vars, not one with conditional behaviour

Tempted to merge `BOJECT_INITIAL_STARTER` and `BOJECT_SCHEMA_DIR` into a single "BOJECT_SCHEMA" with the same gate logic. Rejected. They are different lifecycles:

- The starter's job is **seeding** — applied once, never again. It includes entries (e.g. SiteSettings seed). On every-boot, re-applying entries is dangerous (it would re-create deleted seed entries, or worse, fail because slug uniqueness).
- The schema-dir's job is **convergence** — applied every boot, schema-only, idempotent. Including entries here would make the deploy story wipe-and-replace, which is the opposite of safe.

Two vars, two clear stories. The cost is documenting both; the alternative is a magic flag inside one var that switches semantics, which is worse.

### Apply runs after starter import

The order is: starter (first boot only, full bundle) → schema dir (every boot, schema only). On a fresh project's first boot, the starter creates the initial schema and entries; the schema dir then re-applies the same schema, which is a no-op (the planner sees zero diffs). On every subsequent boot, only the schema dir runs. Both orderings (starter-then-dir vs. dir-then-starter) work on first boot; running starter first matches the "first-boot seed, then ongoing apply" mental model.

### Fail-fast on apply errors halts the boot

If any bundle in the schema dir produces a `SchemaApplyBlockedError` or any other error, the entrypoint exits non-zero. The container restarts in a crash loop until the bad bundle is fixed (rolled back via git revert + redeploy). This is intentional: a deployment that boots with a half-applied schema would be worse than a deployment that doesn't boot. Loud failure is what makes the schema-as-code contract trustworthy.

For the `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=false` (default) case, this means **destructive bundle changes block the deploy until either the flag is set or the bundle is reverted**. Operators reading deploy logs will see the blocker list with affected entry IDs and can act.

### Multiple files, directory-sorted

Day one shipping with directory semantics rather than single-file is cheap and forward-compatible. A project with one file (`schema.boject.json`) is also a valid directory of one file. A project that grows to split schema across modules can do so without renaming env vars or migrating tooling. The cost: alphabetical-ordering becomes a contract operators may rely on (e.g. `00-base.boject.json` before `10-articles.boject.json`); we document this in the README.

### Initial schema file shipped by scaffolder

A new project's `content-types/schema.boject.json` is populated from the chosen starter at scaffold time, not on first boot. Reasons:

1. The user can `git diff` their committed file against the starter's evolution (if they upgrade and the starter changed) — possible only if it's in their repo from day one.
2. The "first boot is special" magic is reduced: by the time the container starts, the file is already there. The first boot's apply is a no-op (because the starter import created the same schema), making boot logs predictable.
3. If the user edits the schema in the UI and forgets to export (Spec 5's CLI), the committed file is the rollback target. If we generated it on first boot, there'd be a window where it didn't exist.

For the `none` starter choice, the scaffolder writes an empty bundle (`{ version: 2, exportedAt: '...', portable: true, contentTypes: [] }`) so the apply path always has something to read.

### Bind mount as read-only

The schema dir is mounted `:ro` so the container cannot overwrite the user's source files. The CMS does not write to this path — exports go via the API, the CLI writes the file from the _host_ side. Read-only enforces this boundary at the OS level and prevents UID-mismatch surprises (the `cms` user in the container would otherwise own any files it wrote).

### Schema dir lives at `/app/content-types` inside the container

Matches the existing convention (`/app/storage`, `/app/starters`). The host path is the user's choice (the scaffolder puts it at `./content-types/`); the container path is fixed.

### `tsx` to run the script, same as the rest of the entrypoint

Consistent with `wait-for-db.ts`, `seed-admin.ts`, `import-starter.ts`. `tsx` is already a runtime dep. No build-time compilation step needed.

## Boot Sequence Detail

Updated `entrypoint.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
log() { echo "[entrypoint] $*"; }

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

Apply-schema script behaviour:

```
[apply-schema] BOJECT_SCHEMA_DIR=/app/content-types
[apply-schema] reading 1 file: schema.boject.json
[apply-schema] schema.boject.json: 0 created, 0 updated, 0 removed (no-op)
[apply-schema] done — 1 file applied, 0 total changes
```

On a non-empty change:

```
[apply-schema] schema.boject.json: 1 created, 2 updated, 0 removed
[apply-schema] done — 1 file applied, 3 total changes
```

On a blocker:

```
[apply-schema] schema.boject.json: BLOCKED
  - FIELD_TYPE_CHANGE at Article.publishDate: cannot change field type from DATETIME to TEXT
  - CONTENT_TYPE_REMOVAL_WITH_ENTRIES at Tag: 4 entries exist (use BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true is insufficient — delete entries first)
[apply-schema] failing boot
```

## Files Added or Modified

| File                                                                                        | Change                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cms/scripts/docker-entrypoint/apply-schema.ts` (new)                                  | Standalone script. Exports `applySchemaIfConfigured(prisma, opts)` plus a CLI entry.                                                                                                                                                   |
| `apps/cms/scripts/docker-entrypoint/apply-schema.test.ts` (new)                             | Unit tests on the pure logic with a fake Prisma. Mirrors `import-starter.ts` test conventions.                                                                                                                                         |
| `apps/cms/docker/entrypoint.sh`                                                             | Insert step 5 (apply-schema), renumber log lines.                                                                                                                                                                                      |
| `apps/cms/Dockerfile`                                                                       | Add `RUN mkdir -p /app/content-types` to the runtime stage so the bind mount target exists.                                                                                                                                            |
| `apps/cms/docker/smoke-test.sh`                                                             | Extend: second-boot apply is a no-op; edit-restart applies a change.                                                                                                                                                                   |
| `packages/create-boject-cms/src/templates/dockerCompose.ts` (or equivalent)                 | Add `./content-types:/app/content-types:ro` bind mount to the `cms` service.                                                                                                                                                           |
| `packages/create-boject-cms/src/templates/dotEnv.ts` (or equivalent)                        | Add `BOJECT_SCHEMA_DIR=/app/content-types` line; add commented `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA=true` line with comment.                                                                                                               |
| `packages/create-boject-cms/src/templates/contentTypes.ts` (new, or extend templates index) | Write `content-types/schema.boject.json` with the chosen starter's content. For `none`, write the empty bundle stub.                                                                                                                   |
| `packages/create-boject-cms/src/index.ts`                                                   | Wire the new content-types template into the file-write phase.                                                                                                                                                                         |
| `packages/create-boject-cms/src/templates/readme.ts`                                        | Add a "Content types" section explaining schema-as-code briefly.                                                                                                                                                                       |
| `packages/create-boject-cms/tests/scaffold.test.ts`                                         | Add assertions: `content-types/schema.boject.json` exists, compose has the bind mount, `.env` has `BOJECT_SCHEMA_DIR`.                                                                                                                 |
| `apps/cms/scripts/docker-entrypoint/import-starter.ts`                                      | No behavioural change. Add a comment cross-referencing the new apply-schema script and clarifying the lifecycle distinction.                                                                                                           |
| `CLAUDE.md`                                                                                 | Document `BOJECT_SCHEMA_DIR` and `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA` in the env vars list. Add a "Schema-as-code" subsection under "Database Schema" describing the lifecycle. Update the entrypoint description to reflect the 6 steps. |
| `starters/README.md`                                                                        | Note that starter bundles are also valid `BOJECT_SCHEMA_DIR` content (same format), and that the scaffolder copies the chosen starter into the project's `content-types/` directory.                                                   |

## Test Plan

**Unit tests** (`apply-schema.test.ts`, `unit` Vitest project):

```typescript
describe('applySchemaIfConfigured', () => {
  it('skips when BOJECT_SCHEMA_DIR is unset');
  it('skips when the directory is empty');
  it('skips when the directory contains no .boject.json files');
  it('reads files in alphabetical order');
  it('calls applySchema once per file');
  it('passes allowDestructive from BOJECT_ALLOW_DESTRUCTIVE_SCHEMA');
  it('logs a summary line on success');
  it('throws on the first failing file (does not continue)');
  it('logs each blocker on a SchemaApplyBlockedError');
});
```

The applier itself is mocked (`importBundle: jest.fn()`-style) — the script's job is the file walk and env handling; the actual mutations are Spec 3's tests.

**Integration tests** in the `integration` project:

```typescript
describe('apply-schema entrypoint integration', () => {
  it('applies a schema bundle to an empty DB');
  it('is a no-op when the bundle matches current state');
  it('applies a diff (add field) when the bundle is updated');
  it('refuses without the destructive flag when removing a type');
  it('applies the removal with the destructive flag');
});
```

**Smoke test** (`docker/smoke-test.sh`):

1. Build the image. Stand up an ephemeral Postgres.
2. Mount a fixture `content-types/` dir with a single bundle.
3. Boot the container. Assert step 4 (starter) imports, step 5 (apply-schema) is a no-op (the starter already created the schema).
4. Restart the container. Assert step 5 logs "0 changes".
5. Mutate the fixture bundle (add a new field). Restart the container. Assert step 5 logs the change applied.
6. Mutate the fixture bundle to remove an existing type with entries. Restart the container. Assert the container exits non-zero and the blocker is in the log.
7. Tear down.

**Scaffolder tests** (`packages/create-boject-cms/tests/scaffold.test.ts`):

- Scaffolding with `--starter base`: assert `content-types/schema.boject.json` matches `starters/base.boject.json` byte-for-byte.
- Scaffolding with `--starter none`: assert `content-types/schema.boject.json` is the empty bundle stub.
- Assert compose file has `./content-types:/app/content-types:ro`.
- Assert `.env` contains `BOJECT_SCHEMA_DIR=/app/content-types`.

## Out of Scope

- Hot reload (a `BOJECT_SCHEMA_DIR` change without a restart). The container model is restart-on-change, matching the rest of the env-var-driven config.
- Validation in CI of "the committed schema matches the running dev CMS." Separate concern, lives in Spec 5's `boject schema check` command (or a CI workflow consuming the same).
- A migration path for existing scaffolded projects to gain the schema dir. Existing flembo-style projects without `content-types/` simply won't run step 5; users opt in by adding the dir + env var. The upgrade CLI (`@boject/cli upgrade`) does not need to backfill these — that's a documented manual step.
- Multi-database / sharded apply. We assume one DB per CMS instance, which matches every other part of the system.
