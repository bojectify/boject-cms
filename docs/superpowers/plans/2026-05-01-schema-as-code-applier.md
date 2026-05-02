# Schema-as-Code Applier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `applySchema(prisma, bundle, options)` — the transactional executor that consumes a `SchemaPlan` and converges the database to the bundle's desired state. Idempotent: re-applying the same bundle is a no-op. Atomic: any error rolls back the whole apply. Plus a `--apply` flag on the existing `pnpm content:import` CLI as the canonical ad-hoc surface.

**Architecture:** A single `applySchema()` function opens one `prisma.$transaction`, calls `snapshotCurrentSchema(tx)` and `planSchema(bundle, snapshot, opts)` inside it, throws structured errors on bundle-validation failure or plan blockers, executes pass 1 (content-type ops) then pass 2 (field ops), and calls `invalidateSchema()` after commit if anything changed. Re-plans inside the transaction and asserts equality to detect concurrent schema mutation.

**Tech Stack:** TypeScript, Prisma 7 (driver-adapter pattern; same singleton client the rest of the app uses), Vitest unit project (DB-backed tests follow the existing `import.test.ts` pattern). No Nuxt or h3 dependencies — the applier runs from `tsx` and from the future entrypoint script.

**Originating spec:** [`docs/superpowers/specs/2026-05-01-schema-as-code-applier-design.md`](../specs/2026-05-01-schema-as-code-applier-design.md)
**Branch:** `feat/144-schema-as-code-applier` (will be created off `main` once the parent PRs merge)
**Parents shipped:**

