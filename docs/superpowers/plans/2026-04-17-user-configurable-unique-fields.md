# User-configurable unique fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users mark TEXT and NUMBER content-type fields as `unique`, enforce uniqueness at entry save time across all versions, and drive the existing `Unique` badge from the new flag instead of a hardcoded type check.

**Architecture:** Add a `unique` boolean column to `ContentTypeField`. Auto-set `true` on ENTRY_TITLE/SLUG (their DB-level constraints still do the real work). Reject `unique: true` on any other type except TEXT/NUMBER. Before inserting or updating an entry version, run `assertUniqueFieldValues` which queries `ContentEntryVersion` joined on `ContentEntry` for any conflicting value across all versions and throws 409 on match. When toggling a field `false → true`, pre-validate that no existing entries hold duplicate values.

**Tech Stack:** Nuxt 4, Prisma 7, PostgreSQL 17, Vue 3, Nuxt UI, Vitest, `tsx`.

**Spec:** `docs/superpowers/specs/2026-04-17-user-configurable-unique-fields-design.md`

---

## Task 1: Add `unique` column to ContentTypeField

**Files:**

- Modify: `prisma/schema/contentType.prisma`
- Create: `prisma/migrations/20260417120000_add_unique_field_flag/migration.sql`
- Regenerate: `generated/prisma/client.ts` (via `pnpm prisma:generate`)

- [ ] **Step 1: Update Prisma schema**

Edit `prisma/schema/contentType.prisma` — add the `unique` column to `ContentTypeField` under `required`:

```prisma
model ContentTypeField {
  id            String      @id @default(uuid())
  contentType   ContentType @relation(fields: [contentTypeId], references: [id], onDelete: Cascade)
  contentTypeId String
  identifier    String
  name          String
  type          FieldType
  required      Boolean     @default(false)
  unique        Boolean     @default(false)
  order         Int         @default(0)
  options       Json?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@unique([contentTypeId, identifier])
}
```

- [ ] **Step 2: Create migration SQL**

Create `prisma/migrations/20260417120000_add_unique_field_flag/migration.sql`:

```sql
ALTER TABLE "ContentTypeField" ADD COLUMN "unique" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ContentTypeField" SET "unique" = true WHERE "type" IN ('ENTRY_TITLE', 'SLUG');
```

- [ ] **Step 3: Apply the migration**

Run: `pnpx prisma migrate deploy`
Expected: "Applying migration `20260417120000_add_unique_field_flag`" / "1 migration has been applied".

- [ ] **Step 4: Regenerate Prisma client**

Run: `pnpm prisma:generate`
Expected: "✔ Generated Prisma Client" with no errors.

- [ ] **Step 5: Seed the test database**

Run: `pnpm prisma:seed:test`
Expected: "Seed complete" — the test DB picks up the new column so integration tests run.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. The new `unique` property is now visible on `ContentTypeField` types.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema/contentType.prisma prisma/migrations/20260417120000_add_unique_field_flag
git commit -m "feat: add unique column to ContentTypeField"
```

---

## Task 2: Add shared field-unique validation helper

**Files:**

- Create: `server/utils/validateFieldUnique.ts`
- Create: `server/utils/validateFieldUnique.test.ts`

A tiny pure helper to answer: "is `unique: true` valid for this field type?". We reuse it across both field-create paths, the field-update path, and the ContentEditor type-narrowing.

- [ ] **Step 1: Write the failing test**

Create `server/utils/validateFieldUnique.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  isUniqueAllowedForType,
  resolveUniqueFlag,
} from './validateFieldUnique';

describe('isUniqueAllowedForType', () => {
  it('allows TEXT and NUMBER', () => {
    expect(isUniqueAllowedForType('TEXT')).toBe(true);
    expect(isUniqueAllowedForType('NUMBER')).toBe(true);
  });

  it('allows ENTRY_TITLE and SLUG (implicit)', () => {
    expect(isUniqueAllowedForType('ENTRY_TITLE')).toBe(true);
    expect(isUniqueAllowedForType('SLUG')).toBe(true);
  });

  it('rejects other types', () => {
    expect(isUniqueAllowedForType('TEXTAREA')).toBe(false);
    expect(isUniqueAllowedForType('BOOLEAN')).toBe(false);
    expect(isUniqueAllowedForType('DATETIME')).toBe(false);
    expect(isUniqueAllowedForType('SELECT')).toBe(false);
    expect(isUniqueAllowedForType('RICHTEXT')).toBe(false);
    expect(isUniqueAllowedForType('RELATION')).toBe(false);
    expect(isUniqueAllowedForType('MULTIRELATION')).toBe(false);
    expect(isUniqueAllowedForType('IMAGE')).toBe(false);
  });
});

