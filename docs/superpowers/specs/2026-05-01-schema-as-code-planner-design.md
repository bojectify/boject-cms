# Schema-as-Code: `planSchema` Pure Planner

## Overview

Introduce a pure function that diffs a desired schema bundle against the current state of the database and produces a `SchemaPlan` describing the operations needed to converge — separated into safe operations, warnings, and blockers. The planner does not touch the database; it operates on a snapshot of current state passed in by the caller. This is the engine that makes idempotent every-boot apply (Spec 4) possible, and the foundation the applier (Spec 3) and CLI (Spec 5) both build on.

The planner answers four questions about a proposed schema change:

1. **What's changing?** — list of creates, updates, removes for content types and fields.
2. **Is anything risky?** — warnings (e.g. `required: false→true` when entries already have nulls).
3. **Is anything refused outright?** — blockers (e.g. field type change, content type with entries removed without `allowDestructive`).
4. **Can the apply proceed?** — a plan with zero blockers is safe to apply. Non-zero blockers means refuse before mutating.

This spec is the parent of Spec 3 (`applySchema`, the transactional executor) and Spec 4 (entrypoint integration). Specs 3, 4, and 5 all consume `SchemaPlan` as their interface contract.

## Approach

**Pure function.** No `PrismaClient` dependency in the planner itself. The caller fetches current state and passes a typed snapshot. This keeps the planner unit-testable without a database, and makes "what would change?" a question we can answer offline against any snapshot.

**Identifier-based merge keys.** Match content types by `identifier` (PascalCase API name) and fields by `(contentTypeIdentifier, fieldIdentifier)`. UUIDs in the bundle are ignored on apply — schema authors editing a committed JSON file should not need to know prod's UUIDs. This is a deliberate departure from `importBundle`'s current behaviour, which preserves UUIDs in non-portable mode.

**Diff matrix encoded as data.** Each rule in the diff matrix (the table from the design conversation, reproduced below) becomes a small predicate inside the planner. Adding new field properties or new safety checks means extending the matrix, not rewriting control flow.

**Pre-flight, then apply.** The applier (Spec 3) calls the planner first, refuses if blockers exist, then applies. Failing inside a transaction works correctness-wise but produces worse error messages — by the time you're mid-mutation, you've lost the global view.

**Two-pass output.** The plan separates content-type-level operations from field-level operations. The applier walks pass 1 (types) before pass 2 (fields) so RELATION fields can resolve targets to either pre-existing or just-created types — same shape as the existing portable-mode logic in `importBundle`.

## Scope

**In:**

- New file `apps/cms/scripts/content-bundle/planSchema.ts` exporting `planSchema(bundle, current, options)`.
- New file `apps/cms/scripts/content-bundle/schemaPlan.types.ts` exporting `SchemaPlan`, `Blocker`, `Warning`, `TypeUpdate`, `FieldUpdate`, `FieldRemoval`, `TypeRemoval` and the supporting unions.
- A small loader `apps/cms/scripts/content-bundle/snapshotCurrentSchema.ts` that reads current schema state from a `PrismaClient` (or transaction) and returns the typed snapshot the planner consumes. Lives in this spec because the snapshot type is part of the planner's contract; the loader is the only impure helper.
- Comprehensive unit tests in `apps/cms/scripts/content-bundle/planSchema.test.ts` covering every row of the diff matrix below.
- Cross-reference validation in the planner: bundle declares a RELATION targeting a non-existent identifier → blocker. Already partially covered by `validateBundle`; the planner adds the cross-bundle-vs-DB resolution step.

**Out (deferred to later specs):**

- Actually mutating the database (Spec 3).
- Running the planner from the entrypoint (Spec 4).
- Surfacing the plan to the CLI (Spec 5).
- Plans for **entries** — this spec is schema-only. Entry import remains the existing `importBundle` (one-shot, create-or-throw). Idempotent entry sync is a separate problem with different safety rules and is out of scope here.

## Design Decisions

### Pure planner, impure snapshot loader

Splitting the snapshot loader (`snapshotCurrentSchema`) from the planner (`planSchema`) means the planner is testable with hand-crafted snapshots — no DB required for unit tests — while a single loader concentrates all Prisma reads in one place. The applier calls them in sequence: `loader` → `planner` → `applier`. The CLI's `boject schema validate` command calls only `planner` against an empty snapshot (to validate cross-references in the bundle without needing a live CMS).

### Identifier-based merge, ignore UUIDs

