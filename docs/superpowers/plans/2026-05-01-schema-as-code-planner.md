# Schema-as-Code Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `planSchema()` — a pure function that diffs a desired schema bundle against a `CurrentSchemaSnapshot` and produces a `SchemaPlan` of safe operations, warnings, and blockers covering every row of the spec's diff matrix. Plus the `snapshotCurrentSchema()` loader that produces the snapshot from a Prisma client.

**Architecture:** Pure planner (`planSchema.ts`), impure loader (`snapshotCurrentSchema.ts`), shared types (`schemaPlan.types.ts`). Planner is unit-tested with hand-crafted snapshots; loader has one DB-backed test. Planner uses identifier-based merge keys (UUIDs in bundle ignored). Two-pass output: content-type ops, then field ops.

**Tech Stack:** TypeScript, Prisma 7 (loader only), Vitest unit project (planner) + DB-backed unit tests (loader, following the existing `import.test.ts` pattern). Pure function — no Nuxt or h3.

**Originating spec:** [`docs/superpowers/specs/2026-05-01-schema-as-code-planner-design.md`](../specs/2026-05-01-schema-as-code-planner-design.md)
**Branch:** `schema/planner` (will be created off `main` after the prereq PR merges)
**Parents shipped:**

- Spec 1 — schema-readonly-flag (PR #150).
- Bundle-format prereq — `unique` flag round-trip (PR #151). This was originally Task 1 of this plan; it's been split into a standalone bug-fix PR. **Start execution at Task 2.**

**Children that consume this:** Spec 3 (applier), Spec 4 (entrypoint), Spec 5 (CLI).

---

## File Structure

| File                                                                 | Responsibility                                                                                                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/cms/scripts/content-bundle/types.ts` (modify)                  | Add `unique?: boolean` to `BundleField`. Bundle format gap — see Task 1.                                                                                                       |
| `apps/cms/scripts/content-bundle/validate.ts` (modify)               | Accept the new optional `unique` field; reject non-boolean if present.                                                                                                         |
| `apps/cms/scripts/content-bundle/export.ts` (modify)                 | Emit `unique` from the DB row into bundle exports.                                                                                                                             |
| `apps/cms/scripts/content-bundle/roundtrip.test.ts` (modify)         | Round-trip assertion: a content type with `unique: true` on a TEXT field survives export → import.                                                                             |
| `apps/cms/scripts/content-bundle/schemaPlan.types.ts` (new)          | All exported types from the spec — `SchemaPlan`, `Blocker`, `Warning`, `TypeUpdate`, `FieldUpdate`, `FieldRemoval`, `TypeRemoval`, `CurrentSchemaSnapshot`, `FieldUsage`, etc. |
| `apps/cms/scripts/content-bundle/planSchema.ts` (new)                | The pure planner. No Prisma. Built incrementally in Tasks 5–17.                                                                                                                |
| `apps/cms/scripts/content-bundle/planSchema.test.ts` (new)           | Unit tests, one `describe` per row group of the diff matrix. Hand-crafted snapshots; no DB.                                                                                    |
| `apps/cms/scripts/content-bundle/snapshotCurrentSchema.ts` (new)     | `snapshotCurrentSchema(prisma)` — the only impure file in this spec. Reads content types, fields, and per-field usage stats.                                                   |
| `apps/cms/scripts/content-bundle/snapshotCurrentSchema.test.ts`(new) | DB-backed test (unit project, following `import.test.ts` pattern). Seeds 2 content types + a few entries, asserts the returned snapshot.                                       |

---

## Cross-Cutting Notes

**Vitest projects.** All new tests live under `apps/cms/scripts/content-bundle/` and run in the **unit** project (`scripts/**/*.test.ts`). The unit project has no `globalSetup`, so any test that hits the DB resets it explicitly (see existing `import.test.ts:11-15`). The planner tests do NOT touch the DB; only `snapshotCurrentSchema.test.ts` does.

**To run the new unit tests during development:**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/snapshotCurrentSchema.test.ts
```

**Postgres needed for snapshot test:** ensure `pnpm db:up` (the test DB connection lives at `postgresql://boject:boject@localhost:5432/boject_test`).

**`unique` on `BundleField`.** Already added to the bundle format in PR #151 (originally Task 1 of this plan, split into a standalone bug-fix PR). The fallback rule when `unique` is absent on an imported bundle: implicit `true` for `ENTRY_TITLE`/`SLUG`, `false` otherwise — matches `apps/cms/server/utils/validateFieldUnique.ts::resolveUniqueFlag`. Don't import h3 from the planner — duplicate the tiny implicit-unique-types set inside `schemaPlan.types.ts` or `planSchema.ts` (already present as `effectiveBundleUnique` per Task 2).

**lefthook on commit.** Pre-commit runs prettier + lint + per-package typecheck. If a hook rewrites formatting, re-stage and retry. If a hook fails (lint/typecheck), fix the underlying issue, re-stage, retry. Do NOT pass `--no-verify`.

**Commit messages.** Conventional commits matching recent history (`feat:`, `chore:`, `docs:`, `test:`). Each commit ends with the trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

**pnpm only.** Never `npm` / `npx`.

---

### Task 1: Extend bundle format with `unique` ✅ LANDED IN PR #151 — SKIP

The bundle format did not previously carry the `unique` flag. The planner needs it. This task added an optional `unique?: boolean` to `BundleField`, accepts it in validation (rejecting non-boolean if present), emits it from export, and added a round-trip test.

> **Skip this task during execution.** It was split into PR #151 ahead of the planner work to keep this PR focused. The implementation details below are kept for context only — the work is already on `main` (or will be once #151 merges). Confirm via `grep -n unique apps/cms/scripts/content-bundle/types.ts` that `unique?: boolean` is present on `BundleField`, then proceed to Task 2.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/types.ts`
- Modify: `apps/cms/scripts/content-bundle/validate.ts`
- Modify: `apps/cms/scripts/content-bundle/export.ts`
- Modify: `apps/cms/scripts/content-bundle/roundtrip.test.ts`

- [ ] **Step 1: Read the current shape**

```bash
grep -n "unique" apps/cms/scripts/content-bundle/types.ts apps/cms/scripts/content-bundle/validate.ts apps/cms/scripts/content-bundle/export.ts apps/cms/scripts/content-bundle/import.ts
```

Expected: no matches.

- [ ] **Step 2: Add `unique?: boolean` to `BundleField`**

In `apps/cms/scripts/content-bundle/types.ts`, the existing interface is:

```ts
export interface BundleField {
  id: string | null;
  identifier: string;
  name: string;
  type: FieldType;
  required: boolean;
  order: number;
  options: BundleFieldOptions | null;
}
```

Add `unique?: boolean` between `required` and `order` (alphabetical-ish would put it after `required`):

```ts
export interface BundleField {
  id: string | null;
  identifier: string;
  name: string;
  type: FieldType;
  required: boolean;
  unique?: boolean;
  order: number;
  options: BundleFieldOptions | null;
}
```

- [ ] **Step 3: Validate `unique` shape in `validate.ts`**

Find `validateField` (or whatever validates an individual field — read the file to confirm). After the existing `required` check, add a check that if `unique` is present it must be a boolean:

```ts
if ('unique' in f && typeof f.unique !== 'boolean') {
  errors.push({
    path: `${path}.unique`,
    message: 'must be a boolean if present',
  });
}
```

Use the same `errors.push` shape as the surrounding code; don't change unrelated lines.

- [ ] **Step 4: Emit `unique` from `export.ts`**

In `apps/cms/scripts/content-bundle/export.ts`, find the field-mapping block that returns the `BundleField` literal (currently lines ~85–93, with `id`, `identifier`, `name`, `type`, `required`, `order`, `options`). Add `unique: f.unique` between `required` and `order`:

```ts
return {
  id: portable ? null : f.id,
  identifier: f.identifier,
  name: f.name,
  type: f.type,
  required: f.required,
  unique: f.unique,
  order: f.order,
  options: outOpts,
};
```

`f.unique` is a Prisma column on `ContentTypeField` already.

- [ ] **Step 5: Add the round-trip test**

In `apps/cms/scripts/content-bundle/roundtrip.test.ts`, add a new `it` at the end of the existing `describe`:

```ts
it('preserves unique=true on a TEXT field through export → import', async () => {
  await reset();
  const ct = await prisma.contentType.create({
    data: {
      name: 'UniqueRoundtrip',
      identifier: 'UniqueRoundtrip',
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
          {
            identifier: 'sku',
            name: 'SKU',
            type: 'TEXT',
            required: false,
            unique: true,
            order: 1,
          },
        ],
      },
    },
  });

  const exported = await exportBundle(prisma, {
    mode: 'schema',
    portable: true,
  });

  // Sanity check: the exported bundle carries unique on both fields.
  const exportedType = exported.contentTypes!.find(
    (c) => c.identifier === 'UniqueRoundtrip'
  )!;
  expect(exportedType.fields.find((f) => f.identifier === 'sku')!.unique).toBe(
    true
  );
  expect(
    exportedType.fields.find((f) => f.identifier === 'title')!.unique
  ).toBe(true);

  // Now wipe and re-import.
  await prisma.contentType.delete({ where: { id: ct.id } });
  await importBundle(prisma, exported, { mode: 'schema' });

  const reimportedField = await prisma.contentTypeField.findFirst({
    where: { identifier: 'sku' },
  });
  expect(reimportedField?.unique).toBe(true);
});
```

Confirm `exportBundle` and `importBundle` are already imported at the top of the test file. If not, add them.

- [ ] **Step 6: Update `import.ts` to accept and use `unique`**

In `apps/cms/scripts/content-bundle/import.ts`, find the spot where field rows are built for `prisma.contentTypeField.create`. The existing code likely passes `required: f.required` but not `unique`. Add `unique: f.unique ?? false` (the fallback handles legacy v1/v2 bundles without `unique`) — adjust to whatever shape the file uses.

If you're unsure where to apply this, run:

```bash
grep -n "required" apps/cms/scripts/content-bundle/import.ts
```

That should pinpoint the field-create call sites.

- [ ] **Step 7: Run round-trip + existing bundle tests**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/
```

Expected: all green, including the new test.

- [ ] **Step 8: Commit**

```bash
git add apps/cms/scripts/content-bundle/types.ts apps/cms/scripts/content-bundle/validate.ts apps/cms/scripts/content-bundle/export.ts apps/cms/scripts/content-bundle/import.ts apps/cms/scripts/content-bundle/roundtrip.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): carry unique flag on BundleField

The bundle format previously dropped the field-level unique flag on
export and ignored it on import. The schema planner needs it to diff
unique transitions (rows 13-15 of the diff matrix). Adds it as an
optional property; legacy bundles without it import unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Define plan types

Drop the entire type definition block from the spec into a new file. Pure types only. No imports from Prisma (only types) and no runtime code.

**Files:**

- Create: `apps/cms/scripts/content-bundle/schemaPlan.types.ts`

- [ ] **Step 1: Create the file**

```ts
// apps/cms/scripts/content-bundle/schemaPlan.types.ts
//
// Type contract for the schema-as-code planner. The applier (Spec 3)
// and CLI (Spec 5) both consume SchemaPlan as their interface.

import type { FieldType } from '#prisma';
import type { Bundle, BundleContentType, BundleField } from './types';

/** Snapshot of current schema state, fetched once before planning. */
export interface CurrentSchemaSnapshot {
  contentTypes: Array<{
    id: string;
    identifier: string;
    name: string;
    description: string | null;
    fields: Array<{
      id: string;
      identifier: string;
      name: string;
      type: FieldType;
      required: boolean;
      unique: boolean;
      order: number;
      options: Record<string, unknown> | null;
    }>;
    /** Total entries (any status) for this type. Used for removal safety. */
    entryCount: number;
  }>;
  /** Per-field stats for safety checks. Keyed by `${typeIdentifier}:${fieldIdentifier}`. */
  fieldUsage: Map<string, FieldUsage>;
}

export interface FieldUsage {
  /** Entries with a non-null/non-undefined value for this field. */
  entriesWithValue: number;
  /** For SELECT fields: count of entries by choice value. */
  selectChoiceCounts?: Map<string, number>;
  /** For RELATION/MULTIRELATION: count of entries pointing at each target identifier. */
  relationTargetCounts?: Map<string, number>;
  /** For NUMBER/TEXT: ordered list of duplicate values + the entry IDs holding them. */
  duplicateValues?: Array<{ value: string | number; entryIds: string[] }>;
}

export interface SchemaPlan {
  contentTypes: {
    create: BundleContentType[];
    update: TypeUpdate[];
    remove: TypeRemoval[];
  };
  fields: {
    create: FieldCreate[];
    update: FieldUpdate[];
    remove: FieldRemoval[];
  };
  warnings: Warning[];
  blockers: Blocker[];
}

export interface TypeUpdate {
  id: string;
  identifier: string;
  changes: Partial<Pick<BundleContentType, 'name' | 'description'>>;
}

export interface TypeRemoval {
  id: string;
  identifier: string;
  entryCount: number;
}

export interface FieldCreate {
  contentTypeId: string;
  contentTypeIdentifier: string;
  field: BundleField;
}

export interface FieldUpdate {
  id: string;
  contentTypeIdentifier: string;
  fieldIdentifier: string;
  changes: Partial<{
    name: string;
    required: boolean;
    unique: boolean;
    order: number;
    options: Record<string, unknown>;
  }>;
}

export interface FieldRemoval {
  id: string;
  contentTypeIdentifier: string;
  fieldIdentifier: string;
  entriesWithValue: number;
}

export type WarningCode =
  | 'NEW_REQUIRED_FIELD_WITH_ENTRIES'
  | 'OPTIONAL_TO_REQUIRED_NO_NULLS'
  | 'UNRECOGNISED_FIELD_OPTION';

export interface Warning {
  code: WarningCode;
  message: string;
  path: string;
}

export type BlockerCode =
  | 'CONTENT_TYPE_REMOVAL_WITH_ENTRIES'
  | 'CONTENT_TYPE_IDENTIFIER_CHANGE'
  | 'FIELD_IDENTIFIER_CHANGE'
  | 'FIELD_TYPE_CHANGE'
  | 'OPTIONAL_TO_REQUIRED_HAS_NULLS'
  | 'UNIQUE_CONFLICT'
  | 'SELECT_CHOICE_REMOVED_IN_USE'
  | 'RELATION_TARGET_REMOVED_IN_USE'
  | 'CONTENT_TYPE_REMOVAL_NEEDS_FLAG'
  | 'FIELD_REMOVAL_NEEDS_FLAG'
  | 'RELATION_TARGET_NOT_FOUND';

export interface Blocker {
  code: BlockerCode;
  message: string;
  path: string;
  /** Affected entry IDs, for blockers that name specific entries. */
  affectedEntryIds?: string[];
}

export interface PlanOptions {
  allowDestructive?: boolean;
}

/**
 * The fallback for `unique` when a bundle field doesn't carry it
 * explicitly. Mirrors the rule in
 * `apps/cms/server/utils/validateFieldUnique.ts::resolveUniqueFlag`:
 * ENTRY_TITLE and SLUG are implicitly unique, everything else
 * defaults to false.
 *
 * Duplicated here (rather than imported from server/utils) so the
 * planner stays free of Nuxt/h3 imports.
 */
export function effectiveBundleUnique(field: BundleField): boolean {
  if (field.type === 'ENTRY_TITLE' || field.type === 'SLUG') return true;
  return field.unique === true;
}

export type { Bundle };
```

- [ ] **Step 2: Verify it typechecks**

```bash
pnpm --filter cms exec nuxi prepare && pnpm --filter cms typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/scripts/content-bundle/schemaPlan.types.ts
git commit -m "$(cat <<'EOF'
feat(bundle): plan types for schema-as-code planner

Defines SchemaPlan, Blocker, Warning, TypeUpdate, FieldUpdate,
FieldRemoval, CurrentSchemaSnapshot, and FieldUsage — the contract
the applier (Spec 3) and CLI (Spec 5) will consume.

Includes effectiveBundleUnique() — the implicit-unique fallback for
ENTRY_TITLE/SLUG. Duplicated from server/utils/validateFieldUnique
to keep the planner free of Nuxt/h3 imports.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Skeleton `planSchema()` returning empty plan

TDD baseline: a `planSchema` that always returns an empty plan, and a single test asserting the shape. This unblocks every subsequent task that adds one row of the diff matrix at a time.

**Files:**

- Create: `apps/cms/scripts/content-bundle/planSchema.ts`
- Create: `apps/cms/scripts/content-bundle/planSchema.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/cms/scripts/content-bundle/planSchema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { planSchema } from './planSchema';
import type { Bundle, CurrentSchemaSnapshot } from './schemaPlan.types';

const emptySnapshot: CurrentSchemaSnapshot = {
  contentTypes: [],
  fieldUsage: new Map(),
};

const emptyBundle: Bundle = {
  version: 2,
  exportedAt: '2026-05-01T00:00:00.000Z',
  portable: true,
  contentTypes: [],
};

describe('planSchema', () => {
  describe('empty inputs', () => {
    it('returns an empty plan for an empty bundle and snapshot', () => {
      const plan = planSchema(emptyBundle, emptySnapshot);
      expect(plan.contentTypes.create).toEqual([]);
      expect(plan.contentTypes.update).toEqual([]);
      expect(plan.contentTypes.remove).toEqual([]);
      expect(plan.fields.create).toEqual([]);
      expect(plan.fields.update).toEqual([]);
      expect(plan.fields.remove).toEqual([]);
      expect(plan.warnings).toEqual([]);
      expect(plan.blockers).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
```

Expected: FAIL — `Failed to resolve import './planSchema'`.

- [ ] **Step 3: Create the skeleton**

`apps/cms/scripts/content-bundle/planSchema.ts`:

```ts
// apps/cms/scripts/content-bundle/planSchema.ts
//
// Pure planner. Diffs a desired schema bundle against a snapshot of
// current DB state and produces a SchemaPlan. No side effects, no
// Prisma. The applier (Spec 3) consumes the plan inside a transaction.
//
// The diff matrix is documented in
// docs/superpowers/specs/2026-05-01-schema-as-code-planner-design.md.
// Each row maps to a small predicate inside this file.

import type {
  Bundle,
  CurrentSchemaSnapshot,
  PlanOptions,
  SchemaPlan,
} from './schemaPlan.types';

export function planSchema(
  _bundle: Bundle,
  _current: CurrentSchemaSnapshot,
  _options: PlanOptions = {}
): SchemaPlan {
  return {
    contentTypes: { create: [], update: [], remove: [] },
    fields: { create: [], update: [], remove: [] },
    warnings: [],
    blockers: [],
  };
}
```

The underscore-prefixed parameters silence the unused-vars lint until subsequent tasks read them.

- [ ] **Step 4: Run, verify GREEN**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
```

Expected: PASS — 1/1 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/planSchema.ts apps/cms/scripts/content-bundle/planSchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): planSchema() skeleton returning empty plan

Baseline for the diff-matrix-driven planner. Subsequent commits add
one row of the diff matrix at a time, each with its own test.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Type-level diff — create + name/description update (rows 1, 4)

The first real predicate: walk the bundle's content types, match each to the snapshot by `identifier`. New ones go in `contentTypes.create`; matched ones with `name` or `description` differences go in `contentTypes.update`.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/planSchema.test.ts`
- Modify: `apps/cms/scripts/content-bundle/planSchema.ts`

- [ ] **Step 1: Add failing tests**

Append a new describe block to `planSchema.test.ts` after the `'empty inputs'` block:

```ts
describe('type-level: create and update (rows 1, 4)', () => {
  it('plans a create for a content type in the bundle but not in the snapshot (row 1)', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [],
        },
      ],
    };
    const plan = planSchema(bundle, emptySnapshot);
    expect(plan.contentTypes.create).toHaveLength(1);
    expect(plan.contentTypes.create[0].identifier).toBe('Article');
    expect(plan.contentTypes.update).toEqual([]);
  });

  it('plans a name update when the name differs (row 4)', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Article',
          name: 'New Name',
          description: 'unchanged',
          fields: [],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Old Name',
          description: 'unchanged',
          fields: [],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.contentTypes.update).toEqual([
      { id: 'ct-1', identifier: 'Article', changes: { name: 'New Name' } },
    ]);
    expect(plan.contentTypes.create).toEqual([]);
  });

  it('plans a description-only update (row 4)', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Article',
          name: 'Article',
          description: 'New description',
          fields: [],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.contentTypes.update).toEqual([
      {
        id: 'ct-1',
        identifier: 'Article',
        changes: { description: 'New description' },
      },
    ]);
  });

  it('does not plan an update when the type matches exactly', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.contentTypes.create).toEqual([]);
    expect(plan.contentTypes.update).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
```

Expected: FAIL — the four new tests fail (skeleton returns empty plan).

- [ ] **Step 3: Implement type-level create + update**

Replace the body of `planSchema.ts` with:

```ts
// apps/cms/scripts/content-bundle/planSchema.ts
//
// Pure planner. Diffs a desired schema bundle against a snapshot of
// current DB state and produces a SchemaPlan.
//
// The diff matrix lives in the originating spec; each row maps to a
// small predicate inside this file.

import type {
  Bundle,
  BundleContentType,
  CurrentSchemaSnapshot,
  PlanOptions,
  SchemaPlan,
  TypeUpdate,
} from './schemaPlan.types';

export function planSchema(
  bundle: Bundle,
  current: CurrentSchemaSnapshot,
  _options: PlanOptions = {}
): SchemaPlan {
  const plan: SchemaPlan = {
    contentTypes: { create: [], update: [], remove: [] },
    fields: { create: [], update: [], remove: [] },
    warnings: [],
    blockers: [],
  };

  const bundleTypes = bundle.contentTypes ?? [];
  const dbTypeByIdentifier = new Map(
    current.contentTypes.map((c) => [c.identifier, c])
  );

  for (const bt of bundleTypes) {
    const db = dbTypeByIdentifier.get(bt.identifier);
    if (!db) {
      plan.contentTypes.create.push(bt);
      continue;
    }

    const update = diffTypeMetadata(bt, db);
    if (update) plan.contentTypes.update.push(update);
  }

  return plan;
}

function diffTypeMetadata(
  bt: BundleContentType,
  db: CurrentSchemaSnapshot['contentTypes'][number]
): TypeUpdate | null {
  const changes: TypeUpdate['changes'] = {};
  if (bt.name !== db.name) changes.name = bt.name;
  if (bt.description !== db.description) changes.description = bt.description;
  if (Object.keys(changes).length === 0) return null;
  return { id: db.id, identifier: bt.identifier, changes };
}
```

- [ ] **Step 4: Run, verify GREEN**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
```

Expected: PASS — all tests green (the empty-input test plus the four new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/planSchema.ts apps/cms/scripts/content-bundle/planSchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): planSchema rows 1 and 4 (type create + name/desc update)

Identifier-based merge — bundle types absent from the DB go in
contentTypes.create; matched types with differing name/description
go in contentTypes.update.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Type-level diff — removal + identifier-change blockers (rows 2, 3, 5)

Three blockers in one task because they all live in the type-walk loop:

- Row 2: type in DB but not in bundle, no entries → `CONTENT_TYPE_REMOVAL_NEEDS_FLAG` blocker, unlocks with `allowDestructive` to a `TypeRemoval`.
- Row 3: type in DB but not in bundle, with entries → `CONTENT_TYPE_REMOVAL_WITH_ENTRIES` blocker; the flag does NOT unlock this.
- Row 5: identifier change attempted. The REST API already enforces immutability of `identifier` on `PUT /api/content-types/[id]` — the planner should match. Detection works for non-portable bundles where `bt.id` is non-null: if it matches an existing DB row by `id` AND the `identifier` differs, that's a rename attempt → `CONTENT_TYPE_IDENTIFIER_CHANGE` blocker. Portable bundles set every `id` to `null` so this can't fire there — those renames continue to show up as remove+create (the documented limitation in the spec's "Renames are remove-then-add, by design" section), and the existing `CONTENT_TYPE_REMOVAL_*` blockers gate them.

When an identifier-change attempt is detected, suppress the noise of the corresponding remove + create blockers by tracking the bundle id and the matched DB id; skip both in the main walks.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/planSchema.test.ts`
- Modify: `apps/cms/scripts/content-bundle/planSchema.ts`

- [ ] **Step 1: Add failing tests**

Append to `planSchema.test.ts`:

```ts
describe('type-level: removal (rows 2, 3)', () => {
  it('blocks removal of an empty content type without allowDestructive (row 2)', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'OrphanType',
          name: 'Orphan',
          description: null,
          fields: [],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0].code).toBe('CONTENT_TYPE_REMOVAL_NEEDS_FLAG');
    expect(plan.blockers[0].path).toBe('contentTypes.OrphanType');
    expect(plan.contentTypes.remove).toEqual([]);
  });

  it('unlocks removal of an empty content type with allowDestructive (row 2)', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'OrphanType',
          name: 'Orphan',
          description: null,
          fields: [],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot, { allowDestructive: true });
    expect(plan.blockers).toEqual([]);
    expect(plan.contentTypes.remove).toEqual([
      { id: 'ct-1', identifier: 'OrphanType', entryCount: 0 },
    ]);
  });

  it('blocks removal of a content type with entries even with allowDestructive (row 3)', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-2',
          identifier: 'PopulatedType',
          name: 'Populated',
          description: null,
          fields: [],
          entryCount: 17,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot, { allowDestructive: true });
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0].code).toBe('CONTENT_TYPE_REMOVAL_WITH_ENTRIES');
    expect(plan.blockers[0].path).toBe('contentTypes.PopulatedType');
    expect(plan.contentTypes.remove).toEqual([]);
  });
});

describe('type-level: identifier change blocker (row 5)', () => {
  it('blocks an identifier change attempted via a non-portable bundle (id matches, identifier differs)', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: false,
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'RenamedArticle',
          name: 'Renamed Article',
          description: null,
          fields: [],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0].code).toBe('CONTENT_TYPE_IDENTIFIER_CHANGE');
    expect(plan.blockers[0].path).toBe('contentTypes.RenamedArticle');
    expect(plan.blockers[0].message).toContain('Article');
    expect(plan.blockers[0].message).toContain('RenamedArticle');
    // Suppress noise: no spurious create or removal blocker.
    expect(plan.contentTypes.create).toEqual([]);
    expect(plan.contentTypes.remove).toEqual([]);
    // Only the identifier-change blocker, not also a removal blocker
    // for the original type.
    expect(
      plan.blockers.filter((b) => b.code !== 'CONTENT_TYPE_IDENTIFIER_CHANGE')
    ).toEqual([]);
  });

  it('still blocks identifier change with allowDestructive (immutable, never unlocked)', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: false,
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'RenamedArticle',
          name: 'Renamed',
          description: null,
          fields: [],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot, { allowDestructive: true });
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0].code).toBe('CONTENT_TYPE_IDENTIFIER_CHANGE');
  });

  it('falls back to remove+create for portable bundles (id is null, no detection signal)', () => {
    // Documented limitation: portable bundles strip ids, so a rename
    // is structurally indistinguishable from remove+add. The existing
    // CONTENT_TYPE_REMOVAL_NEEDS_FLAG blocker still gates this.
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'RenamedArticle',
          name: 'Renamed',
          description: null,
          fields: [],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.contentTypes.create).toHaveLength(1);
    // The orphan triggers the standard removal blocker.
    expect(
      plan.blockers.some((b) => b.code === 'CONTENT_TYPE_REMOVAL_NEEDS_FLAG')
    ).toBe(true);
    expect(
      plan.blockers.some((b) => b.code === 'CONTENT_TYPE_IDENTIFIER_CHANGE')
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
```

Expected: FAIL — three new tests fail.

- [ ] **Step 3: Implement identifier-change detection + removal logic**

In `planSchema.ts`, add an id-based pre-pass to detect identifier-change attempts, then walk the bundle types and the snapshot. Replace the `planSchema` function body with:

```ts
export function planSchema(
  bundle: Bundle,
  current: CurrentSchemaSnapshot,
  options: PlanOptions = {}
): SchemaPlan {
  const plan: SchemaPlan = {
    contentTypes: { create: [], update: [], remove: [] },
    fields: { create: [], update: [], remove: [] },
    warnings: [],
    blockers: [],
  };

  const bundleTypes = bundle.contentTypes ?? [];
  const dbTypeByIdentifier = new Map(
    current.contentTypes.map((c) => [c.identifier, c])
  );
  const dbTypeById = new Map(current.contentTypes.map((c) => [c.id, c]));
  const bundleTypeIdentifiers = new Set(bundleTypes.map((c) => c.identifier));

  // Row 5: identifier-change detection. Only fires for non-portable
  // bundles where bt.id is non-null AND matches a DB row by id with
  // a different identifier. Track the bundle ids and matched DB ids
  // so the main walks can skip the corresponding noise (a spurious
  // create for the new identifier and a spurious removal blocker
  // for the old identifier).
  const renamingBundleTypeIdentifiers = new Set<string>();
  const renamedDbTypeIds = new Set<string>();
  for (const bt of bundleTypes) {
    if (!bt.id) continue;
    const dbByIdMatch = dbTypeById.get(bt.id);
    if (!dbByIdMatch) continue;
    if (dbByIdMatch.identifier !== bt.identifier) {
      plan.blockers.push({
        code: 'CONTENT_TYPE_IDENTIFIER_CHANGE',
        message: `Cannot rename content type "${dbByIdMatch.identifier}" to "${bt.identifier}". Identifiers are immutable. To replace it, remove the old type and create a new one (allowDestructive is required if entries exist).`,
        path: `contentTypes.${bt.identifier}`,
      });
      renamingBundleTypeIdentifiers.add(bt.identifier);
      renamedDbTypeIds.add(dbByIdMatch.id);
    }
  }

  for (const bt of bundleTypes) {
    if (renamingBundleTypeIdentifiers.has(bt.identifier)) continue;
    const db = dbTypeByIdentifier.get(bt.identifier);
    if (!db) {
      plan.contentTypes.create.push(bt);
      continue;
    }

    const update = diffTypeMetadata(bt, db);
    if (update) plan.contentTypes.update.push(update);
  }

  for (const dbType of current.contentTypes) {
    if (bundleTypeIdentifiers.has(dbType.identifier)) continue;
    if (renamedDbTypeIds.has(dbType.id)) continue;

    if (dbType.entryCount > 0) {
      plan.blockers.push({
        code: 'CONTENT_TYPE_REMOVAL_WITH_ENTRIES',
        message: `Cannot remove content type "${dbType.identifier}" — ${dbType.entryCount} entries exist. Delete entries first.`,
        path: `contentTypes.${dbType.identifier}`,
      });
      continue;
    }

    if (!options.allowDestructive) {
      plan.blockers.push({
        code: 'CONTENT_TYPE_REMOVAL_NEEDS_FLAG',
        message: `Cannot remove content type "${dbType.identifier}" without allowDestructive.`,
        path: `contentTypes.${dbType.identifier}`,
      });
      continue;
    }

    plan.contentTypes.remove.push({
      id: dbType.id,
      identifier: dbType.identifier,
      entryCount: dbType.entryCount,
    });
  }

  return plan;
}
```

- [ ] **Step 4: Run, verify GREEN**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
```

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/planSchema.ts apps/cms/scripts/content-bundle/planSchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): planSchema rows 2, 3, 5 (type removal + identifier change)

Empty types removed from a bundle become blockers that allowDestructive
unlocks (row 2). Types with existing entries always block removal —
even with the flag — operators must delete entries first (row 3).

Row 5 (identifier change) detected via id-based match for non-portable
bundles: when bt.id matches a DB row but the identifier differs, emit
CONTENT_TYPE_IDENTIFIER_CHANGE and suppress the spurious create + remove
noise. Mirrors the immutability already enforced by the REST API at
PUT /api/content-types/[id]. Portable bundles (id=null) can't trigger
this — those renames continue to surface as remove+create per the
spec's documented limitation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Field-level diff — create + field-identifier blocker (row 6 + field analog of row 5)

When a field exists in the bundle but not on its content type's DB row:

- Emit a `FieldCreate`.
- If the field is `required: true` AND entries exist on the type, emit a `NEW_REQUIRED_FIELD_WITH_ENTRIES` warning (NOT a blocker — this is row 6 of the matrix).

Plus a field-level analog of row 5: the field PUT endpoint silently ignores `identifier` changes. The planner should refuse them too. Same pattern as type-level detection — only fires for non-portable bundles where `bf.id` is non-null. The blocker code is `CONTENT_TYPE_IDENTIFIER_CHANGE` reused at field path; we'll add a field-specific code in this task.

Field operations only run on types that exist in both bundle and DB (or were just created). For types being created in this same plan, fields are part of the `contentTypes.create` payload — the applier handles those in pass 1. So pass 2 (`fields.*`) only deals with existing types. This task's logic walks bundle types that match a DB type, then walks each bundle field looking for missing-from-DB.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/planSchema.test.ts`
- Modify: `apps/cms/scripts/content-bundle/planSchema.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('field-level: create on existing type (row 6)', () => {
  it('plans a field create on an existing type when no entries exist (safe)', () => {
    const bundle: Bundle = {
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
              identifier: 'tagline',
              name: 'Tagline',
              type: 'TEXT',
              required: false,
              order: 1,
              options: null,
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
          ],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.create).toHaveLength(1);
    expect(plan.fields.create[0].contentTypeIdentifier).toBe('Article');
    expect(plan.fields.create[0].field.identifier).toBe('tagline');
    expect(plan.warnings).toEqual([]);
  });

  it('blocks a field-identifier change attempted via a non-portable bundle', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: false,
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
              options: null,
            },
            {
              id: 'f-2',
              identifier: 'renamedTagline',
              name: 'Tagline',
              type: 'TEXT',
              required: false,
              order: 1,
              options: null,
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
            {
              id: 'f-2',
              identifier: 'tagline',
              name: 'Tagline',
              type: 'TEXT',
              required: false,
              unique: false,
              order: 1,
              options: null,
            },
          ],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0].code).toBe('FIELD_IDENTIFIER_CHANGE');
    expect(plan.blockers[0].path).toBe('fields.Article.renamedTagline');
    expect(plan.blockers[0].message).toContain('tagline');
    expect(plan.blockers[0].message).toContain('renamedTagline');
    // Suppress noise: no spurious create or removal blocker for the
    // pretend-renamed field.
    expect(plan.fields.create).toEqual([]);
    expect(plan.fields.remove).toEqual([]);
  });

  it('warns on a new required field when entries exist (row 6 warning path)', () => {
    const bundle: Bundle = {
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
              identifier: 'category',
              name: 'Category',
              type: 'TEXT',
              required: true,
              order: 1,
              options: null,
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
          ],
          entryCount: 5,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.create).toHaveLength(1);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0].code).toBe('NEW_REQUIRED_FIELD_WITH_ENTRIES');
    expect(plan.warnings[0].path).toBe('fields.Article.category');
  });
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
```

Expected: FAIL — both tests fail (no field handling yet).

- [ ] **Step 3: Add field-level walk**

Edit `planSchema.ts`. Inside the existing bundle-types loop, after the `update = diffTypeMetadata(...)` line, add a call to `diffFieldsForType(plan, bt, db)`. Then add the helper function below the existing `diffTypeMetadata`:

```ts
function diffFieldsForType(
  plan: SchemaPlan,
  bt: BundleContentType,
  db: CurrentSchemaSnapshot['contentTypes'][number]
): void {
  const dbFieldByIdentifier = new Map(db.fields.map((f) => [f.identifier, f]));
  const dbFieldById = new Map(db.fields.map((f) => [f.id, f]));

  // Field-identifier-change detection (analog of row 5 at field
  // level). Only fires for non-portable bundles where bf.id is
  // non-null and matches a DB field by id with a different
  // identifier. Mirrors the silent immutability the field PUT
  // endpoint already enforces.
  const renamingBundleFieldIdentifiers = new Set<string>();
  const renamedDbFieldIds = new Set<string>();
  for (const bf of bt.fields) {
    if (!bf.id) continue;
    const dbByIdMatch = dbFieldById.get(bf.id);
    if (!dbByIdMatch) continue;
    if (dbByIdMatch.identifier !== bf.identifier) {
      plan.blockers.push({
        code: 'FIELD_IDENTIFIER_CHANGE',
        message: `Cannot rename field "${dbByIdMatch.identifier}" to "${bf.identifier}" on "${bt.identifier}". Field identifiers are immutable; remove and re-create with allowDestructive instead.`,
        path: `fields.${bt.identifier}.${bf.identifier}`,
      });
      renamingBundleFieldIdentifiers.add(bf.identifier);
      renamedDbFieldIds.add(dbByIdMatch.id);
    }
  }

  for (const bf of bt.fields) {
    if (renamingBundleFieldIdentifiers.has(bf.identifier)) continue;
    const dbField = dbFieldByIdentifier.get(bf.identifier);
    if (!dbField) {
      plan.fields.create.push({
        contentTypeId: db.id,
        contentTypeIdentifier: bt.identifier,
        field: bf,
      });
      if (bf.required && db.entryCount > 0) {
        plan.warnings.push({
          code: 'NEW_REQUIRED_FIELD_WITH_ENTRIES',
          message: `New required field "${bf.identifier}" added to "${bt.identifier}" which has ${db.entryCount} entries. Existing entries will be missing this value until backfilled.`,
          path: `fields.${bt.identifier}.${bf.identifier}`,
        });
      }
      continue;
    }
    // Update + removal handling lands in subsequent tasks. Note:
    // when later tasks add removal handling, that walk must also
    // skip dbField.id values in renamedDbFieldIds (pass the set
    // through diffFieldsForType's local closure).
  }
}
```

Wire `diffFieldsForType` into the main `planSchema` loop where the existing match-found branch runs. Final shape of the bundle-types loop:

```ts
for (const bt of bundleTypes) {
  const db = dbTypeByIdentifier.get(bt.identifier);
  if (!db) {
    plan.contentTypes.create.push(bt);
    continue;
  }
  const update = diffTypeMetadata(bt, db);
  if (update) plan.contentTypes.update.push(update);
  diffFieldsForType(plan, bt, db);
}
```

- [ ] **Step 4: Run, verify GREEN**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
```

Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/planSchema.ts apps/cms/scripts/content-bundle/planSchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): planSchema row 6 + field-identifier-change blocker

Adds the field-level walk for matched content types:
- New fields emit FieldCreate ops; required fields on a populated
  type surface a NEW_REQUIRED_FIELD_WITH_ENTRIES warning (row 6).
- Field-identifier change attempts on non-portable bundles emit a
  FIELD_IDENTIFIER_CHANGE blocker (analog of row 5 at field level).
  Mirrors the silent immutability the field PUT endpoint already
  enforces.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Field-level diff — name and order updates (row 9)

When a field exists in both bundle and DB and its `name` or `order` differs, emit a `FieldUpdate`. No safety implications — these are always safe.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/planSchema.test.ts`
- Modify: `apps/cms/scripts/content-bundle/planSchema.ts`

- [ ] **Step 1: Add failing test**

```ts
describe('field-level: name and order updates (row 9)', () => {
  it('plans a name update', () => {
    const bundle: Bundle = {
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
              name: 'Renamed Title',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
          ],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toEqual([
      {
        id: 'f-1',
        contentTypeIdentifier: 'Article',
        fieldIdentifier: 'title',
        changes: { name: 'Renamed Title' },
      },
    ]);
  });

  it('plans an order-only update', () => {
    const bundle: Bundle = {
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
              order: 5,
              options: null,
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
          ],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toEqual([
      {
        id: 'f-1',
        contentTypeIdentifier: 'Article',
        fieldIdentifier: 'title',
        changes: { order: 5 },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
```

- [ ] **Step 3: Add the matched-field branch**

In `diffFieldsForType`, after the `if (!dbField) { … continue; }` block, add a call to a new `diffFieldUpdate` helper. Final inside-loop shape:

```ts
for (const bf of bt.fields) {
  const dbField = dbFieldByIdentifier.get(bf.identifier);
  if (!dbField) {
    // unchanged: create + warning
    continue;
  }
  diffFieldUpdate(plan, bt.identifier, bf, dbField);
}
```

Add the helper:

```ts
function diffFieldUpdate(
  plan: SchemaPlan,
  typeIdentifier: string,
  bf: BundleField,
  dbField: CurrentSchemaSnapshot['contentTypes'][number]['fields'][number]
): void {
  const changes: FieldUpdate['changes'] = {};
  if (bf.name !== dbField.name) changes.name = bf.name;
  if (bf.order !== dbField.order) changes.order = bf.order;
  if (Object.keys(changes).length === 0) return;
  plan.fields.update.push({
    id: dbField.id,
    contentTypeIdentifier: typeIdentifier,
    fieldIdentifier: bf.identifier,
    changes,
  });
}
```

You'll need to import `BundleField` and `FieldUpdate` from `./schemaPlan.types` if not already imported.

- [ ] **Step 4: Run, verify GREEN**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/planSchema.ts apps/cms/scripts/content-bundle/planSchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): planSchema row 9 (field name/order update)

Always-safe updates. The applier handles re-numbering by reusing the
reorder endpoint logic — no special "reorder" plan section.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Field-level diff — required transitions (rows 10, 11, 12)

- Row 10: `required: false → true`, no entries with null/missing for that field → safe `FieldUpdate`.
- Row 11: `required: false → true`, entries with null/missing → blocker `OPTIONAL_TO_REQUIRED_HAS_NULLS` with affected entry count in message. (We don't have entry IDs in `FieldUsage` for this — `entriesWithValue` is the inverse. The blocker message can name the count of entries-without-value as `entryCount - entriesWithValue`.)
- Row 12: `required: true → false` → always-safe `FieldUpdate`.

The "entries with null/missing" count = `db.entryCount - usage.entriesWithValue`.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/planSchema.test.ts`
- Modify: `apps/cms/scripts/content-bundle/planSchema.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('field-level: required transitions (rows 10, 11, 12)', () => {
  it('plans optional → required when no entries have null (row 10)', () => {
    const bundle: Bundle = {
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
              identifier: 'tagline',
              name: 'Tagline',
              type: 'TEXT',
              required: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'tagline',
              name: 'Tagline',
              type: 'TEXT',
              required: false,
              unique: false,
              order: 0,
              options: null,
            },
          ],
          entryCount: 3,
        },
      ],
      fieldUsage: new Map([['Article:tagline', { entriesWithValue: 3 }]]),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toEqual([
      {
        id: 'f-1',
        contentTypeIdentifier: 'Article',
        fieldIdentifier: 'tagline',
        changes: { required: true },
      },
    ]);
    expect(plan.blockers).toEqual([]);
  });

  it('blocks optional → required when entries have null (row 11)', () => {
    const bundle: Bundle = {
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
              identifier: 'tagline',
              name: 'Tagline',
              type: 'TEXT',
              required: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'tagline',
              name: 'Tagline',
              type: 'TEXT',
              required: false,
              unique: false,
              order: 0,
              options: null,
            },
          ],
          entryCount: 5,
        },
      ],
      fieldUsage: new Map([['Article:tagline', { entriesWithValue: 3 }]]),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toEqual([]);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0].code).toBe('OPTIONAL_TO_REQUIRED_HAS_NULLS');
    expect(plan.blockers[0].path).toBe('fields.Article.tagline');
    expect(plan.blockers[0].message).toContain('2'); // 5 - 3 = 2 missing
  });

  it('plans required → optional always (row 12)', () => {
    const bundle: Bundle = {
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
              identifier: 'tagline',
              name: 'Tagline',
              type: 'TEXT',
              required: false,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'tagline',
              name: 'Tagline',
              type: 'TEXT',
              required: true,
              unique: false,
              order: 0,
              options: null,
            },
          ],
          entryCount: 99,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toEqual([
      {
        id: 'f-1',
        contentTypeIdentifier: 'Article',
        fieldIdentifier: 'tagline',
        changes: { required: false },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
```

- [ ] **Step 3: Extend `diffFieldUpdate`**

Update `diffFieldUpdate` to handle the `required` transition:

```ts
function diffFieldUpdate(
  plan: SchemaPlan,
  typeIdentifier: string,
  bf: BundleField,
  dbField: CurrentSchemaSnapshot['contentTypes'][number]['fields'][number],
  entryCount: number,
  fieldUsage: CurrentSchemaSnapshot['fieldUsage']
): void {
  const changes: FieldUpdate['changes'] = {};
  if (bf.name !== dbField.name) changes.name = bf.name;
  if (bf.order !== dbField.order) changes.order = bf.order;

  // required transitions (rows 10, 11, 12)
  if (bf.required !== dbField.required) {
    if (bf.required) {
      const usage = fieldUsage.get(`${typeIdentifier}:${bf.identifier}`);
      const entriesWithValue = usage?.entriesWithValue ?? 0;
      const missing = entryCount - entriesWithValue;
      if (missing > 0) {
        plan.blockers.push({
          code: 'OPTIONAL_TO_REQUIRED_HAS_NULLS',
          message: `Cannot mark "${bf.identifier}" required — ${missing} entries on "${typeIdentifier}" have a null/missing value for it. Backfill them first.`,
          path: `fields.${typeIdentifier}.${bf.identifier}`,
        });
      } else {
        changes.required = true;
      }
    } else {
      changes.required = false;
    }
  }

  if (Object.keys(changes).length === 0) return;
  plan.fields.update.push({
    id: dbField.id,
    contentTypeIdentifier: typeIdentifier,
    fieldIdentifier: bf.identifier,
    changes,
  });
}
```

Update the call site in `diffFieldsForType` to pass `db.entryCount` and `current.fieldUsage`. You'll need to thread `current.fieldUsage` from the top-level `planSchema` into `diffFieldsForType` (so its signature grows by one param).

- [ ] **Step 4: Run, verify GREEN**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/planSchema.ts apps/cms/scripts/content-bundle/planSchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): planSchema rows 10-12 (required transitions)

Optional→required is safe when no entries have null/missing values;
blocked otherwise (OPTIONAL_TO_REQUIRED_HAS_NULLS, names the missing
count). Required→optional is always safe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Field-level diff — unique transitions (rows 13, 14, 15)

- Row 13: `unique: false → true`, no duplicates → safe `FieldUpdate`.
- Row 14: `unique: false → true`, duplicates exist → blocker `UNIQUE_CONFLICT` with affected entry IDs.
- Row 15: `unique: true → false` → always safe.

Use `effectiveBundleUnique(bf)` from `schemaPlan.types.ts` to read the bundle's effective `unique` (handles the implicit-true cases).

**Files:**

- Modify: `apps/cms/scripts/content-bundle/planSchema.test.ts`
- Modify: `apps/cms/scripts/content-bundle/planSchema.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('field-level: unique transitions (rows 13, 14, 15)', () => {
  it('plans unique false → true when no duplicates exist (row 13)', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Product',
          name: 'Product',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'sku',
              name: 'SKU',
              type: 'TEXT',
              required: false,
              unique: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Product',
          name: 'Product',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'sku',
              name: 'SKU',
              type: 'TEXT',
              required: false,
              unique: false,
              order: 0,
              options: null,
            },
          ],
          entryCount: 3,
        },
      ],
      fieldUsage: new Map([
        ['Product:sku', { entriesWithValue: 3, duplicateValues: [] }],
      ]),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toEqual([
      {
        id: 'f-1',
        contentTypeIdentifier: 'Product',
        fieldIdentifier: 'sku',
        changes: { unique: true },
      },
    ]);
    expect(plan.blockers).toEqual([]);
  });

  it('blocks unique false → true when duplicates exist (row 14)', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Product',
          name: 'Product',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'sku',
              name: 'SKU',
              type: 'TEXT',
              required: false,
              unique: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Product',
          name: 'Product',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'sku',
              name: 'SKU',
              type: 'TEXT',
              required: false,
              unique: false,
              order: 0,
              options: null,
            },
          ],
          entryCount: 4,
        },
      ],
      fieldUsage: new Map([
        [
          'Product:sku',
          {
            entriesWithValue: 4,
            duplicateValues: [
              { value: 'ABC', entryIds: ['e1', 'e2'] },
              { value: 'DEF', entryIds: ['e3', 'e4'] },
            ],
          },
        ],
      ]),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toEqual([]);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0].code).toBe('UNIQUE_CONFLICT');
    expect(plan.blockers[0].path).toBe('fields.Product.sku');
    expect(plan.blockers[0].affectedEntryIds).toEqual(['e1', 'e2', 'e3', 'e4']);
  });

  it('plans unique true → false always (row 15)', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Product',
          name: 'Product',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'sku',
              name: 'SKU',
              type: 'TEXT',
              required: false,
              unique: false,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Product',
          name: 'Product',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'sku',
              name: 'SKU',
              type: 'TEXT',
              required: false,
              unique: true,
              order: 0,
              options: null,
            },
          ],
          entryCount: 99,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toEqual([
      {
        id: 'f-1',
        contentTypeIdentifier: 'Product',
        fieldIdentifier: 'sku',
        changes: { unique: false },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
```

- [ ] **Step 3: Extend `diffFieldUpdate`**

After the `required` transition block, add a unique block:

```ts
import { effectiveBundleUnique } from './schemaPlan.types';

// ... inside diffFieldUpdate, after the required block:

const bundleUnique = effectiveBundleUnique(bf);
if (bundleUnique !== dbField.unique) {
  if (bundleUnique) {
    const usage = fieldUsage.get(`${typeIdentifier}:${bf.identifier}`);
    const dups = usage?.duplicateValues ?? [];
    if (dups.length > 0) {
      const affectedEntryIds = dups.flatMap((d) => d.entryIds);
      plan.blockers.push({
        code: 'UNIQUE_CONFLICT',
        message: `Cannot mark "${bf.identifier}" unique — ${affectedEntryIds.length} entries on "${typeIdentifier}" share duplicate values.`,
        path: `fields.${typeIdentifier}.${bf.identifier}`,
        affectedEntryIds,
      });
    } else {
      changes.unique = true;
    }
  } else {
    changes.unique = false;
  }
}
```

- [ ] **Step 4: Run, verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/planSchema.ts apps/cms/scripts/content-bundle/planSchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): planSchema rows 13-15 (unique transitions)

Unique false→true is safe iff fieldUsage.duplicateValues is empty;
duplicates surface a UNIQUE_CONFLICT blocker carrying affectedEntryIds
(same shape as the existing 409 the field-CRUD endpoint returns).
Unique true→false is always safe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Field-level diff — type change blocker (row 16)

`type` change is structurally undefined for our data model; existing entry values are the wrong shape after a type change. Always blocked, even with `allowDestructive`. Operators must rename + recreate.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/planSchema.test.ts`
- Modify: `apps/cms/scripts/content-bundle/planSchema.ts`

- [ ] **Step 1: Add failing test**

```ts
describe('field-level: type change blocker (row 16)', () => {
  it('blocks a field type change even with allowDestructive', () => {
    const bundle: Bundle = {
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
              identifier: 'count',
              name: 'Count',
              type: 'NUMBER',
              required: false,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'count',
              name: 'Count',
              type: 'TEXT',
              required: false,
              unique: false,
              order: 0,
              options: null,
            },
          ],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot, { allowDestructive: true });
    expect(plan.fields.update).toEqual([]);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0].code).toBe('FIELD_TYPE_CHANGE');
    expect(plan.blockers[0].path).toBe('fields.Article.count');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Add the blocker check at the start of `diffFieldUpdate`**

Insert at the top of the function (before the `changes` declaration):

```ts
if (bf.type !== dbField.type) {
  plan.blockers.push({
    code: 'FIELD_TYPE_CHANGE',
    message: `Cannot change "${typeIdentifier}.${bf.identifier}" from ${dbField.type} to ${bf.type}. Type changes are never allowed; rename the field instead.`,
    path: `fields.${typeIdentifier}.${bf.identifier}`,
  });
  return; // skip all other update logic
}
```

- [ ] **Step 4: Run, verify GREEN** — and verify the existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/planSchema.ts apps/cms/scripts/content-bundle/planSchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): planSchema row 16 (field type change blocker)

Type changes are structurally undefined — every entry's value becomes
the wrong shape. Always a blocker; allowDestructive does NOT unlock
this. Documented in the blocker message: rename the field instead.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Field-level diff — SELECT choice changes (rows 17, 18, 19)

- Row 17: choice added → safe options update.
- Row 18: choice removed, no entries use it → safe options update.
- Row 19: choice removed, entries use it → `SELECT_CHOICE_REMOVED_IN_USE` blocker.

Snapshot's `fieldUsage[…].selectChoiceCounts` is a Map of choice value → entry count.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/planSchema.test.ts`
- Modify: `apps/cms/scripts/content-bundle/planSchema.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('field-level: SELECT choice changes (rows 17, 18, 19)', () => {
  it('plans an options update when a choice is added (row 17)', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Post',
          name: 'Post',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'category',
              name: 'Category',
              type: 'SELECT',
              required: false,
              order: 0,
              options: { choices: ['news', 'opinion', 'review'] },
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Post',
          name: 'Post',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'category',
              name: 'Category',
              type: 'SELECT',
              required: false,
              unique: false,
              order: 0,
              options: { choices: ['news', 'opinion'] },
            },
          ],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toHaveLength(1);
    expect(plan.fields.update[0].changes.options).toEqual({
      choices: ['news', 'opinion', 'review'],
    });
    expect(plan.blockers).toEqual([]);
  });

  it('plans an options update when an unused choice is removed (row 18)', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Post',
          name: 'Post',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'category',
              name: 'Category',
              type: 'SELECT',
              required: false,
              order: 0,
              options: { choices: ['news'] },
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Post',
          name: 'Post',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'category',
              name: 'Category',
              type: 'SELECT',
              required: false,
              unique: false,
              order: 0,
              options: { choices: ['news', 'opinion'] },
            },
          ],
          entryCount: 5,
        },
      ],
      fieldUsage: new Map([
        [
          'Post:category',
          {
            entriesWithValue: 5,
            selectChoiceCounts: new Map([['news', 5]]),
          },
        ],
      ]),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toHaveLength(1);
    expect(plan.fields.update[0].changes.options).toEqual({
      choices: ['news'],
    });
    expect(plan.blockers).toEqual([]);
  });

  it('blocks removing a choice that entries reference (row 19)', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Post',
          name: 'Post',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'category',
              name: 'Category',
              type: 'SELECT',
              required: false,
              order: 0,
              options: { choices: ['news'] },
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Post',
          name: 'Post',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'category',
              name: 'Category',
              type: 'SELECT',
              required: false,
              unique: false,
              order: 0,
              options: { choices: ['news', 'opinion'] },
            },
          ],
          entryCount: 6,
        },
      ],
      fieldUsage: new Map([
        [
          'Post:category',
          {
            entriesWithValue: 6,
            selectChoiceCounts: new Map([
              ['news', 4],
              ['opinion', 2],
            ]),
          },
        ],
      ]),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toEqual([]);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0].code).toBe('SELECT_CHOICE_REMOVED_IN_USE');
    expect(plan.blockers[0].path).toBe('fields.Post.category');
    expect(plan.blockers[0].message).toContain('opinion');
    expect(plan.blockers[0].message).toContain('2');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Add the SELECT-options branch in `diffFieldUpdate`**

After the `unique` block, before the final `changes` push, add:

```ts
if (bf.type === 'SELECT') {
  const bundleChoices = (bf.options?.choices as string[] | undefined) ?? [];
  const dbChoices = (dbField.options?.choices as string[] | undefined) ?? [];
  const removed = dbChoices.filter((c) => !bundleChoices.includes(c));
  const added = bundleChoices.filter((c) => !dbChoices.includes(c));

  const usage = fieldUsage.get(`${typeIdentifier}:${bf.identifier}`);
  const usedRemoved = removed.filter(
    (c) => (usage?.selectChoiceCounts?.get(c) ?? 0) > 0
  );

  if (usedRemoved.length > 0) {
    const detail = usedRemoved
      .map((c) => `"${c}" (${usage?.selectChoiceCounts?.get(c)} entries)`)
      .join(', ');
    plan.blockers.push({
      code: 'SELECT_CHOICE_REMOVED_IN_USE',
      message: `Cannot remove SELECT choices in use on "${typeIdentifier}.${bf.identifier}": ${detail}. Update entries first.`,
      path: `fields.${typeIdentifier}.${bf.identifier}`,
    });
    return;
  }

  if (added.length > 0 || removed.length > 0) {
    changes.options = { ...(bf.options ?? {}), choices: bundleChoices };
  }
}
```

- [ ] **Step 4: Run, verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/planSchema.ts apps/cms/scripts/content-bundle/planSchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): planSchema rows 17-19 (SELECT choice changes)

Adding choices is always safe; removing unused choices is safe;
removing in-use choices is a SELECT_CHOICE_REMOVED_IN_USE blocker
listing the offending values and entry counts. allowDestructive does
NOT unlock — operators must update entries first.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Field-level diff — RELATION/MULTIRELATION targets (rows 20, 21, 22)

- Row 20: target added → safe options update.
- Row 21: target removed, no relations point to it → safe options update.
- Row 22: target removed, relations point to it → `RELATION_TARGET_REMOVED_IN_USE` blocker.

Snapshot's `fieldUsage[…].relationTargetCounts` keys are target type identifiers.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/planSchema.test.ts`
- Modify: `apps/cms/scripts/content-bundle/planSchema.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('field-level: RELATION target changes (rows 20, 21, 22)', () => {
  it('plans an options update when a target is added (row 20)', () => {
    const bundle: Bundle = {
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
              identifier: 'author',
              name: 'Author',
              type: 'RELATION',
              required: false,
              order: 0,
              options: {
                targetContentTypeIdentifiers: ['Author', 'Editor'],
              },
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'author',
              name: 'Author',
              type: 'RELATION',
              required: false,
              unique: false,
              order: 0,
              options: {
                targetContentTypeIdentifiers: ['Author'],
              },
            },
          ],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toHaveLength(1);
    expect(
      (plan.fields.update[0].changes.options as Record<string, unknown>)
        .targetContentTypeIdentifiers
    ).toEqual(['Author', 'Editor']);
    expect(plan.blockers).toEqual([]);
  });

  it('plans an options update when an unused target is removed (row 21)', () => {
    const bundle: Bundle = {
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
              identifier: 'author',
              name: 'Author',
              type: 'RELATION',
              required: false,
              order: 0,
              options: { targetContentTypeIdentifiers: ['Author'] },
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'author',
              name: 'Author',
              type: 'RELATION',
              required: false,
              unique: false,
              order: 0,
              options: { targetContentTypeIdentifiers: ['Author', 'Editor'] },
            },
          ],
          entryCount: 4,
        },
      ],
      fieldUsage: new Map([
        [
          'Article:author',
          {
            entriesWithValue: 4,
            relationTargetCounts: new Map([['Author', 4]]),
          },
        ],
      ]),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toHaveLength(1);
    expect(plan.blockers).toEqual([]);
  });

  it('blocks removing a target with active relations (row 22)', () => {
    const bundle: Bundle = {
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
              identifier: 'author',
              name: 'Author',
              type: 'RELATION',
              required: false,
              order: 0,
              options: { targetContentTypeIdentifiers: ['Author'] },
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'author',
              name: 'Author',
              type: 'RELATION',
              required: false,
              unique: false,
              order: 0,
              options: { targetContentTypeIdentifiers: ['Author', 'Editor'] },
            },
          ],
          entryCount: 6,
        },
      ],
      fieldUsage: new Map([
        [
          'Article:author',
          {
            entriesWithValue: 6,
            relationTargetCounts: new Map([
              ['Author', 4],
              ['Editor', 2],
            ]),
          },
        ],
      ]),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toEqual([]);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0].code).toBe('RELATION_TARGET_REMOVED_IN_USE');
    expect(plan.blockers[0].message).toContain('Editor');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Add the RELATION-options branch in `diffFieldUpdate`**

After the SELECT block, add:

```ts
if (bf.type === 'RELATION' || bf.type === 'MULTIRELATION') {
  const bundleTargets =
    (bf.options?.targetContentTypeIdentifiers as string[] | undefined) ?? [];
  const dbTargets =
    (dbField.options?.targetContentTypeIdentifiers as string[] | undefined) ??
    [];
  const removedTargets = dbTargets.filter((t) => !bundleTargets.includes(t));
  const addedTargets = bundleTargets.filter((t) => !dbTargets.includes(t));

  const usage = fieldUsage.get(`${typeIdentifier}:${bf.identifier}`);
  const usedRemoved = removedTargets.filter(
    (t) => (usage?.relationTargetCounts?.get(t) ?? 0) > 0
  );

  if (usedRemoved.length > 0) {
    const detail = usedRemoved
      .map((t) => `"${t}" (${usage?.relationTargetCounts?.get(t)} relations)`)
      .join(', ');
    plan.blockers.push({
      code: 'RELATION_TARGET_REMOVED_IN_USE',
      message: `Cannot remove relation targets in use on "${typeIdentifier}.${bf.identifier}": ${detail}. Update entries first.`,
      path: `fields.${typeIdentifier}.${bf.identifier}`,
    });
    return;
  }

  if (addedTargets.length > 0 || removedTargets.length > 0) {
    changes.options = {
      ...(bf.options ?? {}),
      targetContentTypeIdentifiers: bundleTargets,
    };
  }
}
```

- [ ] **Step 4: Run, verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/planSchema.ts apps/cms/scripts/content-bundle/planSchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): planSchema rows 20-22 (RELATION/MULTIRELATION targets)

Adding targets is safe; removing unused targets is safe; removing a
target with active relations is a RELATION_TARGET_REMOVED_IN_USE
blocker that names the targets and relation counts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Field-level diff — RICHTEXT allow-list + unrecognised options (rows 23, 24)

- Row 23: RICHTEXT `targetContentTypeIds` or `linkTargetContentTypeIds` differ → safe options update. (Embed/link gating happens at write-time; old documents aren't validated retroactively.)
- Row 24: any other unknown option key differing → safe options update + `UNRECOGNISED_FIELD_OPTION` warning.

Both fall through to a generic "if options differ, push update" path. The RICHTEXT case is the canonical safe option change. Row 24 is the catch-all warning to surface that the planner can't validate the option semantically.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/planSchema.test.ts`
- Modify: `apps/cms/scripts/content-bundle/planSchema.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('field-level: RICHTEXT and unrecognised options (rows 23, 24)', () => {
  it('plans an options update for RICHTEXT allow-list change (row 23)', () => {
    const bundle: Bundle = {
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
              identifier: 'body',
              name: 'Body',
              type: 'RICHTEXT',
              required: false,
              order: 0,
              options: { targetContentTypeIds: ['ct-img'] },
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'body',
              name: 'Body',
              type: 'RICHTEXT',
              required: false,
              unique: false,
              order: 0,
              options: { targetContentTypeIds: [] },
            },
          ],
          entryCount: 99,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toHaveLength(1);
    expect(plan.warnings).toEqual([]);
    expect(plan.blockers).toEqual([]);
  });

  it('warns on unrecognised option keys (row 24)', () => {
    const bundle: Bundle = {
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
              identifier: 'tagline',
              name: 'Tagline',
              type: 'TEXT',
              required: false,
              order: 0,
              options: { newFutureOption: true },
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'tagline',
              name: 'Tagline',
              type: 'TEXT',
              required: false,
              unique: false,
              order: 0,
              options: null,
            },
          ],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.update).toHaveLength(1);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0].code).toBe('UNRECOGNISED_FIELD_OPTION');
    expect(plan.warnings[0].message).toContain('newFutureOption');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Add fall-through options diff**

After the RELATION block, add a generic options-diff fall-through:

```ts
const knownHandledTypes = new Set(['SELECT', 'RELATION', 'MULTIRELATION']);
if (
  !knownHandledTypes.has(bf.type) &&
  !shallowOptionsEqual(bf.options, dbField.options)
) {
  changes.options = bf.options ?? {};
  // RICHTEXT is documented-safe in the spec (row 23) — no warning.
  if (bf.type !== 'RICHTEXT') {
    const unknownKeys = Object.keys(bf.options ?? {}).filter(
      (k) =>
        !(k in (dbField.options ?? {})) ||
        bf.options?.[k] !== dbField.options?.[k]
    );
    if (unknownKeys.length > 0) {
      plan.warnings.push({
        code: 'UNRECOGNISED_FIELD_OPTION',
        message: `Field "${typeIdentifier}.${bf.identifier}" has option keys the planner does not recognise: ${unknownKeys.join(', ')}. Passing through to the applier; Prisma will validate at apply time.`,
        path: `fields.${typeIdentifier}.${bf.identifier}`,
      });
    }
  }
}
```

Add the helper at the bottom of `planSchema.ts`:

```ts
function shallowOptionsEqual(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return Boolean(!a && !b);
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run, verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/planSchema.ts apps/cms/scripts/content-bundle/planSchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): planSchema rows 23-24 (RICHTEXT + unrecognised options)

RICHTEXT allow-list changes are passed through as options updates
(embed/link gating happens at write-time; old docs aren't validated
retroactively). Unknown option keys on TEXT/NUMBER/etc. are passed
through with an UNRECOGNISED_FIELD_OPTION warning so Prisma can
validate at apply time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Field-level diff — field removal (rows 7, 8)

- Row 7: field in DB, not in bundle, no entries on the type → blocker `FIELD_REMOVAL_NEEDS_FLAG`. Unlocks with `allowDestructive` to a `FieldRemoval`.
- Row 8: field in DB, not in bundle, entries with non-null values exist → blocker `FIELD_REMOVAL_NEEDS_FLAG`. Unlocks with `allowDestructive` (data loss); the field's removal also surfaces an entry-data-loss warning at apply time. The plan-level shape: emits the removal under destructive flag, plus a warning surfacing the entry count whose values will be wiped.

In both cases the operation is the same `FieldRemoval`. The warning differentiates them when the flag is on.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/planSchema.test.ts`
- Modify: `apps/cms/scripts/content-bundle/planSchema.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('field-level: removal (rows 7, 8)', () => {
  it('blocks field removal without allowDestructive, no entries (row 7)', () => {
    const bundle: Bundle = {
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
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
            {
              id: 'f-2',
              identifier: 'oldField',
              name: 'Old Field',
              type: 'TEXT',
              required: false,
              unique: false,
              order: 1,
              options: null,
            },
          ],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.fields.remove).toEqual([]);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0].code).toBe('FIELD_REMOVAL_NEEDS_FLAG');
    expect(plan.blockers[0].path).toBe('fields.Article.oldField');
  });

  it('unlocks field removal with allowDestructive, no entries (row 7)', () => {
    const bundle: Bundle = {
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
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
            {
              id: 'f-2',
              identifier: 'oldField',
              name: 'Old Field',
              type: 'TEXT',
              required: false,
              unique: false,
              order: 1,
              options: null,
            },
          ],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot, { allowDestructive: true });
    expect(plan.blockers).toEqual([]);
    expect(plan.fields.remove).toEqual([
      {
        id: 'f-2',
        contentTypeIdentifier: 'Article',
        fieldIdentifier: 'oldField',
        entriesWithValue: 0,
      },
    ]);
  });

  it('unlocks field removal with allowDestructive when entries hold values, but surfaces a warning (row 8)', () => {
    const bundle: Bundle = {
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
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-1',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
            {
              id: 'f-2',
              identifier: 'oldField',
              name: 'Old Field',
              type: 'TEXT',
              required: false,
              unique: false,
              order: 1,
              options: null,
            },
          ],
          entryCount: 7,
        },
      ],
      fieldUsage: new Map([['Article:oldField', { entriesWithValue: 5 }]]),
    };
    const plan = planSchema(bundle, snapshot, { allowDestructive: true });
    expect(plan.fields.remove).toEqual([
      {
        id: 'f-2',
        contentTypeIdentifier: 'Article',
        fieldIdentifier: 'oldField',
        entriesWithValue: 5,
      },
    ]);
    expect(plan.warnings).toHaveLength(1);
    // The warning code re-uses NEW_REQUIRED_FIELD_WITH_ENTRIES is wrong;
    // this is data loss. We add a dedicated code below.
  });
});
```

- [ ] **Step 2: Add a `FIELD_REMOVAL_DATA_LOSS` warning code**

Edit `schemaPlan.types.ts`. Add `'FIELD_REMOVAL_DATA_LOSS'` to the `WarningCode` union (alphabetical):

```ts
export type WarningCode =
  | 'FIELD_REMOVAL_DATA_LOSS'
  | 'NEW_REQUIRED_FIELD_WITH_ENTRIES'
  | 'OPTIONAL_TO_REQUIRED_NO_NULLS'
  | 'UNRECOGNISED_FIELD_OPTION';