- Spec 1 — schema-readonly-flag (PR #150)
- Bundle-format prereq — `unique` flag round-trip (PR #151)
- Spec 2 — schema-as-code planner (PR #152)
- Planner edge-cases — options equality + snapshot perf (PR #153)

**Children that consume this:** Spec 4 (entrypoint integration), Spec 5 (CLI HTTP surface).

---

## File Structure

| File                                                         | Responsibility                                                                                                                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cms/scripts/content-bundle/applySchemaErrors.ts` (new) | Three error classes — `SchemaApplyValidationError`, `SchemaApplyBlockedError`, `SchemaChangedDuringApplyError`. Separate file so test files can import error shapes without pulling Prisma.                          |
| `apps/cms/scripts/content-bundle/applySchema.ts` (new)       | The applier. Orchestrates validate → transaction → snapshot → plan → blocker check → re-plan equality → pass 1 → pass 2 → cache invalidate. Executes Prisma mutations directly; the planner already verified safety. |
| `apps/cms/scripts/content-bundle/applySchema.test.ts` (new)  | DB-backed tests against `boject_test`. Follows `import.test.ts` pattern (manual reset, direct PrismaClient via PrismaPg adapter). Lives in the unit Vitest project — `scripts/**/*.test.ts` glob picks it up.        |
| `apps/cms/scripts/content-bundle/index.ts` (modify)          | Add the `--apply` flag dispatch in the `import` command branch. When `--apply` is present with `--schema`, route to `applySchema`. With `--entries` or `--all`, error out. Print a result summary on success.        |
| `apps/cms/scripts/content-bundle/index.test.ts` (new)        | Argument-parsing tests for the `--apply` flag matrix. Pure — no DB. Mocks `applySchema`/`importBundle` to assert dispatch.                                                                                           |
| `apps/cms/scripts/content-bundle/plansEqual.ts` (new)        | Tiny helper for the in-transaction re-plan equality check. Sort + JSON-stringify-based comparison. Pure.                                                                                                             |
| `apps/cms/scripts/content-bundle/plansEqual.test.ts` (new)   | Unit tests for `plansEqual` covering insertion-order independence + content equality.                                                                                                                                |
| `CLAUDE.md` (modify)                                         | Document `pnpm content:import --schema --apply` as the canonical ad-hoc apply surface. Add `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA` to the runtime env vars list (forward-reference — consumed by Spec 4 / Spec 5).         |

---

## Cross-Cutting Notes

**Vitest projects.** `applySchema.test.ts` and `index.test.ts` live under `scripts/content-bundle/` and run in the **unit** project (no `globalSetup`). DB-backed tests reset the DB themselves in `beforeEach` — same pattern as `import.test.ts`, `roundtrip.test.ts`, `snapshotCurrentSchema.test.ts`.

**Run a single applier test:**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/applySchema.test.ts
```

**Postgres needed.** `pnpm db:up` before running the DB-backed tests.

**No Nuxt or h3 imports.** The applier runs from `tsx` standalone (and will run from a Docker entrypoint in Spec 4). Use direct Prisma types via `#prisma`. Do not import from `apps/cms/server/utils/*` files that pull h3 (e.g. `validateFieldUnique.ts` imports `createError` from h3 — too heavy for this module). The planner already enforced everything the endpoints would; the applier executes Prisma mutations directly.

**Re-plan equality check.** The spec mandates a re-snapshot + re-plan inside the transaction with deep-equality assertion to detect concurrent schema mutation. Implementation:

1. Take `snapshot1`, compute `plan1`, blocker check.
2. Take `snapshot2`, compute `plan2`.
3. If `!plansEqual(plan1, plan2)` → throw `SchemaChangedDuringApplyError`.
4. Apply `plan1`.

The two snapshots can race within Postgres' default `READ COMMITTED` isolation. The check costs one extra read pass — acceptable for an infrequent operation.

**`invalidateSchema()` only when something changed.** After the transaction commits and at least one mutation was performed (`changed: true`), call `invalidateSchema()`. Skip on no-op apply — the entrypoint (Spec 4) will run apply on every boot, and most boots won't change anything.

**lefthook on commit.** Pre-commit runs prettier + lint + per-package typecheck. If a hook rewrites formatting, re-stage and retry. If a hook fails, fix the underlying issue. Do NOT pass `--no-verify`.

**Commit messages.** Conventional commits matching recent history (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `perf:`). Each commit ends with the trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

**pnpm only.** Never `npm` / `npx`.

---

### Task 1: Error classes (`applySchemaErrors.ts`)

Three small named-class errors. Separate file so callers (Spec 4 entrypoint, Spec 5 API endpoint) can import them without pulling Prisma. Pure module.

**Files:**

- Create: `apps/cms/scripts/content-bundle/applySchemaErrors.ts`
- Create: `apps/cms/scripts/content-bundle/applySchemaErrors.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/cms/scripts/content-bundle/applySchemaErrors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  SchemaApplyBlockedError,
  SchemaApplyValidationError,
  SchemaChangedDuringApplyError,
} from './applySchemaErrors';
import type { Blocker, SchemaPlan } from './schemaPlan.types';

describe('applySchemaErrors', () => {
  it('SchemaApplyValidationError carries code and validation errors', () => {
    const err = new SchemaApplyValidationError([
      { path: 'contentTypes[0].name', message: 'must be a non-empty string' },
    ]);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('BUNDLE_INVALID');
    expect(err.errors).toHaveLength(1);
    expect(err.errors[0]!.path).toBe('contentTypes[0].name');
    expect(err.message).toContain('Bundle validation failed');
  });

  it('SchemaApplyBlockedError carries blockers and the plan', () => {
    const blockers: Blocker[] = [
      {
        code: 'CONTENT_TYPE_REMOVAL_WITH_ENTRIES',
        message: 'cannot remove',
        path: 'contentTypes.Article',
      },
    ];
    const plan: SchemaPlan = {
      contentTypes: { create: [], update: [], remove: [] },
      fields: { create: [], update: [], remove: [] },
      warnings: [],
      blockers,
    };
    const err = new SchemaApplyBlockedError(blockers, plan);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('SCHEMA_APPLY_BLOCKED');
    expect(err.blockers).toBe(blockers);
    expect(err.plan).toBe(plan);
    expect(err.message).toContain('1 blocker');
  });

  it('SchemaChangedDuringApplyError carries code', () => {
    const err = new SchemaChangedDuringApplyError();
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('SCHEMA_CHANGED_DURING_APPLY');
    expect(err.message).toContain('Schema changed');
  });
});
```

- [ ] **Step 2: Run, verify it FAILS**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/applySchemaErrors.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the error classes**

`apps/cms/scripts/content-bundle/applySchemaErrors.ts`:

```ts
// apps/cms/scripts/content-bundle/applySchemaErrors.ts
//
// Error classes thrown by applySchema. Pure module — no Prisma, no h3.
// Callers (Spec 4 entrypoint, Spec 5 API endpoint) branch on the
// `code` property to map these to exit codes / HTTP statuses.

import type { Blocker, SchemaPlan } from './schemaPlan.types';

export interface BundleValidationError {
  path: string;
  message: string;
}

export class SchemaApplyValidationError extends Error {
  readonly code = 'BUNDLE_INVALID' as const;
  readonly errors: BundleValidationError[];

  constructor(errors: BundleValidationError[]) {
    super(
      `Bundle validation failed with ${errors.length} error(s): ${errors
        .map((e) => `${e.path}: ${e.message}`)
        .join('; ')}`
    );
    this.name = 'SchemaApplyValidationError';
    this.errors = errors;
  }
}

export class SchemaApplyBlockedError extends Error {
  readonly code = 'SCHEMA_APPLY_BLOCKED' as const;
  readonly blockers: Blocker[];
  readonly plan: SchemaPlan;

  constructor(blockers: Blocker[], plan: SchemaPlan) {
    super(
      `Schema apply blocked by ${blockers.length} blocker(s): ${blockers
        .map((b) => `[${b.code}] ${b.message}`)
        .join('; ')}`
    );
    this.name = 'SchemaApplyBlockedError';
    this.blockers = blockers;
    this.plan = plan;
  }
}

export class SchemaChangedDuringApplyError extends Error {
  readonly code = 'SCHEMA_CHANGED_DURING_APPLY' as const;

  constructor() {
    super('Schema changed between plan time and apply time. Re-run apply.');
    this.name = 'SchemaChangedDuringApplyError';
  }
}
```

- [ ] **Step 4: Run, verify GREEN**

Expected: 3/3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/applySchemaErrors.ts apps/cms/scripts/content-bundle/applySchemaErrors.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): error classes for schema applier

Three named-class errors with `code` discriminators so Spec 4
(entrypoint) and Spec 5 (CLI) callers can branch cleanly:
- SchemaApplyValidationError (BUNDLE_INVALID)
- SchemaApplyBlockedError (SCHEMA_APPLY_BLOCKED, carries blockers + plan)
- SchemaChangedDuringApplyError (SCHEMA_CHANGED_DURING_APPLY)

Pure module — no Prisma, no h3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `plansEqual` helper

Tiny utility for the in-transaction re-plan equality check. Sorts the plan's array contents deterministically, then JSON.stringify-compares. Pure module.

**Files:**

- Create: `apps/cms/scripts/content-bundle/plansEqual.ts`
- Create: `apps/cms/scripts/content-bundle/plansEqual.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { plansEqual } from './plansEqual';
import type { SchemaPlan } from './schemaPlan.types';

const empty = (): SchemaPlan => ({
  contentTypes: { create: [], update: [], remove: [] },
  fields: { create: [], update: [], remove: [] },
  warnings: [],
  blockers: [],
});

describe('plansEqual', () => {
  it('returns true for two empty plans', () => {
    expect(plansEqual(empty(), empty())).toBe(true);
  });

  it('returns true for plans with identical contents in identical order', () => {
    const a = empty();
    const b = empty();
    a.contentTypes.update.push({
      id: 'ct-1',
      identifier: 'Article',
      changes: { name: 'Renamed' },
    });
    b.contentTypes.update.push({
      id: 'ct-1',
      identifier: 'Article',
      changes: { name: 'Renamed' },
    });
    expect(plansEqual(a, b)).toBe(true);
  });

  it('returns true regardless of insertion order (sorts by identifier)', () => {
    const a = empty();
    const b = empty();
    a.contentTypes.update.push(
      { id: 'ct-1', identifier: 'Article', changes: { name: 'A' } },
      { id: 'ct-2', identifier: 'Author', changes: { name: 'B' } }
    );
    b.contentTypes.update.push(
      { id: 'ct-2', identifier: 'Author', changes: { name: 'B' } },
      { id: 'ct-1', identifier: 'Article', changes: { name: 'A' } }
    );
    expect(plansEqual(a, b)).toBe(true);
  });

  it('returns false when one plan has a different update', () => {
    const a = empty();
    const b = empty();
    a.contentTypes.update.push({
      id: 'ct-1',
      identifier: 'Article',
      changes: { name: 'A' },
    });
    b.contentTypes.update.push({
      id: 'ct-1',
      identifier: 'Article',
      changes: { name: 'B' },
    });
    expect(plansEqual(a, b)).toBe(false);
  });

  it('returns false when one plan has an extra blocker', () => {
    const a = empty();
    const b = empty();
    b.blockers.push({
      code: 'CONTENT_TYPE_REMOVAL_NEEDS_FLAG',
      message: 'x',
      path: 'contentTypes.X',
    });
    expect(plansEqual(a, b)).toBe(false);
  });

  it('sorts field-level operations by contentTypeIdentifier:fieldIdentifier', () => {
    const a = empty();
    const b = empty();
    a.fields.update.push(
      {
        id: 'f-1',
        contentTypeIdentifier: 'Article',
        fieldIdentifier: 'title',
        changes: { name: 'T' },
      },
      {
        id: 'f-2',
        contentTypeIdentifier: 'Article',
        fieldIdentifier: 'body',
        changes: { name: 'B' },
      }
    );
    b.fields.update.push(
      {
        id: 'f-2',
        contentTypeIdentifier: 'Article',
        fieldIdentifier: 'body',
        changes: { name: 'B' },
      },
      {
        id: 'f-1',
        contentTypeIdentifier: 'Article',
        fieldIdentifier: 'title',
        changes: { name: 'T' },
      }
    );
    expect(plansEqual(a, b)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify it FAILS**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/plansEqual.test.ts
```

- [ ] **Step 3: Create the helper**

```ts
// apps/cms/scripts/content-bundle/plansEqual.ts
//
// Deterministic equality check for two SchemaPlans. Used by the
// applier's in-transaction re-plan check: take two snapshots back
// to back, compute plans, assert equality. If a concurrent writer
// changed something, plansEqual returns false and the applier
// rolls back with SchemaChangedDuringApplyError.
//
// Pure module — no DB, no Prisma.

import type { SchemaPlan } from './schemaPlan.types';

export function plansEqual(a: SchemaPlan, b: SchemaPlan): boolean {
  return canonicalise(a) === canonicalise(b);
}

function canonicalise(plan: SchemaPlan): string {
  return JSON.stringify({
    contentTypes: {
      create: [...plan.contentTypes.create].sort((x, y) =>
        x.identifier.localeCompare(y.identifier)
      ),
      update: [...plan.contentTypes.update].sort((x, y) =>
        x.identifier.localeCompare(y.identifier)
      ),
      remove: [...plan.contentTypes.remove].sort((x, y) =>
        x.identifier.localeCompare(y.identifier)
      ),
    },
    fields: {
      create: [...plan.fields.create].sort((x, y) =>
        fieldKey(x.contentTypeIdentifier, x.field.identifier).localeCompare(
          fieldKey(y.contentTypeIdentifier, y.field.identifier)
        )
      ),
      update: [...plan.fields.update].sort((x, y) =>
        fieldKey(x.contentTypeIdentifier, x.fieldIdentifier).localeCompare(
          fieldKey(y.contentTypeIdentifier, y.fieldIdentifier)
        )
      ),
      remove: [...plan.fields.remove].sort((x, y) =>
        fieldKey(x.contentTypeIdentifier, x.fieldIdentifier).localeCompare(
          fieldKey(y.contentTypeIdentifier, y.fieldIdentifier)
        )
      ),
    },
    warnings: [...plan.warnings].sort((x, y) =>
      `${x.code}:${x.path}`.localeCompare(`${y.code}:${y.path}`)
    ),
    blockers: [...plan.blockers].sort((x, y) =>
      `${x.code}:${x.path}`.localeCompare(`${y.code}:${y.path}`)
    ),
  });
}

function fieldKey(typeIdentifier: string, fieldIdentifier: string): string {
  return `${typeIdentifier}:${fieldIdentifier}`;
}
```

- [ ] **Step 4: Run, verify GREEN** (6/6 tests pass).

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/plansEqual.ts apps/cms/scripts/content-bundle/plansEqual.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): plansEqual helper for in-transaction re-plan check

Deterministic equality check for two SchemaPlans. Sorts each array
by stable key (identifier for type ops, type:field for field ops,
code:path for warnings/blockers) then JSON.stringify-compares.

Used by the applier's in-transaction safety check (Spec 3) — take
two snapshots back to back, plansEqual the resulting plans, throw
SchemaChangedDuringApplyError on mismatch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Skeleton `applySchema()` — empty-bundle no-op

TDD baseline: an `applySchema()` that handles the empty-bundle / empty-DB case and returns `{ changed: false, plan, applied: zeros }`. No mutations, no `invalidateSchema()` call. The transaction wrapper is in place.

**Files:**

- Create: `apps/cms/scripts/content-bundle/applySchema.ts`
- Create: `apps/cms/scripts/content-bundle/applySchema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { applySchema } from './applySchema';
import type { Bundle } from './types';

const url = 'postgresql://boject:boject@localhost:5432/boject_test';
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

const emptyBundle: Bundle = {
  version: 2,
  exportedAt: '2026-05-01T00:00:00.000Z',
  portable: true,
  contentTypes: [],
};

describe('applySchema', () => {
  beforeEach(async () => {
    await reset();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  describe('happy path — no-op', () => {
    it('returns changed=false for an empty bundle on an empty DB', async () => {
      const result = await applySchema(prisma, emptyBundle);
      expect(result.changed).toBe(false);
      expect(result.applied).toEqual({
        contentTypesCreated: 0,
        contentTypesUpdated: 0,
        contentTypesRemoved: 0,
        fieldsCreated: 0,
        fieldsUpdated: 0,
        fieldsRemoved: 0,
      });
      expect(result.plan.contentTypes.create).toEqual([]);
      expect(result.plan.blockers).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run, verify it FAILS**

```bash
pnpm --filter cms exec vitest run --project unit scripts/content-bundle/applySchema.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the skeleton**

```ts
// apps/cms/scripts/content-bundle/applySchema.ts
//
// Idempotent schema apply. Reads current state, computes a plan
// against the bundle, applies any safe operations inside a single
// transaction. Spec 3.
//
// Throws:
// - SchemaApplyValidationError — bundle failed validateBundle.
// - SchemaApplyBlockedError — plan has blockers; transaction rolls back.
// - SchemaChangedDuringApplyError — schema changed between two snapshots
//   inside the transaction. Caller should re-run.

import type { PrismaClient } from '#prisma';
import type { Bundle } from './types';
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

const ZERO_APPLIED: ApplySchemaResult['applied'] = {
  contentTypesCreated: 0,
  contentTypesUpdated: 0,
  contentTypesRemoved: 0,
  fieldsCreated: 0,
  fieldsUpdated: 0,
  fieldsRemoved: 0,
};

export async function applySchema(
  _prisma: PrismaClient,
  _bundle: Bundle,
  _options: ApplySchemaOptions = {}
): Promise<ApplySchemaResult> {
  const plan: SchemaPlan = {
    contentTypes: { create: [], update: [], remove: [] },
    fields: { create: [], update: [], remove: [] },
    warnings: [],
    blockers: [],
  };
  return { changed: false, plan, applied: { ...ZERO_APPLIED } };
}
```

(Underscore-prefixed parameters silence unused-vars; subsequent tasks read them.)

- [ ] **Step 4: Run, verify GREEN** (1/1 test passes).

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/applySchema.ts apps/cms/scripts/content-bundle/applySchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): applySchema() skeleton — empty-bundle no-op

Baseline that hands back changed=false on an empty bundle. Subsequent
tasks add validation, plan computation, blocker handling, the two-pass
mutation walk, the in-transaction re-plan check, and the
invalidateSchema() call.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: validateBundle integration

The applier rejects malformed bundles BEFORE opening a transaction. Throws `SchemaApplyValidationError` with the validation errors.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/applySchema.ts`
- Modify: `apps/cms/scripts/content-bundle/applySchema.test.ts`

- [ ] **Step 1: Add the failing test**

Append to the `applySchema.test.ts` describe (after the `'happy path — no-op'` block):

```ts
describe('validateBundle integration', () => {
  it('throws SchemaApplyValidationError on a malformed bundle, no transaction opened', async () => {
    const malformedBundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Article',
          name: 'Article',
          description: null,
          // No fields array → validateBundle rejects "fields must be an array"
        },
      ],
    } as unknown as Bundle;

    await expect(applySchema(prisma, malformedBundle)).rejects.toThrow(
      /Bundle validation failed/
    );
    await expect(applySchema(prisma, malformedBundle)).rejects.toMatchObject({
      code: 'BUNDLE_INVALID',
    });
  });
});
```

- [ ] **Step 2: Run, verify it FAILS**

- [ ] **Step 3: Wire validateBundle into applySchema**

Update `applySchema.ts`:

```ts
import type { PrismaClient } from '#prisma';
import type { Bundle } from './types';
import type { SchemaPlan } from './schemaPlan.types';
import { validateBundle } from './validate';
import { SchemaApplyValidationError } from './applySchemaErrors';

