# Content Bundle CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a CLI that exports and imports dynamic content types and their entries as portable JSON bundles, plus a prerequisite change that makes `entryTitle` unique per content type.

**Architecture:** Importable module under `scripts/content-bundle/` with pure functions (`exportBundle`, `importBundle`, `validateBundle`) that take a `PrismaClient` instance. A thin CLI wrapper parses args and wires up `pnpm` scripts. Two modes per command: default (UUIDs preserved) and `--portable` (UUIDs stripped, refs keyed by `identifier` + `slug || entryTitle`). All database writes run in a single transaction. Integration tests use the test DB and exercise round-trip export → import cycles.

**Tech Stack:** TypeScript, `tsx` (for running scripts standalone), Prisma v7 (with `@prisma/adapter-pg`), Vitest for tests, existing repo conventions (ESM, `generated/prisma/client`, `#prisma` alias).

**Reference spec:** `docs/superpowers/specs/2026-04-14-content-bundle-cli-design.md`

---

## Prerequisite: Unique `entryTitle`

### Task 1: Add `entryTitle` column to `ContentEntry`

**Files:**

- Modify: `prisma/schema/contentEntry.prisma`
- Create: `prisma/migrations/20260414120000_add_entry_title_column/migration.sql`

**Context:** `prisma migrate dev` requires an interactive terminal and does not work over MCP. Use the manual-migration workflow: hand-write the SQL, then apply via `pnpx prisma migrate deploy`.

- [ ] **Step 1: Update the Prisma schema**

Replace the contents of `prisma/schema/contentEntry.prisma` with:

```prisma
model ContentEntry {
  id            String        @id @default(uuid())
  contentType   ContentType   @relation(fields: [contentTypeId], references: [id])
  contentTypeId String
  data          Json
  entryTitle    String
  slug          String?
  status        ContentStatus @default(DRAFT)
  publishedAt   DateTime?
  createdBy     String?
  updatedBy     String?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  @@unique([contentTypeId, slug])
  @@unique([contentTypeId, entryTitle])
}
```

- [ ] **Step 2: Create the migration SQL**

Create `prisma/migrations/20260414120000_add_entry_title_column/migration.sql` with:

```sql
-- Add entryTitle column; backfill from data JSONB using the content type's ENTRY_TITLE field
ALTER TABLE "ContentEntry" ADD COLUMN "entryTitle" TEXT;

-- Backfill: resolve the ENTRY_TITLE field identifier per content type, then copy the value from data
UPDATE "ContentEntry" e
SET "entryTitle" = COALESCE(NULLIF(e.data ->> f.identifier, ''), 'Untitled')
FROM "ContentTypeField" f
WHERE f."contentTypeId" = e."contentTypeId"
  AND f.type = 'ENTRY_TITLE';

-- Fail the migration if any row is still null (no ENTRY_TITLE field configured — should not happen)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ContentEntry" WHERE "entryTitle" IS NULL) THEN
    RAISE EXCEPTION 'ContentEntry rows without entryTitle after backfill — check that all content types have an ENTRY_TITLE field';
  END IF;
END $$;

-- Fail the migration if duplicates exist (user must resolve manually)
DO $$
DECLARE
  dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT "contentTypeId", "entryTitle"
    FROM "ContentEntry"
    GROUP BY "contentTypeId", "entryTitle"
    HAVING COUNT(*) > 1
  ) t;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Duplicate (contentTypeId, entryTitle) pairs found — resolve duplicates before applying this migration';
  END IF;
END $$;

ALTER TABLE "ContentEntry" ALTER COLUMN "entryTitle" SET NOT NULL;

CREATE UNIQUE INDEX "ContentEntry_contentTypeId_entryTitle_key"
  ON "ContentEntry"("contentTypeId", "entryTitle");
```

- [ ] **Step 3: Apply the migration**

Run: `pnpx prisma migrate deploy`
Expected: `Applying migration 20260414120000_add_entry_title_column` followed by `1 migration applied`.

- [ ] **Step 4: Regenerate Prisma client**

Run: `pnpm prisma:generate`
Expected: `Generated Prisma Client` succeeded.

- [ ] **Step 5: Typecheck passes**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema/contentEntry.prisma prisma/migrations/20260414120000_add_entry_title_column/
git commit -m "feat(schema): add entryTitle column with unique constraint"
```

---

### Task 2: Sync `entryTitle` column in entry create/update endpoints

**Files:**

- Modify: `server/api/content-entries/index.post.ts`
- Modify: `server/api/content-entries/[id].put.ts`
- Modify: `server/api/content-entries/content-entries.test.ts`

- [ ] **Step 1: Add failing tests to the existing integration test file**

Add these test cases to `server/api/content-entries/content-entries.test.ts` (inside the existing `describe`):

```ts
it('populates entryTitle column from the ENTRY_TITLE field value on create', async () => {
  const created = await $fetch<{ id: string; entryTitle: string }>(
    '/api/content-entries',
    {
      method: 'POST',
      body: {
        contentTypeId: blogPostTypeId,
        data: { title: 'Hello entryTitle', body: 'x' },
        status: 'DRAFT',
      },
      headers: authHeaders,
    }
  );
  expect(created.entryTitle).toBe('Hello entryTitle');
});

it('rejects duplicate entryTitle within a content type with 409', async () => {
  await $fetch('/api/content-entries', {
    method: 'POST',
    body: {
      contentTypeId: blogPostTypeId,
      data: { title: 'Unique Title', body: 'x' },
      status: 'DRAFT',
    },
    headers: authHeaders,
  });

  await expect(
    $fetch('/api/content-entries', {
      method: 'POST',
      body: {
        contentTypeId: blogPostTypeId,
        data: { title: 'Unique Title', body: 'x' },
        status: 'DRAFT',
      },
      headers: authHeaders,
    })
  ).rejects.toMatchObject({ statusCode: 409 });
});

it('updates entryTitle column when title field changes via PUT', async () => {
  const created = await $fetch<{ id: string }>('/api/content-entries', {
    method: 'POST',
    body: {
      contentTypeId: blogPostTypeId,
      data: { title: 'Original', body: 'x' },
      status: 'DRAFT',
    },
    headers: authHeaders,
  });
  const updated = await $fetch<{ entryTitle: string }>(
    `/api/content-entries/${created.id}`,
    {
      method: 'PUT',
      body: { data: { title: 'Renamed', body: 'x' } },
      headers: authHeaders,
    }
  );
  expect(updated.entryTitle).toBe('Renamed');
});
```

(`blogPostTypeId` and `authHeaders` should already exist in that test file's setup — reuse them. If test setup needs a small adjustment, handle inline.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run server/api/content-entries/content-entries.test.ts`
Expected: 3 new tests fail (column not populated / no duplicate rejection).

- [ ] **Step 3: Update the POST endpoint**

Modify `server/api/content-entries/index.post.ts`. After `const slug = extractSlug(...)`, add:

```ts
const entryTitle = extractEntryTitle(validatedData, contentType.fields);
```

And include `entryTitle` in the `prisma.contentEntry.create` call:

```ts
prisma.contentEntry.create({
  data: {
    contentTypeId,
    data: validatedData as Prisma.InputJsonValue,
    entryTitle,
    slug,
    status: status as 'DRAFT',
    publishedAt: status === 'PUBLISHED' ? new Date() : undefined,
  },
}),
```

Update the `withPrismaErrors` options to cover both unique constraints:

```ts
{
  uniqueMessage:
    'An entry with this slug or title already exists for this content type',
}
```

- [ ] **Step 4: Update the PUT endpoint**

Modify `server/api/content-entries/[id].put.ts`. After the `data.slug = extractSlug(...)` line inside the `if (typeof body.data === 'object' ...)` block, add:

```ts
data.entryTitle = extractEntryTitle(validatedData, existing.contentType.fields);
```