```

Update the third test above to assert the warning code:

```ts
expect(plan.warnings[0].code).toBe('FIELD_REMOVAL_DATA_LOSS');
expect(plan.warnings[0].path).toBe('fields.Article.oldField');
```

- [ ] **Step 3: Run, verify FAIL**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
```

- [ ] **Step 4: Add field-removal walk in `diffFieldsForType`**

After the existing for-loop over bundle fields, add a second loop over DB fields. It must skip DB fields that are targets of a detected rename (Task 6's `renamedDbFieldIds` set, which is in scope inside `diffFieldsForType`):

```ts
const bundleFieldIdentifiers = new Set(bt.fields.map((f) => f.identifier));
for (const dbField of db.fields) {
  if (bundleFieldIdentifiers.has(dbField.identifier)) continue;
  if (renamedDbFieldIds.has(dbField.id)) continue; // Suppress noise from rename detection.

  if (!options.allowDestructive) {
    plan.blockers.push({
      code: 'FIELD_REMOVAL_NEEDS_FLAG',
      message: `Cannot remove field "${dbField.identifier}" from "${bt.identifier}" without allowDestructive.`,
      path: `fields.${bt.identifier}.${dbField.identifier}`,
    });
    continue;
  }

  const usage = fieldUsage.get(`${bt.identifier}:${dbField.identifier}`);
  const entriesWithValue = usage?.entriesWithValue ?? 0;
  plan.fields.remove.push({
    id: dbField.id,
    contentTypeIdentifier: bt.identifier,
    fieldIdentifier: dbField.identifier,
    entriesWithValue,
  });
  if (entriesWithValue > 0) {
    plan.warnings.push({
      code: 'FIELD_REMOVAL_DATA_LOSS',
      message: `Removing "${bt.identifier}.${dbField.identifier}" will wipe values held by ${entriesWithValue} entries.`,
      path: `fields.${bt.identifier}.${dbField.identifier}`,
    });
  }
}
```

You'll need to thread `options: PlanOptions` into `diffFieldsForType` (along with `fieldUsage`). Update its signature accordingly.

- [ ] **Step 5: Run, verify GREEN**

- [ ] **Step 6: Commit**

```bash
git add apps/cms/scripts/content-bundle/schemaPlan.types.ts apps/cms/scripts/content-bundle/planSchema.ts apps/cms/scripts/content-bundle/planSchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): planSchema rows 7-8 (field removal)

Field removals require allowDestructive. With the flag set:
- No entries → clean removal.
- Entries hold values → removal proceeds, FIELD_REMOVAL_DATA_LOSS
  warning surfaces affected entry count.

Adds FIELD_REMOVAL_DATA_LOSS to WarningCode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Cross-reference resolution (RELATION_TARGET_NOT_FOUND blocker)

When a bundle's RELATION/MULTIRELATION field declares a `targetContentTypeIdentifiers` value that exists in neither the bundle nor the DB snapshot, the planner emits a `RELATION_TARGET_NOT_FOUND` blocker. This is the cross-bundle-vs-DB resolution step the spec calls for. It runs as a final pass over all bundle fields after type-walk is complete (so a target created in the same bundle resolves correctly).

**Files:**

- Modify: `apps/cms/scripts/content-bundle/planSchema.test.ts`
- Modify: `apps/cms/scripts/content-bundle/planSchema.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('cross-references', () => {
  it('resolves a RELATION targeting a type also in the bundle', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Author',
          name: 'Author',
          description: null,
          fields: [],
        },
        {
          id: null,
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'author',
              name: 'Author',
              type: 'RELATION',
              required: false,
              order: 0,
              options: { targetContentTypeIdentifiers: ['Author'] },
            },
          ],
        },
      ],
    };
    const plan = planSchema(bundle, emptySnapshot);
    expect(plan.blockers).toEqual([]);
  });

  it('resolves a RELATION targeting a type already in the DB', () => {
    const bundle: Bundle = {
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
              identifier: 'author',
              name: 'Author',
              type: 'RELATION',
              required: false,
              order: 0,
              options: { targetContentTypeIdentifiers: ['Author'] },
            },
          ],
        },
      ],
    };
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-author',
          identifier: 'Author',
          name: 'Author',
          description: null,
          fields: [],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    expect(plan.blockers).toEqual([]);
  });

  it('blocks a RELATION targeting a type that exists in neither the bundle nor the DB', () => {
    const bundle: Bundle = {
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
              identifier: 'author',
              name: 'Author',
              type: 'RELATION',
              required: false,
              order: 0,
              options: { targetContentTypeIdentifiers: ['MissingType'] },
            },
          ],
        },
      ],
    };
    const plan = planSchema(bundle, emptySnapshot);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0].code).toBe('RELATION_TARGET_NOT_FOUND');
    expect(plan.blockers[0].path).toBe('fields.Article.author');
    expect(plan.blockers[0].message).toContain('MissingType');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Add a final cross-ref pass**

