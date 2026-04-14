# Content Bundle CLI

## Overview

Ship a CLI that exports and imports dynamic content types and their entries as portable JSON bundles.

**Primary use case:** Onboarding a fresh CMS instance with a pre-built set of content types (seed data). A future scaffolder tool (e.g. `pnpx create-boject-cms`) will clone the repo, set up the database, then run `pnpm content:import <starter>.boject.json` to apply a chosen starter kit.

**Secondary use cases:** Copy/clone between instances, version-control schemas, share content type shapes across projects.

**Scope:** JSON format, CLI only (no UI yet), separately invokable modes for schema-only, entries-only, or both. Supports a portable mode that rewrites UUID references into human-meaningful keys for cross-instance migration.

## Prerequisite: Unique `entryTitle`

Portable-mode references resolve entries by `slug || entryTitle`. `slug` is already unique per content type via `(contentTypeId, slug)`, but `entryTitle` is currently a JSONB value on `ContentEntry.data` with no uniqueness guarantee. This spec promotes `entryTitle` to a first-class column.

**Schema changes:**

- Add `entryTitle String` column on `ContentEntry`
- Add unique constraint on `(contentTypeId, entryTitle)`
- Mirrors how `slug` is already handled (stored both in JSONB `data` and a dedicated column)

**Behaviour changes:**

- API keeps `data[titleFieldIdentifier]` and the `entryTitle` column in sync on create/update (same pattern as slug)
- `validateEntryData` enforces presence and non-emptiness
- DB unique index enforces uniqueness — a 409 is returned on collision (via `withPrismaErrors`)

**Migration:**

- Pre-check for duplicates before applying the constraint
- If duplicates exist, fail the migration with an error listing the offending `(contentType, entryTitle)` pairs — user resolves manually. Seed data is small, this is a dev-time concern.

**`validateEntryData` update:**

- Add an optional `{ skipRelationRequired?: boolean }` option so the two-pass portable import can defer required-on-relation checks to pass 2 without duplicating validation logic. Default behaviour (no option passed) is unchanged for existing callers.

## Bundle Format

Single JSON file per bundle. Convention: `*.boject.json`. Pretty-printed with 2-space indent so bundles diff cleanly in git.

```json
{
  "version": 1,
  "exportedAt": "2026-04-14T10:00:00.000Z",
  "portable": false,
  "contentTypes": [
    {
      "id": "uuid-or-null-if-portable",
      "identifier": "BlogPost",
      "name": "Blog Post",
      "description": "...",
      "fields": [
        {
          "id": "uuid-or-null-if-portable",
          "identifier": "title",
          "name": "Title",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "identifier": "category",
          "name": "Category",
          "type": "RELATION",
          "required": false,
          "order": 1,
          "options": {
            "targetContentTypeIds": ["uuid-or-null-if-portable"],
            "targetContentTypeIdentifiers": ["Category"]
          }
        }
      ]
    }
  ],
  "entries": [
    {
      "id": "uuid-or-null-if-portable",
      "contentTypeId": "uuid-or-null-if-portable",
      "contentTypeIdentifier": "BlogPost",
      "entryTitle": "Hello world",
      "slug": "hello-world",
      "status": "PUBLISHED",
      "publishedAt": "2026-03-01T00:00:00.000Z",
      "data": {
        "title": "Hello world",
        "body": { "type": "doc", "content": [] }
      }
    }
  ]
}
```

**Field notes:**

- `version` — bundle schema version. v1 now. Lets future imports detect format.
- `portable` — recorded at export, governs how import resolves references.
- **Non-portable mode**: UUIDs (`id`, `contentTypeId`, `targetContentTypeIds`) are authoritative. `identifier`, `slug`, `entryTitle` are included for readability but not used as keys.
- **Portable mode**: `id` fields are `null`. Import generates fresh UUIDs. References resolved via `identifier` (types) and `slug || entryTitle` (entries).
- `data` is preserved verbatim by default, including ProseMirror JSON for RICHTEXT fields and SELECT values. In portable mode, RELATION and MULTIRELATION refs inside `data` are rewritten — see Export Behavior.

**System fields explicitly excluded** (regenerated on import, not a backup format):

- `createdAt`, `updatedAt` — set to import time
- `createdBy`, `updatedBy` — set from an optional `--author` flag or left null

`publishedAt` is preserved because it is content-meaningful, not system metadata.

## CLI Commands

All commands are wrappers over an importable module (`scripts/content-bundle/`) so the future scaffolder can either shell out or import the functions directly.

### Module structure