Update the `uniqueMessage` to the same combined wording used in POST.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:run server/api/content-entries/content-entries.test.ts`
Expected: All tests pass (existing + 3 new).

- [ ] **Step 6: Run a broader check**

Run: `pnpm test:run`
Expected: Full suite passes.

- [ ] **Step 7: Commit**

```bash
git add server/api/content-entries/
git commit -m "feat(content-entries): sync entryTitle column on create and update"
```

---

### Task 3: Update seed script to populate `entryTitle`

**Files:**

- Modify: `prisma/seed.ts`

- [ ] **Step 1: Locate the ContentEntry seeding block**

Run: `grep -n "contentEntry" prisma/seed.ts`
Expected: Line numbers where `prisma.contentEntry.create` or `upsert` calls live.

- [ ] **Step 2: Add `entryTitle` to each ContentEntry create/upsert**

For every `prisma.contentEntry.create({ data: { ... } })` or `upsert({ ... })` in `prisma/seed.ts`, add an `entryTitle` matching the title field value inside `data`. Example pattern:

```ts
await prisma.contentEntry.create({
  data: {
    contentTypeId: blogPostType.id,
    data: { title: 'First post', body: {} },
    entryTitle: 'First post',
    slug: 'first-post',
    status: 'PUBLISHED',
    publishedAt: new Date(),
  },
});
```

- [ ] **Step 3: Run the seed to verify it succeeds**

Run: `pnpm prisma:seed`
Expected: Seed completes without errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts
git commit -m "chore(seed): populate entryTitle on dynamic ContentEntry records"
```

---

## Content Bundle CLI

### Task 4: Scaffold module directory and shared types

**Files:**

- Create: `scripts/content-bundle/types.ts`

- [ ] **Step 1: Create the types file**

Create `scripts/content-bundle/types.ts`:

```ts
import type { ContentStatus, FieldType } from '#prisma';

export const BUNDLE_VERSION = 1;

export type BundleFieldOptions = {
  choices?: string[];
  targetContentTypeIds?: string[] | null[];
  targetContentTypeIdentifiers?: string[];
  [key: string]: unknown;
};

export interface BundleField {
  id: string | null;
  identifier: string;
  name: string;
  type: FieldType;
  required: boolean;
  order: number;
  options: BundleFieldOptions | null;
}

export interface BundleContentType {
  id: string | null;
  identifier: string;
  name: string;
  description: string | null;
  fields: BundleField[];
}

export interface BundleEntry {
  id: string | null;
  contentTypeId: string | null;
  contentTypeIdentifier: string;
  entryTitle: string;
  slug: string | null;
  status: ContentStatus;
  publishedAt: string | null;
  data: Record<string, unknown>;
}

export interface Bundle {
  version: number;
  exportedAt: string;
  portable: boolean;
  contentTypes?: BundleContentType[];
  entries?: BundleEntry[];
}

export type BundleMode = 'schema' | 'entries' | 'all';

export interface ValidationError {
  path: string;
  message: string;
}

export type ConflictErrorKind =
  | 'contentType.identifier'
  | 'contentType.id'
  | 'field.id'
  | 'entry.id'
  | 'entry.slug'
  | 'entry.entryTitle';

export interface ConflictError {
  kind: ConflictErrorKind;
  identifier: string;
  existingId?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

export interface ImportResult {
  contentTypesCreated: number;
  entriesCreated: number;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/content-bundle/types.ts
git commit -m "feat(content-bundle): add shared bundle type definitions"
```

---

### Task 5: Implement bundle shape validation (`validate.ts`)

**Files:**

- Create: `scripts/content-bundle/validate.ts`
- Test: `scripts/content-bundle/validate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `scripts/content-bundle/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateBundle } from './validate';
import type { Bundle } from './types';