The current `importBundle` honours UUIDs in non-portable bundles. For idempotent apply that's wrong: a schema file committed to git is the desired state, and the schema author should not need to know what UUIDs prod assigned. The planner ignores `id` fields entirely on the bundle side and matches by `identifier`. UUIDs continue to be preserved in the database — they just aren't part of the schema-as-code contract.

This means committed schema bundles should be exported with `--portable` semantics by default. The CLI's `schema pull` (Spec 5) does this implicitly. Operators writing bundles by hand should also write portable-style bundles. Non-portable bundles still work for one-shot transfers via the existing `pnpm content:import` flow — that path is not deprecated.

### Field type changes are blockers, not unsafe-with-flag

A field's `type` change (e.g. `TEXT` → `NUMBER`) is structurally undefined in our data model — every existing entry's value is suddenly the wrong shape. There is no migration we can do safely. Operators wanting this should rename the field (which is itself a remove + add today), not flip the type. The planner refuses unconditionally; even `allowDestructive: true` does not unlock it. Documented loudly so users don't burn cycles trying.

### `ENTRY_TITLE` and `SLUG` field rules carry over

The existing schema rules (exactly one `ENTRY_TITLE`, at most one `SLUG`, both auto-`unique: true`) are enforced by `validateBundle` and the field-CRUD endpoints today. The planner does not duplicate these — it relies on `validateBundle` running first. The applier (Spec 3) is responsible for invoking `validateBundle` on the bundle before invoking the planner. Out-of-the-box guarantees: if `validateBundle` says ok, the planner can assume bundle-internal invariants hold.

### Renames are remove-then-add, by design

A schema author who renames a field via the UI exports a bundle where the old identifier is missing and a new one is present. The planner sees this as a removal + addition — it has no way to know the user's intent. This is a documented limitation, identical to how Prisma's schema-driven SQL migrations behave. Mitigations available to the user:

- Use the UI rename, then export. Old data is preserved by the in-place rename. Then commit.
- Edit the JSON by hand to change the identifier in place. Old data on the prod DB still uses the old identifier, so the planner sees this as remove + add and refuses (or wipes data, with the destructive flag). Worse outcome than option 1.

The planner does not try to be clever. Renames live with the author's tooling, not the deploy path.

### Choices removed = blocker only if entries reference them

`SELECT` field choices are stored in `options.choices: string[]`. If an author removes a choice from the bundle, the planner consults the snapshot's `selectChoiceUsage` (computed by the loader) — keyed by `(contentTypeIdentifier, fieldIdentifier, choiceValue) → entryCount`. Zero usage → safe update. Non-zero → blocker (with affected entry IDs in the message). `allowDestructive` does not unlock this either; operators must update entries first.

### `targetContentTypeIds` shrinking = blocker only if entries point to dropped types

Same shape as choices. The loader computes `relationTargetUsage` keyed by `(contentTypeIdentifier, fieldIdentifier, targetTypeIdentifier) → entryCount`. The planner blocks the update if any entry currently points to a target type that the new bundle removes from the allow-list.

### Plan ordering: types first, then fields

Pass 1 (`contentTypes.create` and `contentTypes.update`): no fields touched. After pass 1, every type in the bundle exists in the DB. Pass 2 (`fields.*`): all field operations, including RELATION/MULTIRELATION target resolution against the now-complete type set. This mirrors the deferred-target logic already in `importBundle.ts` and avoids the chicken-and-egg of two types referencing each other via RELATION fields.

### Order field reordering is part of the plan, not a separate operation

When a field's `order` value differs between bundle and DB, that's a `FieldUpdate` with `changes.order`. The applier handles re-numbering by calling the existing reorder endpoint logic. No special "reorder" plan section.

## The Diff Matrix

This is the canonical reference; the planner enforces it row-by-row. Each row maps to a method on the planner.