After all the type-walk loops in `planSchema`, before `return plan`, add:

```ts
const allKnownTypeIdentifiers = new Set<string>([
  ...bundleTypes.map((c) => c.identifier),
  ...current.contentTypes.map((c) => c.identifier),
]);
for (const bt of bundleTypes) {
  for (const bf of bt.fields) {
    if (bf.type !== 'RELATION' && bf.type !== 'MULTIRELATION') continue;
    const targets =
      (bf.options?.targetContentTypeIdentifiers as string[] | undefined) ?? [];
    const missing = targets.filter((t) => !allKnownTypeIdentifiers.has(t));
    if (missing.length > 0) {
      plan.blockers.push({
        code: 'RELATION_TARGET_NOT_FOUND',
        message: `Field "${bt.identifier}.${bf.identifier}" targets unknown content type(s): ${missing.join(', ')}.`,
        path: `fields.${bt.identifier}.${bf.identifier}`,
      });
    }
  }
}
```

- [ ] **Step 4: Run, verify GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/planSchema.ts apps/cms/scripts/content-bundle/planSchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): planSchema cross-ref resolution (RELATION_TARGET_NOT_FOUND)

Final pass over RELATION/MULTIRELATION fields. A target identifier
that exists in neither the bundle nor the DB snapshot is a
RELATION_TARGET_NOT_FOUND blocker. Targets created in the same
bundle resolve correctly because the resolution set unions both.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Plan ordering invariant test