const validBundle: Bundle = {
  version: 1,
  exportedAt: '2026-04-14T10:00:00.000Z',
  portable: false,
  contentTypes: [
    {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      identifier: 'BlogPost',
      name: 'Blog Post',
      description: null,
      fields: [
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
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
  entries: [],
};

describe('validateBundle', () => {
  it('returns ok for a minimal valid bundle', () => {
    expect(validateBundle(validBundle)).toEqual({ ok: true, errors: [] });
  });

  it('rejects wrong version', () => {
    const result = validateBundle({ ...validBundle, version: 2 });
    expect(result.ok).toBe(false);
    expect(result.errors[0].path).toBe('version');
  });

  it('rejects missing ENTRY_TITLE field', () => {
    const result = validateBundle({
      ...validBundle,
      contentTypes: [
        {
          ...validBundle.contentTypes![0],
          fields: [
            {
              id: null,
              identifier: 'body',
              name: 'Body',
              type: 'TEXT',
              required: false,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toMatch(/ENTRY_TITLE/);
  });

  it('rejects SELECT field without choices', () => {
    const result = validateBundle({
      ...validBundle,
      contentTypes: [
        {
          ...validBundle.contentTypes![0],
          fields: [
            ...validBundle.contentTypes![0].fields,
            {
              id: null,
              identifier: 'status',
              name: 'Status',
              type: 'SELECT',
              required: false,
              order: 1,
              options: {},
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].path).toMatch(/contentTypes\[0\]\.fields\[1\]/);
  });

  it('rejects RELATION field missing targetContentTypeIds and identifiers', () => {
    const result = validateBundle({
      ...validBundle,
      contentTypes: [
        {
          ...validBundle.contentTypes![0],
          fields: [
            ...validBundle.contentTypes![0].fields,
            {
              id: null,
              identifier: 'author',
              name: 'Author',
              type: 'RELATION',
              required: false,
              order: 1,
              options: {},
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toMatch(/target/);
  });

  it('rejects portable bundle with missing entryTitle on entry', () => {
    const result = validateBundle({
      ...validBundle,
      portable: true,
      entries: [
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'BlogPost',
          entryTitle: '',
          slug: null,
          status: 'DRAFT',
          publishedAt: null,
          data: { title: 'x' },
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toMatch(/entryTitle/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run scripts/content-bundle/validate.test.ts`
Expected: Module-not-found or failing assertions.

- [ ] **Step 3: Implement `validate.ts`**

Create `scripts/content-bundle/validate.ts`:

```ts
import type {
  Bundle,
  BundleContentType,
  BundleEntry,
  BundleField,
  ValidationError,
  ValidationResult,
} from './types';
import { BUNDLE_VERSION } from './types';

const FIELD_TYPES = new Set([
  'ENTRY_TITLE',
  'SLUG',
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'BOOLEAN',
  'DATETIME',
  'SELECT',
  'RICHTEXT',
  'RELATION',
  'MULTIRELATION',
]);

const STATUSES = new Set(['DRAFT', 'PUBLISHED', 'CHANGED', 'ARCHIVED']);

export function validateBundle(bundle: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isObject(bundle)) {
    return {
      ok: false,
      errors: [{ path: '', message: 'bundle must be an object' }],
    };
  }

  const b = bundle as Partial<Bundle>;

  if (b.version !== BUNDLE_VERSION) {
    errors.push({
      path: 'version',
      message: `expected version ${BUNDLE_VERSION}, got ${b.version}`,
    });
  }

  if (typeof b.portable !== 'boolean') {
    errors.push({ path: 'portable', message: 'must be a boolean' });
  }

  if (b.contentTypes !== undefined) {
    if (!Array.isArray(b.contentTypes)) {
      errors.push({ path: 'contentTypes', message: 'must be an array' });
    } else {
      b.contentTypes.forEach((ct, i) =>
        validateContentType(ct, `contentTypes[${i}]`, errors)
      );
    }
  }

  if (b.entries !== undefined) {
    if (!Array.isArray(b.entries)) {
      errors.push({ path: 'entries', message: 'must be an array' });
    } else {
      b.entries.forEach((e, i) =>
        validateEntry(e, `entries[${i}]`, b.portable === true, errors)
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateContentType(
  ct: unknown,
  path: string,
  errors: ValidationError[]
): void {
  if (!isObject(ct)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }
  const c = ct as Partial<BundleContentType>;

  if (typeof c.identifier !== 'string' || !c.identifier) {
    errors.push({
      path: `${path}.identifier`,
      message: 'must be a non-empty string',
    });
  }
  if (typeof c.name !== 'string' || !c.name) {
    errors.push({
      path: `${path}.name`,
      message: 'must be a non-empty string',
    });
  }
  if (!Array.isArray(c.fields)) {
    errors.push({ path: `${path}.fields`, message: 'must be an array' });
    return;
  }

  const titleCount = c.fields.filter(
    (f) => isObject(f) && (f as BundleField).type === 'ENTRY_TITLE'
  ).length;
  if (titleCount !== 1) {
    errors.push({
      path: `${path}.fields`,
      message: `expected exactly one ENTRY_TITLE field, got ${titleCount}`,
    });
  }

  const slugCount = c.fields.filter(
    (f) => isObject(f) && (f as BundleField).type === 'SLUG'
  ).length;
  if (slugCount > 1) {
    errors.push({
      path: `${path}.fields`,
      message: `expected at most one SLUG field, got ${slugCount}`,
    });
  }

  c.fields.forEach((f, i) => validateField(f, `${path}.fields[${i}]`, errors));
}

function validateField(
  field: unknown,
  path: string,
  errors: ValidationError[]
): void {
  if (!isObject(field)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }
  const f = field as Partial<BundleField>;

  if (typeof f.identifier !== 'string' || !f.identifier) {
    errors.push({
      path: `${path}.identifier`,
      message: 'must be a non-empty string',
    });
  }
  if (typeof f.type !== 'string' || !FIELD_TYPES.has(f.type)) {
    errors.push({
      path: `${path}.type`,
      message: `must be one of ${Array.from(FIELD_TYPES).join(', ')}`,
    });
    return;
  }

  if (f.type === 'SELECT') {
    const choices = (f.options as { choices?: string[] } | null)?.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      errors.push({
        path: `${path}.options`,
        message: 'SELECT field requires a non-empty choices array',
      });
    }
  }

  if (f.type === 'RELATION' || f.type === 'MULTIRELATION') {
    const opts = f.options ?? {};
    const ids = (opts as { targetContentTypeIds?: unknown })
      .targetContentTypeIds;
    const idents = (opts as { targetContentTypeIdentifiers?: unknown })
      .targetContentTypeIdentifiers;
    const hasIds = Array.isArray(ids) && ids.length > 0;
    const hasIdents = Array.isArray(idents) && idents.length > 0;
    if (!hasIds && !hasIdents) {
      errors.push({
        path: `${path}.options`,
        message: `${f.type} field requires targetContentTypeIds or targetContentTypeIdentifiers`,
      });
    }
  }
}

function validateEntry(
  entry: unknown,
  path: string,
  portable: boolean,
  errors: ValidationError[]
): void {
  if (!isObject(entry)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }
  const e = entry as Partial<BundleEntry>;

  if (typeof e.contentTypeIdentifier !== 'string' || !e.contentTypeIdentifier) {
    errors.push({
      path: `${path}.contentTypeIdentifier`,
      message: 'must be a non-empty string',
    });
  }
  if (typeof e.entryTitle !== 'string' || !e.entryTitle) {
    errors.push({
      path: `${path}.entryTitle`,
      message: 'must be a non-empty string',
    });
  }
  if (typeof e.status !== 'string' || !STATUSES.has(e.status)) {
    errors.push({
      path: `${path}.status`,
      message: `must be one of ${Array.from(STATUSES).join(', ')}`,
    });
  }
  if (!isObject(e.data)) {
    errors.push({ path: `${path}.data`, message: 'must be an object' });
  }

  if (portable && e.id !== null) {
    errors.push({
      path: `${path}.id`,
      message: 'portable bundle entries must have id=null',
    });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run scripts/content-bundle/validate.test.ts`
Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/content-bundle/validate.ts scripts/content-bundle/validate.test.ts
git commit -m "feat(content-bundle): add bundle shape validation"
```

---

### Task 6: Implement portable reference rewriting helpers

**Files:**

- Create: `scripts/content-bundle/portable.ts`
- Test: `scripts/content-bundle/portable.test.ts`

**Context:** Portable mode rewrites UUID-based references into identifier/slug keys on export, and back to UUIDs on import. Walkers are pure functions (no DB) so they're unit-testable.

- [ ] **Step 1: Write failing tests**

Create `scripts/content-bundle/portable.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  encodeRelationRef,
  decodeRelationRef,
  encodeDataRefs,
  decodeDataRefs,
} from './portable';

const typeIdToIdent = new Map([['aaa-uuid-ct', 'BlogPost']]);
const typeIdentToEntryKeys = new Map([
  [
    'BlogPost',
    new Map([['post-uuid-1', { slug: 'hello', entryTitle: 'Hello' }]]),
  ],
]);

const identToTypeId = new Map([['BlogPost', 'aaa-uuid-ct']]);
const typeIdentToKeyToEntry = new Map([
  [
    'BlogPost',
    new Map<string, string>([
      ['hello', 'post-uuid-1'],
      ['Hello', 'post-uuid-1'],
    ]),
  ],
]);

describe('encodeRelationRef', () => {
  it('rewrites a UUID ref to identifier + slug', () => {
    const ref = encodeRelationRef(
      { contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' },
      typeIdToIdent,
      typeIdentToEntryKeys
    );
    expect(ref).toEqual({
      contentTypeIdentifier: 'BlogPost',
      entryKey: 'hello',
    });
  });

  it('falls back to entryTitle when no slug is set', () => {
    const ref = encodeRelationRef(
      { contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' },
      typeIdToIdent,
      new Map([
        [
          'BlogPost',
          new Map([['post-uuid-1', { slug: null, entryTitle: 'Hello' }]]),
        ],
      ])
    );
    expect(ref.entryKey).toBe('Hello');
  });

  it('throws when ref cannot be resolved', () => {
    expect(() =>
      encodeRelationRef(
        { contentTypeId: 'missing', entryId: 'missing' },
        typeIdToIdent,
        typeIdentToEntryKeys
      )
    ).toThrow();
  });
});

describe('decodeRelationRef', () => {
  it('resolves identifier + slug back to UUIDs', () => {
    const ref = decodeRelationRef(
      { contentTypeIdentifier: 'BlogPost', entryKey: 'hello' },
      identToTypeId,
      typeIdentToKeyToEntry
    );
    expect(ref).toEqual({
      contentTypeId: 'aaa-uuid-ct',
      entryId: 'post-uuid-1',
    });
  });

  it('throws when identifier or key is not resolvable', () => {
    expect(() =>
      decodeRelationRef(
        { contentTypeIdentifier: 'BlogPost', entryKey: 'ghost' },
        identToTypeId,
        typeIdentToKeyToEntry
      )
    ).toThrow();
  });
});

describe('encodeDataRefs / decodeDataRefs round-trip', () => {
  it('walks and rewrites RELATION values inside data', () => {
    const data = {
      title: 'Post',
      author: { contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' },
      tags: [{ contentTypeId: 'aaa-uuid-ct', entryId: 'post-uuid-1' }],
    };
    const fieldTypes = {
      title: 'ENTRY_TITLE' as const,
      author: 'RELATION' as const,
      tags: 'MULTIRELATION' as const,
    };

    const encoded = encodeDataRefs(
      data,
      fieldTypes,
      typeIdToIdent,
      typeIdentToEntryKeys
    );
    expect(encoded.author).toEqual({
      contentTypeIdentifier: 'BlogPost',
      entryKey: 'hello',
    });
    expect((encoded.tags as unknown[])[0]).toEqual({
      contentTypeIdentifier: 'BlogPost',
      entryKey: 'hello',
    });

    const decoded = decodeDataRefs(
      encoded,
      fieldTypes,
      identToTypeId,
      typeIdentToKeyToEntry
    );
    expect(decoded).toEqual(data);
  });

  it('rewrites cmsEmbed nodes inside RICHTEXT data', () => {
    const data = {
      body: {
        type: 'doc',
        content: [
          {
            type: 'cmsEmbed',
            attrs: {
              embedType: 'aaa-uuid-ct',
              embedId: 'post-uuid-1',
            },
          },
        ],
      },
    };
    const fieldTypes = { body: 'RICHTEXT' as const };

    const encoded = encodeDataRefs(
      data,
      fieldTypes,
      typeIdToIdent,
      typeIdentToEntryKeys
    );
    const embed = (
      encoded.body as { content: Array<{ attrs: Record<string, unknown> }> }
    ).content[0].attrs;
    expect(embed).toMatchObject({
      embedType: 'BlogPost',
      embedKey: 'hello',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run scripts/content-bundle/portable.test.ts`
Expected: Module not found.

- [ ] **Step 3: Implement `portable.ts`**

Create `scripts/content-bundle/portable.ts`:

```ts
import type { FieldType } from '#prisma';

export interface UuidRelationRef {
  contentTypeId: string;
  entryId: string;
}

export interface PortableRelationRef {
  contentTypeIdentifier: string;
  entryKey: string;
}

export type EntryKeyMap = Map<
  string,
  { slug: string | null; entryTitle: string }
>;

export function encodeRelationRef(
  ref: UuidRelationRef,
  typeIdToIdentifier: Map<string, string>,
  typeIdentifierToEntryKeys: Map<string, EntryKeyMap>
): PortableRelationRef {
  const identifier = typeIdToIdentifier.get(ref.contentTypeId);
  if (!identifier) {
    throw new Error(
      `Cannot encode relation ref: unknown contentTypeId ${ref.contentTypeId}`
    );
  }
  const entryMap = typeIdentifierToEntryKeys.get(identifier);
  const keys = entryMap?.get(ref.entryId);
  if (!keys) {
    throw new Error(
      `Cannot encode relation ref: entry ${ref.entryId} not found for ${identifier}`
    );
  }
  const entryKey = keys.slug ?? keys.entryTitle;
  if (!entryKey) {
    throw new Error(
      `Cannot encode relation ref: entry ${ref.entryId} has no slug or entryTitle`
    );
  }
  return { contentTypeIdentifier: identifier, entryKey };
}

export function decodeRelationRef(
  ref: PortableRelationRef,
  identifierToTypeId: Map<string, string>,
  typeIdentifierToKeyToEntry: Map<string, Map<string, string>>
): UuidRelationRef {
  const contentTypeId = identifierToTypeId.get(ref.contentTypeIdentifier);
  if (!contentTypeId) {
    throw new Error(
      `Cannot decode relation ref: unknown identifier ${ref.contentTypeIdentifier}`
    );
  }
  const keyMap = typeIdentifierToKeyToEntry.get(ref.contentTypeIdentifier);
  const entryId = keyMap?.get(ref.entryKey);
  if (!entryId) {
    throw new Error(
      `Cannot decode relation ref: entry ${ref.contentTypeIdentifier}:${ref.entryKey} not found`
    );
  }
  return { contentTypeId, entryId };
}

type FieldTypeMap = Record<string, FieldType>;

export function encodeDataRefs(
  data: Record<string, unknown>,
  fieldTypes: FieldTypeMap,
  typeIdToIdentifier: Map<string, string>,
  typeIdentifierToEntryKeys: Map<string, EntryKeyMap>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const type = fieldTypes[key];
    if (value === null || value === undefined) {
      out[key] = value;
      continue;
    }
    if (type === 'RELATION') {
      out[key] = encodeRelationRef(
        value as UuidRelationRef,
        typeIdToIdentifier,
        typeIdentifierToEntryKeys
      );
    } else if (type === 'MULTIRELATION') {
      out[key] = (value as UuidRelationRef[]).map((ref) =>
        encodeRelationRef(ref, typeIdToIdentifier, typeIdentifierToEntryKeys)
      );
    } else if (type === 'RICHTEXT') {
      out[key] = rewriteCmsEmbeds(value, (attrs) => {
        const ident = typeIdToIdentifier.get(attrs.embedType);
        if (!ident) return attrs;
        const entryMap = typeIdentifierToEntryKeys.get(ident);
        const keys = entryMap?.get(attrs.embedId);
        if (!keys) return attrs;
        const entryKey = keys.slug ?? keys.entryTitle;
        return { embedType: ident, embedKey: entryKey };
      });
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function decodeDataRefs(
  data: Record<string, unknown>,
  fieldTypes: FieldTypeMap,
  identifierToTypeId: Map<string, string>,
  typeIdentifierToKeyToEntry: Map<string, Map<string, string>>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const type = fieldTypes[key];
    if (value === null || value === undefined) {
      out[key] = value;
      continue;
    }
    if (type === 'RELATION') {
      out[key] = decodeRelationRef(
        value as PortableRelationRef,
        identifierToTypeId,
        typeIdentifierToKeyToEntry
      );
    } else if (type === 'MULTIRELATION') {
      out[key] = (value as PortableRelationRef[]).map((ref) =>
        decodeRelationRef(ref, identifierToTypeId, typeIdentifierToKeyToEntry)
      );
    } else if (type === 'RICHTEXT') {
      out[key] = rewriteCmsEmbeds(value, (attrs) => {
        const contentTypeId = identifierToTypeId.get(attrs.embedType);
        if (!contentTypeId) return attrs;
        const keyMap = typeIdentifierToKeyToEntry.get(attrs.embedType);
        const entryId = keyMap?.get(attrs.embedKey);
        if (!entryId) return attrs;
        return { embedType: contentTypeId, embedId: entryId };
      });
    } else {
      out[key] = value;
    }
  }
  return out;
}

function rewriteCmsEmbeds(
  doc: unknown,
  rewrite: (attrs: Record<string, string>) => Record<string, unknown>
): unknown {
  if (!doc || typeof doc !== 'object') return doc;
  if (Array.isArray(doc)) return doc.map((n) => rewriteCmsEmbeds(n, rewrite));
  const node = doc as Record<string, unknown>;
  if (node.type === 'cmsEmbed' && typeof node.attrs === 'object') {
    return { ...node, attrs: rewrite(node.attrs as Record<string, string>) };
  }
  const out: Record<string, unknown> = { ...node };
  if (Array.isArray(node.content)) {
    out.content = (node.content as unknown[]).map((n) =>
      rewriteCmsEmbeds(n, rewrite)
    );
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run scripts/content-bundle/portable.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/content-bundle/portable.ts scripts/content-bundle/portable.test.ts
git commit -m "feat(content-bundle): add portable reference rewriting helpers"
```

---

### Task 7: Implement `exportBundle`

**Files:**

- Create: `scripts/content-bundle/export.ts`
- Test: `scripts/content-bundle/export.test.ts`

**Context:** `exportBundle` is async, takes a `PrismaClient` and `{ mode, portable }`, queries the DB, and returns a `Bundle`. Pure function aside from DB reads. Test uses the test DB.

- [ ] **Step 1: Write failing integration test**

Create `scripts/content-bundle/export.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { exportBundle } from './export';

const url = 'postgresql://boject:boject@localhost:5432/boject_test';
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

describe('exportBundle', () => {
  beforeEach(async () => await reset());
  afterEach(async () => await reset());

  it('exports schema-only bundle with UUIDs in non-portable mode', async () => {
    const ct = await prisma.contentType.create({
      data: {
        identifier: 'BlogPost',
        name: 'Blog Post',
        fields: {
          create: {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
            order: 0,
          },
        },
      },
      include: { fields: true },
    });

    const bundle = await exportBundle(prisma, {
      mode: 'schema',
      portable: false,
    });

    expect(bundle.version).toBe(1);
    expect(bundle.portable).toBe(false);
    expect(bundle.contentTypes).toHaveLength(1);
    expect(bundle.contentTypes![0].id).toBe(ct.id);
    expect(bundle.contentTypes![0].fields[0].id).toBe(ct.fields[0].id);
    expect(bundle.entries).toBeUndefined();
  });

  it('strips UUIDs in portable mode', async () => {
    await prisma.contentType.create({
      data: {
        identifier: 'BlogPost',
        name: 'Blog Post',
        fields: {
          create: {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
            order: 0,
          },
        },
      },
    });

    const bundle = await exportBundle(prisma, {
      mode: 'schema',
      portable: true,
    });

    expect(bundle.portable).toBe(true);
    expect(bundle.contentTypes![0].id).toBeNull();
    expect(bundle.contentTypes![0].fields[0].id).toBeNull();
  });

  it('exports entries with all metadata in --all mode', async () => {
    const ct = await prisma.contentType.create({
      data: {
        identifier: 'BlogPost',
        name: 'Blog Post',
        fields: {
          create: {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
            order: 0,
          },
        },
      },
    });
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ct.id,
        data: { title: 'Hello' },
        entryTitle: 'Hello',
        slug: 'hello',
        status: 'PUBLISHED',
        publishedAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    });

    const bundle = await exportBundle(prisma, { mode: 'all', portable: false });

    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries![0]).toMatchObject({
      entryTitle: 'Hello',
      slug: 'hello',
      status: 'PUBLISHED',
      publishedAt: '2026-04-01T00:00:00.000Z',
    });
  });

  it('rewrites relation refs to identifier+slug in portable mode', async () => {
    const category = await prisma.contentType.create({
      data: {
        identifier: 'Category',
        name: 'Category',
        fields: {
          create: {
            identifier: 'name',
            name: 'Name',
            type: 'ENTRY_TITLE',
            required: true,
            order: 0,
          },
        },
      },
    });
    const categoryEntry = await prisma.contentEntry.create({
      data: {
        contentTypeId: category.id,
        data: { name: 'News' },
        entryTitle: 'News',
        slug: 'news',
        status: 'PUBLISHED',
      },
    });
    const blog = await prisma.contentType.create({
      data: {
        identifier: 'BlogPost',
        name: 'Blog Post',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
            },
            {
              identifier: 'category',
              name: 'Category',
              type: 'RELATION',
              required: false,
              order: 1,
              options: { targetContentTypeIds: [category.id] },
            },
          ],
        },
      },
    });
    await prisma.contentEntry.create({
      data: {
        contentTypeId: blog.id,
        data: {
          title: 'Hello',
          category: { contentTypeId: category.id, entryId: categoryEntry.id },
        },
        entryTitle: 'Hello',
        slug: 'hello',
        status: 'DRAFT',
      },
    });

    const bundle = await exportBundle(prisma, { mode: 'all', portable: true });

    const blogEntry = bundle.entries!.find(
      (e) => e.contentTypeIdentifier === 'BlogPost'
    )!;
    expect(blogEntry.data.category).toEqual({
      contentTypeIdentifier: 'Category',
      entryKey: 'news',
    });

    const blogType = bundle.contentTypes!.find(
      (c) => c.identifier === 'BlogPost'
    )!;
    const categoryField = blogType.fields.find(
      (f) => f.identifier === 'category'
    )!;
    expect(categoryField.options?.targetContentTypeIdentifiers).toEqual([
      'Category',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run scripts/content-bundle/export.test.ts`
Expected: Module not found.

- [ ] **Step 3: Implement `export.ts`**

Create `scripts/content-bundle/export.ts`:

```ts
import type { PrismaClient } from '#prisma';
import type {
  Bundle,
  BundleContentType,
  BundleEntry,
  BundleField,
  BundleMode,
} from './types';
import { BUNDLE_VERSION } from './types';
import { encodeDataRefs, type EntryKeyMap } from './portable';

export interface ExportOptions {
  mode: BundleMode;
  portable: boolean;
}

export async function exportBundle(
  prisma: PrismaClient,
  options: ExportOptions
): Promise<Bundle> {
  const { mode, portable } = options;

  const wantsSchema = mode === 'schema' || mode === 'all';
  const wantsEntries = mode === 'entries' || mode === 'all';

  const contentTypes = await prisma.contentType.findMany({
    include: { fields: { orderBy: { order: 'asc' } } },
    orderBy: { name: 'asc' },
  });

  const typeIdToIdentifier = new Map(
    contentTypes.map((c) => [c.id, c.identifier])
  );
  const identifierByTypeId = (id: string) => typeIdToIdentifier.get(id) ?? id;

  const allEntries = await prisma.contentEntry.findMany({
    orderBy: [{ contentTypeId: 'asc' }, { entryTitle: 'asc' }],
  });

  const entryKeysByType = new Map<string, EntryKeyMap>();
  for (const entry of allEntries) {
    const identifier = typeIdToIdentifier.get(entry.contentTypeId);
    if (!identifier) continue;
    let map = entryKeysByType.get(identifier);
    if (!map) {
      map = new Map();
      entryKeysByType.set(identifier, map);
    }
    map.set(entry.id, { slug: entry.slug, entryTitle: entry.entryTitle });
  }

  const bundle: Bundle = {
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    portable,
  };

  if (wantsSchema) {
    bundle.contentTypes = contentTypes.map((ct) => {
      const fields: BundleField[] = ct.fields.map((f) => {
        const opts = (f.options ?? null) as BundleField['options'];
        let outOpts = opts;
        if (portable && opts && Array.isArray(opts.targetContentTypeIds)) {
          const idents = opts.targetContentTypeIds.map((id) =>
            identifierByTypeId(id as string)
          );
          outOpts = {
            ...opts,
            targetContentTypeIds: opts.targetContentTypeIds.map(() => null),
            targetContentTypeIdentifiers: idents,
          };
        } else if (
          !portable &&
          opts &&
          Array.isArray(opts.targetContentTypeIds)
        ) {
          const idents = (opts.targetContentTypeIds as string[]).map(
            (id) => typeIdToIdentifier.get(id) ?? id
          );
          outOpts = { ...opts, targetContentTypeIdentifiers: idents };
        }

        return {
          id: portable ? null : f.id,
          identifier: f.identifier,
          name: f.name,
          type: f.type,
          required: f.required,
          order: f.order,
          options: outOpts,
        };
      });

      return {
        id: portable ? null : ct.id,
        identifier: ct.identifier,
        name: ct.name,
        description: ct.description ?? null,
        fields,
      } satisfies BundleContentType;
    });
  }

  if (wantsEntries) {
    const fieldTypesByContentTypeId = new Map<string, Record<string, string>>();
    for (const ct of contentTypes) {
      const map: Record<string, string> = {};
      for (const f of ct.fields) map[f.identifier] = f.type;
      fieldTypesByContentTypeId.set(ct.id, map);
    }

    bundle.entries = allEntries.map((entry) => {
      const identifier =
        typeIdToIdentifier.get(entry.contentTypeId) ?? entry.contentTypeId;
      const fieldTypes =
        fieldTypesByContentTypeId.get(entry.contentTypeId) ?? {};
      const rawData = entry.data as Record<string, unknown>;
      const data = portable
        ? encodeDataRefs(
            rawData,
            fieldTypes as Record<string, import('#prisma').FieldType>,
            typeIdToIdentifier,
            entryKeysByType
          )
        : rawData;

      return {
        id: portable ? null : entry.id,
        contentTypeId: portable ? null : entry.contentTypeId,
        contentTypeIdentifier: identifier,
        entryTitle: entry.entryTitle,
        slug: entry.slug,
        status: entry.status,
        publishedAt: entry.publishedAt ? entry.publishedAt.toISOString() : null,
        data,
      } satisfies BundleEntry;
    });
  }

  return bundle;
}
```

- [ ] **Step 4: Seed test DB and run test**

Run: `pnpm prisma:seed:test`
Expected: Seed completes.

Run: `pnpm test:run scripts/content-bundle/export.test.ts`
Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/content-bundle/export.ts scripts/content-bundle/export.test.ts
git commit -m "feat(content-bundle): implement exportBundle"
```

---

### Task 8: Implement `importBundle`

**Files:**

- Create: `scripts/content-bundle/import.ts`
- Test: `scripts/content-bundle/import.test.ts`

**Context:** `importBundle` runs inside a single `prisma.$transaction`. Steps: validate → conflict pre-flight → write content types → write entries (two-pass in portable mode). On failure, transaction rolls back.

- [ ] **Step 1: Write failing tests**

Create `scripts/content-bundle/import.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { importBundle } from './import';
import type { Bundle } from './types';

const url = 'postgresql://boject:boject@localhost:5432/boject_test';
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

const schemaOnly: Bundle = {
  version: 1,
  exportedAt: '2026-04-14T10:00:00.000Z',
  portable: true,
  contentTypes: [
    {
      id: null,
      identifier: 'BlogPost',
      name: 'Blog Post',
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
          identifier: 'body',
          name: 'Body',
          type: 'TEXTAREA',
          required: false,
          order: 1,
          options: null,
        },
      ],
    },
  ],
};

describe('importBundle', () => {
  beforeEach(async () => await reset());
  afterEach(async () => await reset());

  it('imports a portable schema-only bundle with fresh UUIDs', async () => {
    const result = await importBundle(prisma, schemaOnly, { mode: 'schema' });
    expect(result.contentTypesCreated).toBe(1);
    expect(result.entriesCreated).toBe(0);

    const stored = await prisma.contentType.findMany({
      include: { fields: true },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].identifier).toBe('BlogPost');
    expect(stored[0].fields).toHaveLength(2);
  });

  it('fails when importing a bundle with an identifier that already exists', async () => {
    await importBundle(prisma, schemaOnly, { mode: 'schema' });
    await expect(
      importBundle(prisma, schemaOnly, { mode: 'schema' })
    ).rejects.toThrow(/BlogPost/);
  });

  it('imports entries with portable refs via two-pass resolution', async () => {
    const withRelations: Bundle = {
      version: 1,
      exportedAt: '2026-04-14T10:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'Category',
          name: 'Category',
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
          identifier: 'BlogPost',
          name: 'Blog Post',
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
              type: 'RELATION',
              required: false,
              order: 1,
              options: {
                targetContentTypeIds: [null],
                targetContentTypeIdentifiers: ['Category'],
              },
            },
          ],
        },
      ],
      entries: [
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'Category',
          entryTitle: 'News',
          slug: 'news',
          status: 'PUBLISHED',
          publishedAt: null,
          data: { name: 'News' },
        },
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'BlogPost',
          entryTitle: 'Hello',
          slug: 'hello',
          status: 'DRAFT',
          publishedAt: null,
          data: {
            title: 'Hello',
            category: { contentTypeIdentifier: 'Category', entryKey: 'news' },
          },
        },
      ],
    };

    const result = await importBundle(prisma, withRelations, { mode: 'all' });
    expect(result.entriesCreated).toBe(2);

    const blog = await prisma.contentType.findUnique({
      where: { identifier: 'BlogPost' },
    });
    const category = await prisma.contentType.findUnique({
      where: { identifier: 'Category' },
    });
    const blogPost = await prisma.contentEntry.findFirst({
      where: { contentTypeId: blog!.id, slug: 'hello' },
    });
    const newsCategory = await prisma.contentEntry.findFirst({
      where: { contentTypeId: category!.id, slug: 'news' },
    });
    const data = blogPost!.data as Record<string, unknown>;
    expect(data.category).toEqual({
      contentTypeId: category!.id,
      entryId: newsCategory!.id,
    });
  });

  it('rolls back on failure mid-import', async () => {
    const badBundle: Bundle = {
      ...schemaOnly,
      contentTypes: [
        schemaOnly.contentTypes![0],
        {
          // identifier collides with itself — two types with same identifier
          ...schemaOnly.contentTypes![0],
        },
      ],
    };
    await expect(
      importBundle(prisma, badBundle, { mode: 'schema' })
    ).rejects.toThrow();
    const count = await prisma.contentType.count();
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run scripts/content-bundle/import.test.ts`
Expected: Module not found.

- [ ] **Step 3: Implement `import.ts`**

Create `scripts/content-bundle/import.ts`:

```ts
import type { PrismaClient, FieldType } from '#prisma';
import type { Bundle, BundleMode, ImportResult } from './types';
import { validateBundle } from './validate';
import { decodeDataRefs } from './portable';

export interface ImportOptions {
  mode: BundleMode;
  author?: string;
}

export async function importBundle(
  prisma: PrismaClient,
  bundle: Bundle,
  options: ImportOptions
): Promise<ImportResult> {
  const validation = validateBundle(bundle);
  if (!validation.ok) {
    throw new Error(
      `Bundle failed validation:\n${validation.errors
        .map((e) => `  ${e.path}: ${e.message}`)
        .join('\n')}`
    );
  }

  const { mode, author } = options;
  const wantsSchema = mode === 'schema' || mode === 'all';
  const wantsEntries = mode === 'entries' || mode === 'all';

  return prisma.$transaction(async (tx) => {
    let contentTypesCreated = 0;
    let entriesCreated = 0;

    const identifierToTypeId = new Map<string, string>();
    const typeIdentifierToKeyToEntry = new Map<string, Map<string, string>>();
    const fieldTypesByTypeId = new Map<string, Record<string, FieldType>>();

    const existingTypes = await tx.contentType.findMany({
      include: { fields: true },
    });
    for (const ct of existingTypes) {
      identifierToTypeId.set(ct.identifier, ct.id);
      const fieldTypes: Record<string, FieldType> = {};
      for (const f of ct.fields) fieldTypes[f.identifier] = f.type;
      fieldTypesByTypeId.set(ct.id, fieldTypes);
    }
    const existingEntries = await tx.contentEntry.findMany();
    for (const entry of existingEntries) {
      const ident = existingTypes.find(
        (t) => t.id === entry.contentTypeId
      )?.identifier;
      if (!ident) continue;
      let map = typeIdentifierToKeyToEntry.get(ident);
      if (!map) {
        map = new Map();
        typeIdentifierToKeyToEntry.set(ident, map);
      }
      if (entry.slug) map.set(entry.slug, entry.id);
      map.set(entry.entryTitle, entry.id);
    }

    if (wantsSchema && bundle.contentTypes) {
      for (const ct of bundle.contentTypes) {
        if (identifierToTypeId.has(ct.identifier)) {
          throw new Error(
            `ContentType identifier "${ct.identifier}" already exists on target`
          );
        }
      }

      for (const ct of bundle.contentTypes) {
        const created = await tx.contentType.create({
          data: {
            id: bundle.portable ? undefined : (ct.id ?? undefined),
            identifier: ct.identifier,
            name: ct.name,
            description: ct.description ?? undefined,
            fields: {
              create: ct.fields.map((f) => {
                let opts = f.options ?? null;
                if (
                  bundle.portable &&
                  opts &&
                  Array.isArray(opts.targetContentTypeIdentifiers)
                ) {
                  const ids = opts.targetContentTypeIdentifiers.map((ident) => {
                    const resolved = identifierToTypeId.get(ident);
                    if (!resolved) {
                      throw new Error(
                        `RELATION field "${f.identifier}" targets unknown content type "${ident}"`
                      );
                    }
                    return resolved;
                  });
                  const { targetContentTypeIdentifiers: _omit, ...rest } = opts;
                  opts = { ...rest, targetContentTypeIds: ids };
                }
                return {
                  id: bundle.portable ? undefined : (f.id ?? undefined),
                  identifier: f.identifier,
                  name: f.name,
                  type: f.type,
                  required: f.required,
                  order: f.order,
                  options: opts ?? undefined,
                };
              }),
            },
          },
          include: { fields: true },
        });
        contentTypesCreated++;
        identifierToTypeId.set(created.identifier, created.id);
        const fieldTypes: Record<string, FieldType> = {};
        for (const f of created.fields) fieldTypes[f.identifier] = f.type;
        fieldTypesByTypeId.set(created.id, fieldTypes);
      }
    }

    if (wantsEntries && bundle.entries) {
      for (const e of bundle.entries) {
        const typeId = identifierToTypeId.get(e.contentTypeIdentifier);
        if (!typeId) {
          throw new Error(
            `Entry "${e.entryTitle}" references unknown content type "${e.contentTypeIdentifier}"`
          );
        }
        const existing = await tx.contentEntry.findFirst({
          where: {
            contentTypeId: typeId,
            OR: [
              e.slug ? { slug: e.slug } : {},
              { entryTitle: e.entryTitle },
            ].filter((w) => Object.keys(w).length > 0),
          },
        });
        if (existing) {
          throw new Error(
            `Entry "${e.contentTypeIdentifier}:${e.slug ?? e.entryTitle}" already exists on target`
          );
        }
      }

      const pendingEntries: Array<{
        newId: string;
        bundleEntry: (typeof bundle.entries)[number];
      }> = [];

      for (const e of bundle.entries) {
        const typeId = identifierToTypeId.get(e.contentTypeIdentifier)!;
        const fieldTypes = fieldTypesByTypeId.get(typeId) ?? {};

        // Pass 1 data: in portable mode strip relation fields (resolved in pass 2).
        // We trust the bundle shape — validateBundle already ran. Relation refs
        // are resolved via in-memory maps in pass 2, so extra type checks here
        // add nothing.
        const pass1Data = bundle.portable
          ? stripRelationFields(e.data, fieldTypes)
          : (e.data as Record<string, unknown>);

        const created = await tx.contentEntry.create({
          data: {
            id: bundle.portable ? undefined : (e.id ?? undefined),
            contentTypeId: typeId,
            data: pass1Data as import('#prisma').Prisma.InputJsonValue,
            entryTitle: e.entryTitle,
            slug: e.slug,
            status: e.status,
            publishedAt: e.publishedAt ? new Date(e.publishedAt) : null,
            createdBy: author ?? null,
            updatedBy: author ?? null,
          },
        });

        entriesCreated++;
        let map = typeIdentifierToKeyToEntry.get(e.contentTypeIdentifier);
        if (!map) {
          map = new Map();
          typeIdentifierToKeyToEntry.set(e.contentTypeIdentifier, map);
        }
        if (e.slug) map.set(e.slug, created.id);
        map.set(e.entryTitle, created.id);

        pendingEntries.push({ newId: created.id, bundleEntry: e });
      }

      if (bundle.portable) {
        for (const { newId, bundleEntry } of pendingEntries) {
          const typeId = identifierToTypeId.get(
            bundleEntry.contentTypeIdentifier
          )!;
          const fieldTypes = fieldTypesByTypeId.get(typeId) ?? {};
          const resolvedData = decodeDataRefs(
            bundleEntry.data,
            fieldTypes,
            identifierToTypeId,
            typeIdentifierToKeyToEntry
          );
          await tx.contentEntry.update({
            where: { id: newId },
            data: {
              data: resolvedData as import('#prisma').Prisma.InputJsonValue,
            },
          });
        }
      }
    }

    return { contentTypesCreated, entriesCreated };
  });
}

function stripRelationFields(
  data: Record<string, unknown>,
  fieldTypes: Record<string, FieldType>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const type = fieldTypes[key];
    if (type === 'RELATION' || type === 'MULTIRELATION') {
      out[key] = null;
    } else {
      out[key] = value;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run scripts/content-bundle/import.test.ts`
Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/content-bundle/import.ts scripts/content-bundle/import.test.ts
git commit -m "feat(content-bundle): implement importBundle with portable two-pass"
```

---

### Task 9: Add fixture bundles

**Files:**

- Create: `scripts/content-bundle/fixtures/minimal.boject.json`
- Create: `scripts/content-bundle/fixtures/with-relations.boject.json`
- Create: `scripts/content-bundle/fixtures/with-richtext.boject.json`

- [ ] **Step 1: Create `minimal.boject.json`**

Create the file with:

```json
{
  "version": 1,
  "exportedAt": "2026-04-14T10:00:00.000Z",
  "portable": true,
  "contentTypes": [
    {
      "id": null,
      "identifier": "Page",
      "name": "Page",
      "description": null,
      "fields": [
        {
          "id": null,
          "identifier": "title",
          "name": "Title",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "slug",
          "name": "Slug",
          "type": "SLUG",
          "required": false,
          "order": 1,
          "options": null
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Create `with-relations.boject.json`**

Create the file with:

```json
{
  "version": 1,
  "exportedAt": "2026-04-14T10:00:00.000Z",
  "portable": true,
  "contentTypes": [
    {
      "id": null,
      "identifier": "Category",
      "name": "Category",
      "description": null,
      "fields": [
        {
          "id": null,
          "identifier": "name",
          "name": "Name",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        }
      ]
    },
    {
      "id": null,
      "identifier": "Post",
      "name": "Post",
      "description": null,
      "fields": [
        {
          "id": null,
          "identifier": "title",
          "name": "Title",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "category",
          "name": "Category",
          "type": "RELATION",
          "required": false,
          "order": 1,
          "options": {
            "targetContentTypeIds": [null],
            "targetContentTypeIdentifiers": ["Category"]
          }
        }
      ]
    }
  ],
  "entries": [
    {
      "id": null,
      "contentTypeId": null,
      "contentTypeIdentifier": "Category",
      "entryTitle": "News",
      "slug": "news",
      "status": "PUBLISHED",
      "publishedAt": null,
      "data": { "name": "News" }
    },
    {
      "id": null,
      "contentTypeId": null,
      "contentTypeIdentifier": "Post",
      "entryTitle": "Welcome",
      "slug": "welcome",
      "status": "DRAFT",
      "publishedAt": null,
      "data": {
        "title": "Welcome",
        "category": { "contentTypeIdentifier": "Category", "entryKey": "news" }
      }
    }
  ]
}
```

- [ ] **Step 3: Create `with-richtext.boject.json`**

Create the file with:

```json
{
  "version": 1,
  "exportedAt": "2026-04-14T10:00:00.000Z",
  "portable": true,
  "contentTypes": [
    {
      "id": null,
      "identifier": "Article",
      "name": "Article",
      "description": null,
      "fields": [
        {
          "id": null,
          "identifier": "title",
          "name": "Title",
          "type": "ENTRY_TITLE",
          "required": true,
          "order": 0,
          "options": null
        },
        {
          "id": null,
          "identifier": "body",
          "name": "Body",
          "type": "RICHTEXT",
          "required": false,
          "order": 1,
          "options": null
        }
      ]
    }
  ],
  "entries": [
    {
      "id": null,
      "contentTypeId": null,
      "contentTypeIdentifier": "Article",
      "entryTitle": "First Article",
      "slug": "first-article",
      "status": "PUBLISHED",
      "publishedAt": "2026-04-01T00:00:00.000Z",
      "data": {
        "title": "First Article",
        "body": {
          "type": "doc",
          "content": [
            {
              "type": "paragraph",
              "content": [{ "type": "text", "text": "Hello world" }]
            }
          ]
        }
      }
    }
  ]
}
```

- [ ] **Step 4: Validate fixtures pass shape check**

Add a small test file `scripts/content-bundle/fixtures/fixtures.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateBundle } from '../validate';

const here = new URL('.', import.meta.url).pathname;

describe('fixtures', () => {
  it.each(['minimal', 'with-relations', 'with-richtext'])(
    '%s.boject.json passes validateBundle',
    (name) => {
      const raw = readFileSync(join(here, `${name}.boject.json`), 'utf8');
      const bundle = JSON.parse(raw);
      expect(validateBundle(bundle)).toEqual({ ok: true, errors: [] });
    }
  );
});
```

Run: `pnpm test:run scripts/content-bundle/fixtures/fixtures.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/content-bundle/fixtures/
git commit -m "feat(content-bundle): add fixture bundles and shape regression test"
```

---

### Task 10: Add round-trip integration test

**Files:**

- Create: `scripts/content-bundle/roundtrip.test.ts`

**Context:** Export a seeded DB, wipe it, import the bundle back, then compare. Exercises both portable and non-portable modes in a realistic end-to-end flow.

- [ ] **Step 1: Write failing test**

Create `scripts/content-bundle/roundtrip.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { exportBundle } from './export';
import { importBundle } from './import';

const url = 'postgresql://boject:boject@localhost:5432/boject_test';
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

async function seed() {
  const category = await prisma.contentType.create({
    data: {
      identifier: 'Category',
      name: 'Category',
      fields: {
        create: {
          identifier: 'name',
          name: 'Name',
          type: 'ENTRY_TITLE',
          required: true,
          order: 0,
        },
      },
    },
  });
  const categoryEntry = await prisma.contentEntry.create({
    data: {
      contentTypeId: category.id,
      data: { name: 'News' },
      entryTitle: 'News',
      slug: 'news',
      status: 'PUBLISHED',
    },
  });
  const post = await prisma.contentType.create({
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
            order: 0,
          },
          {
            identifier: 'category',
            name: 'Category',
            type: 'RELATION',
            required: false,
            order: 1,
            options: { targetContentTypeIds: [category.id] },
          },
        ],
      },
    },
  });
  await prisma.contentEntry.create({
    data: {
      contentTypeId: post.id,
      data: {
        title: 'Welcome',
        category: { contentTypeId: category.id, entryId: categoryEntry.id },
      },
      entryTitle: 'Welcome',
      slug: 'welcome',
      status: 'DRAFT',
    },
  });
}

describe('export → import round-trip', () => {
  beforeEach(async () => await reset());
  afterEach(async () => await reset());

  it('preserves schema and entries in portable mode', async () => {
    await seed();
    const bundle = await exportBundle(prisma, { mode: 'all', portable: true });

    await reset();

    const result = await importBundle(prisma, bundle, { mode: 'all' });
    expect(result.contentTypesCreated).toBe(2);
    expect(result.entriesCreated).toBe(2);

    const post = await prisma.contentType.findUnique({
      where: { identifier: 'Post' },
    });
    const category = await prisma.contentType.findUnique({
      where: { identifier: 'Category' },
    });
    const welcome = await prisma.contentEntry.findFirst({
      where: { contentTypeId: post!.id, slug: 'welcome' },
    });
    const news = await prisma.contentEntry.findFirst({
      where: { contentTypeId: category!.id, slug: 'news' },
    });
    const data = welcome!.data as Record<string, unknown>;
    expect(data.category).toEqual({
      contentTypeId: category!.id,
      entryId: news!.id,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm test:run scripts/content-bundle/roundtrip.test.ts`
Expected: 1 test passes.

- [ ] **Step 3: Commit**

```bash
git add scripts/content-bundle/roundtrip.test.ts
git commit -m "test(content-bundle): export → import round-trip integration test"
```

---

### Task 11: Implement CLI entry point

**Files:**

- Create: `scripts/content-bundle/index.ts`
- Modify: `package.json`

**Context:** Thin CLI wrapper. Parses `process.argv`, instantiates Prisma, calls into module functions, writes/reads files, prints errors, exits with correct codes.

- [ ] **Step 1: Create the CLI entry**

Create `scripts/content-bundle/index.ts`:

```ts
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { exportBundle } from './export';
import { importBundle } from './import';
import { validateBundle } from './validate';
import type { BundleMode } from './types';

function parseMode(
  args: string[],
  hasDefault: BundleMode | null = 'schema'
): BundleMode {
  if (args.includes('--all')) return 'all';
  if (args.includes('--entries')) return 'entries';
  if (args.includes('--schema')) return 'schema';
  if (hasDefault) return hasDefault;
  throw new Error('Missing --schema, --entries, or --all');
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  try {
    if (command === 'export') {
      const mode = parseMode(args, 'schema');
      const portable = args.includes('--portable');
      const out =
        flagValue(args, '--out') ??
        `./content-bundle${mode === 'all' ? '' : `-${mode}`}.json`;

      const bundle = await exportBundle(prisma, { mode, portable });
      writeFileSync(resolve(out), JSON.stringify(bundle, null, 2));
      console.log(`Wrote bundle to ${out}`);
      process.exit(0);
    }

    if (command === 'import') {
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
      const author = flagValue(args, '--author');
      const result = await importBundle(prisma, bundle, { mode, author });
      console.log(
        `Imported ${result.contentTypesCreated} content type(s) and ${result.entriesCreated} entry/entries`
      );
      process.exit(0);
    }

    if (command === 'validate') {
      const path = args[0];
      if (!path) throw new Error('Usage: content-bundle validate <path>');
      const raw = readFileSync(resolve(path), 'utf8');
      const bundle = JSON.parse(raw);
      const result = validateBundle(bundle);
      if (result.ok) {
        console.log('Bundle is valid');
        process.exit(0);
      }
      console.error('Bundle failed validation:');
      for (const err of result.errors) {
        console.error(`  ${err.path}: ${err.message}`);
      }
      process.exit(1);
    }

    console.error('Unknown command. Expected: export | import | validate');
    process.exit(1);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
```

- [ ] **Step 2: Add pnpm scripts**

Modify `package.json`. Add these entries to the `"scripts"` object:

```json
"content:export": "tsx scripts/content-bundle/index.ts export",
"content:import": "tsx scripts/content-bundle/index.ts import",
"content:validate": "tsx scripts/content-bundle/index.ts validate"
```

- [ ] **Step 3: Smoke test `validate` against a fixture**

Run: `pnpm content:validate scripts/content-bundle/fixtures/minimal.boject.json`
Expected: `Bundle is valid`, exit 0.

- [ ] **Step 4: Smoke test `validate` against an invalid bundle**

Run: `echo '{"version": 2}' > /tmp/bad.json && pnpm content:validate /tmp/bad.json; echo "exit: $?"`
Expected: Errors printed, `exit: 1`.

- [ ] **Step 5: Smoke test `export` and `import` end-to-end**

Run: `pnpm content:export --all --portable --out /tmp/dump.json`
Expected: `Wrote bundle to /tmp/dump.json`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/content-bundle/index.ts package.json
git commit -m "feat(content-bundle): add CLI entry and pnpm scripts"
```

---

### Task 12: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: No errors.

- [ ] **Step 3: Format check**

Run: `pnpm format`
Expected: No files need formatting.

- [ ] **Step 4: Full test suite**

Run: `pnpm test:run`
Expected: All tests pass.

- [ ] **Step 5: Update CLAUDE.md**

Add entries under the appropriate sections of `CLAUDE.md` for:

- The new `entryTitle` column and `(contentTypeId, entryTitle)` unique constraint
- The `content-bundle` CLI commands and module structure
- The fixture bundles

Exact wording is up to the implementer — follow the existing file's style and section organization.

- [ ] **Step 6: Commit docs**

```bash
git add CLAUDE.md
git commit -m "docs: document entryTitle constraint and content-bundle CLI"
```

---

## Plan Complete

All tasks:

1. Add `entryTitle` column to `ContentEntry`
2. Sync `entryTitle` in content-entry endpoints
3. Update seed script
4. Scaffold module + shared types
5. Bundle shape validation
6. Portable reference rewriting helpers
7. `exportBundle`
8. `importBundle`
9. Fixture bundles
10. Round-trip integration test
11. CLI entry + pnpm scripts
12. Final verification + docs