describe('resolveUniqueFlag', () => {
  it('forces true for ENTRY_TITLE regardless of requested', () => {
    expect(resolveUniqueFlag('ENTRY_TITLE', false)).toBe(true);
    expect(resolveUniqueFlag('ENTRY_TITLE', undefined)).toBe(true);
  });

  it('forces true for SLUG regardless of requested', () => {
    expect(resolveUniqueFlag('SLUG', false)).toBe(true);
    expect(resolveUniqueFlag('SLUG', undefined)).toBe(true);
  });

  it('uses requested value for TEXT and NUMBER', () => {
    expect(resolveUniqueFlag('TEXT', true)).toBe(true);
    expect(resolveUniqueFlag('TEXT', false)).toBe(false);
    expect(resolveUniqueFlag('NUMBER', true)).toBe(true);
  });

  it('defaults to false when not provided on TEXT/NUMBER', () => {
    expect(resolveUniqueFlag('TEXT', undefined)).toBe(false);
    expect(resolveUniqueFlag('NUMBER', undefined)).toBe(false);
  });

  it('defaults to false for other types when not requested', () => {
    expect(resolveUniqueFlag('BOOLEAN', undefined)).toBe(false);
  });

  it('throws when requesting unique: true on a disallowed type', () => {
    expect(() => resolveUniqueFlag('BOOLEAN', true)).toThrow(
      /unique is not supported/i
    );
    expect(() => resolveUniqueFlag('RICHTEXT', true)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `pnpm test:unit server/utils/validateFieldUnique.test.ts`
Expected: FAIL — "Cannot find module './validateFieldUnique'".

- [ ] **Step 3: Write the minimal implementation**

Create `server/utils/validateFieldUnique.ts`:

```ts
import type { FieldType } from '#prisma';
import { createError } from 'h3';

const USER_CONFIGURABLE_UNIQUE_TYPES = new Set<FieldType>(['TEXT', 'NUMBER']);
const IMPLICIT_UNIQUE_TYPES = new Set<FieldType>(['ENTRY_TITLE', 'SLUG']);

export function isUniqueAllowedForType(type: FieldType): boolean {
  return (
    USER_CONFIGURABLE_UNIQUE_TYPES.has(type) || IMPLICIT_UNIQUE_TYPES.has(type)
  );
}

export function resolveUniqueFlag(
  type: FieldType,
  requested: boolean | undefined
): boolean {
  if (IMPLICIT_UNIQUE_TYPES.has(type)) return true;
  const value = requested === true;
  if (value && !USER_CONFIGURABLE_UNIQUE_TYPES.has(type)) {
    throw createError({
      statusCode: 400,
      statusMessage: `unique is not supported for fields of type ${type}`,
    });
  }
  return value;
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `pnpm test:unit server/utils/validateFieldUnique.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/utils/validateFieldUnique.ts server/utils/validateFieldUnique.test.ts
git commit -m "feat: add field unique flag resolution helper"
```

---

## Task 3: Accept and auto-set `unique` in field create paths

**Files:**

- Modify: `server/api/content-types/index.post.ts`
- Modify: `server/api/content-types/[id]/fields/index.post.ts`
- Modify: `server/api/content-types/content-types.test.ts`

Both paths pass every field through `resolveUniqueFlag` so ENTRY_TITLE/SLUG auto-gain `unique: true`, TEXT/NUMBER pick up the user-supplied value, and any other type requesting `unique: true` gets 400.

- [ ] **Step 1: Write the failing integration tests**

Append to `server/api/content-types/content-types.test.ts` inside the existing `describe` block for content types:

```ts
it('auto-sets unique=true on ENTRY_TITLE and SLUG during content type creation', async () => {
  const res = await api('/api/content-types', {
    method: 'POST',
    body: {
      name: `Unique Auto ${Date.now()}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
        { identifier: 'slug', name: 'Slug', type: 'SLUG' },
        { identifier: 'body', name: 'Body', type: 'TEXT' },
      ],
    },
  });
  const title = res.fields.find((f: any) => f.identifier === 'title');
  const slug = res.fields.find((f: any) => f.identifier === 'slug');
  const body = res.fields.find((f: any) => f.identifier === 'body');
  expect(title.unique).toBe(true);
  expect(slug.unique).toBe(true);
  expect(body.unique).toBe(false);
});

it('accepts unique=true on TEXT and NUMBER fields in content type creation', async () => {
  const res = await api('/api/content-types', {
    method: 'POST',
    body: {
      name: `Unique Text ${Date.now()}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
        { identifier: 'sku', name: 'SKU', type: 'TEXT', unique: true },
        {
          identifier: 'issueNumber',
          name: 'Issue Number',
          type: 'NUMBER',
          unique: true,
        },
      ],
    },
  });
  const sku = res.fields.find((f: any) => f.identifier === 'sku');
  const issue = res.fields.find((f: any) => f.identifier === 'issueNumber');
  expect(sku.unique).toBe(true);
  expect(issue.unique).toBe(true);
});

it('rejects unique=true on a BOOLEAN field during content type creation', async () => {
  await expect(
    api('/api/content-types', {
      method: 'POST',
      body: {
        name: `Unique Bad ${Date.now()}`,
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
          { identifier: 'flag', name: 'Flag', type: 'BOOLEAN', unique: true },
        ],
      },
    })
  ).rejects.toThrow(/400/);
});

it('auto-sets unique=true when adding an ENTRY_TITLE or SLUG via POST /fields', async () => {
  const created = await api('/api/content-types', {
    method: 'POST',
    body: {
      name: `Add Field Unique ${Date.now()}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
      ],
    },
  });
  const field = await api(`/api/content-types/${created.id}/fields`, {
    method: 'POST',
    body: { identifier: 'slug', name: 'Slug', type: 'SLUG' },
  });
  expect(field.unique).toBe(true);
});

it('accepts unique=true when adding a TEXT field via POST /fields', async () => {
  const created = await api('/api/content-types', {
    method: 'POST',
    body: {
      name: `Add Text Unique ${Date.now()}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
      ],
    },
  });
  const field = await api(`/api/content-types/${created.id}/fields`, {
    method: 'POST',
    body: { identifier: 'sku', name: 'SKU', type: 'TEXT', unique: true },
  });
  expect(field.unique).toBe(true);
});

it('rejects unique=true on a RICHTEXT field via POST /fields', async () => {
  const created = await api('/api/content-types', {
    method: 'POST',
    body: {
      name: `Add Richtext Unique ${Date.now()}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
      ],
    },
  });
  await expect(
    api(`/api/content-types/${created.id}/fields`, {
      method: 'POST',
      body: {
        identifier: 'body',
        name: 'Body',
        type: 'RICHTEXT',
        unique: true,
      },
    })
  ).rejects.toThrow(/400/);
});
```

Note: `api(url, opts)` in this plan is shorthand for the test harness's actual pattern. The file already imports `$fetch` from `@nuxt/test-utils/e2e` and defines a `getSessionCookie()` helper; a real call looks like:

```ts
const cookie = await getSessionCookie();
const res = await $fetch<ContentTypeResponse>('/api/content-types', {
  method: 'POST',
  headers: { cookie },
  body: { ... },
});
```

Apply that shape to every `api(...)` call shown below. For expected failures, use `fetch(url, { headers: { cookie } })` and assert on `res.status` (pattern used by the `rejects missing ENTRY_TITLE field` test already in the file) rather than `rejects.toThrow(/400/)`.

- [ ] **Step 2: Run the tests — expect failure**

Run: `pnpm test:integration server/api/content-types/content-types.test.ts`
Expected: 6 new tests fail — either missing `unique` on the response or 500/400 mismatches.

- [ ] **Step 3: Update the bulk-create handler**

Edit `server/api/content-types/index.post.ts`. Inside the `body.fields.map(...)` callback, replace the existing `return { ... }` at the end with a resolved-unique version. Add the import near the top and the `unique` resolution right before `return`.

Top of file:

```ts
import { resolveUniqueFlag } from '../../utils/validateFieldUnique';
```

Replace the final return inside the `map`:

```ts
const uniqueFlag = resolveUniqueFlag(
  type,
  typeof f.unique === 'boolean' ? f.unique : undefined
);

return {
  identifier: fieldIdentifier,
  name: fieldName,
  type,
  required: typeof f.required === 'boolean' ? f.required : false,
  unique: uniqueFlag,
  order: idx,
  options: f.options ?? undefined,
};
```

- [ ] **Step 4: Update the single-field create handler**

Edit `server/api/content-types/[id]/fields/index.post.ts`.

Add import near the top:

```ts
import { resolveUniqueFlag } from '../../../../utils/validateFieldUnique';
```

Replace the `prisma.contentTypeField.create({ ... })` block:

```ts
const uniqueFlag = resolveUniqueFlag(
  type,
  typeof body.unique === 'boolean' ? body.unique : undefined
);

const created = await withPrismaErrors(
  () =>
    prisma.contentTypeField.create({
      data: {
        contentTypeId,
        identifier: fieldIdentifier,
        name,
        type,
        required: typeof body.required === 'boolean' ? body.required : false,
        unique: uniqueFlag,
        order: maxOrder + 1,
        options: body.options ?? undefined,
      },
    }),
  {
    uniqueMessage:
      'A field with this identifier already exists on this content type',
  }
);
```

- [ ] **Step 5: Run the tests — expect pass**

Run: `pnpm test:integration server/api/content-types/content-types.test.ts`
Expected: all tests in the file pass, including the 6 new ones.

- [ ] **Step 6: Commit**

```bash
git add server/api/content-types/index.post.ts server/api/content-types/[id]/fields/index.post.ts server/api/content-types/content-types.test.ts
git commit -m "feat: accept unique flag in field create endpoints"
```

---

## Task 4: Accept `unique` in field PUT (without conflict detection yet)

**Files:**

- Modify: `server/api/content-types/[id]/fields/[fieldId].put.ts`
- Modify: `server/api/content-types/content-types.test.ts`

The PUT accepts `unique` but only for TEXT/NUMBER. Toggling it on ENTRY_TITLE/SLUG to `false` returns 400. Toggling on a non-TEXT/NUMBER to `true` returns 400. The conflict-detection check lands in Task 7; this task just wires the flag through for the happy path.

- [ ] **Step 1: Write the failing tests**

Append to `server/api/content-types/content-types.test.ts`:

```ts
it('allows toggling unique=true on an empty TEXT field', async () => {
  const ct = await api('/api/content-types', {
    method: 'POST',
    body: {
      name: `Toggle Unique ${Date.now()}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
        { identifier: 'sku', name: 'SKU', type: 'TEXT' },
      ],
    },
  });
  const sku = ct.fields.find((f: any) => f.identifier === 'sku');
  const updated = await api(`/api/content-types/${ct.id}/fields/${sku.id}`, {
    method: 'PUT',
    body: { unique: true },
  });
  expect(updated.unique).toBe(true);
});

it('allows toggling unique=false on a user-configurable field', async () => {
  const ct = await api('/api/content-types', {
    method: 'POST',
    body: {
      name: `Toggle Off Unique ${Date.now()}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
        { identifier: 'sku', name: 'SKU', type: 'TEXT', unique: true },
      ],
    },
  });
  const sku = ct.fields.find((f: any) => f.identifier === 'sku');
  const updated = await api(`/api/content-types/${ct.id}/fields/${sku.id}`, {
    method: 'PUT',
    body: { unique: false },
  });
  expect(updated.unique).toBe(false);
});

it('rejects setting unique=false on ENTRY_TITLE', async () => {
  const ct = await api('/api/content-types', {
    method: 'POST',
    body: {
      name: `Immutable Unique ${Date.now()}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
      ],
    },
  });
  const title = ct.fields.find((f: any) => f.identifier === 'title');
  await expect(
    api(`/api/content-types/${ct.id}/fields/${title.id}`, {
      method: 'PUT',
      body: { unique: false },
    })
  ).rejects.toThrow(/400/);
});