The applier (Spec 3) walks `contentTypes` ops first, then `fields` ops. This task does NOT change the planner — it adds an invariant test asserting the plan separates these two passes correctly. It catches future regressions where someone might accidentally interleave them.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/planSchema.test.ts`

- [ ] **Step 1: Add the test**

```ts
describe('plan ordering', () => {
  it('separates type creates from field creates so pass-1/pass-2 is preserved', () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Author',
          name: 'Author',
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
    const snapshot: CurrentSchemaSnapshot = {
      contentTypes: [
        {
          id: 'ct-article',
          identifier: 'Article',
          name: 'Article',
          description: null,
          fields: [
            {
              id: 'f-1',
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              unique: true,
              order: 0,
              options: null,
            },
          ],
          entryCount: 0,
        },
      ],
      fieldUsage: new Map(),
    };
    const plan = planSchema(bundle, snapshot);
    // Author is brand new → contentTypes.create with its fields embedded.
    // Article exists with the title field → no field create here.
    expect(plan.contentTypes.create).toHaveLength(1);
    expect(plan.contentTypes.create[0].identifier).toBe('Author');
    expect(plan.contentTypes.create[0].fields).toHaveLength(1);
    // No fields.create entry for Author — its fields ride along with the
    // type create. Pass 2 only handles fields against pre-existing types.
    expect(plan.fields.create).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify GREEN**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/planSchema.test.ts
```

If the test fails, the planner is incorrectly emitting `fields.create` entries for fields on types being created in the same plan. Fix by ensuring the bundle-types loop's "no DB match → contentTypes.create" branch does NOT also call `diffFieldsForType`. Re-check the implementation at the end of Task 6 — the `continue` on the `if (!db)` line should already prevent this. If it doesn't, fix it now.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/scripts/content-bundle/planSchema.test.ts
git commit -m "$(cat <<'EOF'
test(bundle): plan ordering invariant (pass-1 types, pass-2 fields)

Asserts that fields belonging to types created in the same plan ride
along with contentTypes.create rather than appearing in fields.create.
The applier's two-pass walk depends on this — pass 1 creates types,
pass 2 walks fields against pre-existing (now-complete) types.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Snapshot loader — `snapshotCurrentSchema(prisma)`

Implements the only impure file in this spec. Reads content types + fields from Prisma, then computes `fieldUsage` for the relevant fields.

For each content type:

- `entryCount = prisma.contentEntry.count({ where: { contentTypeId: ct.id } })`
- For each field, populate `fieldUsage.get('${ct.identifier}:${f.identifier}')`:
  - `entriesWithValue` = number of entries whose data has a non-null/non-undefined value at `data[f.identifier]`. Compute via raw SQL or by iterating versions in JS.
  - For SELECT: `selectChoiceCounts` = Map of choice value → count.
  - For RELATION: `relationTargetCounts` = Map of target identifier → count of entries pointing at it.
  - For MULTIRELATION: same shape, but each entry can point at multiple targets simultaneously.
  - For TEXT/NUMBER unique-eligible: `duplicateValues` = ordered list of duplicate values + holding entry IDs.

The simplest correct implementation: load all `ContentEntry` rows once with their PUBLISHED + DRAFT/CHANGED versions (the entry's "live" values from the editor's perspective — match how `assertUniqueFieldValues` handles versions), then iterate in JS.

For this plan, prefer correctness + clarity over performance. The applier (Spec 3) reuses the snapshot inside a transaction; we'll optimise if profiling shows it's needed.

**Files:**

- Create: `apps/cms/scripts/content-bundle/snapshotCurrentSchema.ts`

- [ ] **Step 1: Create the loader**

```ts
// apps/cms/scripts/content-bundle/snapshotCurrentSchema.ts
//
// The only impure file in the planner spec. Reads current schema +
// per-field usage from a PrismaClient (or transaction client) and
// returns a CurrentSchemaSnapshot the pure planner consumes.

import type { PrismaClient } from '#prisma';
import type { CurrentSchemaSnapshot, FieldUsage } from './schemaPlan.types';

export async function snapshotCurrentSchema(
  prisma: PrismaClient
): Promise<CurrentSchemaSnapshot> {
  const types = await prisma.contentType.findMany({
    include: { fields: { orderBy: { order: 'asc' } } },
    orderBy: { identifier: 'asc' },
  });

  const typeIdToIdentifier = new Map(types.map((t) => [t.id, t.identifier]));

  // Counts per type. Single grouped query.
  const entryCountRows = await prisma.contentEntry.groupBy({
    by: ['contentTypeId'],
    _count: { _all: true },
  });
  const entryCountByTypeId = new Map(
    entryCountRows.map((r) => [r.contentTypeId, r._count._all])
  );

  // Pull every entry with its versions in one pass for fieldUsage.
  // For "live editor view" use the most recent non-archived version
  // per entry (CHANGED > DRAFT > PUBLISHED).
  const entries = await prisma.contentEntry.findMany({
    include: { versions: true },
  });

  const fieldUsage = new Map<string, FieldUsage>();

  for (const ct of types) {
    for (const field of ct.fields) {
      const key = `${ct.identifier}:${field.identifier}`;
      const usage: FieldUsage = { entriesWithValue: 0 };
      const fieldType = field.type;
      const trackChoices = fieldType === 'SELECT';
      const trackRelationTargets =
        fieldType === 'RELATION' || fieldType === 'MULTIRELATION';
      const trackDuplicates = fieldType === 'TEXT' || fieldType === 'NUMBER';

      if (trackChoices) usage.selectChoiceCounts = new Map();
      if (trackRelationTargets) usage.relationTargetCounts = new Map();
      const valuesByEntry: Map<string, unknown> = new Map(); // for duplicates

      for (const entry of entries) {
        if (entry.contentTypeId !== ct.id) continue;
        const liveVersion = pickLiveVersion(entry.versions);
        if (!liveVersion) continue;
        const data = liveVersion.data as Record<string, unknown>;
        const value = data?.[field.identifier];
        if (value === undefined || value === null || value === '') continue;
        usage.entriesWithValue += 1;

        if (trackChoices && typeof value === 'string') {
          usage.selectChoiceCounts!.set(
            value,
            (usage.selectChoiceCounts!.get(value) ?? 0) + 1
          );
        }
        if (trackRelationTargets) {
          const refs = Array.isArray(value) ? value : [value];
          for (const ref of refs) {
            if (!ref || typeof ref !== 'object') continue;
            const targetTypeId = (ref as { contentTypeId?: string })
              .contentTypeId;
            if (!targetTypeId) continue;
            const targetIdentifier = typeIdToIdentifier.get(targetTypeId);
            if (!targetIdentifier) continue;
            usage.relationTargetCounts!.set(
              targetIdentifier,
              (usage.relationTargetCounts!.get(targetIdentifier) ?? 0) + 1
            );
          }
        }
        if (trackDuplicates) {
          valuesByEntry.set(entry.id, value);
        }
      }

      if (trackDuplicates) {
        const groups = new Map<string, string[]>();
        for (const [entryId, val] of valuesByEntry) {
          const k = JSON.stringify(val);
          let group = groups.get(k);
          if (!group) {
            group = [];
            groups.set(k, group);
          }
          group.push(entryId);
        }
        const dups: NonNullable<FieldUsage['duplicateValues']> = [];
        for (const [k, ids] of groups) {
          if (ids.length > 1) {
            dups.push({ value: JSON.parse(k), entryIds: ids });
          }
        }
        if (dups.length > 0) usage.duplicateValues = dups;
      }

      fieldUsage.set(key, usage);
    }
  }

  return {
    contentTypes: types.map((ct) => ({
      id: ct.id,
      identifier: ct.identifier,
      name: ct.name,
      description: ct.description,
      fields: ct.fields.map((f) => ({
        id: f.id,
        identifier: f.identifier,
        name: f.name,
        type: f.type,
        required: f.required,
        unique: f.unique,
        order: f.order,
        options: f.options as Record<string, unknown> | null,
      })),
      entryCount: entryCountByTypeId.get(ct.id) ?? 0,
    })),
    fieldUsage,
  };
}

type Version = {
  status: 'DRAFT' | 'PUBLISHED' | 'CHANGED' | 'ARCHIVED';
  data: unknown;
};

function pickLiveVersion(versions: Version[]): Version | null {
  return (
    versions.find((v) => v.status === 'CHANGED') ??
    versions.find((v) => v.status === 'DRAFT') ??
    versions.find((v) => v.status === 'PUBLISHED') ??
    null
  );
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
pnpm --filter cms exec nuxi prepare && pnpm --filter cms typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/scripts/content-bundle/snapshotCurrentSchema.ts
git commit -m "$(cat <<'EOF'
feat(bundle): snapshotCurrentSchema loader

Reads content types + fields + per-field usage stats from Prisma into
a CurrentSchemaSnapshot. The only impure file in the planner spec.
Computes entriesWithValue, selectChoiceCounts, relationTargetCounts,
and duplicateValues from each entry's "live" version (CHANGED > DRAFT
> PUBLISHED) so the planner sees what the editor would see.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Snapshot loader — DB-backed unit test

One integration-flavoured test (in the unit project, following `import.test.ts` pattern) that seeds two content types and a few entries with a SELECT, a RELATION, and a unique TEXT field, then calls the loader and asserts every interesting field of the resulting snapshot.

**Files:**

- Create: `apps/cms/scripts/content-bundle/snapshotCurrentSchema.test.ts`

- [ ] **Step 1: Create the test**

```ts
// apps/cms/scripts/content-bundle/snapshotCurrentSchema.test.ts
//
// DB-backed unit test (follows import.test.ts pattern). Seeds two
// content types + a few entries, asserts the loader produces a
// snapshot the planner can consume.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { snapshotCurrentSchema } from './snapshotCurrentSchema';

const url = 'postgresql://boject:boject@localhost:5432/boject_test';
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

describe('snapshotCurrentSchema', () => {
  beforeEach(async () => {
    await reset();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it('returns content types, fields, entry counts, and per-field usage', async () => {
    // Seed: Author with one entry; Article with two entries that
    // reference different Author entries via RELATION + a SELECT
    // category + a unique sku TEXT with one duplicate pair.
    const author = await prisma.contentType.create({
      data: {
        name: 'Author',
        identifier: 'Author',
        fields: {
          create: [
            {
              identifier: 'name',
              name: 'Name',
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

    const authorEntry = await prisma.contentEntry.create({
      data: {
        contentTypeId: author.id,
        entryTitle: 'Olly',
        slug: 'olly',
        versions: {
          create: [
            {
              status: 'PUBLISHED',
              entryTitle: 'Olly',
              data: { name: 'Olly' },
              publishedAt: new Date(),
            },
          ],
        },
      },
    });

    const article = await prisma.contentType.create({
      data: {
        name: 'Article',
        identifier: 'Article',
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
            {
              identifier: 'category',
              name: 'Category',
              type: 'SELECT',
              required: false,
              unique: false,
              order: 1,
              options: { choices: ['news', 'opinion'] },
            },
            {
              identifier: 'author',
              name: 'Author',
              type: 'RELATION',
              required: false,
              unique: false,
              order: 2,
              options: { targetContentTypeIdentifiers: ['Author'] },
            },
            {
              identifier: 'sku',
              name: 'SKU',
              type: 'TEXT',
              required: false,
              unique: true,
              order: 3,
            },
          ],
        },
      },
    });

    await prisma.contentEntry.create({
      data: {
        contentTypeId: article.id,
        entryTitle: 'First',
        slug: 'first',
        versions: {
          create: [
            {
              status: 'PUBLISHED',
              entryTitle: 'First',
              data: {
                title: 'First',
                category: 'news',
                author: { contentTypeId: author.id, entryId: authorEntry.id },
                sku: 'ABC',
              },
              publishedAt: new Date(),
            },
          ],
        },
      },
    });

    await prisma.contentEntry.create({
      data: {
        contentTypeId: article.id,
        entryTitle: 'Second',
        slug: 'second',
        versions: {
          create: [
            {
              status: 'PUBLISHED',
              entryTitle: 'Second',
              data: {
                title: 'Second',
                category: 'news',
                author: { contentTypeId: author.id, entryId: authorEntry.id },
                sku: 'ABC', // duplicate intentionally
              },
              publishedAt: new Date(),
            },
          ],
        },
      },
    });

    const snapshot = await snapshotCurrentSchema(prisma);

    const articleSnap = snapshot.contentTypes.find(
      (c) => c.identifier === 'Article'
    )!;
    expect(articleSnap).toBeDefined();
    expect(articleSnap.entryCount).toBe(2);
    expect(articleSnap.fields).toHaveLength(4);

    const categoryUsage = snapshot.fieldUsage.get('Article:category')!;
    expect(categoryUsage.entriesWithValue).toBe(2);
    expect(categoryUsage.selectChoiceCounts!.get('news')).toBe(2);
    expect(categoryUsage.selectChoiceCounts!.get('opinion') ?? 0).toBe(0);

    const authorUsage = snapshot.fieldUsage.get('Article:author')!;
    expect(authorUsage.entriesWithValue).toBe(2);
    expect(authorUsage.relationTargetCounts!.get('Author')).toBe(2);

    const skuUsage = snapshot.fieldUsage.get('Article:sku')!;
    expect(skuUsage.entriesWithValue).toBe(2);
    expect(skuUsage.duplicateValues).toHaveLength(1);
    expect(skuUsage.duplicateValues![0].value).toBe('ABC');
    expect(skuUsage.duplicateValues![0].entryIds).toHaveLength(2);

    const authorTypeSnap = snapshot.contentTypes.find(
      (c) => c.identifier === 'Author'
    )!;
    expect(authorTypeSnap.entryCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify it passes**

Pre-req: `pnpm db:up` is running.

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/snapshotCurrentSchema.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/scripts/content-bundle/snapshotCurrentSchema.test.ts
git commit -m "$(cat <<'EOF'
test(bundle): snapshotCurrentSchema integration test

Seeds two content types + entries covering SELECT, RELATION, and
unique TEXT (with duplicates), asserts every interesting field of
the snapshot the loader returns. DB-backed unit test mirroring the
existing import.test.ts pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Final verification and PR

- [ ] **Step 1: Full unit suite**

```bash
pnpm test:unit
```

Expected: all green (existing tests + new `planSchema.test.ts` + `snapshotCurrentSchema.test.ts` + the round-trip test added in Task 1).

- [ ] **Step 2: Full integration suite (sanity check — this plan adds no integration tests, but the import-side changes from Task 1 affect existing import behaviour)**

```bash
pnpm test:integration
```

Expected: all green.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 4: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 5: Format check on changed files**

```bash
git diff --name-only main..HEAD | xargs npx prettier --check
```

Expected: "All matched files use Prettier code style!"

(Skip the repo-wide `pnpm format` because pre-existing perf/reports NDJSON files cause unrelated failures.)

- [ ] **Step 6: Push the branch**

```bash
git push -u origin schema/planner
```

- [ ] **Step 7: Open the PR**

```bash
gh pr create --title "feat: schema-as-code planner (planSchema + snapshotCurrentSchema)" --body "$(cat <<'EOF'
## Summary

Implements Spec 2 of the schema-as-code stack — pure `planSchema()`
plus the `snapshotCurrentSchema()` loader. Diffs a desired schema
bundle against current DB state, produces a `SchemaPlan` of safe
ops, warnings, and blockers covering every row of the diff matrix
in the originating spec.

- New `BundleField.unique?: boolean` so schema files can carry the
  flag through export/import (closes a pre-existing bundle format gap).
- `apps/cms/scripts/content-bundle/planSchema.ts` — pure logic, no
  Prisma. Comprehensive unit tests, one row of the diff matrix per
  describe block.
- `apps/cms/scripts/content-bundle/snapshotCurrentSchema.ts` — the
  only impure file. Computes per-field usage (entriesWithValue,
  selectChoiceCounts, relationTargetCounts, duplicateValues) so the
  planner can answer safety questions without a DB.
- All shared types in `schemaPlan.types.ts`.

This unblocks Spec 3 (transactional applier), Spec 4 (entrypoint
auto-apply), and Spec 5 (CLI). All three consume `SchemaPlan` as
their interface.

## Test plan

- [x] Unit tests for every row of the diff matrix in
      `planSchema.test.ts`.
- [x] DB-backed test for the loader covering SELECT, RELATION,
      and unique TEXT (with duplicates).
- [x] Round-trip test for `unique` on `BundleField`.
- [x] Full integration suite — no regressions.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Self-Review

**Spec coverage check:**

- ✅ Pure `planSchema(bundle, current, options)` with all type signatures from the spec → Task 2 (types) + Task 3 (skeleton) + Tasks 4–15 (rules).
- ✅ `snapshotCurrentSchema(prisma)` loader → Task 17.
- ✅ Comprehensive unit tests covering every row of the diff matrix → Tasks 4–14 (rows 1–24, with row 5 documented as not-detectable-by-design and row 16 unconditional blocker covered).
- ✅ Snapshot DB-backed test → Task 18.
- ✅ Cross-reference resolution (RELATION_TARGET_NOT_FOUND) → Task 15.
- ✅ Plan ordering (types-then-fields) invariant → Task 16.
- ✅ `allowDestructive` unlocks documented and tested → Tasks 5 (type removal), 14 (field removal). Type-with-entries (row 3) and field-type-change (row 16) and unique-conflict (row 14) and select-in-use (row 19) and relation-in-use (row 22) all explicitly tested as NOT unlocked.
- ✅ Bundle format gap (`unique` not on `BundleField`) → landed in PR #151 (originally Task 1; split into a prereq bug-fix PR).

**Placeholder scan:**

- All code blocks contain real code; no "TBD" / "implement later" strings.
- All test cases use literal data, not "...similar to Task N".
- All commit messages and verification commands are exact.

**Type/symbol consistency:**

- `planSchema`, `snapshotCurrentSchema`, `effectiveBundleUnique`, `CurrentSchemaSnapshot`, `SchemaPlan`, `Blocker`, `Warning`, `TypeUpdate`, `FieldCreate`, `FieldUpdate`, `FieldRemoval`, `TypeRemoval`, `FieldUsage`, `PlanOptions` — all referenced consistently across tasks.
- `BlockerCode` and `WarningCode` unions match the spec verbatim, with one addition (`FIELD_REMOVAL_DATA_LOSS`) added in Task 14 with its own commit.
- Map keys for `fieldUsage` use the `${typeIdentifier}:${fieldIdentifier}` convention everywhere.

**Plan ordering note:**

- Row 5 (content type identifier change) is detected via id-based match for non-portable bundles (Task 5). For portable bundles (`id: null`), the rename is structurally indistinguishable from remove + create — those continue to surface as removal blockers per the spec's documented limitation.
- Field-level identifier change is detected the same way (Task 6). The new `FIELD_IDENTIFIER_CHANGE` blocker code matches the existing API immutability guarantee.
- The applier (Spec 3) is the consumer of `SchemaPlan`; this plan does NOT wire it up.

---

## Plan Done — Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-05-01-schema-as-code-planner.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