```
scripts/content-bundle/
  index.ts          # CLI entry — arg parsing, exit codes
  export.ts         # exports: exportBundle({ mode, portable }) -> Bundle
  import.ts         # exports: importBundle(bundle, { mode, author? }) -> ImportResult
  validate.ts       # exports: validateBundle(bundle) -> ValidationResult
  types.ts          # shared Bundle, ImportResult, ValidationResult types
  fixtures/         # known-good bundles used by tests and regression
```

- `index.ts` parses args and calls the module functions. Returns exit code based on result.
- Module functions take an explicit `PrismaClient` so callers (tests, scaffolder) can pass their own instance.
- `types.ts` exports typed shapes for callers.

### `pnpm content:export`

```
pnpm content:export [--schema | --entries | --all] [--portable] [--out <path>]
```

- `--schema` (default if no mode flag) — content types + fields only
- `--entries` — entries only (assumes target already has matching schema)
- `--all` — schema + entries in one bundle
- `--portable` — rewrite refs to identifier/slug keys, strip UUIDs
- `--out <path>` — defaults to `./content-bundle.json` (or `-schema.json` / `-entries.json` depending on mode)

### `pnpm content:import`

```
pnpm content:import <path> [--schema | --entries | --all] [--author <string>]
```

- Positional `<path>` — bundle file to import
- `--schema` / `--entries` / `--all` — which portion to apply. Default matches what's in the bundle (schema-only bundle → `--schema`; full bundle → `--all`)
- `--author <string>` — written to `createdBy` / `updatedBy` on imported entries. Optional.
- Reads `bundle.portable` to decide resolution strategy
- Conflict handling: fail fast on any collision. No flags for replace/skip in v1.

### `pnpm content:validate`

```
pnpm content:validate <path>
```

- Parse + schema-check the bundle without touching the database
- Used by CI to gate starter-kit bundles, by the scaffolder, and as a pre-flight before a real import
- Non-zero exit on any validation error

## Export Behavior

`exportBundle({ mode, portable })` flow:

1. **Fetch content types** (if mode is `schema` or `all`):
   `prisma.contentType.findMany({ include: { fields: { orderBy: { order: 'asc' } } } })`
2. **Fetch entries** (if mode is `entries` or `all`):
   `prisma.contentEntry.findMany({ include: { contentType: true } })`
3. **Assemble bundle:**
   - Non-portable: emit `id`, `contentTypeId`, and `options.targetContentTypeIds` as UUIDs. `data` preserved verbatim.
   - Portable: walk every reference and rewrite (see below). All `id` fields set to `null`.
4. **Portable validation**: if any referenced entry resolves to neither slug nor entryTitle, abort with an error listing the offenders. (entryTitle is required post-migration, so this is a belt-and-braces check against dev mistakes.)
5. **Write to disk** with 2-space indent.

### Portable reference rewriting

- Field `options.targetContentTypeIds` → add parallel `targetContentTypeIdentifiers` (array positions aligned), strip UUIDs.
- Entry `data` RELATION values `{ contentTypeId, entryId }` → `{ contentTypeIdentifier, entryKey }` where `entryKey = slug || entryTitle`.
- Entry `data` MULTIRELATION arrays — same rewrite applied to each element. Order preserved.
- Entry `contentTypeId` stripped. `contentTypeIdentifier` becomes the key.

### RICHTEXT and CmsEmbed

`data` for a RICHTEXT field is a ProseMirror JSON document. If it contains `cmsEmbed` nodes pointing at dynamic entries, portable mode recursively rewrites `embedId` → `{ contentTypeIdentifier, entryKey }`. Non-portable leaves embeds untouched.

This assumes `CmsEmbed` has been rewired to reference dynamic content types. The current extension references hardcoded rugby model names (`team/club/competition/season`) — those are deleted as part of separate work and are not our concern here. If encountered in a bundle, they pass through untouched (the `embedType` string is just preserved).

### Not exported

- `createdAt`, `updatedAt`, `createdBy`, `updatedBy` on entries
- `User` records
- `ApiKey` records
- Image file bytes (no file-field support yet in the dynamic system)

## Import Behavior

`importBundle(bundle, { mode, author? })` runs inside a single `prisma.$transaction`.

1. **Parse and validate bundle shape**
   - Check `version === 1`
   - Validate shape (zod or hand-rolled): content type entries have required keys, field `type` values are valid enum members, SELECT fields have `choices`, RELATION/MULTIRELATION fields have `targetContentTypeIds` or `targetContentTypeIdentifiers`
   - Abort on any shape issue with a path-based error (e.g. `contentTypes[0].fields[2].options`)

2. **Conflict pre-flight** (before any writes)
   - Non-portable: check `ContentType.id`, `ContentTypeField.id`, `ContentEntry.id` — fail if any collide
   - Both modes: check `ContentType.identifier`, `(contentTypeId, slug)`, `(contentTypeId, entryTitle)` — fail listing all offenders
   - All-or-nothing — no partial imports