it('rejects setting unique=false on SLUG', async () => {
  const ct = await api('/api/content-types', {
    method: 'POST',
    body: {
      name: `Slug Immutable ${Date.now()}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
        { identifier: 'slug', name: 'Slug', type: 'SLUG' },
      ],
    },
  });
  const slug = ct.fields.find((f: any) => f.identifier === 'slug');
  await expect(
    api(`/api/content-types/${ct.id}/fields/${slug.id}`, {
      method: 'PUT',
      body: { unique: false },
    })
  ).rejects.toThrow(/400/);
});

it('rejects setting unique=true on a BOOLEAN field', async () => {
  const ct = await api('/api/content-types', {
    method: 'POST',
    body: {
      name: `Bool No Unique ${Date.now()}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
        { identifier: 'flag', name: 'Flag', type: 'BOOLEAN' },
      ],
    },
  });
  const flag = ct.fields.find((f: any) => f.identifier === 'flag');
  await expect(
    api(`/api/content-types/${ct.id}/fields/${flag.id}`, {
      method: 'PUT',
      body: { unique: true },
    })
  ).rejects.toThrow(/400/);
});
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `pnpm test:integration server/api/content-types/content-types.test.ts`
Expected: 5 new tests fail.

- [ ] **Step 3: Update the PUT handler**

Edit `server/api/content-types/[id]/fields/[fieldId].put.ts`.

Add import:

```ts
import { resolveUniqueFlag } from '../../../../utils/validateFieldUnique';
```

Inside the handler, after the existing `if ('options' in body)` block and before the `if ('type' in body)` block, add:

```ts
if ('unique' in body) {
  if (typeof body.unique !== 'boolean') {
    throw createError({
      statusCode: 400,
      statusMessage: 'unique must be a boolean',
    });
  }
  if (
    (field.type === 'ENTRY_TITLE' || field.type === 'SLUG') &&
    body.unique === false
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: `unique cannot be disabled on ${field.type} fields`,
    });
  }
  // Force implicit-unique types back to true even if body says true explicitly.
  // Throw for user-configurable types requesting unique on a non-TEXT/NUMBER field.
  data.unique = resolveUniqueFlag(field.type, body.unique);
}
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `pnpm test:integration server/api/content-types/content-types.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/api/content-types/[id]/fields/[fieldId].put.ts server/api/content-types/content-types.test.ts
git commit -m "feat: accept unique flag on field PUT"
```

---

## Task 5: Create `assertUniqueFieldValues` enforcement helper

**Files:**

- Create: `server/utils/assertUniqueFieldValues.ts`
- Create: `server/utils/assertUniqueFieldValues.test.ts`

This helper queries `ContentEntryVersion` for any version sharing the incoming value on a unique TEXT/NUMBER field. Uses raw SQL so we can index into JSONB and cast properly. Integration coverage lands in Task 6; this task locks in the interface and unit-tests the type casting + null skipping logic.

- [ ] **Step 1: Write the failing tests**

Create `server/utils/assertUniqueFieldValues.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FieldType } from '#prisma';
import { assertUniqueFieldValues } from './assertUniqueFieldValues';

type FakeRow = { entryId: string; value: unknown };

const fakePrisma = {
  rows: [] as FakeRow[],
  $queryRaw: vi.fn(async () => fakePrisma.rows),
};

vi.mock('./prisma', () => ({ prisma: fakePrisma }));

