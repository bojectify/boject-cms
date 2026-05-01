# Schema-as-Code: `applySchema` Transactional Applier

## Overview

Implement the executor that takes a `SchemaPlan` (produced by `planSchema` — Spec 2) and applies it to the database inside a single transaction. Pre-flight rejects plans with blockers; the apply path mutates content types and fields in dependency order, calls `invalidateSchema()` on success, and returns a summary. This is what makes idempotent schema-as-code possible: a deploy can re-run apply on every boot, no-op when nothing changed, and never partially apply on failure.

This spec is consumed by Spec 4 (entrypoint integration) and Spec 5 (CLI). It is the only place in the schema-as-code stack that writes to the database.

Parent spec: [`2026-05-01-schema-as-code-planner-design.md`](./2026-05-01-schema-as-code-planner-design.md). All `SchemaPlan` types are defined there.

## Approach

**One transaction per apply.** Every mutation in the plan runs inside `prisma.$transaction(async (tx) => …)`. On any error, Postgres rolls back — the database is unchanged. There is no partial-apply state to recover from. This costs apply latency (the transaction holds locks longer) but pays for itself the first time a deploy fails halfway through.

**Pre-flight inside, not outside.** The applier accepts a `SchemaPlan` directly — but it also re-runs the planner against a snapshot taken inside the transaction, then asserts the new plan equals the input plan. This catches the race where another writer mutates the schema between plan-time and apply-time. Mismatch → throw, transaction rolls back, caller sees a clear "schema changed during apply" error.

**Two-pass execution.** Pass 1 = content-type-level operations (create, update, remove). Pass 2 = field-level operations (create, update, remove). This guarantees that a RELATION field added in pass 2 can resolve `targetContentTypeIds` against types created in pass 1.

**Reuse existing endpoint logic where possible.** The 7 schema-mutation endpoints already encode the right validation (PascalCase identifier check, unique-flag rules, ENTRY_TITLE/SLUG enforcement). The applier should call the same underlying utilities those endpoints use — `assertIdentifier`, `assertFieldIdentifier`, `resolveUniqueFlag`, `assertUniqueFieldValues` — not re-implement them. The endpoints stay the canonical surface for human edits; the applier is a parallel surface for file-driven edits.

**Schema cache invalidation.** After a successful apply that includes any content-type or field mutation, call `invalidateSchema()` so the next GraphQL request rebuilds. Skip the call when the plan is empty (a no-op apply on an unchanged file).

## Scope

**In:**

- New file `apps/cms/scripts/content-bundle/applySchema.ts` exporting `applySchema(prisma, bundle, options)`.
- The applier internally:
  1. Calls `validateBundle(bundle)`, throws on validation errors.
  2. Opens a `prisma.$transaction`.
  3. Inside the transaction: calls `snapshotCurrentSchema(tx)`, then `planSchema(bundle, snapshot, { allowDestructive })`.
  4. If `plan.blockers.length > 0`: throws a structured error containing all blockers — transaction rolls back before any mutation. (No mutations have happened yet, so rollback is trivially the right thing.)
  5. Executes pass 1 (content types), then pass 2 (fields). Each operation uses the same DB-level guards as the existing endpoints.
  6. After the transaction commits successfully, if any mutation was performed, calls `invalidateSchema()`.
- New env var `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA` plumbed through `runtimeConfig` and consumed by the entrypoint script (Spec 4) and CLI (Spec 5). The applier itself takes `allowDestructive: boolean` as an option — env-var translation lives at the call sites.
- New `--apply` flag on the existing `pnpm content:import` CLI that routes through `applySchema` instead of `importBundle`. This is the "ad-hoc" surface — operators can run idempotent apply against a running CMS via `pnpm content:import path/to/schema.boject.json --schema --apply`. Existing strict-create import continues to work via the no-`--apply` path.
- Integration tests covering the apply path against a real `boject_test` database.

**Out (deferred):**

- Entry-level idempotent apply (out of scope across the entire schema-as-code work; entries remain one-shot imports).
- Running `applySchema` from the entrypoint (Spec 4).
- API endpoint exposing the applier (Spec 5 — `/api/schema/apply` for the CLI).
- The planner itself (Spec 2 — already designed).
- Concurrency control beyond the in-transaction plan-equality check. We assume schema mutations are infrequent and Postgres-level write locks are sufficient.

## Design Decisions

### Re-plan inside the transaction, assert equality

A `SchemaPlan` is computed against a snapshot. Between snapshot time and apply time, another writer may have changed the schema (a UI edit on a non-readonly instance, or a concurrent CLI apply). If we apply the original plan blindly, we may overwrite legitimate changes or fail with confusing constraint errors mid-mutation.

Mitigation: take a fresh snapshot at the top of the transaction, re-run the planner, and compare against the input plan. If unequal, throw `SCHEMA_CHANGED_DURING_APPLY`. The user re-runs apply with a fresh plan. This trades a small extra read at apply time for a much better failure mode.