// ... (interfaces unchanged)

export async function applySchema(
  _prisma: PrismaClient,
  bundle: Bundle,
  _options: ApplySchemaOptions = {}
): Promise<ApplySchemaResult> {
  const validation = validateBundle(bundle);
  if (!validation.ok) {
    throw new SchemaApplyValidationError(validation.errors);
  }

  const plan: SchemaPlan = {
    contentTypes: { create: [], update: [], remove: [] },
    fields: { create: [], update: [], remove: [] },
    warnings: [],
    blockers: [],
  };
  return { changed: false, plan, applied: { ...ZERO_APPLIED } };
}
```

- [ ] **Step 4: Run, verify GREEN** (2/2 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/applySchema.ts apps/cms/scripts/content-bundle/applySchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): applySchema validates bundle shape before opening transaction

Calls validateBundle() up front. On failure, throws
SchemaApplyValidationError with the structured errors — no
transaction is opened, so no DB cost is incurred.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Plan computation + blocker handling inside transaction

Open a `prisma.$transaction`, call `snapshotCurrentSchema(tx)` and `planSchema(bundle, snapshot, opts)` inside it. If `plan.blockers.length > 0`, throw `SchemaApplyBlockedError`. Transaction rolls back automatically (no mutations have happened yet).

**Files:**

- Modify: `apps/cms/scripts/content-bundle/applySchema.ts`
- Modify: `apps/cms/scripts/content-bundle/applySchema.test.ts`

- [ ] **Step 1: Add the failing tests**

Append:

```ts
describe('blocker handling — refuses before mutating', () => {
  it('throws SchemaApplyBlockedError on a blocker, DB unchanged', async () => {
    // Seed a content type with an entry. An empty bundle would try to
    // remove it, which is blocked even with allowDestructive.
    const ct = await prisma.contentType.create({
      data: {
        identifier: 'Locked',
        name: 'Locked',
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

    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [],
    };

    await expect(
      applySchema(prisma, bundle, { allowDestructive: true })
    ).rejects.toMatchObject({
      code: 'SCHEMA_APPLY_BLOCKED',
    });

    // DB unchanged — content type still exists.
    const stillThere = await prisma.contentType.findUnique({
      where: { identifier: 'Locked' },
    });
    expect(stillThere).not.toBeNull();
  });

  it('blocker error carries the blockers array and the plan', async () => {
    await prisma.contentType.create({
      data: {
        identifier: 'WithEntries',
        name: 'WithEntries',
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
    await prisma.contentEntry.create({
      data: {
        contentTypeId: (
          await prisma.contentType.findUniqueOrThrow({
            where: { identifier: 'WithEntries' },
          })
        ).id,
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

    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [],
    };

    try {
      await applySchema(prisma, bundle);
      throw new Error('expected applySchema to throw');
    } catch (e) {
      const err = e as { code: string; blockers: unknown[]; plan: unknown };
      expect(err.code).toBe('SCHEMA_APPLY_BLOCKED');
      expect(err.blockers.length).toBeGreaterThan(0);
      expect(err.plan).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run, verify they FAIL**

Expected: tests fail because the skeleton doesn't open a transaction or throw the blocked error.

- [ ] **Step 3: Open the transaction, plan, blocker-throw**

Replace the `applySchema` body:

```ts
import { snapshotCurrentSchema } from './snapshotCurrentSchema';
import { planSchema } from './planSchema';
import {
  SchemaApplyBlockedError,
  SchemaApplyValidationError,
} from './applySchemaErrors';

// ... (interfaces and ZERO_APPLIED unchanged)

export async function applySchema(
  prisma: PrismaClient,
  bundle: Bundle,
  options: ApplySchemaOptions = {}
): Promise<ApplySchemaResult> {
  const validation = validateBundle(bundle);
  if (!validation.ok) {
    throw new SchemaApplyValidationError(validation.errors);
  }

  return prisma.$transaction(async (tx) => {
    const snapshot = await snapshotCurrentSchema(tx as PrismaClient);
    const plan = planSchema(bundle, snapshot, {
      allowDestructive: options.allowDestructive,
    });

    if (plan.blockers.length > 0) {
      throw new SchemaApplyBlockedError(plan.blockers, plan);
    }

    // No-op short-circuit will land in subsequent tasks; for now,
    // still return changed: false because the mutation walk hasn't
    // been written.
    return { changed: false, plan, applied: { ...ZERO_APPLIED } };
  });
}
```

The cast `tx as PrismaClient` is a small white lie: Prisma's transaction client `Prisma.TransactionClient` is structurally compatible with the methods `snapshotCurrentSchema` calls (`findMany`, `groupBy`). Justified because the callsite is type-correct at runtime; if Prisma's type narrowing improves later, drop the cast.

- [ ] **Step 4: Run, verify GREEN**

All four tests should now pass (1 from Task 3 no-op, 1 from Task 4 validation, 2 from Task 5 blocker).

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/applySchema.ts apps/cms/scripts/content-bundle/applySchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): applySchema computes plan in transaction, throws on blockers

Inside prisma.$transaction: snapshot current schema, compute plan,
short-circuit-throw SchemaApplyBlockedError if any blocker is present.
Transaction rolls back (no mutations have happened yet, so this is
trivially safe).

Mutation walks land in subsequent tasks. The transaction wrapper is
the load-bearing piece — any error thrown inside it triggers rollback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Pass 1 — content-type create + update

Pass 1 mutates content-type-level state. This task covers `contentTypes.create` and `contentTypes.update`. Removals land in Task 7 (they have a cascade subtlety).

**Files:**

- Modify: `apps/cms/scripts/content-bundle/applySchema.ts`
- Modify: `apps/cms/scripts/content-bundle/applySchema.test.ts`

- [ ] **Step 1: Add the failing tests**

```ts
describe('happy path — pass 1 (types)', () => {
  it('creates a new content type from an empty DB, with its fields embedded', async () => {
    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Article',
          name: 'Article',
          description: 'Blog article',
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
              identifier: 'slug',
              name: 'Slug',
              type: 'SLUG',
              required: false,
              order: 1,
              options: null,
            },
          ],
        },
      ],
    };
    const result = await applySchema(prisma, bundle);
    expect(result.changed).toBe(true);
    expect(result.applied.contentTypesCreated).toBe(1);

    const ct = await prisma.contentType.findUnique({
      where: { identifier: 'Article' },
      include: { fields: true },
    });
    expect(ct).not.toBeNull();
    expect(ct!.name).toBe('Article');
    expect(ct!.description).toBe('Blog article');
    expect(ct!.fields).toHaveLength(2);
    expect(ct!.fields.find((f) => f.identifier === 'title')!.unique).toBe(true);
    expect(ct!.fields.find((f) => f.identifier === 'slug')!.unique).toBe(true);
  });

  it('updates a content type display name (identifier unchanged)', async () => {
    await prisma.contentType.create({
      data: {
        identifier: 'Article',
        name: 'Old Name',
        description: null,
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

    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Article',
          name: 'New Name',
          description: 'Renamed',
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
    const result = await applySchema(prisma, bundle);
    expect(result.changed).toBe(true);
    expect(result.applied.contentTypesUpdated).toBe(1);

    const ct = await prisma.contentType.findUnique({
      where: { identifier: 'Article' },
    });
    expect(ct!.name).toBe('New Name');
    expect(ct!.description).toBe('Renamed');
  });
});
```

- [ ] **Step 2: Run, verify they FAIL**

Both tests should fail — `applySchema` currently returns `changed: false` and applies nothing.

- [ ] **Step 3: Implement pass 1 (types: create + update)**

Inside the transaction, after the blocker check, add:

```ts
import type { Bundle, BundleField } from './types';
import { effectiveBundleUnique } from './schemaPlan.types';
// ... (other imports)

// Inside the transaction body, after the blocker check:

const applied: ApplySchemaResult['applied'] = { ...ZERO_APPLIED };

// Pass 1: content-type creates (with fields embedded).
for (const bt of plan.contentTypes.create) {
  await tx.contentType.create({
    data: {
      identifier: bt.identifier,
      name: bt.name,
      description: bt.description ?? undefined,
      fields: {
        create: bt.fields.map(toFieldCreatePayload),
      },
    },
  });
  applied.contentTypesCreated += 1;
}

// Pass 1: content-type updates (name + description only — identifier
// is immutable, planner already enforced).
for (const update of plan.contentTypes.update) {
  await tx.contentType.update({
    where: { id: update.id },
    data: update.changes,
  });
  applied.contentTypesUpdated += 1;
}

// Pass 1: content-type removes — Task 7.

// Pass 2: fields — Tasks 8-11.

const changed = isPlanNonEmpty(plan);
return { changed, plan, applied };
```

Add the helpers at the bottom of the file:

```ts
function toFieldCreatePayload(f: BundleField) {
  return {
    identifier: f.identifier,
    name: f.name,
    type: f.type,
    required: f.required,
    unique: effectiveBundleUnique(f),
    order: f.order,
    options: (f.options ?? undefined) as
      | import('#prisma').Prisma.InputJsonValue
      | undefined,
  };
}

function isPlanNonEmpty(plan: SchemaPlan): boolean {
  return (
    plan.contentTypes.create.length > 0 ||
    plan.contentTypes.update.length > 0 ||
    plan.contentTypes.remove.length > 0 ||
    plan.fields.create.length > 0 ||
    plan.fields.update.length > 0 ||
    plan.fields.remove.length > 0
  );
}
```

- [ ] **Step 4: Run, verify GREEN**

Both tests pass plus the existing 4. Total: 6/6.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/applySchema.ts apps/cms/scripts/content-bundle/applySchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): applySchema pass 1 — content-type creates + updates

Walks plan.contentTypes.create with fields embedded (so RELATION
fields added in pass 2 can resolve targets to types created here),
then plan.contentTypes.update for name/description changes.

Field create payload uses effectiveBundleUnique() so ENTRY_TITLE/SLUG
come in unique=true even from legacy bundles without the flag.
isPlanNonEmpty() drives the changed boolean in the result.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Pass 1 — content-type removes (cascade-aware)

`tx.contentType.delete` cascades to fields via Prisma's `onDelete: Cascade`. The applier optimises: when removing a content type, it does NOT need to also walk `plan.fields.remove` for that type — the cascade handles them. Just call `delete` and increment the counter.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/applySchema.ts`
- Modify: `apps/cms/scripts/content-bundle/applySchema.test.ts`

- [ ] **Step 1: Add the failing tests**

```ts
describe('happy path — pass 1 removes', () => {
  it('removes an empty content type with allowDestructive', async () => {
    await prisma.contentType.create({
      data: {
        identifier: 'Stale',
        name: 'Stale',
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

    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [],
    };
    const result = await applySchema(prisma, bundle, {
      allowDestructive: true,
    });
    expect(result.changed).toBe(true);
    expect(result.applied.contentTypesRemoved).toBe(1);

    const gone = await prisma.contentType.findUnique({
      where: { identifier: 'Stale' },
    });
    expect(gone).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** (test expects removal but the applier doesn't yet remove).

- [ ] **Step 3: Add the removal pass**

After the update loop:

```ts
// Pass 1: content-type removes. Prisma's onDelete: Cascade cleans up
// fields — no need to walk fields.remove for these types.
const removedTypeIds = new Set<string>();
for (const removal of plan.contentTypes.remove) {
  await tx.contentType.delete({ where: { id: removal.id } });
  applied.contentTypesRemoved += 1;
  removedTypeIds.add(removal.id);
}
```

The `removedTypeIds` set will be consumed by Task 11's field-remove walk to skip cascaded fields.

- [ ] **Step 4: Run, verify GREEN**.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/applySchema.ts apps/cms/scripts/content-bundle/applySchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): applySchema pass 1 — content-type removes

Walks plan.contentTypes.remove with prisma.contentType.delete().
Prisma's onDelete: Cascade handles field deletion automatically.
Tracks removedTypeIds so the field-remove walk (Task 11) can skip
already-cascaded fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Pass 2 — field create

Pass 2 starts. New fields land on existing content types. The plan's `fields.create` excludes fields on types being CREATED in pass 1 (those rode along inside `contentTypes.create`).

**Files:**

- Modify: `apps/cms/scripts/content-bundle/applySchema.ts`
- Modify: `apps/cms/scripts/content-bundle/applySchema.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('happy path — pass 2 (field creates)', () => {
  it('adds a field to an existing content type', async () => {
    await prisma.contentType.create({
      data: {
        identifier: 'Article',
        name: 'Article',
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
    const result = await applySchema(prisma, bundle);
    expect(result.changed).toBe(true);
    expect(result.applied.fieldsCreated).toBe(1);

    const tagline = await prisma.contentTypeField.findFirst({
      where: { identifier: 'tagline' },
    });
    expect(tagline).not.toBeNull();
    expect(tagline!.type).toBe('TEXT');
  });
});
```

- [ ] **Step 2: Run, verify it FAILS**.

- [ ] **Step 3: Add the field-create walk**

After the type-removal loop:

```ts
// Pass 2: field creates on existing types.
for (const create of plan.fields.create) {
  await tx.contentTypeField.create({
    data: {
      contentTypeId: create.contentTypeId,
      ...toFieldCreatePayload(create.field),
    },
  });
  applied.fieldsCreated += 1;
}
```

- [ ] **Step 4: Run, verify GREEN**.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/applySchema.ts apps/cms/scripts/content-bundle/applySchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): applySchema pass 2 — field creates

Walks plan.fields.create. The plan only contains fields targeting
types that already exist in the DB (or were created earlier in pass 1) —
fields on bundle-new types ride along with contentTypes.create instead.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Pass 2 — field updates (name/order/required/unique/options)

A single `tx.contentTypeField.update` call per `FieldUpdate`. The planner already validated the change is safe; the applier just hands the changes to Prisma.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/applySchema.ts`
- Modify: `apps/cms/scripts/content-bundle/applySchema.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('happy path — pass 2 (field updates)', () => {
  it('updates a field name and order', async () => {
    await prisma.contentType.create({
      data: {
        identifier: 'Article',
        name: 'Article',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Old Title',
              type: 'ENTRY_TITLE',
              required: true,
              unique: true,
              order: 5,
            },
          ],
        },
      },
    });

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
    const result = await applySchema(prisma, bundle);
    expect(result.changed).toBe(true);
    expect(result.applied.fieldsUpdated).toBe(1);

    const f = await prisma.contentTypeField.findFirst({
      where: { identifier: 'title' },
    });
    expect(f!.name).toBe('Title');
    expect(f!.order).toBe(0);
  });

  it('updates a SELECT field options when a choice is added', async () => {
    await prisma.contentType.create({
      data: {
        identifier: 'Post',
        name: 'Post',
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
              options: { choices: ['news'] },
            },
          ],
        },
      },
    });

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
              type: 'SELECT',
              required: false,
              order: 1,
              options: { choices: ['news', 'opinion'] },
            },
          ],
        },
      ],
    };
    const result = await applySchema(prisma, bundle);
    expect(result.changed).toBe(true);
    expect(result.applied.fieldsUpdated).toBe(1);

    const f = await prisma.contentTypeField.findFirst({
      where: { identifier: 'category' },
    });
    expect((f!.options as { choices: string[] }).choices).toEqual([
      'news',
      'opinion',
    ]);
  });

  it('updates required false → true when no entries have null', async () => {
    const ct = await prisma.contentType.create({
      data: {
        identifier: 'Article',
        name: 'Article',
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
              identifier: 'tagline',
              name: 'Tagline',
              type: 'TEXT',
              required: false,
              unique: false,
              order: 1,
            },
          ],
        },
      },
    });
    // Seed an entry whose tagline is set, so required: true is safe.
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ct.id,
        entryTitle: 'A',
        slug: 'a',
        versions: {
          create: {
            data: { title: 'A', tagline: 'Hello' },
            entryTitle: 'A',
            status: 'PUBLISHED',
          },
        },
      },
    });

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
              required: true,
              order: 1,
              options: null,
            },
          ],
        },
      ],
    };
    const result = await applySchema(prisma, bundle);
    expect(result.applied.fieldsUpdated).toBe(1);

    const f = await prisma.contentTypeField.findFirst({
      where: { identifier: 'tagline' },
    });
    expect(f!.required).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify they FAIL**.

- [ ] **Step 3: Add the field-update walk**

After the field-create walk:

```ts
// Pass 2: field updates.
for (const update of plan.fields.update) {
  const data: import('#prisma').Prisma.ContentTypeFieldUpdateInput = {};
  if (update.changes.name !== undefined) data.name = update.changes.name;
  if (update.changes.order !== undefined) data.order = update.changes.order;
  if (update.changes.required !== undefined)
    data.required = update.changes.required;
  if (update.changes.unique !== undefined) data.unique = update.changes.unique;
  if (update.changes.options !== undefined) {
    data.options = update.changes
      .options as import('#prisma').Prisma.InputJsonValue;
  }
  await tx.contentTypeField.update({ where: { id: update.id }, data });
  applied.fieldsUpdated += 1;
}
```

- [ ] **Step 4: Run, verify GREEN** (3 new + previous tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/applySchema.ts apps/cms/scripts/content-bundle/applySchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): applySchema pass 2 — field updates

Walks plan.fields.update. Builds a Prisma update payload from the
sparse changes object (only setting properties present in the diff).
Covers name, order, required, unique, and options changes — the
planner already validated each change is safe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Pass 2 — field removes (skip cascaded)

Field removals from `plan.fields.remove`. Skip any field whose owning content type was just removed in pass 1 (Prisma cascade already deleted it).

**Files:**

- Modify: `apps/cms/scripts/content-bundle/applySchema.ts`
- Modify: `apps/cms/scripts/content-bundle/applySchema.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
describe('happy path — pass 2 (field removes)', () => {
  it('removes a field with allowDestructive', async () => {
    await prisma.contentType.create({
      data: {
        identifier: 'Article',
        name: 'Article',
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
              identifier: 'oldField',
              name: 'Old',
              type: 'TEXT',
              required: false,
              unique: false,
              order: 1,
            },
          ],
        },
      },
    });

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
    const result = await applySchema(prisma, bundle, {
      allowDestructive: true,
    });
    expect(result.changed).toBe(true);
    expect(result.applied.fieldsRemoved).toBe(1);

    const gone = await prisma.contentTypeField.findFirst({
      where: { identifier: 'oldField' },
    });
    expect(gone).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify it FAILS**.

- [ ] **Step 3: Add the field-remove walk (with cascade guard)**

After the field-update walk:

```ts
// Pass 2: field removes. Skip any field whose owning content type was
// just removed in pass 1 — Prisma's cascade already deleted those.
for (const removal of plan.fields.remove) {
  // Look up the field's contentTypeId via the snapshot to check if
  // its owner was just removed. We could re-query, but the snapshot
  // already has the answer — locate the field by id.
  const ownerWasRemoved =
    removedTypeIds.size > 0 &&
    snapshot.contentTypes.some(
      (c) =>
        removedTypeIds.has(c.id) && c.fields.some((f) => f.id === removal.id)
    );
  if (ownerWasRemoved) continue;
  await tx.contentTypeField.delete({ where: { id: removal.id } });
  applied.fieldsRemoved += 1;
}
```

- [ ] **Step 4: Run, verify GREEN**.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/applySchema.ts apps/cms/scripts/content-bundle/applySchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): applySchema pass 2 — field removes (cascade-aware)

Walks plan.fields.remove with prisma.contentTypeField.delete. Skips
any field whose owning content type was just removed in pass 1 —
Prisma's onDelete: Cascade has already deleted those rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Two-pass ordering — RELATION targeting same-bundle type

Cover the load-bearing reason for the two-pass design: a bundle that creates a content type AND adds a RELATION field targeting it in the same apply must succeed. The pass 1 type-create runs first, so by the time pass 2's field-create fires, the target exists.

This is mostly a regression test — the existing implementation should already handle it correctly because pass 1 commits before pass 2 reads.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/applySchema.test.ts`

- [ ] **Step 1: Add the test**

```ts
describe('two-pass ordering', () => {
  it('creates a content type and a RELATION field targeting it in one apply', async () => {
    // Article exists; Author is brand new; Article gets a RELATION field
    // targeting Author, all in one bundle.
    await prisma.contentType.create({
      data: {
        identifier: 'Article',
        name: 'Article',
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
            {
              id: null,
              identifier: 'author',
              name: 'Author',
              type: 'RELATION',
              required: false,
              order: 1,
              options: { targetContentTypeIdentifiers: ['Author'] },
            },
          ],
        },
      ],
    };
    const result = await applySchema(prisma, bundle);
    expect(result.changed).toBe(true);
    expect(result.applied.contentTypesCreated).toBe(1);
    expect(result.applied.fieldsCreated).toBe(1);

    const authorField = await prisma.contentTypeField.findFirst({
      where: { identifier: 'author' },
    });
    expect(authorField).not.toBeNull();
    const opts = authorField!.options as {
      targetContentTypeIdentifiers?: string[];
    };
    expect(opts.targetContentTypeIdentifiers).toEqual(['Author']);
  });

  it('creates two content types that mutually relate in one apply', async () => {
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
            {
              id: null,
              identifier: 'author',
              name: 'Author',
              type: 'RELATION',
              required: false,
              order: 1,
              options: { targetContentTypeIdentifiers: ['Author'] },
            },
          ],
        },
      ],
    };
    const result = await applySchema(prisma, bundle);
    expect(result.applied.contentTypesCreated).toBe(2);
    // Both types created with their fields embedded (no separate
    // pass 2 entries — both rode along with pass 1).
    expect(result.applied.fieldsCreated).toBe(0);
  });
});
```

- [ ] **Step 2: Run**

Both should pass without code changes. If they don't, something in pass 1's create walk is wrong — investigate.

- [ ] **Step 3: Commit**

```bash
git add apps/cms/scripts/content-bundle/applySchema.test.ts
git commit -m "$(cat <<'EOF'
test(bundle): applySchema two-pass ordering invariants

Pins the load-bearing reason for the two-pass design: a bundle
creating a type AND a RELATION field targeting it must succeed.
Pass 1 commits the type before pass 2 creates the field. Two
mutually-related types embed their RELATION fields in the type-create
payload, riding along with pass 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: In-transaction re-plan equality check

Take a second snapshot inside the transaction, compute a second plan, assert equality with the first. Mismatch → throw `SchemaChangedDuringApplyError`. Catches the race where a concurrent writer mutates the schema between our two reads.

The simplest test approach: stub the snapshot loader to return different shapes on the two calls. We do this by `vi.spyOn`ing `snapshotCurrentSchema` to return a synthetic mutation on the second call.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/applySchema.ts`
- Modify: `apps/cms/scripts/content-bundle/applySchema.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
import * as snapshotModule from './snapshotCurrentSchema';
import { vi } from 'vitest';

describe('concurrency — re-plan equality check', () => {
  it('throws SchemaChangedDuringApplyError when the snapshot changes between reads', async () => {
    await prisma.contentType.create({
      data: {
        identifier: 'Article',
        name: 'Article',
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

    let callCount = 0;
    const spy = vi.spyOn(snapshotModule, 'snapshotCurrentSchema');
    spy.mockImplementation(async (tx) => {
      callCount += 1;
      // Real snapshot for both calls — but inject a synthetic content
      // type into the second call's result so plansEqual returns false.
      const real = await snapshotModule.snapshotCurrentSchema(tx);
      if (callCount >= 2) {
        return {
          ...real,
          contentTypes: [
            ...real.contentTypes,
            {
              id: 'synthetic-id',
              identifier: 'InjectedType',
              name: 'Injected',
              description: null,
              fields: [],
              entryCount: 0,
            },
          ],
        };
      }
      return real;
    });

    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Article',
          name: 'Renamed',
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
    await expect(
      applySchema(prisma, bundle, { allowDestructive: true })
    ).rejects.toMatchObject({ code: 'SCHEMA_CHANGED_DURING_APPLY' });

    spy.mockRestore();

    // DB unchanged — name should still be Article (the rename rolled back).
    const ct = await prisma.contentType.findUnique({
      where: { identifier: 'Article' },
    });
    expect(ct!.name).toBe('Article');
  });
});
```

- [ ] **Step 2: Run, verify it FAILS** (no re-plan check yet).

- [ ] **Step 3: Add the re-plan check**

After computing `plan` and the blocker check, before the mutation walks:

```ts
import { plansEqual } from './plansEqual';
import { SchemaChangedDuringApplyError } from './applySchemaErrors';

// ... inside the transaction body, after `if (plan.blockers.length > 0) throw …`:

// Skip the re-plan + mutation walk if the plan is empty — nothing
// to apply, nothing to race against.
if (!isPlanNonEmpty(plan)) {
  return { changed: false, plan, applied: { ...ZERO_APPLIED } };
}

const snapshot2 = await snapshotCurrentSchema(tx as PrismaClient);
const plan2 = planSchema(bundle, snapshot2, {
  allowDestructive: options.allowDestructive,
});
if (!plansEqual(plan, plan2)) {
  throw new SchemaChangedDuringApplyError();
}

// (now run the mutation walks against the verified-stable plan)
```

- [ ] **Step 4: Run, verify GREEN**.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/applySchema.ts apps/cms/scripts/content-bundle/applySchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): applySchema re-plan equality check inside transaction

Take a second snapshot + recompute the plan between the blocker
check and the mutation walks. plansEqual asserts no concurrent
writer changed the schema between reads. Mismatch -> throw
SchemaChangedDuringApplyError, transaction rolls back, caller can
re-run with the now-current state.

Skipped for empty plans — there's nothing to race against.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: `invalidateSchema()` integration

After the transaction commits, if any mutation was performed, call `invalidateSchema()` so the next GraphQL request rebuilds. Skip on no-op apply.

`invalidateSchema` lives in `apps/cms/server/graphql/schema.ts` — but that file imports from Nuxt-build-only paths (`#prisma`, etc.). The applier already uses `#prisma` types, so importing `invalidateSchema` works at runtime when the script runs inside the Nuxt context (via `tsx`'s ts-node alias resolution + path mapping). Test by spying on the export.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/applySchema.ts`
- Modify: `apps/cms/scripts/content-bundle/applySchema.test.ts`

- [ ] **Step 1: Add the failing tests**

```ts
import * as schemaModule from '../../server/graphql/schema';

describe('invalidateSchema integration', () => {
  it('does NOT call invalidateSchema on a no-op apply', async () => {
    const spy = vi.spyOn(schemaModule, 'invalidateSchema');
    spy.mockImplementation(() => {});

    const result = await applySchema(prisma, emptyBundle);
    expect(result.changed).toBe(false);
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('calls invalidateSchema once on a non-empty apply', async () => {
    const spy = vi.spyOn(schemaModule, 'invalidateSchema');
    spy.mockImplementation(() => {});

    const bundle: Bundle = {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'NewType',
          name: 'NewType',
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
    const result = await applySchema(prisma, bundle);
    expect(result.changed).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run, verify they FAIL** (`invalidateSchema` not called yet).

- [ ] **Step 3: Wire `invalidateSchema()` after the transaction**

```ts
import { invalidateSchema } from '../../server/graphql/schema';

// Replace the existing transaction return with:

const txResult = await prisma.$transaction(async (tx) => {
  // ... existing transaction body, returning { changed, plan, applied }
});

if (txResult.changed) {
  invalidateSchema();
}
return txResult;
```

(Restructure the function to capture the transaction result, then conditionally invalidate after commit. The transaction body still returns the result object as before.)

- [ ] **Step 4: Run, verify GREEN**.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/scripts/content-bundle/applySchema.ts apps/cms/scripts/content-bundle/applySchema.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): applySchema calls invalidateSchema() on non-empty apply

After the transaction commits, if any mutation was performed, call
invalidateSchema() so the next GraphQL request rebuilds. No-op
applies skip the invalidation — the entrypoint (Spec 4) runs apply
on every boot, and most boots are no-ops on a stable schema.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: CLI `--apply` flag on `pnpm content:import`

Wire `--apply` into the existing `import` command branch in `apps/cms/scripts/content-bundle/index.ts`. With `--schema --apply`, route to `applySchema`. With `--entries --apply` or `--all --apply`, error out with a clear message. Existing `--schema` (no `--apply`) continues to use `importBundle`.

**Files:**

- Modify: `apps/cms/scripts/content-bundle/index.ts`
- Create: `apps/cms/scripts/content-bundle/index.test.ts`

- [ ] **Step 1: Write the failing CLI argument tests**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the imports we want to assert dispatch on. The CLI calls
// importBundle / applySchema; we mock both and assert which one fires.
vi.mock('./import', () => ({
  importBundle: vi.fn().mockResolvedValue({
    contentTypesCreated: 0,
    entriesCreated: 0,
  }),
}));
vi.mock('./applySchema', () => ({
  applySchema: vi.fn().mockResolvedValue({
    changed: false,
    plan: {
      contentTypes: { create: [], update: [], remove: [] },
      fields: { create: [], update: [], remove: [] },
      warnings: [],
      blockers: [],
    },
    applied: {
      contentTypesCreated: 0,
      contentTypesUpdated: 0,
      contentTypesRemoved: 0,
      fieldsCreated: 0,
      fieldsUpdated: 0,
      fieldsRemoved: 0,
    },
  }),
}));
vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue(
      JSON.stringify({
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [],
      })
    ),
  };
});

import { importBundle } from './import';
import { applySchema } from './applySchema';

describe('content-bundle CLI — --apply flag dispatch', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  async function runCli(...args: string[]) {
    process.argv = ['node', 'content-bundle', ...args];
    // Re-import the CLI entry — top-level await runs main().
    vi.resetModules();
    await import('./index');
  }

  it('--schema --apply routes to applySchema', async () => {
    await runCli('import', '/fake.json', '--schema', '--apply');
    expect(applySchema).toHaveBeenCalledTimes(1);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it('--schema (no --apply) routes to importBundle', async () => {
    await runCli('import', '/fake.json', '--schema');
    expect(importBundle).toHaveBeenCalledTimes(1);
    expect(applySchema).not.toHaveBeenCalled();
  });

  it('--entries --apply errors out', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runCli('import', '/fake.json', '--entries', '--apply');
    expect(applySchema).not.toHaveBeenCalled();
    expect(importBundle).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('--all --apply errors out', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runCli('import', '/fake.json', '--all', '--apply');
    expect(applySchema).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
```

This test pattern is more complex than the rest because we're testing a top-level-async script's dispatch via mock injection. If this turns out to be flaky in practice, fall back to refactoring `index.ts` to extract a testable `runCli(args)` function — see step 4.

- [ ] **Step 2: Run, verify FAILS** (the existing CLI doesn't recognise `--apply`).

- [ ] **Step 3: Wire `--apply` into the CLI**

Edit `apps/cms/scripts/content-bundle/index.ts`. In the `import` command branch:

```ts
if (command === 'import') {
  if (wantsHelp(args)) {
    console.log(HELP);
    process.exit(0);
  }
  const path = args[0];
  if (!path) throw new Error('Usage: content-bundle import <path>');
  const raw = readFileSync(resolve(path), 'utf8');
  const bundle = JSON.parse(raw);
  const defaultMode: BundleMode =
    bundle.contentTypes && bundle.entries
      ? 'all'
      : bundle.entries
        ? 'entries'
        : 'schema';
  const mode = parseMode(args.slice(1), defaultMode);
  const apply = args.includes('--apply');

  if (apply && mode !== 'schema') {
    console.error(`--apply is only valid with --schema. Got mode=${mode}.`);
    process.exit(2);
  }

  if (apply) {
    const allowDestructive = args.includes('--allow-destructive');
    const { applySchema } = await import('./applySchema');
    const result = await applySchema(prisma, bundle, { allowDestructive });
    if (result.changed) {
      console.log(
        `Applied: ${result.applied.contentTypesCreated} type(s) created, ` +
          `${result.applied.contentTypesUpdated} updated, ` +
          `${result.applied.contentTypesRemoved} removed; ` +
          `${result.applied.fieldsCreated} field(s) created, ` +
          `${result.applied.fieldsUpdated} updated, ` +
          `${result.applied.fieldsRemoved} removed.`
      );
    } else {
      console.log('No-op (schema already matches bundle).');
    }
    process.exit(0);
  }

  const author = flagValue(args, '--author');
  const result = await importBundle(prisma, bundle, { mode, author });
  console.log(
    `Imported ${result.contentTypesCreated} content type(s) and ${result.entriesCreated} entry/entries`
  );
  process.exit(0);
}
```

Also extend the `HELP` string to mention `--apply` and `--allow-destructive`.

- [ ] **Step 4: If the test pattern is flaky**

If the `vi.resetModules() + dynamic import` pattern doesn't fire `main()` reliably, refactor: extract a `runCli(args)` async function from `main()` and have `main()` simply call `runCli(process.argv.slice(2))`. The test then imports `runCli` directly and calls it with arrays of args. This is a small, mechanical refactor and is the cleanest test-first pattern for CLI dispatch.

The plan recommends going straight to the `runCli`-extracted form. Update `index.ts`:

```ts
export async function runCli(argv: string[]): Promise<void> {
  // ... existing main body, taking argv instead of process.argv
}

async function main() {
  await runCli(process.argv.slice(2));
}

// Only auto-run when invoked as a script.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

The test then imports `{ runCli }` and calls it directly, no `vi.resetModules` gymnastics.

- [ ] **Step 5: Run, verify GREEN**.

- [ ] **Step 6: Manual sanity check (optional)**

```bash
# Should run applySchema (no-op on an unchanged DB)
pnpm content:import starters/base.boject.json --schema --apply
```

Expected: prints either "Applied: …" or "No-op (schema already matches bundle).".

- [ ] **Step 7: Commit**

```bash
git add apps/cms/scripts/content-bundle/index.ts apps/cms/scripts/content-bundle/index.test.ts
git commit -m "$(cat <<'EOF'
feat(bundle): pnpm content:import --apply routes through applySchema

Adds the --apply flag (only valid with --schema) so operators can
run idempotent schema apply against a running CMS via the existing
content:import CLI. --apply with --entries or --all errors out.
The --allow-destructive flag is passed through to applySchema.

Refactored main() into runCli(argv) for testability — main() now
just delegates to runCli(process.argv.slice(2)).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: CLAUDE.md + final verification + PR

- [ ] **Step 1: Update CLAUDE.md**

Find the `## Commands` section at the top of `CLAUDE.md`. The existing line for `pnpm content:import` is:

```
pnpm content:import <path> [--schema|--entries|--all] [--author <string>]     # Import a JSON bundle into the CMS
```

Replace with:

```
pnpm content:import <path> [--schema|--entries|--all] [--apply] [--allow-destructive] [--author <string>]   # Import a JSON bundle into the CMS. With --schema --apply, runs idempotent schema apply via applySchema (Spec 3). --allow-destructive unlocks safe removals.
```

In the "Architecture" list, after the existing `**Schema editing lock**` bullet (added in Spec 1's PR #150), add a new bullet:

```markdown
- **Schema-as-code applier** — `apps/cms/scripts/content-bundle/applySchema.ts::applySchema(prisma, bundle, options)` is the idempotent transactional executor that consumes a `SchemaPlan` and converges the database to the bundle's desired state. Called via `pnpm content:import path/to/schema.boject.json --schema --apply`. Throws `SchemaApplyValidationError` on bundle-shape failure, `SchemaApplyBlockedError` on plan blockers (transaction rolls back), and `SchemaChangedDuringApplyError` if a concurrent writer mutates the schema between two in-transaction snapshots. Calls `invalidateSchema()` after a non-empty apply so GraphQL rebuilds. Forward-references `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA` (consumed by Spec 4 entrypoint and Spec 5 CLI).
```

In the "Docker image" → "Runtime env vars" line, after `BOJECT_SCHEMA_READONLY`, insert:

```
`BOJECT_ALLOW_DESTRUCTIVE_SCHEMA` (optional, `true`/`1` lets the entrypoint applier remove content types and fields when the bundle drops them; defaults to off — additive changes only),
```

In the "Key Files" section, add (after the existing `apps/cms/server/utils/schemaReadOnly.ts` entry):

```
- `apps/cms/scripts/content-bundle/applySchema.ts` — Idempotent transactional schema applier
- `apps/cms/scripts/content-bundle/applySchemaErrors.ts` — `SchemaApplyValidationError`, `SchemaApplyBlockedError`, `SchemaChangedDuringApplyError`
- `apps/cms/scripts/content-bundle/plansEqual.ts` — Deterministic plan-equality check used by the in-transaction re-plan safety net
- `apps/cms/scripts/content-bundle/applySchema.test.ts` — DB-backed integration tests for the applier
```

Run prettier:

```bash
pnpm format CLAUDE.md
```

If it rewraps, run `pnpm format:fix CLAUDE.md` and re-stage.

- [ ] **Step 2: Full unit suite**

```bash
pnpm test:unit
```

Expected: all green (existing tests + new `applySchema.test.ts`, `applySchemaErrors.test.ts`, `plansEqual.test.ts`, `index.test.ts`).

- [ ] **Step 3: Full integration suite**

```bash
pnpm test:integration
```

Expected: all green. The applier doesn't add integration tests, but its DB writes through Prisma might affect global state — the integration suite has its own `globalSetup` that resets the DB.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 5: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 6: Format check on changed files**

```bash
git diff --name-only main..HEAD | xargs npx prettier --check
```

Expected: "All matched files use Prettier code style!".

- [ ] **Step 7: Push**

```bash
git push -u origin feat/144-schema-as-code-applier
```

- [ ] **Step 8: Open PR**

```bash
gh pr create --title "feat: schema-as-code applier (applySchema + content:import --apply)" --body "$(cat <<'EOF'
## Summary

Implements Spec 3 of the schema-as-code stack — the transactional applier that consumes a `SchemaPlan` from Spec 2 and converges the database to a bundle's desired state. Idempotent, atomic, and safe against concurrent schema mutation.

This unblocks Spec 4 (entrypoint integration — auto-apply on every boot) and Spec 5 (CLI HTTP surface — `boject schema apply`).

## What lands

- `apps/cms/scripts/content-bundle/applySchema.ts` — the orchestrator: validate bundle → open transaction → snapshot → plan → blocker check → re-snapshot → re-plan → equality check → pass 1 (types) → pass 2 (fields) → commit → invalidateSchema.
- `apps/cms/scripts/content-bundle/applySchemaErrors.ts` — three error classes with `code` discriminators (`BUNDLE_INVALID`, `SCHEMA_APPLY_BLOCKED`, `SCHEMA_CHANGED_DURING_APPLY`).
- `apps/cms/scripts/content-bundle/plansEqual.ts` — deterministic `SchemaPlan` equality, used by the in-transaction re-plan safety net.
- `pnpm content:import --schema --apply` flag — routes through `applySchema` instead of `importBundle`. `--allow-destructive` passes through. `--apply` with `--entries` or `--all` errors out.
- DB-backed integration tests (unit Vitest project, following `import.test.ts` pattern).

## Coverage

- Happy paths: type create / update / remove, field create / update (name/order/required/unique/options) / remove.
- Two-pass ordering: a single apply that creates a type and a RELATION field targeting it; two mutually-related types in one apply.
- Blocker handling: refuses removal-with-entries, type-change, optional→required-with-nulls, unique-with-duplicates, in-use SELECT choice removal, in-use RELATION target removal — DB unchanged after refused apply.
- `allowDestructive` unlocks the right things and not the wrong things (still refuses with-entries removal, still refuses type change).
- Concurrency: `SchemaChangedDuringApplyError` thrown when a synthetic mutation appears between two in-transaction snapshots.
- `invalidateSchema()` called once on non-empty apply, NOT called on no-op apply.
- CLI dispatch: `--schema --apply` → applier; `--schema` alone → `importBundle`; `--apply` with non-`--schema` mode errors.

## Test plan

- [x] Unit tests for error classes + `plansEqual`.
- [x] DB-backed applier tests for every happy path + every blocker scenario.
- [x] CLI dispatch tests via `runCli(argv)` extraction.
- [x] Full unit + integration suites green.

## Follow-ups (for Spec 4 entrypoint)

The applier consumes `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA` via the `allowDestructive` option, but the env-var translation lives at call sites (CLI flag here; entrypoint script in Spec 4). CLAUDE.md documents the env var as a forward reference.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Self-Review

**Spec coverage check:**

- ✅ `applySchema(prisma, bundle, options)` with `ApplySchemaOptions` + `ApplySchemaResult` types matching the spec → Tasks 3-13.
- ✅ Validate bundle shape → Task 4.
- ✅ Single transaction wrapping snapshot + plan + apply → Task 5.
- ✅ Blocker pre-flight inside transaction → Task 5.
- ✅ Re-plan equality check inside transaction → Task 12.
- ✅ Two-pass execution (types pass 1, fields pass 2) → Tasks 6-10.
- ✅ Reuse endpoint utilities semantics: the planner already validated, the applier executes — `effectiveBundleUnique` carries the implicit-true rule for ENTRY_TITLE/SLUG → Task 6.
- ✅ Cache invalidation on non-empty apply → Task 13.
- ✅ Removal cascade optimisation (skip cascaded fields) → Task 10.
- ✅ Three named error classes with `code` discriminators → Task 1.
- ✅ Two-pass ordering test (RELATION targeting same-bundle type, mutual relations) → Task 11.
- ✅ `--apply` flag on `pnpm content:import` with the mode matrix from the spec → Task 14.
- ✅ CLAUDE.md documentation → Task 15.

**Out-of-scope (spec-confirmed):**

- Entry-level idempotent apply.
- HTTP/REST endpoint exposing the applier (Spec 5).
- Entrypoint integration (Spec 4) — only the env-var name is forward-documented.
- `BOJECT_ALLOW_DESTRUCTIVE_SCHEMA` runtime config (consumed by Spec 4/5 callers).

**Placeholder scan:**

- Each code block in tasks contains real code.
- Each bash command has explicit expected output where relevant.
- No "similar to Task N" references — each task repeats its own context.
- The CLI test (Task 14) lays out both the optimistic `vi.resetModules` pattern and the fallback `runCli` extraction; the recommendation is the latter for reliability.

**Type/symbol consistency:**

- `applySchema`, `ApplySchemaOptions`, `ApplySchemaResult`, `SchemaApplyValidationError`, `SchemaApplyBlockedError`, `SchemaChangedDuringApplyError`, `plansEqual`, `effectiveBundleUnique`, `snapshotCurrentSchema`, `planSchema`, `invalidateSchema`, `runCli` — referenced consistently across tasks.
- `BUNDLE_INVALID` / `SCHEMA_APPLY_BLOCKED` / `SCHEMA_CHANGED_DURING_APPLY` codes match the spec.
- `removedTypeIds` set introduced in Task 7 is consumed in Task 10 — name matches across both.

**Risk notes:**

- The CLI test pattern (Task 14, Step 1) is the part most likely to need iteration during execution. The fallback in Step 4 (extract `runCli`) is the recommended path; the implementer should go straight to it if the dynamic-import-based test feels fragile.
- The re-plan equality check (Task 12) is mocked via `vi.spyOn` on `snapshotCurrentSchema`. ESM module re-export shapes can be touchy; if the spy doesn't intercept, fall back to a fixture-injection approach where `applySchema` accepts an optional `_snapshotLoader` parameter for tests. Document the rationale if the fallback is taken.

---

## Plan Done — Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-05-01-schema-as-code-applier.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Fresh subagent per task, two-stage review between tasks. Same pattern that landed PRs #150, #151, #152, #153.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