3. **Write content types** (if mode is `schema` or `all`)
   - Portable: generate fresh UUIDs for each `ContentType` and `ContentTypeField`. Build an `identifier → UUID` map that includes both new types being imported and existing types already in the DB (so relations can target pre-existing types).
   - Non-portable: use UUIDs from the bundle.
   - Resolve field `options.targetContentTypeIds`:
     - Non-portable: use UUIDs as-is
     - Portable: resolve via `targetContentTypeIdentifiers` through the identifier→UUID map. Error if any identifier cannot be resolved.

4. **Write entries** (if mode is `entries` or `all`)
   - **Non-portable path**: single pass. `data` already has UUIDs; insert directly after running `validateEntryData`. Sync `entryTitle` and `slug` columns from `data` (same as normal API routes).
   - **Portable path**: two passes.
     - **Pass 1**: for each entry, resolve `contentTypeIdentifier` → UUID. Insert entry with `data` stripped of RELATION / MULTIRELATION values and RICHTEXT `cmsEmbed` node refs — scalar fields (TEXT, NUMBER, BOOLEAN, DATETIME, SELECT, ENTRY_TITLE, SLUG, plain RICHTEXT body) are written as-is. `validateEntryData` runs in "pass 1 mode" which skips required-check on relation fields (deferred to pass 2) but still enforces scalar type checks. Build a lookup map keyed by `contentTypeIdentifier + entryKey` → new entry UUID.
     - **Pass 2**: for each entry, walk the bundle's original `data` and resolve RELATION, MULTIRELATION, and `cmsEmbed` refs. Resolution order per ref: (a) lookup map for entries inside the bundle, (b) DB query by `(contentTypeId, slug)` for existing entries, (c) fallback to `(contentTypeId, entryTitle)`. Write the fully-resolved `data` via `prisma.contentEntry.update`, then run the complete `validateEntryData` including required-on-relation checks.
   - `publishedAt` preserved from bundle; `createdAt` / `updatedAt` set to now; `createdBy` / `updatedBy` set from `--author` flag or null.
   - All entry writes are validated by `validateEntryData`.

5. **On any failure**: transaction rolls back, CLI exits non-zero, error message identifies the failing row.

### Missing references in portable mode

If an entry's `data` references an entry that is neither in the bundle nor in the DB, import fails with a clear error: `Entry <contentTypeIdentifier>:<entryKey> references missing <targetContentTypeIdentifier>:<entryKey>`. User resolves by including the referenced entry or importing it separately first.

## Validation and Errors

### Error shapes

```ts
type ValidationError = { path: string; message: string };

type ConflictError = {
  kind: 'contentType.identifier' | 'entry.slug' | 'entry.entryTitle' | 'id';
  identifier: string;
  existingId?: string;
};
```

- CLI groups errors by kind, one line per offender, exit code 1.
- Errors surface the `path` for shape issues (e.g. `contentTypes[0].fields[2].options`) so users can locate the problem in the JSON.

### `validateBundle`

- Runs the same shape + reference checks as `importBundle` pass 1 without touching the DB
- Returns `{ ok: boolean; errors: ValidationError[] }`
- `pnpm content:validate` is a thin CLI wrapper

## Testing

- **Unit tests** — pure-function tests of the portable ref-rewrite walkers (encode + decode round-trip), shape validation, conflict pre-flight logic.
- **Integration tests** — Prisma against the test DB, full export → wipe → import round-trip in both portable and non-portable modes. Covers RELATION, MULTIRELATION, RICHTEXT with embeds, SELECT, all scalar field types. Reuses the test harness used by `content-entries.test.ts`.
- **Fixture bundles** — `scripts/content-bundle/fixtures/` holds known-good bundles (minimal, with-relations, with-richtext) used by tests and available as a regression baseline.
- CI runs `pnpm content:validate` against any bundles committed under `starters/` or `scripts/content-bundle/fixtures/`.

## Out of Scope

- UI for export/import (file picker, bundle preview). A thin wrapper once needed.
- Remote / HTTP mode (CLI hitting a deployed instance's API with a Bearer key).
- Conflict flags (`--replace`, `--skip`, `--force`). Add when a real use case appears.
- Backup/restore semantics — preserving `createdAt`, `createdBy`, `User` records, `ApiKey` records.
- Image / file bytes — blocked on a future file-field type in the dynamic system.
- Migrating the existing rugby models (Team, Club, Player, Fixture, etc.) — separate spec once this lands and file-field + repeater support exists.
- Bundle format v2 and migrations between format versions.