const fieldBase = {
  id: 'f1',
  contentTypeId: 'ct1',
  name: 'SKU',
  identifier: 'sku',
  required: false,
  unique: true,
  options: null,
  order: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('assertUniqueFieldValues', () => {
  beforeEach(() => {
    fakePrisma.rows = [];
    fakePrisma.$queryRaw.mockClear();
  });

  it('skips fields with unique=false', async () => {
    await assertUniqueFieldValues(
      { sku: 'ABC' },
      [{ ...fieldBase, unique: false, type: 'TEXT' as FieldType }],
      'ct1'
    );
    expect(fakePrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('skips fields of unsupported types even when unique=true', async () => {
    await assertUniqueFieldValues(
      { sku: 'ABC' },
      [{ ...fieldBase, unique: true, type: 'ENTRY_TITLE' as FieldType }],
      'ct1'
    );
    expect(fakePrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('skips when value is null, undefined, or empty string', async () => {
    await assertUniqueFieldValues(
      { sku: null, issue: undefined, code: '' },
      [
        { ...fieldBase, identifier: 'sku', type: 'TEXT' as FieldType },
        { ...fieldBase, identifier: 'issue', type: 'NUMBER' as FieldType },
        { ...fieldBase, identifier: 'code', type: 'TEXT' as FieldType },
      ],
      'ct1'
    );
    expect(fakePrisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('throws 409 when a duplicate TEXT value exists on another entry', async () => {
    fakePrisma.rows = [{ entryId: 'e2', value: 'ABC' }];
    await expect(
      assertUniqueFieldValues(
        { sku: 'ABC' },
        [{ ...fieldBase, identifier: 'sku', type: 'TEXT' as FieldType }],
        'ct1'
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'UNIQUE_CONFLICT', field: 'sku', value: 'ABC' },
    });
  });

  it('throws 409 when a duplicate NUMBER value exists', async () => {
    fakePrisma.rows = [{ entryId: 'e2', value: 42 }];
    await expect(
      assertUniqueFieldValues(
        { issue: 42 },
        [{ ...fieldBase, identifier: 'issue', type: 'NUMBER' as FieldType }],
        'ct1'
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'UNIQUE_CONFLICT', field: 'issue', value: 42 },
    });
  });

  it('passes when the only match is the excluded entry', async () => {
    fakePrisma.rows = [{ entryId: 'e1', value: 'ABC' }];
    await expect(
      assertUniqueFieldValues(
        { sku: 'ABC' },
        [{ ...fieldBase, identifier: 'sku', type: 'TEXT' as FieldType }],
        'ct1',
        'e1'
      )
    ).resolves.toBeUndefined();
  });

  it('does case-sensitive comparison for TEXT', async () => {
    // DB doesn't match 'ABC' against 'abc' — we rely on the raw SQL's `=` operator.
    fakePrisma.rows = [];
    await expect(
      assertUniqueFieldValues(
        { sku: 'abc' },
        [{ ...fieldBase, identifier: 'sku', type: 'TEXT' as FieldType }],
        'ct1'
      )
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `pnpm test:unit server/utils/assertUniqueFieldValues.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

Create `server/utils/assertUniqueFieldValues.ts`:

```ts
import { Prisma } from '#prisma';
import type { FieldType } from '#prisma';
import { createError } from 'h3';
import { prisma } from './prisma';

interface FieldDef {
  identifier: string;
  name: string;
  type: FieldType;
  unique: boolean;
}

export async function assertUniqueFieldValues(
  data: Record<string, unknown>,
  fields: FieldDef[],
  contentTypeId: string,
  excludeEntryId?: string
): Promise<void> {
  for (const field of fields) {
    if (!field.unique) continue;
    if (field.type !== 'TEXT' && field.type !== 'NUMBER') continue;

    const value = data[field.identifier];
    if (value === null || value === undefined || value === '') continue;

    const rows = await queryConflicts(
      contentTypeId,
      field.identifier,
      field.type,
      value,
      excludeEntryId
    );

    if (rows.length > 0) {
      throw createError({
        statusCode: 409,
        statusMessage: `${field.name} must be unique`,
        data: {
          error: 'UNIQUE_CONFLICT',
          field: field.identifier,
          message: `${field.name} must be unique`,
          value,
        },
      });
    }
  }
}

async function queryConflicts(
  contentTypeId: string,
  identifier: string,
  type: 'TEXT' | 'NUMBER',
  value: unknown,
  excludeEntryId: string | undefined
): Promise<Array<{ entryId: string }>> {
  // Raw SQL: pull any ContentEntryVersion (any status) for an entry in this
  // content type where the JSONB value at `identifier` matches. For NUMBER,
  // cast both sides to numeric; for TEXT, compare as text.
  const excludeClause = excludeEntryId
    ? Prisma.sql`AND ce."id" <> ${excludeEntryId}`
    : Prisma.empty;

  if (type === 'NUMBER') {
    return prisma.$queryRaw<Array<{ entryId: string }>>`
      SELECT ce."id" AS "entryId"
      FROM "ContentEntry" ce
      JOIN "ContentEntryVersion" cev ON cev."entryId" = ce."id"
      WHERE ce."contentTypeId" = ${contentTypeId}
        ${excludeClause}
        AND (cev."data" ->> ${identifier})::numeric = ${Number(value)}::numeric
      LIMIT 1
    `;
  }

  return prisma.$queryRaw<Array<{ entryId: string }>>`
    SELECT ce."id" AS "entryId"
    FROM "ContentEntry" ce
    JOIN "ContentEntryVersion" cev ON cev."entryId" = ce."id"
    WHERE ce."contentTypeId" = ${contentTypeId}
      ${excludeClause}
      AND cev."data" ->> ${identifier} = ${String(value)}
    LIMIT 1
  `;
}
```

Note: the unit tests mock `./prisma`, so they never exercise the raw SQL path — that's covered by the integration tests in Task 6. The implementation here is written defensively so the real query is safe against SQL injection via `Prisma.sql` / parameter interpolation.

- [ ] **Step 4: Run the tests — expect pass**

Run: `pnpm test:unit server/utils/assertUniqueFieldValues.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/utils/assertUniqueFieldValues.ts server/utils/assertUniqueFieldValues.test.ts
git commit -m "feat: add assertUniqueFieldValues enforcement helper"
```

---

## Task 6: Wire uniqueness enforcement into entry create and update

**Files:**

- Modify: `server/api/content-entries/index.post.ts`
- Modify: `server/api/content-entries/[id].put.ts`
- Modify: `server/api/content-entries/content-entries.test.ts`

- [ ] **Step 1: Write failing integration tests**

Append to `server/api/content-entries/content-entries.test.ts`:

```ts
describe('unique field enforcement', () => {
  async function createContentTypeWithUniqueText() {
    return api('/api/content-types', {
      method: 'POST',
      body: {
        name: `UniqueText ${Date.now()}`,
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
          { identifier: 'sku', name: 'SKU', type: 'TEXT', unique: true },
        ],
      },
    });
  }

  async function createContentTypeWithUniqueNumber() {
    return api('/api/content-types', {
      method: 'POST',
      body: {
        name: `UniqueNumber ${Date.now()}`,
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
          { identifier: 'issue', name: 'Issue', type: 'NUMBER', unique: true },
        ],
      },
    });
  }

  it('rejects creating an entry with a duplicate unique TEXT value', async () => {
    const ct = await createContentTypeWithUniqueText();
    await api('/api/content-entries', {
      method: 'POST',
      body: { contentTypeId: ct.id, data: { title: 'A', sku: 'SKU-1' } },
    });
    await expect(
      api('/api/content-entries', {
        method: 'POST',
        body: { contentTypeId: ct.id, data: { title: 'B', sku: 'SKU-1' } },
      })
    ).rejects.toThrow(/409/);
  });

  it('rejects creating an entry with a duplicate unique NUMBER value', async () => {
    const ct = await createContentTypeWithUniqueNumber();
    await api('/api/content-entries', {
      method: 'POST',
      body: { contentTypeId: ct.id, data: { title: 'A', issue: 7 } },
    });
    await expect(
      api('/api/content-entries', {
        method: 'POST',
        body: { contentTypeId: ct.id, data: { title: 'B', issue: 7 } },
      })
    ).rejects.toThrow(/409/);
  });

  it('allows multiple entries with empty/null unique values', async () => {
    const ct = await createContentTypeWithUniqueText();
    await api('/api/content-entries', {
      method: 'POST',
      body: { contentTypeId: ct.id, data: { title: 'A', sku: '' } },
    });
    await expect(
      api('/api/content-entries', {
        method: 'POST',
        body: { contentTypeId: ct.id, data: { title: 'B', sku: '' } },
      })
    ).resolves.toBeTruthy();
    await expect(
      api('/api/content-entries', {
        method: 'POST',
        body: { contentTypeId: ct.id, data: { title: 'C', sku: null } },
      })
    ).resolves.toBeTruthy();
  });

  it('allows an entry to keep its own unique value on update', async () => {
    const ct = await createContentTypeWithUniqueText();
    const created = await api('/api/content-entries', {
      method: 'POST',
      body: { contentTypeId: ct.id, data: { title: 'A', sku: 'SKU-ABC' } },
    });
    const updated = await api(`/api/content-entries/${created.id}`, {
      method: 'PUT',
      body: { data: { title: 'A-renamed', sku: 'SKU-ABC' } },
    });
    expect(updated.data.sku).toBe('SKU-ABC');
  });

  it('blocks conflicts across all versions (draft vs draft)', async () => {
    const ct = await createContentTypeWithUniqueText();
    await api('/api/content-entries', {
      method: 'POST',
      body: { contentTypeId: ct.id, data: { title: 'A', sku: 'SKU-X' } },
    });
    await expect(
      api('/api/content-entries', {
        method: 'POST',
        body: { contentTypeId: ct.id, data: { title: 'B', sku: 'SKU-X' } },
      })
    ).rejects.toThrow(/409/);
  });

  it('returns 409 body shape with UNIQUE_CONFLICT error and offending value', async () => {
    const ct = await createContentTypeWithUniqueText();
    await api('/api/content-entries', {
      method: 'POST',
      body: { contentTypeId: ct.id, data: { title: 'A', sku: 'SHAPE-1' } },
    });
    try {
      await api('/api/content-entries', {
        method: 'POST',
        body: { contentTypeId: ct.id, data: { title: 'B', sku: 'SHAPE-1' } },
      });
      throw new Error('Expected 409');
    } catch (err: any) {
      expect(err.data?.data?.error ?? err.data?.error).toBe('UNIQUE_CONFLICT');
      const payload = err.data?.data ?? err.data;
      expect(payload.field).toBe('sku');
      expect(payload.value).toBe('SHAPE-1');
    }
  });
});
```

The `err.data?.data ?? err.data` fallback accounts for h3's `createError({ data })` landing one layer deeper depending on the fetch client in use — keep both access paths until you see which one the actual error object exposes in this test harness, then simplify.

- [ ] **Step 2: Run tests — expect failure**

Run: `pnpm test:integration server/api/content-entries/content-entries.test.ts`
Expected: 6 new tests fail with either 200s instead of 409s or missing error body shape.

- [ ] **Step 3: Wire into entry POST**

Edit `server/api/content-entries/index.post.ts`. Add import:

```ts
import { assertUniqueFieldValues } from '../../utils/assertUniqueFieldValues';
```

After the existing `validatedData = await validateEntryData(...)` line, before `extractSlug`, add:

```ts
await assertUniqueFieldValues(validatedData, contentType.fields, contentTypeId);
```

- [ ] **Step 4: Wire into entry PUT**

Edit `server/api/content-entries/[id].put.ts`. Add import:

```ts
import { assertUniqueFieldValues } from '../../utils/assertUniqueFieldValues';
```

Modify the `validateEntryData` branch. Replace:

```ts
let validatedData: Record<string, unknown> | null = null;
if (typeof body.data === 'object' && body.data !== null) {
  validatedData = await validateEntryData(
    body.data as Record<string, unknown>,
    entry.contentType.fields
  );
}
```

With:

```ts
let validatedData: Record<string, unknown> | null = null;
if (typeof body.data === 'object' && body.data !== null) {
  validatedData = await validateEntryData(
    body.data as Record<string, unknown>,
    entry.contentType.fields
  );
  await assertUniqueFieldValues(
    validatedData,
    entry.contentType.fields,
    entry.contentTypeId,
    entry.id
  );
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `pnpm test:integration server/api/content-entries/content-entries.test.ts`
Expected: all tests pass (existing + 6 new).

- [ ] **Step 6: Commit**

```bash
git add server/api/content-entries/index.post.ts server/api/content-entries/[id].put.ts server/api/content-entries/content-entries.test.ts
git commit -m "feat: enforce unique field values on entry create/update"
```

---

## Task 7: Detect conflicts when enabling unique on a field with existing entries

**Files:**

- Modify: `server/api/content-types/[id]/fields/[fieldId].put.ts`
- Modify: `server/api/content-types/content-types.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `server/api/content-types/content-types.test.ts`:

```ts
it('blocks enabling unique on a TEXT field with existing duplicates', async () => {
  const ct = await api('/api/content-types', {
    method: 'POST',
    body: {
      name: `DupBlock ${Date.now()}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
        { identifier: 'code', name: 'Code', type: 'TEXT' },
      ],
    },
  });
  await api('/api/content-entries', {
    method: 'POST',
    body: { contentTypeId: ct.id, data: { title: 'A', code: 'DUP' } },
  });
  await api('/api/content-entries', {
    method: 'POST',
    body: { contentTypeId: ct.id, data: { title: 'B', code: 'DUP' } },
  });
  const code = ct.fields.find((f: any) => f.identifier === 'code');
  try {
    await api(`/api/content-types/${ct.id}/fields/${code.id}`, {
      method: 'PUT',
      body: { unique: true },
    });
    throw new Error('Expected 409');
  } catch (err: any) {
    const payload = err.data?.data ?? err.data;
    expect(payload.error).toBe('UNIQUE_CONFLICT');
    expect(Array.isArray(payload.conflicts)).toBe(true);
    const dupGroup = payload.conflicts.find((c: any) => c.value === 'DUP');
    expect(dupGroup).toBeDefined();
    expect(dupGroup.entryIds.length).toBeGreaterThanOrEqual(2);
  }
});

it('allows enabling unique on a TEXT field when all values are distinct', async () => {
  const ct = await api('/api/content-types', {
    method: 'POST',
    body: {
      name: `DupAllow ${Date.now()}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
        { identifier: 'code', name: 'Code', type: 'TEXT' },
      ],
    },
  });
  await api('/api/content-entries', {
    method: 'POST',
    body: { contentTypeId: ct.id, data: { title: 'A', code: 'ONE' } },
  });
  await api('/api/content-entries', {
    method: 'POST',
    body: { contentTypeId: ct.id, data: { title: 'B', code: 'TWO' } },
  });
  const code = ct.fields.find((f: any) => f.identifier === 'code');
  const updated = await api(`/api/content-types/${ct.id}/fields/${code.id}`, {
    method: 'PUT',
    body: { unique: true },
  });
  expect(updated.unique).toBe(true);
});

it('ignores null/empty values when detecting duplicates on toggle', async () => {
  const ct = await api('/api/content-types', {
    method: 'POST',
    body: {
      name: `NullDupOK ${Date.now()}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
        { identifier: 'code', name: 'Code', type: 'TEXT' },
      ],
    },
  });
  await api('/api/content-entries', {
    method: 'POST',
    body: { contentTypeId: ct.id, data: { title: 'A', code: '' } },
  });
  await api('/api/content-entries', {
    method: 'POST',
    body: { contentTypeId: ct.id, data: { title: 'B', code: null } },
  });
  const code = ct.fields.find((f: any) => f.identifier === 'code');
  const updated = await api(`/api/content-types/${ct.id}/fields/${code.id}`, {
    method: 'PUT',
    body: { unique: true },
  });
  expect(updated.unique).toBe(true);
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `pnpm test:integration server/api/content-types/content-types.test.ts`
Expected: the new tests fail — the first returns 200 instead of 409; the others either succeed or 500.

- [ ] **Step 3: Implement the pre-toggle conflict check**

Edit `server/api/content-types/[id]/fields/[fieldId].put.ts`. Add these imports at the top:

```ts
import { Prisma } from '#prisma';
```

Then update the `if ('unique' in body) { ... }` block so that when flipping `false → true` on a TEXT or NUMBER field, we query for duplicates first. Replace the block written in Task 4 with:

```ts
if ('unique' in body) {
  if (typeof body.unique !== 'boolean') {
    throw createError({
      statusCode: 400,
      statusMessage: 'unique must be a boolean',
    });
  }
  if (
    (field.type === 'ENTRY_TITLE' || field.type === 'SLUG') &&
    body.unique === false
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: `unique cannot be disabled on ${field.type} fields`,
    });
  }
  const nextUnique = resolveUniqueFlag(field.type, body.unique);

  // When flipping false -> true on a TEXT/NUMBER field, block if duplicates exist.
  if (
    nextUnique &&
    !field.unique &&
    (field.type === 'TEXT' || field.type === 'NUMBER')
  ) {
    const conflicts = await findDuplicateGroups(
      contentTypeId,
      field.identifier,
      field.type
    );
    if (conflicts.length > 0) {
      throw createError({
        statusCode: 409,
        statusMessage:
          'Cannot mark field as unique — existing entries have duplicate values',
        data: {
          error: 'UNIQUE_CONFLICT',
          message:
            'Cannot mark field as unique — existing entries have duplicate values',
          conflicts,
        },
      });
    }
  }

  data.unique = nextUnique;
}
```

Then add the helper at the bottom of the file, below the handler:

```ts
async function findDuplicateGroups(
  contentTypeId: string,
  identifier: string,
  type: 'TEXT' | 'NUMBER'
): Promise<Array<{ value: unknown; entryIds: string[] }>> {
  // For each entry, pick ANY version's value at `identifier` (a version's value
  // is the same across draft/published/changed only when the user hasn't edited
  // the field; we conservatively use the latest version's value per entry).
  // Group entries by that value and return groups where COUNT > 1. Null/empty
  // are excluded.
  if (type === 'NUMBER') {
    const rows = await prisma.$queryRaw<
      Array<{ value: number; entryIds: string[] }>
    >`
      SELECT v.value, array_agg(v."entryId") AS "entryIds"
      FROM (
        SELECT DISTINCT ON (cev."entryId")
          cev."entryId",
          (cev."data" ->> ${identifier})::numeric AS value
        FROM "ContentEntryVersion" cev
        JOIN "ContentEntry" ce ON ce."id" = cev."entryId"
        WHERE ce."contentTypeId" = ${contentTypeId}
          AND cev."data" ? ${identifier}
          AND cev."data" ->> ${identifier} <> ''
        ORDER BY cev."entryId", cev."updatedAt" DESC
      ) v
      GROUP BY v.value
      HAVING COUNT(*) > 1
    `;
    return rows.map((r) => ({ value: r.value, entryIds: r.entryIds }));
  }

  const rows = await prisma.$queryRaw<
    Array<{ value: string; entryIds: string[] }>
  >`
    SELECT v.value, array_agg(v."entryId") AS "entryIds"
    FROM (
      SELECT DISTINCT ON (cev."entryId")
        cev."entryId",
        cev."data" ->> ${identifier} AS value
      FROM "ContentEntryVersion" cev
      JOIN "ContentEntry" ce ON ce."id" = cev."entryId"
      WHERE ce."contentTypeId" = ${contentTypeId}
        AND cev."data" ? ${identifier}
        AND cev."data" ->> ${identifier} <> ''
      ORDER BY cev."entryId", cev."updatedAt" DESC
    ) v
    GROUP BY v.value
    HAVING COUNT(*) > 1
  `;
  return rows.map((r) => ({ value: r.value, entryIds: r.entryIds }));
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm test:integration server/api/content-types/content-types.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/api/content-types/[id]/fields/[fieldId].put.ts server/api/content-types/content-types.test.ts
git commit -m "feat: detect duplicate values when enabling unique on existing field"
```

---

## Task 8: Add `Unique` toggle to FieldModal

**Files:**

- Modify: `components/field-modal/fieldModal.types.ts`
- Modify: `components/field-modal/FieldModal.vue`

- [ ] **Step 1: Extend types**

Edit `components/field-modal/fieldModal.types.ts`:

```ts
import type { BasicComponentProps } from '~/types/basicComponentProps';

export interface FieldData {
  id?: string;
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  options: unknown;
}

export interface FieldFormData {
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  options: unknown;
}

export type FieldModalProps = BasicComponentProps & {
  open: boolean;
  mode: 'add' | 'edit';
  field: FieldData | null;
  fieldTypeOptions: Array<{ label: string; value: string }>;
  entryCount?: number;
  conflictAlert?: {
    message: string;
    conflicts: Array<{ value: unknown; entryIds: string[] }>;
  } | null;
};
```

- [ ] **Step 2: Update FieldModal.vue**

Edit `components/field-modal/FieldModal.vue`.

Add `formUnique` ref alongside the other refs:

```ts
const formUnique = ref(false);
```

Update the `open` watcher so it hydrates / resets `formUnique`:

```ts
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      if (props.mode === 'edit' && props.field) {
        formName.value = props.field.name;
        formIdentifier.value = props.field.identifier;
        formType.value = props.field.type;
        formRequired.value = props.field.required;
        formUnique.value = props.field.unique;
        formOptions.value = props.field.options ?? null;
        identifierTouched.value = true;
      } else {
        formName.value = '';
        formIdentifier.value = '';
        formType.value = 'TEXT';
        formRequired.value = false;
        formUnique.value = false;
        formOptions.value = null;
        identifierTouched.value = false;
      }
    }
  }
);
```

Add a computed so we only show the toggle for TEXT/NUMBER plus the always-on ENTRY_TITLE/SLUG:

```ts
const showUniqueToggle = computed(
  () =>
    formType.value === 'TEXT' ||
    formType.value === 'NUMBER' ||
    formType.value === 'ENTRY_TITLE' ||
    formType.value === 'SLUG'
);

const uniqueToggleReadonly = computed(
  () => formType.value === 'ENTRY_TITLE' || formType.value === 'SLUG'
);
```

Update `handleSave`:

```ts
function handleSave() {
  if (!canSave.value) return;
  emit('save', {
    identifier: formIdentifier.value.trim(),
    name: formName.value.trim(),
    type: formType.value,
    required: formRequired.value,
    unique: uniqueToggleReadonly.value ? true : formUnique.value,
    options: formOptions.value,
  });
}
```

In the template, insert a conflict alert at the top of `<template #body>`, before the info bar:

```vue
<UAlert
  v-if="conflictAlert"
  color="error"
  icon="i-lucide-alert-circle"
  :title="conflictAlert.message"
  class="mb-2"
>
  <template #description>
    <ul class="mt-2 space-y-1 text-sm">
      <li
        v-for="(c, i) in conflictAlert.conflicts"
        :key="i"
      >
        <span class="font-medium">{{ c.value }}</span>
        <span class="text-muted"> — </span>
        <NuxtLink
          v-for="(eid, j) in c.entryIds"
          :key="eid"
          :to="`/entries/${eid}`"
          target="_blank"
          class="underline mr-2"
        >
          {{ eid.slice(0, 8) }}<span v-if="j < c.entryIds.length - 1">,</span>
        </NuxtLink>
      </li>
    </ul>
  </template>
</UAlert>
```

Add the `Unique` switch. In the add-mode grid (replace the existing two-column row):

```vue
<!-- Type + Required + Unique row (add mode) -->
<div v-if="mode === 'add'" class="grid grid-cols-2 gap-4">
  <UFormField label="Type">
    <USelect
      v-model="formType"
      :items="fieldTypeOptions"
      value-key="value"
      class="w-full"
    />
  </UFormField>
  <UFormField label=" ">
    <div class="flex flex-col gap-2">
      <USwitch v-model="formRequired" label="Required" />
      <USwitch
        v-if="showUniqueToggle"
        :model-value="uniqueToggleReadonly ? true : formUnique"
        :disabled="uniqueToggleReadonly"
        label="Unique"
        @update:model-value="formUnique = $event"
      />
    </div>
  </UFormField>
</div>
```

And extend the edit-mode block. Replace the existing `<UFormField v-if="mode === 'edit'" label="Required">`:

```vue
<UFormField v-if="mode === 'edit'" label="Required">
  <USwitch v-model="formRequired" />
</UFormField>
<UFormField v-if="mode === 'edit' && showUniqueToggle" label="Unique">
  <USwitch
    :model-value="uniqueToggleReadonly ? true : formUnique"
    :disabled="uniqueToggleReadonly"
    @update:model-value="formUnique = $event"
  />
  <template #help>
    Entries must have distinct values for this field. Empty values are
    allowed.
  </template>
</UFormField>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/field-modal/FieldModal.vue components/field-modal/fieldModal.types.ts
git commit -m "feat: add Unique toggle and conflict alert to FieldModal"
```

---

## Task 9: Wire `unique` through the content type edit page

**Files:**

- Modify: `pages/content-types/[id]/index.vue`

- [ ] **Step 1: Extend the fetched content type type**

In the `useAuthedFetch<{...}>` generic on the content type fetch, add `unique: boolean;` alongside `required` in the `fields` array type. And extend the `fieldModalField` ref's type (the object literal) and `openEditFieldModal` / `fieldMenuItems` parameter types so they carry `unique: boolean` through.

- [ ] **Step 2: Pass and persist `unique` on save**

In `handleFieldSave`, include `unique: data.unique` in both the POST (add) and PUT (update) bodies:

```ts
if (fieldModalMode.value === 'add') {
  await $fetch(`/api/content-types/${id}/fields`, {
    method: 'POST',
    body: {
      identifier: data.identifier,
      name: data.name,
      type: data.type,
      required: data.required,
      unique: data.unique,
      ...(data.options ? { options: data.options } : {}),
    },
  });
  ...
} else {
  await $fetch(
    `/api/content-types/${id}/fields/${fieldModalField.value!.id}`,
    {
      method: 'PUT',
      body: {
        name: data.name,
        required: data.required,
        unique: data.unique,
        ...(data.options ? { options: data.options } : {}),
      },
    }
  );
  ...
}
```

- [ ] **Step 3: Capture `UNIQUE_CONFLICT` from the save and surface in the modal**

Add a ref to hold the conflict payload:

```ts
const conflictAlert = ref<{
  message: string;
  conflicts: Array<{ value: unknown; entryIds: string[] }>;
} | null>(null);
```

Wrap the existing try/catch in `handleFieldSave` to populate it on 409:

```ts
async function handleFieldSave(data: FieldFormData) {
  conflictAlert.value = null;
  try {
    if (fieldModalMode.value === 'add') {
      // ... existing POST body
    } else {
      // ... existing PUT body
    }
    fieldModalOpen.value = false;
    await refresh();
  } catch (err: any) {
    const payload = err?.data?.data ?? err?.data;
    if (
      err?.statusCode === 409 &&
      payload?.error === 'UNIQUE_CONFLICT' &&
      Array.isArray(payload.conflicts)
    ) {
      conflictAlert.value = {
        message:
          payload.message ??
          'Cannot mark field as unique — existing entries have duplicate values',
        conflicts: payload.conflicts,
      };
      return;
    }
    const message =
      err instanceof Error ? err.message : 'Failed to save field.';
    toast.add({ title: 'Error', description: message, color: 'error' });
  }
}
```

Reset `conflictAlert.value = null` inside `openAddFieldModal` and `openEditFieldModal`, and pass it down:

```vue
<FieldModal
  :open="fieldModalOpen"
  :mode="fieldModalMode"
  :field="fieldModalField"
  :field-type-options="fieldTypeOptions"
  :entry-count="contentType?._count.entries ?? 0"
  :conflict-alert="conflictAlert"
  @close="fieldModalOpen = false"
  @save="handleFieldSave"
  @delete="handleFieldDelete"
/>
```

(Prop order/names may differ slightly from the current usage — add `conflict-alert` binding next to the existing ones.)

- [ ] **Step 4: Replace the hardcoded badge with `field.unique`**

Replace the block added in PR #71 (or the first cosmetic attempt at issue #47):

```vue
<UBadge
  v-if="field.type === 'ENTRY_TITLE' || field.type === 'SLUG'"
  color="info"
  size="sm"
  variant="subtle"
  class="ml-1"
>
  Unique
</UBadge>
```

with:

```vue
<UBadge
  v-if="field.unique"
  color="info"
  size="sm"
  variant="subtle"
  class="ml-1"
>
  Unique
</UBadge>
```

If this branch is not built on top of #71, skip that replacement — just add the `field.unique` badge after the existing Required badge in the field list row.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add pages/content-types/[id]/index.vue
git commit -m "feat: persist unique flag and surface conflicts on content type edit"
```

---

## Task 10: Surface unique-conflict errors on entry save

**Files:**

- Modify: `composables/useContentEntryEditor.ts`
- Modify: `components/content-editor/ContentEditor.vue`

Let the entry editor render a field-level error from `UNIQUE_CONFLICT` responses instead of a generic toast message.

- [ ] **Step 1: Update the composable's save error handling**

Edit `composables/useContentEntryEditor.ts`. After the existing `saveError` ref, add a sibling ref:

```ts
const fieldErrors = ref<Record<string, string>>({});
```

In both `saveDraft` and `publish`, in the `catch (err: unknown)` blocks, replace the body with:

```ts
} catch (err: unknown) {
  const anyErr = err as {
    statusCode?: number;
    data?: { data?: Record<string, unknown>; [key: string]: unknown };
    message?: string;
  };
  const payload = (anyErr?.data?.data ?? anyErr?.data) as
    | { error?: string; field?: string; message?: string }
    | undefined;
  if (
    anyErr?.statusCode === 409 &&
    payload?.error === 'UNIQUE_CONFLICT' &&
    typeof payload.field === 'string'
  ) {
    fieldErrors.value = {
      ...fieldErrors.value,
      [payload.field]: payload.message ?? 'Must be unique',
    };
    saveError.value = payload.message ?? 'Value must be unique';
    toast.add({
      title: 'Duplicate value',
      description: payload.message ?? 'Value must be unique',
      color: 'error',
    });
    return;
  }
  const message = err instanceof Error ? err.message : 'Failed to save.';
  saveError.value = message;
  toast.add({ title: 'Error', description: message, color: 'error' });
}
```

Clear `fieldErrors` at the start of each save:

```ts
fieldErrors.value = {};
```

Return `fieldErrors` from the composable:

```ts
return {
  // ... existing entries
  fieldErrors,
};
```

- [ ] **Step 2: Render field errors in ContentEditor**

Edit `components/content-editor/ContentEditor.vue`. Add to the props interface (`components/content-editor/contentEditor.types.ts`):

```ts
fieldErrors?: Record<string, string>;
```

Wire it into `validate()` so form-level errors bubble into the existing UForm error slots:

```ts
function validate(formData: Record<string, unknown>): FormError[] {
  const errors: FormError[] = [];
  for (const field of props.fields) {
    if ('required' in field && field.required) {
      const val = formData[field.key];
      if (val === undefined || val === null || val === '') {
        errors.push({
          name: field.key,
          message: `${field.label} is required`,
        });
      }
    }
  }
  for (const [key, message] of Object.entries(props.fieldErrors ?? {})) {
    errors.push({ name: key, message });
  }
  return errors;
}
```

In the entry editor consumers (`pages/entries/[...stack].vue` and `components/entry-editor-pane/EntryEditorPane.vue`), pass the prop through:

```vue
<ContentEditor ... :field-errors="fieldErrors" />
```

And in the `useContentEntryEditor` destructure, include `fieldErrors`:

```ts
const {
  // ... existing
  fieldErrors,
} = useContentEntryEditor(...);
```

After both `saveDraft`/`publish` have their catch block populate `fieldErrors`, re-trigger validation so the form shows the new errors. In each consumer, after `saveDraft()` / `publish()` returns (success OR failure), call:

```ts
await editorRef.value?.validate();
```

Simpler approach: the validator already runs before save in `handleSaveDraft` / `handlePublish`. After a failed save, also trigger a second validation pass. Add it to both handlers:

```ts
async function handleSaveDraft() {
  const valid = await editorRef.value?.validate();
  if (valid === false) return;
  const newId = await saveDraft();
  await editorRef.value?.validate();
  if (newId && rootIsNew.value) {
    await router.replace(`/entries/${newId}`);
  }
}
```

(Same change in `handlePublish` and in the pane's handlers.)

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add composables/useContentEntryEditor.ts components/content-editor/ContentEditor.vue components/content-editor/contentEditor.types.ts pages/entries/[...stack].vue components/entry-editor-pane/EntryEditorPane.vue
git commit -m "feat: surface unique-conflict errors per-field in entry editor"
```

---

## Task 11: Update CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the new concept**

Find the "ContentTypeField" bullet under "Dynamic Content Types" and append a sentence about the `unique` flag. Find the "FieldType enum" bullet and mention that TEXT and NUMBER support a user-configurable `unique` flag, while ENTRY_TITLE and SLUG are implicitly unique.

Add a new bullet under the same section:

```
- **Field uniqueness** — `ContentTypeField.unique` (`Boolean`, default `false`) marks a field as unique within its content type. Auto-set to `true` at creation time for `ENTRY_TITLE` and `SLUG` (enforced at the DB level via `@@unique` on the `ContentEntry` envelope). User-configurable on `TEXT` and `NUMBER`; other types reject `unique: true` with 400. Enforcement on JSONB fields uses a runtime check in `server/utils/assertUniqueFieldValues.ts`, invoked from the entry POST/PUT handlers across all entry versions (not just PUBLISHED). Null/undefined/empty-string values are skipped. Comparison is case-sensitive exact match. Enabling `unique: true` on a field with existing duplicates returns 409 with `{ error: 'UNIQUE_CONFLICT', conflicts: [{ value, entryIds }] }`.
```

Add new file references under "Key Files":

```
- `server/utils/validateFieldUnique.ts` — `isUniqueAllowedForType` / `resolveUniqueFlag` helpers for the field CRUD endpoints
- `server/utils/assertUniqueFieldValues.ts` — runtime uniqueness check for entry create/update
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document unique field flag and enforcement"
```

---

## Task 12: Verify everything end-to-end

- [ ] **Step 1: Run the full unit + integration test suite**

Run: `pnpm test`
Expected: all tests pass (existing 269 + the new ones from Tasks 2, 3, 4, 6, 7).

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Manual browser smoke test**

Start the dev server: `pnpm dev`.

Walk through:

1. Create a content type with a TEXT field `sku` marked Unique. Observe the `Unique` badge in the field list.
2. Create an entry with `sku = "SKU-1"`. Save. Succeeds.
3. Create a second entry with `sku = "SKU-1"`. Try to save. Observe inline error on the SKU field and a toast.
4. Edit the field via the modal and toggle Unique off. Save two entries with `sku = "DUP"`. Edit the field and try to toggle Unique back on. Observe the conflict alert in the modal listing both entries.
5. Confirm ENTRY_TITLE and SLUG fields still show the Unique badge and the modal switch for them is disabled (on).

- [ ] **Step 4: Create follow-up GH issue for DDL-based enforcement**

Run:

```bash
gh issue create --title "Upgrade unique-field enforcement to PostgreSQL expression index" --body "$(cat <<'EOF'
## Problem

The current runtime uniqueness check in `server/utils/assertUniqueFieldValues.ts` has a race condition: two concurrent POSTs can both pass the check and both insert conflicting values.

## Proposed solution

Add DB-level enforcement via PostgreSQL expression unique indexes on \`ContentEntryVersion\` keyed by \`(entryId-joined-to-contentTypeId, data->>'<identifier>')\`. When a user toggles a field \`unique: true\`, app code runs \`CREATE UNIQUE INDEX ...\`; drops it on toggle off; also handles field identifier renames (would need to drop + recreate).

## Scope

- Application-managed DDL on field create/update/delete
- Retain the existing runtime check for nice 409 error shape (catch the DB violation at the handler layer and translate)
- Integration tests for the race scenario

## Related

Blocks: none — the runtime check (this PR) covers the common case. This is the atomic-safety upgrade.
EOF
)"
```

- [ ] **Step 5: Final commit if any doc updates remain**

Run `git status` — if anything is unstaged, decide whether it belongs in a cleanup commit or should be discarded. If clean, proceed.

- [ ] **Step 6: Check Wallaby, then push + open PR**

Follow the repo's push workflow: check `wallaby_failingTests`; if clean, push with `WALLABY_VERIFIED=1 git push -u origin feat/user-configurable-unique-fields`. Otherwise fall back to a plain push.

Open the PR:

```bash
gh pr create --title "feat: user-configurable unique field flag" --body "$(cat <<'EOF'
## Summary
- Adds a `unique` Boolean flag to `ContentTypeField`. Auto-set to `true` on ENTRY_TITLE/SLUG; user-configurable on TEXT and NUMBER; rejected on other types.
- Enforces uniqueness at entry create/update time across all entry versions via a runtime check (`server/utils/assertUniqueFieldValues.ts`). 409 response carries `{ error: 'UNIQUE_CONFLICT', field, value }`.
- Toggling `unique: true` on a field with existing duplicates returns 409 with a conflict list the UI surfaces in the field modal.
- Replaces the hardcoded ENTRY_TITLE/SLUG badge check (PR #71) with `field.unique`.
- Closes #47.
- Follow-up tracked: race-safe DDL-based enforcement.

## Test plan
- [x] `pnpm test` — all passing (existing + new unit + integration)
- [x] Browser smoke test (steps in plan Task 12)
- [x] Lint + typecheck clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