Equality check: deep-equal of the plan's `create` / `update` / `remove` / `blockers` / `warnings` arrays, sorted deterministically (by identifier, then by field identifier). The planner must produce stable ordering for this to work — covered by a planner test.

### Use endpoint utilities, don't bypass them

The existing endpoints encode product rules (e.g. `assertFieldIdentifier` enforces camelCase; `resolveUniqueFlag` rejects `unique: true` on non-TEXT/NUMBER fields). The applier reuses these. Two reasons:

1. Avoid divergence — if the rule changes, both surfaces stay in sync.
2. Trust — the endpoints have integration tests; reusing the same utilities means the applier inherits that confidence.

When the planner has already verified a rule (e.g. unique-conflict checks), the applier may skip the redundant check. Otherwise it runs the check, treating any failure as a hard error (since the planner should have caught it — failure means a planner bug).

### Allow-destructive is a single boolean, not granular

Operators either trust the bundle to remove things or they don't. Granular flags (`--allow-remove-types`, `--allow-remove-fields`) add surface area without solving a real problem — if you want to remove a field, you almost certainly trust the file to be right. The single boolean keeps the contract simple. Field-type changes remain blocked even with the flag (Spec 2, row 16).

### `--apply` flag on `content:import` rather than a separate CLI

The existing `pnpm content:import` already handles `--schema` / `--entries` / `--all` modes via `importBundle`. Adding `--apply` makes idempotent apply a sibling operation rather than a parallel command. The mode matrix becomes:

| Mode        | `--apply` absent                                              | `--apply` present                                |
| ----------- | ------------------------------------------------------------- | ------------------------------------------------ |
| `--schema`  | One-shot create-or-throw (`importBundle({ mode: 'schema' })`) | Idempotent apply (`applySchema`)                 |
| `--entries` | One-shot entry import (`importBundle({ mode: 'entries' })`)   | **Error** — `--apply` only valid with `--schema` |
| `--all`     | One-shot full import                                          | **Error** — same reason                          |

This keeps existing scripts working unchanged while making the new flow discoverable from the same entry point.

### `invalidateSchema()` only on non-empty plans

The schema cache rebuilds on next GraphQL request after invalidation. For a no-op apply (the plan was empty), invalidating is wasted work. The applier checks `plan.contentTypes.create.length + plan.contentTypes.update.length + plan.contentTypes.remove.length + plan.fields.create.length + plan.fields.update.length + plan.fields.remove.length > 0` before invalidating. This matters because the entrypoint (Spec 4) runs apply on every boot — most boots will be no-ops on a stable schema.

### Removal order: fields first, then types