| #   | Bundle vs DB                                                                             | Category | Default behaviour                                                                            | `allowDestructive` unlocks?                                       |
| --- | ---------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | Content type in bundle, not in DB                                                        | Create   | Add to plan as `contentTypes.create`                                                         | n/a                                                               |
| 2   | Content type in DB, not in bundle, no entries                                            | Removal  | Blocker                                                                                      | Yes — adds to `contentTypes.remove`                               |
| 3   | Content type in DB, not in bundle, entries exist                                         | Removal  | Blocker                                                                                      | **No** — refuses even with flag, recommend deleting entries first |
| 4   | Content type in both, `name` or `description` differs                                    | Update   | Add to plan as `contentTypes.update`                                                         | n/a                                                               |
| 5   | Content type `identifier` differs (bundle author tried to rename)                        | Update   | Blocker — `identifier` is immutable (already enforced by API)                                | No                                                                |
| 6   | Field in bundle, not in DB, on existing type                                             | Create   | Safe if `required: false` or no entries exist; warning if `required: true` and entries exist | n/a (warning, not blocker)                                        |
| 7   | Field in DB, not in bundle, no entries on the type                                       | Removal  | Blocker                                                                                      | Yes — adds to `fields.remove`                                     |
| 8   | Field in DB, not in bundle, entries exist with non-null values for that field            | Removal  | Blocker                                                                                      | Yes — adds to `fields.remove`, warns about data loss              |
| 9   | Field `name` or `order` differs                                                          | Update   | Add to `fields.update`                                                                       | n/a                                                               |
| 10  | Field `required: false → true`, no entries with null/missing                             | Update   | Safe                                                                                         | n/a                                                               |
| 11  | Field `required: false → true`, entries with null/missing                                | Update   | Blocker — name affected entries                                                              | No                                                                |
| 12  | Field `required: true → false`                                                           | Update   | Always safe                                                                                  | n/a                                                               |
| 13  | Field `unique: false → true`, no duplicates                                              | Update   | Safe; reuse `assertUniqueFieldValues` to verify                                              | n/a                                                               |
| 14  | Field `unique: false → true`, duplicates exist                                           | Update   | Blocker — name affected entries (same shape as the existing 409 `UNIQUE_CONFLICT`)           | No                                                                |
| 15  | Field `unique: true → false`                                                             | Update   | Always safe                                                                                  | n/a                                                               |
| 16  | Field `type` change                                                                      | Update   | Blocker — never unlocked                                                                     | **No**                                                            |
| 17  | SELECT choice added                                                                      | Update   | Safe                                                                                         | n/a                                                               |
| 18  | SELECT choice removed, no entries use it                                                 | Update   | Safe                                                                                         | n/a                                                               |
| 19  | SELECT choice removed, entries use it                                                    | Update   | Blocker — name affected entries                                                              | No                                                                |
| 20  | RELATION/MULTIRELATION `targetContentTypeIds` adds an entry                              | Update   | Safe                                                                                         | n/a                                                               |
| 21  | RELATION/MULTIRELATION `targetContentTypeIds` removes an entry, no relations point to it | Update   | Safe                                                                                         | n/a                                                               |
| 22  | RELATION/MULTIRELATION `targetContentTypeIds` removes an entry, relations point to it    | Update   | Blocker — name affected entries                                                              | No                                                                |
| 23  | RICHTEXT `targetContentTypeIds` or `linkTargetContentTypeIds` change                     | Update   | Safe — embed/link gating happens at write-time, not retroactively                            | n/a                                                               |
| 24  | Field options change that the planner doesn't recognise                                  | Update   | Add to `fields.update` with the new options blob — Prisma will validate at apply time        | n/a                                                               |

## Type Definitions

Types live in `schemaPlan.types.ts`:

```typescript
import type { FieldType, ContentStatus } from '#prisma';
import type { BundleContentType, BundleField } from './types';

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

export interface Warning {
  code:
    | 'NEW_REQUIRED_FIELD_WITH_ENTRIES'
    | 'OPTIONAL_TO_REQUIRED_NO_NULLS'
    | 'UNRECOGNISED_FIELD_OPTION';
  message: string;
  path: string;
}

export interface Blocker {
  code:
    | 'CONTENT_TYPE_REMOVAL_WITH_ENTRIES'
    | 'CONTENT_TYPE_IDENTIFIER_CHANGE'
    | 'FIELD_TYPE_CHANGE'
    | 'OPTIONAL_TO_REQUIRED_HAS_NULLS'
    | 'UNIQUE_CONFLICT'
    | 'SELECT_CHOICE_REMOVED_IN_USE'
    | 'RELATION_TARGET_REMOVED_IN_USE'
    | 'CONTENT_TYPE_REMOVAL_NEEDS_FLAG'
    | 'FIELD_REMOVAL_NEEDS_FLAG'
    | 'RELATION_TARGET_NOT_FOUND';
  message: string;
  path: string;
  /** Affected entry IDs, for blockers that name specific entries. */
  affectedEntryIds?: string[];
}

export interface PlanOptions {
  allowDestructive?: boolean;
}

export function planSchema(
  bundle: Bundle,
  current: CurrentSchemaSnapshot,
  options?: PlanOptions
): SchemaPlan;
```

## Files Added or Modified