Inside pass 1's "remove content types" sub-step, Prisma's cascading delete handles fields automatically (field FK has `onDelete: Cascade`). But the plan structure separates field removals from type removals — and field removals on types that are _also_ being removed are redundant. The applier optimises: when removing a content type, skip any field removals on that type from the plan (they'd error with "field not found" after the cascade). This is bookkeeping, not a correctness concern.

### Don't bother with batching for v1

The applier executes mutations one at a time. For schema apply this is fine — schemas have dozens of fields, not thousands. The `prisma.$transaction` overhead dominates either way. If apply latency becomes a problem (it won't, on schemas this size), revisit.

## Behaviour Contract

```typescript
import type { Bundle } from './types';
import type { PrismaClient } from '#prisma';
import type { SchemaPlan } from './schemaPlan.types';

export interface ApplySchemaOptions {
  allowDestructive?: boolean;
}

export interface ApplySchemaResult {
  /** Whether any mutations were executed. False = plan was empty (no-op). */
  changed: boolean;
  plan: SchemaPlan;
  applied: {
    contentTypesCreated: number;
    contentTypesUpdated: number;
    contentTypesRemoved: number;
    fieldsCreated: number;
    fieldsUpdated: number;
    fieldsRemoved: number;
  };
}

/**
 * Idempotent schema apply. Reads current state, computes a plan against
 * the bundle, applies any safe operations inside one transaction.
 *
 * Throws:
 * - `SchemaApplyValidationError` — bundle failed validateBundle.
 * - `SchemaApplyBlockedError` — plan has blockers; transaction rolled back.
 * - `SchemaChangedDuringApplyError` — schema changed between plan-time and
 *   apply-time. Caller should re-run.
 */
export async function applySchema(
  prisma: PrismaClient,
  bundle: Bundle,
  options?: ApplySchemaOptions
): Promise<ApplySchemaResult>;
```

Errors are exported as named classes from `applySchema.ts` so callers (Spec 4 entrypoint, Spec 5 API endpoint) can branch on them.

```typescript
export class SchemaApplyValidationError extends Error {
  readonly code = 'BUNDLE_INVALID';
  readonly errors: Array<{ path: string; message: string }>;
}

export class SchemaApplyBlockedError extends Error {
  readonly code = 'SCHEMA_APPLY_BLOCKED';
  readonly blockers: Blocker[];
  readonly plan: SchemaPlan;
}

export class SchemaChangedDuringApplyError extends Error {
  readonly code = 'SCHEMA_CHANGED_DURING_APPLY';
}
```

## Files Added or Modified

| File                                                         | Change                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/cms/scripts/content-bundle/applySchema.ts` (new)       | The applier. Imports the planner and snapshot loader from Spec 2.                                                                                                                                                  |
| `apps/cms/scripts/content-bundle/applySchemaErrors.ts` (new) | Error classes (small file, separate so test files can import without pulling Prisma).                                                                                                                              |
| `apps/cms/scripts/content-bundle/applySchema.test.ts` (new)  | Integration tests against `boject_test` DB.                                                                                                                                                                        |
| `apps/cms/scripts/content-bundle/index.ts`                   | Wire the new `--apply` flag into the CLI. Validate that `--apply` is only used with `--schema`.                                                                                                                    |
| `apps/cms/scripts/content-bundle/index.test.ts`              | Add CLI argument tests for the `--apply` flag combinations.                                                                                                                                                        |
| `apps/cms/server/graphql/schema.ts`                          | No change — `invalidateSchema` is already exported. The applier imports and calls it.                                                                                                                              |
| `apps/cms/server/utils/validateFieldUnique.ts`               | Export `assertUniqueAllowedForType` (currently `isUniqueAllowedForType` returning a boolean) as a throwing variant the applier can call directly. Tiny refactor; optional if the existing helpers compose cleanly. |
| `CLAUDE.md`                                                  | Add `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA` to the env vars list. Document the `pnpm content:import --apply` flow as the canonical idempotent-apply ad-hoc command.                                                      |

## Test Plan

`applySchema.test.ts` lives in the `integration` Vitest project. Each test seeds a small DB state, calls `applySchema`, asserts both the result and the resulting DB state.

```typescript
describe('applySchema', () => {
  describe('happy path', () => {
    it('creates a new content type from an empty DB');
    it('adds a field to an existing content type');
    it('renames a content type display name (identifier unchanged)');
    it('removes a SELECT choice that no entries use');
    it('expands a RELATION target list');
    it('reports changed=false on a no-op apply');
    it('does not call invalidateSchema on a no-op apply');
    it('calls invalidateSchema once on a non-empty apply');
  });

  describe('blockers refuse before mutating', () => {
    it('refuses to remove a content type with entries');
    it('refuses to change a field type');
    it('refuses to set required=true when nulls exist');
    it('refuses to set unique=true when duplicates exist, names entries');
    it('refuses to remove a SELECT choice in use, names entries');
    it('refuses to shrink RELATION targets when entries reference them');
    it('rolls back: DB unchanged after a refused apply');
  });

  describe('allowDestructive unlocks the right things', () => {
    it('removes an empty content type with the flag');
    it('removes an empty field with the flag');
    it('removes a field with entry data with the flag (data is lost)');
    it('still refuses field type change even with the flag');
    it('still refuses removal with entries even with the flag');
  });

  describe('transaction semantics', () => {
    it('rolls back on a Prisma constraint failure mid-pass-2');
    it('detects schema change during apply and throws');
  });

  describe('two-pass ordering', () => {
    it('creates a content type and a RELATION field targeting it in one apply');
    it('creates two content types that RELATION each other in one apply');
    it(
      'removes a field before removing the type that owns it (cascade preserves correctness)'
    );
  });

  describe('CLI integration', () => {
    it('pnpm content:import --schema --apply runs applySchema');
    it(
      'pnpm content:import --schema (without --apply) runs the existing strict importBundle'
    );
    it('pnpm content:import --entries --apply errors out');
    it('pnpm content:import --all --apply errors out');
  });

  describe('validateBundle integration', () => {
    it('throws SchemaApplyValidationError on a malformed bundle, no mutations');
  });
});
```

The existing `apps/cms/scripts/content-bundle/import.ts` and its tests are unchanged. The new applier is a sibling module; both are exported from the CLI entry point.

## Out of Scope

- Entry idempotent apply (whole-of-spec scope: schema only).
- HTTP/REST surface for the applier (Spec 5).
- Entrypoint integration (Spec 4).
- Concurrency: the in-transaction re-plan check handles "another writer changed something between plan and apply." We do not implement an advisory lock — at this scale it's not needed, and Postgres' default isolation handles the actual write conflicts.
- Rollback of a previously applied change as a first-class operation. The user reverts in git and re-applies. Symmetric remove-paths exist; that's enough.
- Auditing / history of applies. The Webhook delivery log is the closest analogue, but schema apply is not a webhook event today and adding one is out of scope here.