| File                                                                  | Change                                                                                                                                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cms/scripts/content-bundle/schemaPlan.types.ts` (new)           | All exported types above.                                                                                                                                                  |
| `apps/cms/scripts/content-bundle/planSchema.ts` (new)                 | The pure planner. Pure logic — no Prisma imports.                                                                                                                          |
| `apps/cms/scripts/content-bundle/snapshotCurrentSchema.ts` (new)      | `snapshotCurrentSchema(prisma)` returning `CurrentSchemaSnapshot`. The only impure file in this spec.                                                                      |
| `apps/cms/scripts/content-bundle/planSchema.test.ts` (new)            | Unit tests, one `describe` per row of the diff matrix above. Hand-crafted snapshots; no DB.                                                                                |
| `apps/cms/scripts/content-bundle/snapshotCurrentSchema.test.ts` (new) | Integration test (`integration` Vitest project) — seeds a small DB state, calls the loader, asserts the snapshot shape. One test is enough; the loader's surface is small. |
| `apps/cms/scripts/content-bundle/types.ts`                            | No change expected. Re-exported as needed from `schemaPlan.types.ts`.                                                                                                      |
| `apps/cms/scripts/content-bundle/validate.ts`                         | No change. The planner relies on `validateBundle` running before it.                                                                                                       |

## Test Plan

`planSchema.test.ts` is the heaviest deliverable in this spec. Structure:

```typescript
describe('planSchema', () => {
  describe('safe operations', () => {
    it('plans create for new content type'); // row 1
    it('plans name/description update'); // row 4
    it('plans field create on existing type without entries'); // row 6 (safe path)
    it('plans field name/order update'); // row 9
    it('plans optional → required when no nulls exist'); // row 10
    it('plans required → optional'); // row 12
    it('plans unique → false'); // row 15
    it('plans select choice add'); // row 17
    it('plans select choice remove when unused'); // row 18
    it('plans relation target add'); // row 20
    it('plans relation target remove when unused'); // row 21
    it('plans richtext allow-list change'); // row 23
  });

  describe('warnings (non-blocking)', () => {
    it('warns on new required field when entries exist'); // row 6 (warning path)
    it('warns on unrecognised field option key'); // row 24
  });

  describe('blockers (refuse without flag)', () => {
    it('blocks content-type removal with entries'); // row 3
    it('blocks identifier change'); // row 5
    it('blocks optional → required with nulls, names entries'); // row 11
    it('blocks unique → true with duplicates, names entries'); // row 14
    it('blocks select choice removal in use, names entries'); // row 19
    it('blocks relation target removal in use, names entries'); // row 22
    it('blocks relation target not present in bundle or DB'); // (cross-ref)
    it('blocks content-type removal without flag, no entries'); // row 2
    it('blocks field removal without flag, no entries'); // row 7
    it('blocks field removal without flag, with entry data'); // row 8
  });

  describe('blockers unaffected by allowDestructive', () => {
    it('still blocks identifier change with flag'); // row 5
    it('still blocks field type change with flag'); // row 16
    it('still blocks content-type removal with entries + flag'); // row 3
    it('still blocks unique conflict with flag'); // row 14
    it('still blocks relation target in use with flag'); // row 22
  });

  describe('allowDestructive unlocks', () => {
    it('unlocks empty content-type removal'); // row 2 → row 2 with flag
    it('unlocks empty field removal'); // row 7 → row 7 with flag
    it('unlocks field removal with entry data, surfaces warning'); // row 8 → row 8 with flag
  });

  describe('plan ordering', () => {
    it('places type creates before field creates that target them');
    it('separates type updates from field updates');
  });

  describe('cross-references', () => {
    it('resolves RELATION targeting a type created in same bundle');
    it('resolves RELATION targeting an existing DB type');
    it('blocks RELATION targeting a type that exists in neither');
  });
});
```

`snapshotCurrentSchema.test.ts` is one integration test: seeds 2 content types and 5 entries, asserts the returned `CurrentSchemaSnapshot` matches expectations including `fieldUsage` populated correctly for SELECT, RELATION, and unique TEXT fields.

## Out of Scope

- Entry-level diffing (out of this spec — only schema is diffed; entries remain a one-shot import).
- Migration files or rename detection (documented limitation).
- A CLI for running the planner ad-hoc (Spec 5 — `boject schema validate` and `boject schema plan`).
- Wiring into the entrypoint (Spec 4).
- The actual mutation execution (Spec 3).
- Schema cache invalidation. The planner produces a plan; the applier (Spec 3) is responsible for calling `invalidateSchema()` after mutations.
