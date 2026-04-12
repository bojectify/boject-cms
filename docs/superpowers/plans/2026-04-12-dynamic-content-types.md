# Dynamic Content Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-defined content types with dynamic fields, stored via JSONB, so non-developers can create arbitrary content structures through the CMS.

**Architecture:** Three new Prisma models (ContentType, ContentTypeField, ContentEntry) with a JSONB `data` column on entries. REST API for CRUD on types, fields, and entries. Entry data validated at runtime against the type's field definitions. Existing rugby models remain unchanged.

**Tech Stack:** Prisma v7, Nuxt 4 (Nitro API routes), Vue 3, Nuxt UI, Vitest + @nuxt/test-utils

**Spec:** `docs/superpowers/specs/2026-04-12-dynamic-content-types-design.md`

---

## File Structure

### Prisma Schema

- Create: `prisma/schema/contentType.prisma` — ContentType + ContentTypeField models + FieldType enum
- Create: `prisma/schema/contentEntry.prisma` — ContentEntry model

### Server Utilities

- Create: `server/utils/validateEntryData.ts` — Validates entry `data` JSONB against ContentTypeField definitions

### API Routes — Content Types

- Create: `server/api/content-types.get.ts` — List content types
- Create: `server/api/content-types/index.post.ts` — Create content type with fields
- Create: `server/api/content-types/[id].get.ts` — Get content type with fields
- Create: `server/api/content-types/[id].put.ts` — Update content type
- Create: `server/api/content-types/[id].delete.ts` — Delete content type

### API Routes — Content Type Fields

- Create: `server/api/content-types/[id]/fields/index.post.ts` — Add field
- Create: `server/api/content-types/[id]/fields/[fieldId].put.ts` — Update field
- Create: `server/api/content-types/[id]/fields/[fieldId].delete.ts` — Delete field
- Create: `server/api/content-types/[id]/fields/reorder.put.ts` — Bulk reorder fields

### API Routes — Content Entries

- Create: `server/api/content-entries.get.ts` — List entries
- Create: `server/api/content-entries/index.post.ts` — Create entry
- Create: `server/api/content-entries/[id].get.ts` — Get entry
- Create: `server/api/content-entries/[id].put.ts` — Update entry
- Create: `server/api/content-entries/[id].delete.ts` — Delete entry

### Tests

- Create: `server/api/content-types/content-types.test.ts` — Content type + field API tests
- Create: `server/api/content-entries/content-entries.test.ts` — Content entry API tests

### Frontend

- Create: `pages/content-types/index.vue` — Content type listing
- Create: `pages/content-types/new.vue` — Create content type
- Create: `pages/content-types/[id].vue` — Edit content type
- Create: `pages/content-types/[id]/entries/index.vue` — Entry listing for a content type
- Create: `pages/content-types/[id]/entries/new.vue` — Create entry
- Create: `pages/content-types/[id]/entries/[entryId].vue` — Edit entry
- Create: `composables/useContentEntryEditor.ts` — Entry editor composable (adapts useContentEditor pattern for dynamic entries)
- Create: `server/utils/mapFieldsToConfig.ts` — Maps ContentTypeField[] → FieldConfig[] (shared between server-side validation and client)
- Modify: `layouts/default.vue` — Add "Content Types" section + dynamic links to sidebar
- Modify: `server/api/content.get.ts` — Include dynamic entries in UNION ALL query
- Modify: `prisma/seed.ts` — Add sample content type + entries

---

### Task 1: Prisma Schema — ContentType, ContentTypeField, ContentEntry

**Files:**

- Create: `prisma/schema/contentType.prisma`
- Create: `prisma/schema/contentEntry.prisma`

- [ ] **Step 1: Create the FieldType enum and ContentType + ContentTypeField models**

Create `prisma/schema/contentType.prisma`:

```prisma
enum FieldType {
  ENTRY_TITLE
  SLUG
  TEXT
  TEXTAREA
  NUMBER
  BOOLEAN
  DATETIME
  SELECT
}

model ContentType {
  id          String             @id @default(uuid())
  name        String             @unique
  description String?
  fields      ContentTypeField[]
  entries     ContentEntry[]
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt
}

model ContentTypeField {
  id            String      @id @default(uuid())
  contentType   ContentType @relation(fields: [contentTypeId], references: [id], onDelete: Cascade)
  contentTypeId String
  name          String
  label         String
  type          FieldType
  required      Boolean     @default(false)
  order         Int         @default(0)
  options       Json?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@unique([contentTypeId, name])
}
```

- [ ] **Step 2: Create the ContentEntry model**

Create `prisma/schema/contentEntry.prisma`:

```prisma
model ContentEntry {
  id            String        @id @default(uuid())
  contentType   ContentType   @relation(fields: [contentTypeId], references: [id])
  contentTypeId String
  data          Json
  slug          String?
  status        ContentStatus @default(DRAFT)
  publishedAt   DateTime?
  createdBy     String?
  updatedBy     String?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  @@unique([contentTypeId, slug])
}
```

- [ ] **Step 3: Generate the migration SQL**

Run:

```bash
pnpx prisma migrate diff --from-schema-datasource prisma/schema --to-schema prisma/schema --script
```

Create the migration directory and SQL file:

```bash
mkdir -p prisma/migrations/20260412120000_add_dynamic_content_types
```

Save the generated SQL to `prisma/migrations/20260412120000_add_dynamic_content_types/migration.sql`.

- [ ] **Step 4: Apply the migration and regenerate the client**

Run:

```bash
pnpx prisma migrate deploy && pnpm prisma:generate
```

Expected: Migration applied, Prisma client regenerated.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema/contentType.prisma prisma/schema/contentEntry.prisma prisma/migrations/20260412120000_add_dynamic_content_types/
git commit -m "feat: add ContentType, ContentTypeField, ContentEntry schema"
```

---

### Task 2: Entry Data Validation Utility

**Files:**

- Create: `server/utils/validateEntryData.ts`

- [ ] **Step 1: Write the validation utility**

Create `server/utils/validateEntryData.ts`:

```typescript
import { createError } from 'h3';
import type { FieldType } from '#prisma';

interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: unknown;
}

/**
 * Validate entry data against field definitions.
 * Returns the validated/cleaned data object.
 * Throws 400 on validation failure.
 */
export function validateEntryData(
  data: Record<string, unknown>,
  fields: FieldDef[]
): Record<string, unknown> {
  const validated: Record<string, unknown> = {};
  const fieldMap = new Map(fields.map((f) => [f.name, f]));

  for (const field of fields) {
    const value = data[field.name];
    const isEmpty = value === undefined || value === null || value === '';

    if (field.required && isEmpty) {
      throw createError({
        statusCode: 400,
        statusMessage: `${field.label} is required`,
      });
    }

    if (isEmpty) {
      validated[field.name] = null;
      continue;
    }

    switch (field.type) {
      case 'ENTRY_TITLE':
      case 'SLUG':
      case 'TEXT':
      case 'TEXTAREA':
        if (typeof value !== 'string') {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.label} must be a string`,
          });
        }
        validated[field.name] = value;
        break;

      case 'NUMBER':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.label} must be a number`,
          });
        }
        validated[field.name] = value;
        break;

      case 'BOOLEAN':
        if (typeof value !== 'boolean') {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.label} must be a boolean`,
          });
        }
        validated[field.name] = value;
        break;

      case 'DATETIME':
        if (typeof value !== 'string' || isNaN(Date.parse(value))) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.label} must be a valid ISO-8601 date string`,
          });
        }
        validated[field.name] = value;
        break;

      case 'SELECT': {
        if (typeof value !== 'string') {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.label} must be a string`,
          });
        }
        const opts = field.options as { choices?: string[] } | null;
        const choices = opts?.choices ?? [];
        if (choices.length > 0 && !choices.includes(value)) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.label} must be one of: ${choices.join(', ')}`,
          });
        }
        validated[field.name] = value;
        break;
      }

      default:
        validated[field.name] = value;
    }
  }

  // Strip unknown keys
  return validated;
}

/**
 * Extract slug value from validated data using field definitions.
 * Returns null if no SLUG field defined or value is empty.
 */
export function extractSlug(
  data: Record<string, unknown>,
  fields: FieldDef[]
): string | null {
  const slugField = fields.find((f) => f.type === 'SLUG');
  if (!slugField) return null;
  const val = data[slugField.name];
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

/**
 * Extract entryTitle value from validated data using field definitions.
 * Returns 'Untitled' if ENTRY_TITLE field value is empty.
 */
export function extractEntryTitle(
  data: Record<string, unknown>,
  fields: FieldDef[]
): string {
  const titleField = fields.find((f) => f.type === 'ENTRY_TITLE');
  if (!titleField) return 'Untitled';
  const val = data[titleField.name];
  return typeof val === 'string' && val.trim() ? val.trim() : 'Untitled';
}
```

- [ ] **Step 2: Commit**

```bash
git add server/utils/validateEntryData.ts
git commit -m "feat: add entry data validation utility"
```

---

### Task 3: Content Type API — List and Create

**Files:**

- Create: `server/api/content-types.get.ts`
- Create: `server/api/content-types/index.post.ts`
- Create: `server/api/content-types/content-types.test.ts`

- [ ] **Step 1: Write the test file with list and create tests**

Create `server/api/content-types/content-types.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { resetRateLimitStore } from '../../utils/rateLimit';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

let _sessionCookie: string | null = null;

async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@boject.com',
      password: 'password',
    }),
    headers: { 'Content-Type': 'application/json' },
  });
  const cookies = response.headers.getSetCookie();
  _sessionCookie = cookies.join('; ');
  return _sessionCookie;
}

type ContentTypeResponse = {
  id: string;
  name: string;
  description: string | null;
  fields: Array<{
    id: string;
    name: string;
    label: string;
    type: string;
    required: boolean;
    order: number;
    options: unknown;
  }>;
};

type ListResponse = {
  items: Array<{ id: string; name: string; [key: string]: unknown }>;
  total: number;
};

describe('Content Type endpoints', async () => {
  await setup({ dev: true });

  beforeEach(() => {
    resetRateLimitStore();
  });

  describe('POST /api/content-types', () => {
    it('creates a content type with fields', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Test Type ${Date.now()}`,
          description: 'A test content type',
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { name: 'body', label: 'Body', type: 'TEXTAREA' },
          ],
        },
      });
      expect(created.id).toBeDefined();
      expect(created.fields).toHaveLength(2);
      expect(created.fields[0]!.type).toBe('ENTRY_TITLE');
      expect(created.fields[0]!.order).toBe(0);
      expect(created.fields[1]!.order).toBe(1);
    });

    it('rejects missing ENTRY_TITLE field', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `No Title ${Date.now()}`,
          fields: [{ name: 'body', label: 'Body', type: 'TEXT' }],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects duplicate name', async () => {
      const cookie = await getSessionCookie();
      const name = `Dup Type ${Date.now()}`;
      await $fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        }),
      });
      expect(res.status).toBe(409);
    });

    it('rejects duplicate field names', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Dup Fields ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { name: 'title', label: 'Title 2', type: 'TEXT' },
          ],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid field name format', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Bad Name ${Date.now()}`,
          fields: [
            {
              name: 'Title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects more than one SLUG field', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Two Slugs ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { name: 'slug', label: 'Slug', type: 'SLUG' },
            { name: 'slug2', label: 'Slug 2', type: 'SLUG' },
          ],
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/content-types', () => {
    it('returns paginated content types', async () => {
      const { items, total } = await $fetch<ListResponse>(
        '/api/content-types',
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(total).toBeGreaterThanOrEqual(1);
      expect(items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/content-types/[id]', () => {
    it('returns content type with fields ordered by order', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Detail Type ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { name: 'summary', label: 'Summary', type: 'TEXT' },
            { name: 'count', label: 'Count', type: 'NUMBER' },
          ],
        },
      });
      const fetched = await $fetch<ContentTypeResponse>(
        `/api/content-types/${created.id}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(fetched.fields).toHaveLength(3);
      expect(fetched.fields[0]!.order).toBe(0);
      expect(fetched.fields[1]!.order).toBe(1);
      expect(fetched.fields[2]!.order).toBe(2);
    });

    it('returns 404 for unknown id', async () => {
      const res = await fetch(
        '/api/content-types/00000000-0000-0000-0000-000000000000',
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/content-types/[id]', () => {
    it('updates name and description', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Update Type ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });
      const updated = await $fetch<ContentTypeResponse>(
        `/api/content-types/${created.id}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: { name: `Updated ${Date.now()}`, description: 'Updated desc' },
        }
      );
      expect(updated.description).toBe('Updated desc');
    });
  });

  describe('DELETE /api/content-types/[id]', () => {
    it('deletes a content type with no entries', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Delete Type ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });
      const res = await fetch(`/api/content-types/${created.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      expect(res.status).toBe(200);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test --project integration -- server/api/content-types/content-types.test.ts`

Expected: FAIL — endpoints don't exist yet.

- [ ] **Step 3: Implement GET /api/content-types**

Create `server/api/content-types.get.ts`:

```typescript
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));

  const [items, total] = await Promise.all([
    prisma.contentType.findMany({
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        _count: { select: { fields: true, entries: true } },
      },
    }),
    prisma.contentType.count(),
  ]);

  return { items, total };
});
```

- [ ] **Step 4: Implement POST /api/content-types**

Create `server/api/content-types/index.post.ts`:

```typescript
import type { FieldType } from '#prisma';
import { assertStringLength } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

const FIELD_NAME_RE = /^[a-z][a-z0-9_]*$/;

const VALID_FIELD_TYPES = new Set<string>([
  'ENTRY_TITLE',
  'SLUG',
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'BOOLEAN',
  'DATETIME',
  'SELECT',
]);

const NAME_MAX = 200;

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-types.post');
  const body = await readBody<Record<string, unknown>>(event);

  const name = assertStringLength(body.name, 'name', NAME_MAX);
  const description =
    typeof body.description === 'string' ? body.description : null;

  if (!Array.isArray(body.fields) || body.fields.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'fields array is required and must not be empty',
    });
  }

  const fieldNames = new Set<string>();
  let entryTitleCount = 0;
  let slugCount = 0;

  const fieldsData = body.fields.map((raw: unknown, idx: number) => {
    if (typeof raw !== 'object' || raw === null) {
      throw createError({
        statusCode: 400,
        statusMessage: `fields[${idx}] must be an object`,
      });
    }
    const f = raw as Record<string, unknown>;

    const fieldName = assertStringLength(f.name, `fields[${idx}].name`, 100);
    if (!FIELD_NAME_RE.test(fieldName)) {
      throw createError({
        statusCode: 400,
        statusMessage: `fields[${idx}].name must match /^[a-z][a-z0-9_]*$/`,
      });
    }
    if (fieldNames.has(fieldName)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Duplicate field name: ${fieldName}`,
      });
    }
    fieldNames.add(fieldName);

    const label = assertStringLength(f.label, `fields[${idx}].label`, 200);

    if (typeof f.type !== 'string' || !VALID_FIELD_TYPES.has(f.type)) {
      throw createError({
        statusCode: 400,
        statusMessage: `fields[${idx}].type must be a valid FieldType`,
      });
    }
    const type = f.type as FieldType;

    if (type === 'ENTRY_TITLE') entryTitleCount++;
    if (type === 'SLUG') slugCount++;

    return {
      name: fieldName,
      label,
      type,
      required: typeof f.required === 'boolean' ? f.required : false,
      order: idx,
      options: f.options ?? undefined,
    };
  });

  if (entryTitleCount !== 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Exactly one ENTRY_TITLE field is required',
    });
  }

  if (slugCount > 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'At most one SLUG field is allowed',
    });
  }

  const created = await withPrismaErrors(
    () =>
      prisma.contentType.create({
        data: {
          name,
          description,
          fields: { create: fieldsData },
        },
        include: {
          fields: { orderBy: { order: 'asc' } },
        },
      }),
    { uniqueMessage: 'A content type with this name already exists' }
  );

  setResponseStatus(event, 201);
  return created;
});
```

- [ ] **Step 5: Implement GET /api/content-types/[id]**

Create `server/api/content-types/[id].get.ts`:

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const contentType = await prisma.contentType.findUnique({
    where: { id },
    include: {
      fields: { orderBy: { order: 'asc' } },
      _count: { select: { entries: true } },
    },
  });
  if (!contentType) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content type not found',
    });
  }
  return contentType;
});
```

- [ ] **Step 6: Implement PUT /api/content-types/[id]**

Create `server/api/content-types/[id].put.ts`:

```typescript
import type { Prisma } from '#prisma';
import { assertUuid, assertStringLength } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

const NAME_MAX = 200;

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-types.put');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.contentType.findUnique({ where: { id } });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content type not found',
    });
  }

  const data: Prisma.ContentTypeUpdateInput = {};
  if ('name' in body) {
    data.name = assertStringLength(body.name, 'name', NAME_MAX);
  }
  if ('description' in body) {
    data.description =
      typeof body.description === 'string' ? body.description : null;
  }

  return await withPrismaErrors(
    () =>
      prisma.contentType.update({
        where: { id },
        data,
        include: {
          fields: { orderBy: { order: 'asc' } },
          _count: { select: { entries: true } },
        },
      }),
    { uniqueMessage: 'A content type with this name already exists' }
  );
});
```

- [ ] **Step 7: Implement DELETE /api/content-types/[id]**

Create `server/api/content-types/[id].delete.ts`:

```typescript
import { assertUuid } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-types.delete');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const existing = await prisma.contentType.findUnique({
    where: { id },
    include: { _count: { select: { entries: true } } },
  });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content type not found',
    });
  }

  if (existing._count.entries > 0) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Cannot delete content type with existing entries. Delete all entries first.',
    });
  }

  await withPrismaErrors(() => prisma.contentType.delete({ where: { id } }), {
    notFoundMessage: 'Content type not found',
  });

  return { success: true };
});
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test --project integration -- server/api/content-types/content-types.test.ts`

Expected: All tests PASS.

- [ ] **Step 9: Commit**

```bash
git add server/api/content-types.get.ts server/api/content-types/ server/utils/validateEntryData.ts
git commit -m "feat: add content type CRUD API with tests"
```

---

### Task 4: Content Type Field API — Add, Update, Delete, Reorder

**Files:**

- Create: `server/api/content-types/[id]/fields/index.post.ts`
- Create: `server/api/content-types/[id]/fields/[fieldId].put.ts`
- Create: `server/api/content-types/[id]/fields/[fieldId].delete.ts`
- Create: `server/api/content-types/[id]/fields/reorder.put.ts`
- Modify: `server/api/content-types/content-types.test.ts` — Add field management tests

- [ ] **Step 1: Add field management tests**

Append to `server/api/content-types/content-types.test.ts`:

```typescript
describe('POST /api/content-types/[id]/fields', () => {
  it('adds a field with auto-incremented order', async () => {
    const cookie = await getSessionCookie();
    const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: `Field Add ${Date.now()}`,
        fields: [
          {
            name: 'title',
            label: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
        ],
      },
    });
    const field = await $fetch<{ id: string; order: number }>(
      `/api/content-types/${ct.id}/fields`,
      {
        method: 'POST',
        headers: { cookie },
        body: { name: 'summary', label: 'Summary', type: 'TEXT' },
      }
    );
    expect(field.order).toBe(1);
  });

  it('rejects adding a second ENTRY_TITLE', async () => {
    const cookie = await getSessionCookie();
    const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: `No Dup Title ${Date.now()}`,
        fields: [
          {
            name: 'title',
            label: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
        ],
      },
    });
    const res = await fetch(`/api/content-types/${ct.id}/fields`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'title2',
        label: 'Title 2',
        type: 'ENTRY_TITLE',
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/content-types/[id]/fields/[fieldId]', () => {
  it('updates field label and required', async () => {
    const cookie = await getSessionCookie();
    const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: `Field Update ${Date.now()}`,
        fields: [
          {
            name: 'title',
            label: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
          { name: 'desc', label: 'Description', type: 'TEXT' },
        ],
      },
    });
    const fieldId = ct.fields[1]!.id;
    const updated = await $fetch<{ label: string; required: boolean }>(
      `/api/content-types/${ct.id}/fields/${fieldId}`,
      {
        method: 'PUT',
        headers: { cookie },
        body: { label: 'Full Description', required: true },
      }
    );
    expect(updated.label).toBe('Full Description');
    expect(updated.required).toBe(true);
  });

  it('blocks type change when entries exist', async () => {
    const cookie = await getSessionCookie();
    const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: `Type Block ${Date.now()}`,
        fields: [
          {
            name: 'title',
            label: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
          { name: 'count', label: 'Count', type: 'NUMBER' },
        ],
      },
    });
    // Create an entry so field type change is blocked
    await $fetch('/api/content-entries', {
      method: 'POST',
      headers: { cookie },
      body: { contentTypeId: ct.id, data: { title: 'Test', count: 1 } },
    });
    const fieldId = ct.fields[1]!.id;
    const res = await fetch(`/api/content-types/${ct.id}/fields/${fieldId}`, {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'TEXT' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/content-types/[id]/fields/[fieldId]', () => {
  it('deletes a non-essential field', async () => {
    const cookie = await getSessionCookie();
    const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: `Field Del ${Date.now()}`,
        fields: [
          {
            name: 'title',
            label: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
          { name: 'extra', label: 'Extra', type: 'TEXT' },
        ],
      },
    });
    const res = await fetch(
      `/api/content-types/${ct.id}/fields/${ct.fields[1]!.id}`,
      { method: 'DELETE', headers: { cookie } }
    );
    expect(res.status).toBe(200);
  });

  it('blocks deleting the only ENTRY_TITLE field', async () => {
    const cookie = await getSessionCookie();
    const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: `No Del Title ${Date.now()}`,
        fields: [
          {
            name: 'title',
            label: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
        ],
      },
    });
    const res = await fetch(
      `/api/content-types/${ct.id}/fields/${ct.fields[0]!.id}`,
      { method: 'DELETE', headers: { cookie } }
    );
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/content-types/[id]/fields/reorder', () => {
  it('reorders fields', async () => {
    const cookie = await getSessionCookie();
    const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: `Reorder ${Date.now()}`,
        fields: [
          {
            name: 'title',
            label: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
          { name: 'a', label: 'A', type: 'TEXT' },
          { name: 'b', label: 'B', type: 'TEXT' },
        ],
      },
    });
    await $fetch(`/api/content-types/${ct.id}/fields/reorder`, {
      method: 'PUT',
      headers: { cookie },
      body: {
        fields: [
          { id: ct.fields[2]!.id, order: 0 },
          { id: ct.fields[0]!.id, order: 1 },
          { id: ct.fields[1]!.id, order: 2 },
        ],
      },
    });
    const fetched = await $fetch<ContentTypeResponse>(
      `/api/content-types/${ct.id}`,
      { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
    );
    expect(fetched.fields[0]!.name).toBe('b');
    expect(fetched.fields[1]!.name).toBe('title');
    expect(fetched.fields[2]!.name).toBe('a');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test --project integration -- server/api/content-types/content-types.test.ts`

Expected: New tests FAIL.

- [ ] **Step 3: Implement POST /api/content-types/[id]/fields**

Create `server/api/content-types/[id]/fields/index.post.ts`:

```typescript
import type { FieldType } from '#prisma';
import { assertUuid, assertStringLength } from '../../../../utils/validation';
import { withPrismaErrors } from '../../../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../../../utils/rateLimitEndpoint';

const FIELD_NAME_RE = /^[a-z][a-z0-9_]*$/;

const VALID_FIELD_TYPES = new Set<string>([
  'ENTRY_TITLE',
  'SLUG',
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'BOOLEAN',
  'DATETIME',
  'SELECT',
]);

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-type-fields.post');
  const contentTypeId = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const contentType = await prisma.contentType.findUnique({
    where: { id: contentTypeId },
    include: { fields: true },
  });
  if (!contentType) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content type not found',
    });
  }

  const name = assertStringLength(body.name, 'name', 100);
  if (!FIELD_NAME_RE.test(name)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Field name must match /^[a-z][a-z0-9_]*$/',
    });
  }

  const label = assertStringLength(body.label, 'label', 200);

  if (typeof body.type !== 'string' || !VALID_FIELD_TYPES.has(body.type)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'type must be a valid FieldType',
    });
  }
  const type = body.type as FieldType;

  if (
    type === 'ENTRY_TITLE' &&
    contentType.fields.some((f) => f.type === 'ENTRY_TITLE')
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content type already has an ENTRY_TITLE field',
    });
  }

  if (type === 'SLUG' && contentType.fields.some((f) => f.type === 'SLUG')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content type already has a SLUG field',
    });
  }

  const maxOrder = contentType.fields.reduce(
    (max, f) => Math.max(max, f.order),
    -1
  );

  const created = await withPrismaErrors(
    () =>
      prisma.contentTypeField.create({
        data: {
          contentTypeId,
          name,
          label,
          type,
          required: typeof body.required === 'boolean' ? body.required : false,
          order: maxOrder + 1,
          options: body.options ?? undefined,
        },
      }),
    {
      uniqueMessage: `A field named "${name}" already exists on this content type`,
    }
  );

  setResponseStatus(event, 201);
  return created;
});
```

- [ ] **Step 4: Implement PUT /api/content-types/[id]/fields/[fieldId]**

Create `server/api/content-types/[id]/fields/[fieldId].put.ts`:

```typescript
import type { FieldType } from '#prisma';
import { assertUuid, assertStringLength } from '../../../../utils/validation';
import { withPrismaErrors } from '../../../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../../../utils/rateLimitEndpoint';

const VALID_FIELD_TYPES = new Set<string>([
  'ENTRY_TITLE',
  'SLUG',
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'BOOLEAN',
  'DATETIME',
  'SELECT',
]);

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-type-fields.put');
  const contentTypeId = assertUuid(getRouterParam(event, 'id'), 'id');
  const fieldId = assertUuid(getRouterParam(event, 'fieldId'), 'fieldId');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.contentTypeField.findUnique({
    where: { id: fieldId },
  });
  if (!existing || existing.contentTypeId !== contentTypeId) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Field not found',
    });
  }

  const data: Record<string, unknown> = {};

  if ('label' in body) {
    data.label = assertStringLength(body.label, 'label', 200);
  }

  if ('required' in body) {
    if (typeof body.required !== 'boolean') {
      throw createError({
        statusCode: 400,
        statusMessage: 'required must be a boolean',
      });
    }
    data.required = body.required;
  }

  if ('options' in body) {
    data.options = body.options;
  }

  if ('type' in body) {
    if (typeof body.type !== 'string' || !VALID_FIELD_TYPES.has(body.type)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'type must be a valid FieldType',
      });
    }
    // Block type change if entries exist
    const entryCount = await prisma.contentEntry.count({
      where: { contentTypeId },
    });
    if (entryCount > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Cannot change field type when entries exist',
      });
    }
    data.type = body.type as FieldType;
  }

  return await withPrismaErrors(
    () =>
      prisma.contentTypeField.update({
        where: { id: fieldId },
        data,
      }),
    {
      uniqueMessage:
        'A field with this name already exists on this content type',
    }
  );
});
```

- [ ] **Step 5: Implement DELETE /api/content-types/[id]/fields/[fieldId]**

Create `server/api/content-types/[id]/fields/[fieldId].delete.ts`:

```typescript
import { assertUuid } from '../../../../utils/validation';
import { withPrismaErrors } from '../../../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../../../utils/rateLimitEndpoint';

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-type-fields.delete');
  const contentTypeId = assertUuid(getRouterParam(event, 'id'), 'id');
  const fieldId = assertUuid(getRouterParam(event, 'fieldId'), 'fieldId');

  const existing = await prisma.contentTypeField.findUnique({
    where: { id: fieldId },
  });
  if (!existing || existing.contentTypeId !== contentTypeId) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Field not found',
    });
  }

  // Don't allow deleting the only ENTRY_TITLE field
  if (existing.type === 'ENTRY_TITLE') {
    const titleCount = await prisma.contentTypeField.count({
      where: { contentTypeId, type: 'ENTRY_TITLE' },
    });
    if (titleCount <= 1) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Cannot delete the only ENTRY_TITLE field',
      });
    }
  }

  await withPrismaErrors(
    () => prisma.contentTypeField.delete({ where: { id: fieldId } }),
    { notFoundMessage: 'Field not found' }
  );

  return { success: true };
});
```

- [ ] **Step 6: Implement PUT /api/content-types/[id]/fields/reorder**

Create `server/api/content-types/[id]/fields/reorder.put.ts`:

```typescript
import { assertUuid, assertNonNegativeInt } from '../../../../utils/validation';
import { withPrismaErrors } from '../../../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../../../utils/rateLimitEndpoint';

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-type-fields.reorder');
  const contentTypeId = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<{ fields?: unknown }>(event);

  if (!Array.isArray(body.fields)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'fields array is required',
    });
  }

  const validated = body.fields.map((raw: unknown, idx: number) => {
    if (typeof raw !== 'object' || raw === null) {
      throw createError({
        statusCode: 400,
        statusMessage: `fields[${idx}] must be an object`,
      });
    }
    const item = raw as Record<string, unknown>;
    return {
      id: assertUuid(item.id, `fields[${idx}].id`),
      order: assertNonNegativeInt(item.order, `fields[${idx}].order`),
    };
  });

  // Verify all fields belong to this content type
  const ids = validated.map((f) => f.id);
  const existing = await prisma.contentTypeField.findMany({
    where: { id: { in: ids }, contentTypeId },
    select: { id: true },
  });
  if (existing.length !== ids.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'One or more fields do not belong to this content type',
    });
  }

  const updated = await withPrismaErrors(() =>
    prisma.$transaction(
      validated.map((item) =>
        prisma.contentTypeField.update({
          where: { id: item.id },
          data: { order: item.order },
        })
      )
    )
  );

  return updated;
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test --project integration -- server/api/content-types/content-types.test.ts`

Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add server/api/content-types/
git commit -m "feat: add content type field management API (add, update, delete, reorder)"
```

---

### Task 5: Content Entry API — CRUD

**Files:**

- Create: `server/api/content-entries.get.ts`
- Create: `server/api/content-entries/index.post.ts`
- Create: `server/api/content-entries/[id].get.ts`
- Create: `server/api/content-entries/[id].put.ts`
- Create: `server/api/content-entries/[id].delete.ts`
- Create: `server/api/content-entries/content-entries.test.ts`

- [ ] **Step 1: Write the test file**

Create `server/api/content-entries/content-entries.test.ts`:

```typescript
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { resetRateLimitStore } from '../../utils/rateLimit';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

let _sessionCookie: string | null = null;

async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@boject.com',
      password: 'password',
    }),
    headers: { 'Content-Type': 'application/json' },
  });
  const cookies = response.headers.getSetCookie();
  _sessionCookie = cookies.join('; ');
  return _sessionCookie;
}

type ContentType = {
  id: string;
  fields: Array<{ id: string; name: string; type: string }>;
};

type EntryResponse = {
  id: string;
  contentTypeId: string;
  data: Record<string, unknown>;
  slug: string | null;
  status: string;
};

type ListResponse = {
  items: EntryResponse[];
  total: number;
};

let testContentType: ContentType;

describe('Content Entry endpoints', async () => {
  await setup({ dev: true });

  beforeAll(async () => {
    const cookie = await getSessionCookie();
    testContentType = await $fetch<ContentType>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: `Entry Test Type ${Date.now()}`,
        fields: [
          {
            name: 'title',
            label: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
          { name: 'slug', label: 'Slug', type: 'SLUG' },
          { name: 'summary', label: 'Summary', type: 'TEXT' },
          { name: 'count', label: 'Count', type: 'NUMBER' },
          { name: 'featured', label: 'Featured', type: 'BOOLEAN' },
          { name: 'publish_date', label: 'Publish Date', type: 'DATETIME' },
          {
            name: 'category',
            label: 'Category',
            type: 'SELECT',
            options: { choices: ['news', 'blog', 'update'] },
          },
        ],
      },
    });
  });

  beforeEach(() => {
    resetRateLimitStore();
  });

  describe('POST /api/content-entries', () => {
    it('creates an entry with valid data', async () => {
      const cookie = await getSessionCookie();
      const entry = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: {
            title: 'My First Entry',
            slug: 'my-first-entry',
            summary: 'A summary',
            count: 42,
            featured: true,
            publish_date: '2026-01-01T00:00:00.000Z',
            category: 'news',
          },
        },
      });
      expect(entry.id).toBeDefined();
      expect(entry.data.title).toBe('My First Entry');
      expect(entry.slug).toBe('my-first-entry');
      expect(entry.status).toBe('DRAFT');
    });

    it('rejects missing required field', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { summary: 'No title' },
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid number field', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: 'Bad Count', count: 'not a number' },
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid select value', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: 'Bad Category', category: 'invalid' },
        }),
      });
      expect(res.status).toBe(400);
    });

    it('enforces slug uniqueness within content type', async () => {
      const cookie = await getSessionCookie();
      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: 'Slug Dup 1', slug: 'unique-slug-test' },
        },
      });
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: testContentType.id,
          data: { title: 'Slug Dup 2', slug: 'unique-slug-test' },
        }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('GET /api/content-entries', () => {
    it('lists entries for a content type', async () => {
      const { items, total } = await $fetch<ListResponse>(
        `/api/content-entries?contentTypeId=${testContentType.id}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(total).toBeGreaterThanOrEqual(1);
      expect(items[0]!.contentTypeId).toBe(testContentType.id);
    });

    it('requires contentTypeId', async () => {
      const res = await fetch('/api/content-entries', {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      expect(res.status).toBe(400);
    });

    it('filters by status', async () => {
      const { items } = await $fetch<ListResponse>(
        `/api/content-entries?contentTypeId=${testContentType.id}&status=PUBLISHED`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      for (const item of items) {
        expect(item.status).toBe('PUBLISHED');
      }
    });
  });

  describe('GET /api/content-entries/[id]', () => {
    it('returns entry with data', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: 'Detail Entry' },
        },
      });
      const entry = await $fetch<EntryResponse>(
        `/api/content-entries/${created.id}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(entry.data.title).toBe('Detail Entry');
    });

    it('returns 404 for unknown id', async () => {
      const res = await fetch(
        '/api/content-entries/00000000-0000-0000-0000-000000000000',
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/content-entries/[id]', () => {
    it('updates entry data and status', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: 'Update Me' },
        },
      });
      const updated = await $fetch<EntryResponse>(
        `/api/content-entries/${created.id}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: {
            data: { title: 'Updated Title', summary: 'New summary' },
            status: 'PUBLISHED',
          },
        }
      );
      expect(updated.data.title).toBe('Updated Title');
      expect(updated.status).toBe('PUBLISHED');
    });
  });

  describe('DELETE /api/content-entries/[id]', () => {
    it('deletes an entry', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<EntryResponse>('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: testContentType.id,
          data: { title: 'Delete Me' },
        },
      });
      const res = await fetch(`/api/content-entries/${created.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      expect(res.status).toBe(200);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test --project integration -- server/api/content-entries/content-entries.test.ts`

Expected: FAIL — endpoints don't exist yet.

- [ ] **Step 3: Implement GET /api/content-entries**

Create `server/api/content-entries.get.ts`:

```typescript
import type { ContentStatus, Prisma } from '#prisma';
import { assertUuid } from '../utils/validation';

const VALID_STATUSES = new Set<string>([
  'DRAFT',
  'PUBLISHED',
  'CHANGED',
  'ARCHIVED',
]);

export default defineEventHandler(async (event) => {
  const query = getQuery(event);

  if (!query.contentTypeId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'contentTypeId is required',
    });
  }
  const contentTypeId = assertUuid(query.contentTypeId, 'contentTypeId');

  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));

  const where: Prisma.ContentEntryWhereInput = { contentTypeId };

  if (typeof query.status === 'string' && VALID_STATUSES.has(query.status)) {
    where.status = query.status as ContentStatus;
  }

  const [items, total] = await Promise.all([
    prisma.contentEntry.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.contentEntry.count({ where }),
  ]);

  return { items, total };
});
```

- [ ] **Step 4: Implement POST /api/content-entries**

Create `server/api/content-entries/index.post.ts`:

```typescript
import { assertUuid } from '../../utils/validation';
import {
  validateEntryData,
  extractSlug,
  extractEntryTitle,
} from '../../utils/validateEntryData';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

const VALID_STATUSES = new Set<string>([
  'DRAFT',
  'PUBLISHED',
  'CHANGED',
  'ARCHIVED',
]);

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-entries.post');
  const body = await readBody<Record<string, unknown>>(event);

  const contentTypeId = assertUuid(body.contentTypeId, 'contentTypeId');

  const contentType = await prisma.contentType.findUnique({
    where: { id: contentTypeId },
    include: { fields: true },
  });
  if (!contentType) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content type not found',
    });
  }

  const rawData =
    typeof body.data === 'object' && body.data !== null
      ? (body.data as Record<string, unknown>)
      : {};

  const validatedData = validateEntryData(rawData, contentType.fields);
  const slug = extractSlug(validatedData, contentType.fields);

  let status = 'DRAFT';
  if (typeof body.status === 'string' && VALID_STATUSES.has(body.status)) {
    status = body.status;
  }

  const created = await withPrismaErrors(
    () =>
      prisma.contentEntry.create({
        data: {
          contentTypeId,
          data: validatedData,
          slug,
          status: status as 'DRAFT',
          publishedAt: status === 'PUBLISHED' ? new Date() : undefined,
        },
      }),
    {
      uniqueMessage:
        'An entry with this slug already exists for this content type',
    }
  );

  setResponseStatus(event, 201);
  return created;
});
```

- [ ] **Step 5: Implement GET /api/content-entries/[id]**

Create `server/api/content-entries/[id].get.ts`:

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: {
      contentType: {
        include: { fields: { orderBy: { order: 'asc' } } },
      },
    },
  });
  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }
  return entry;
});
```

- [ ] **Step 6: Implement PUT /api/content-entries/[id]**

Create `server/api/content-entries/[id].put.ts`:

```typescript
import { assertUuid } from '../../utils/validation';
import { validateEntryData, extractSlug } from '../../utils/validateEntryData';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

const VALID_STATUSES = new Set<string>([
  'DRAFT',
  'PUBLISHED',
  'CHANGED',
  'ARCHIVED',
]);

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-entries.put');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.contentEntry.findUnique({
    where: { id },
    include: {
      contentType: { include: { fields: true } },
    },
  });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  const data: Record<string, unknown> = {};

  if (typeof body.data === 'object' && body.data !== null) {
    const rawData = body.data as Record<string, unknown>;
    const validatedData = validateEntryData(
      rawData,
      existing.contentType.fields
    );
    data.data = validatedData;
    data.slug = extractSlug(validatedData, existing.contentType.fields);
  }

  if (typeof body.status === 'string' && VALID_STATUSES.has(body.status)) {
    data.status = body.status;
    if (body.status === 'PUBLISHED' && !existing.publishedAt) {
      data.publishedAt = new Date();
    }
  }

  return await withPrismaErrors(
    () =>
      prisma.contentEntry.update({
        where: { id },
        data,
      }),
    {
      uniqueMessage:
        'An entry with this slug already exists for this content type',
    }
  );
});
```

- [ ] **Step 7: Implement DELETE /api/content-entries/[id]**

Create `server/api/content-entries/[id].delete.ts`:

```typescript
import { assertUuid } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-entries.delete');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const existing = await prisma.contentEntry.findUnique({ where: { id } });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  await withPrismaErrors(() => prisma.contentEntry.delete({ where: { id } }), {
    notFoundMessage: 'Content entry not found',
  });

  return { success: true };
});
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test --project integration -- server/api/content-entries/content-entries.test.ts`

Expected: All tests PASS.

- [ ] **Step 9: Commit**

```bash
git add server/api/content-entries.get.ts server/api/content-entries/
git commit -m "feat: add content entry CRUD API with tests"
```

---

### Task 6: Extend Content UNION ALL Query

**Files:**

- Modify: `server/api/content.get.ts`

- [ ] **Step 1: Add dynamic entries to the UNION ALL query**

In `server/api/content.get.ts`, after the existing UNION ALL for static tables, add a subquery for `ContentEntry`. The dynamic entries need to extract the entry title from the JSONB `data` column using the `ENTRY_TITLE` field.

Replace the `unionSql` construction and the query with:

```typescript
// Static content tables
const staticUnion = tables
  .map(
    (t) =>
      `SELECT id, "entryTitle", status::text, "createdAt", "updatedAt", '${t}' AS "contentType" FROM "${t}"${statusWhere}`
  )
  .join(' UNION ALL ');

// Dynamic content entries — join with ContentType for the type name
// and ContentTypeField to find the ENTRY_TITLE field name, then extract from JSONB
const dynamicStatusWhere = status
  ? ` AND ce.status = '${status}'::"ContentStatus"`
  : '';
const dynamicContentTypeWhere = contentType
  ? ` AND ct.name = '${contentType}'`
  : '';

const dynamicUnion = `
    SELECT ce.id,
           COALESCE(ce.data ->> etf.name, 'Untitled') AS "entryTitle",
           ce.status::text,
           ce."createdAt",
           ce."updatedAt",
           ct.name AS "contentType"
    FROM "ContentEntry" ce
    JOIN "ContentType" ct ON ce."contentTypeId" = ct.id
    LEFT JOIN "ContentTypeField" etf ON etf."contentTypeId" = ct.id AND etf.type = 'ENTRY_TITLE'
    WHERE 1=1${dynamicStatusWhere}${dynamicContentTypeWhere}
  `;

const fullUnion =
  contentType && !tables.length
    ? dynamicUnion
    : tables.length
      ? `${staticUnion} UNION ALL ${dynamicUnion}`
      : dynamicUnion;
```

Also update the `CONTENT_TABLES` type check to allow dynamic content type names to be passed as `contentType` filter — when the value doesn't match a static table, only the dynamic query runs.

- [ ] **Step 2: Run existing content tests to verify no regressions**

Run: `pnpm test --project integration -- server/api/content/content.test.ts`

Expected: All existing tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/api/content.get.ts
git commit -m "feat: include dynamic content entries in UNION ALL content query"
```

---

### Task 7: Seed Data

**Files:**

- Modify: `prisma/seed.ts`

- [ ] **Step 1: Add sample content type and entries to the seed**

Append before the final `console.log('Seed complete')` in `prisma/seed.ts`:

```typescript
// --- Dynamic content types ---
const blogType = await prisma.contentType.upsert({
  where: { name: 'Blog Post' },
  update: {},
  create: {
    name: 'Blog Post',
    description: 'Blog articles with rich metadata',
    fields: {
      create: [
        {
          name: 'title',
          label: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
          order: 0,
        },
        { name: 'slug', label: 'Slug', type: 'SLUG', required: true, order: 1 },
        { name: 'summary', label: 'Summary', type: 'TEXTAREA', order: 2 },
        {
          name: 'publish_date',
          label: 'Publish Date',
          type: 'DATETIME',
          order: 3,
        },
        { name: 'featured', label: 'Featured', type: 'BOOLEAN', order: 4 },
        {
          name: 'category',
          label: 'Category',
          type: 'SELECT',
          order: 5,
          options: { choices: ['news', 'match-report', 'community'] },
        },
      ],
    },
  },
});

// Seed blog entries
await prisma.contentEntry.upsert({
  where: {
    contentTypeId_slug: {
      contentTypeId: blogType.id,
      slug: 'welcome-to-the-club',
    },
  },
  update: {},
  create: {
    contentTypeId: blogType.id,
    data: {
      title: 'Welcome to the Club',
      slug: 'welcome-to-the-club',
      summary: 'An introduction to our rugby club and what we stand for.',
      publish_date: '2026-01-15T10:00:00.000Z',
      featured: true,
      category: 'community',
    },
    slug: 'welcome-to-the-club',
    status: 'PUBLISHED',
    publishedAt: new Date('2026-01-15'),
  },
});

await prisma.contentEntry.upsert({
  where: {
    contentTypeId_slug: {
      contentTypeId: blogType.id,
      slug: 'season-opener-recap',
    },
  },
  update: {},
  create: {
    contentTypeId: blogType.id,
    data: {
      title: 'Season Opener Recap',
      slug: 'season-opener-recap',
      summary: 'A thrilling start to the 2026 season with a home win.',
      publish_date: '2026-02-01T18:00:00.000Z',
      featured: false,
      category: 'match-report',
    },
    slug: 'season-opener-recap',
    status: 'PUBLISHED',
    publishedAt: new Date('2026-02-01'),
  },
});
```

- [ ] **Step 2: Run the seed**

Run: `pnpm prisma:seed`

Expected: Seed completes without errors.

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat: seed sample Blog Post content type with entries"
```

---

### Task 8: UI — Content Type List Page

**Files:**

- Create: `pages/content-types/index.vue`
- Modify: `layouts/default.vue`

- [ ] **Step 1: Create the content type list page**

Create `pages/content-types/index.vue`:

```vue
<script setup lang="ts">
const page = ref(1);
const { data, status } = await useFetch('/api/content-types', {
  query: { page, perPage: 15 },
  watch: [page],
});

type ContentTypeItem = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  _count: { fields: number; entries: number };
};

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: '_count.fields', header: 'Fields' },
  { accessorKey: '_count.entries', header: 'Entries' },
  { accessorKey: 'updatedAt', header: 'Updated' },
];
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-bold">Content Types</h1>
      <UButton icon="i-lucide-plus" to="/content-types/new">
        New Content Type
      </UButton>
    </div>
    <UTable
      :data="data?.items ?? []"
      :columns="columns"
      :loading="status === 'pending'"
    >
      <template #name-cell="{ row }">
        <NuxtLink
          :to="`/content-types/${(row.original as ContentTypeItem).id}`"
          class="text-primary hover:underline"
        >
          {{ (row.original as ContentTypeItem).name }}
        </NuxtLink>
      </template>
      <template #updatedAt-cell="{ row }">
        {{
          new Date(
            (row.original as ContentTypeItem).updatedAt
          ).toLocaleDateString()
        }}
      </template>
    </UTable>
    <div
      v-if="data?.total"
      class="flex justify-center border-t border-default pt-4"
    >
      <UPagination
        :page="page"
        :total="data.total"
        :items-per-page="15"
        show-edges
        :sibling-count="1"
        size="lg"
        @update:page="page = $event"
      />
    </div>
  </div>
</template>
```

- [ ] **Step 2: Add Content Types link and dynamic entries to the sidebar**

Modify `layouts/default.vue` to fetch content types and build the sidebar dynamically. Change the `<script setup>` section:

Add after the existing `navItems` array:

```typescript
const { data: contentTypes } = await useFetch<{
  items: Array<{ id: string; name: string }>;
}>('/api/content-types', { query: { perPage: 50 } });

const dynamicNavItems = computed<NavigationMenuItem[]>(() => {
  const items: NavigationMenuItem[] = [
    {
      label: 'Content Types',
      icon: 'i-lucide-blocks',
      to: '/content-types',
    },
  ];
  for (const ct of contentTypes.value?.items ?? []) {
    items.push({
      label: ct.name,
      icon: 'i-lucide-file-text',
      to: `/content-types/${ct.id}/entries`,
    });
  }
  return items;
});
```

Update the template to render two `UNavigationMenu` sections — the existing static items and the dynamic content types with a separator between them:

```vue
<UNavigationMenu :items="navItems" orientation="vertical" />
<USeparator class="my-2" />
<UNavigationMenu :items="dynamicNavItems" orientation="vertical" />
```

- [ ] **Step 3: Verify the page renders**

Run `pnpm dev` and navigate to `http://localhost:4000/content-types`. The seeded "Blog Post" type should appear in the list and in the sidebar.

- [ ] **Step 4: Commit**

```bash
git add pages/content-types/index.vue layouts/default.vue
git commit -m "feat: add content type list page and sidebar navigation"
```

---

### Task 9: UI — Create / Edit Content Type with Field Builder

**Files:**

- Create: `pages/content-types/new.vue`
- Create: `pages/content-types/[id].vue`

- [ ] **Step 1: Create the new content type page**

Create `pages/content-types/new.vue`:

```vue
<script setup lang="ts">
const router = useRouter();
const toast = useToast();

const name = ref('');
const description = ref('');

type FieldDraft = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: { choices?: string[] } | null;
};

const fields = ref<FieldDraft[]>([
  {
    name: 'title',
    label: 'Title',
    type: 'ENTRY_TITLE',
    required: true,
    options: null,
  },
]);

const fieldTypes = [
  { label: 'Entry Title', value: 'ENTRY_TITLE' },
  { label: 'Slug', value: 'SLUG' },
  { label: 'Text', value: 'TEXT' },
  { label: 'Textarea', value: 'TEXTAREA' },
  { label: 'Number', value: 'NUMBER' },
  { label: 'Boolean', value: 'BOOLEAN' },
  { label: 'Date/Time', value: 'DATETIME' },
  { label: 'Select', value: 'SELECT' },
];

function addField() {
  fields.value.push({
    name: '',
    label: '',
    type: 'TEXT',
    required: false,
    options: null,
  });
}

function removeField(idx: number) {
  fields.value.splice(idx, 1);
}

function moveField(idx: number, direction: 'up' | 'down') {
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= fields.value.length) return;
  const temp = fields.value[idx]!;
  fields.value[idx] = fields.value[swapIdx]!;
  fields.value[swapIdx] = temp;
}

const isSaving = ref(false);

async function handleSave() {
  isSaving.value = true;
  try {
    const created = await $fetch<{ id: string }>('/api/content-types', {
      method: 'POST',
      body: {
        name: name.value,
        description: description.value || null,
        fields: fields.value,
      },
    });
    toast.add({
      title: 'Created',
      description: 'Content type created successfully.',
      color: 'success',
    });
    await router.push(`/content-types/${created.id}`);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to create content type.';
    toast.add({ title: 'Error', description: message, color: 'error' });
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div class="p-6 max-w-2xl">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">New Content Type</h1>
      <UButton :loading="isSaving" icon="i-lucide-save" @click="handleSave">
        Save
      </UButton>
    </div>

    <div class="space-y-6">
      <UFormField label="Name" required size="xl">
        <UInput v-model="name" placeholder="e.g. Blog Post" class="w-full" />
      </UFormField>

      <UFormField label="Description" size="xl">
        <UTextarea v-model="description" :rows="2" class="w-full" />
      </UFormField>

      <USeparator label="Fields" />

      <div class="space-y-4">
        <div
          v-for="(field, idx) in fields"
          :key="idx"
          class="border rounded-lg p-4 space-y-3"
        >
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-muted">
              Field {{ idx + 1 }}
            </span>
            <div class="flex gap-1">
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-chevron-up"
                :disabled="idx === 0"
                @click="moveField(idx, 'up')"
              />
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-chevron-down"
                :disabled="idx === fields.length - 1"
                @click="moveField(idx, 'down')"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                :disabled="fields.length <= 1"
                @click="removeField(idx)"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Machine Name" size="xl">
              <UInput
                v-model="field.name"
                placeholder="e.g. summary"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Label" size="xl">
              <UInput
                v-model="field.label"
                placeholder="e.g. Summary"
                class="w-full"
              />
            </UFormField>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Type" size="xl">
              <USelect
                v-model="field.type"
                :items="fieldTypes"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Required" size="xl">
              <USwitch v-model="field.required" />
            </UFormField>
          </div>

          <div v-if="field.type === 'SELECT'">
            <UFormField label="Choices (comma-separated)" size="xl">
              <UInput
                :model-value="field.options?.choices?.join(', ') ?? ''"
                placeholder="e.g. news, blog, update"
                class="w-full"
                @update:model-value="
                  field.options = {
                    choices: ($event as string)
                      .split(',')
                      .map((s: string) => s.trim())
                      .filter(Boolean),
                  }
                "
              />
            </UFormField>
          </div>
        </div>
      </div>

      <UButton variant="outline" icon="i-lucide-plus" @click="addField">
        Add Field
      </UButton>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Create the edit content type page**

Create `pages/content-types/[id].vue`:

```vue
<script setup lang="ts">
const route = useRoute();
const toast = useToast();
const id = route.params.id as string;

type FieldData = {
  id: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
  order: number;
  options: { choices?: string[] } | null;
};

type ContentTypeData = {
  id: string;
  name: string;
  description: string | null;
  fields: FieldData[];
  _count: { entries: number };
};

const { data: contentType, refresh } = await useFetch<ContentTypeData>(
  `/api/content-types/${id}`
);

const name = ref(contentType.value?.name ?? '');
const description = ref(contentType.value?.description ?? '');

watch(contentType, (val) => {
  if (val) {
    name.value = val.name;
    description.value = val.description ?? '';
  }
});

const isSaving = ref(false);

async function handleSave() {
  isSaving.value = true;
  try {
    await $fetch(`/api/content-types/${id}`, {
      method: 'PUT',
      body: { name: name.value, description: description.value || null },
    });
    await refresh();
    toast.add({
      title: 'Saved',
      description: 'Content type updated.',
      color: 'success',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to save.';
    toast.add({ title: 'Error', description: message, color: 'error' });
  } finally {
    isSaving.value = false;
  }
}

// Field management
const fieldTypes = [
  { label: 'Entry Title', value: 'ENTRY_TITLE' },
  { label: 'Slug', value: 'SLUG' },
  { label: 'Text', value: 'TEXT' },
  { label: 'Textarea', value: 'TEXTAREA' },
  { label: 'Number', value: 'NUMBER' },
  { label: 'Boolean', value: 'BOOLEAN' },
  { label: 'Date/Time', value: 'DATETIME' },
  { label: 'Select', value: 'SELECT' },
];

const newFieldName = ref('');
const newFieldLabel = ref('');
const newFieldType = ref('TEXT');
const newFieldRequired = ref(false);

async function addField() {
  try {
    await $fetch(`/api/content-types/${id}/fields`, {
      method: 'POST',
      body: {
        name: newFieldName.value,
        label: newFieldLabel.value,
        type: newFieldType.value,
        required: newFieldRequired.value,
      },
    });
    newFieldName.value = '';
    newFieldLabel.value = '';
    newFieldType.value = 'TEXT';
    newFieldRequired.value = false;
    await refresh();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to add field.';
    toast.add({ title: 'Error', description: message, color: 'error' });
  }
}

async function removeField(fieldId: string) {
  try {
    await $fetch(`/api/content-types/${id}/fields/${fieldId}`, {
      method: 'DELETE',
    });
    await refresh();
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Failed to delete field.';
    toast.add({ title: 'Error', description: message, color: 'error' });
  }
}

async function moveField(fieldId: string, direction: 'up' | 'down') {
  const fields = contentType.value?.fields ?? [];
  const idx = fields.findIndex((f) => f.id === fieldId);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= fields.length) return;

  const reordered = fields.map((f, i) => ({
    id: f.id,
    order:
      i === idx
        ? fields[swapIdx]!.order
        : i === swapIdx
          ? fields[idx]!.order
          : f.order,
  }));

  await $fetch(`/api/content-types/${id}/fields/reorder`, {
    method: 'PUT',
    body: { fields: reordered },
  });
  await refresh();
}
</script>

<template>
  <div class="p-6 max-w-2xl">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">
        {{ contentType?.name ?? 'Content Type' }}
      </h1>
      <div class="flex gap-2">
        <UButton
          variant="outline"
          icon="i-lucide-list"
          :to="`/content-types/${id}/entries`"
        >
          View Entries
        </UButton>
        <UButton :loading="isSaving" icon="i-lucide-save" @click="handleSave">
          Save
        </UButton>
      </div>
    </div>

    <div class="space-y-6">
      <UFormField label="Name" required size="xl">
        <UInput v-model="name" class="w-full" />
      </UFormField>

      <UFormField label="Description" size="xl">
        <UTextarea v-model="description" :rows="2" class="w-full" />
      </UFormField>

      <USeparator label="Fields" />

      <div class="space-y-2">
        <div
          v-for="field in contentType?.fields ?? []"
          :key="field.id"
          class="border rounded-lg p-3 flex items-center justify-between"
        >
          <div>
            <span class="font-medium">{{ field.label }}</span>
            <span class="text-sm text-muted ml-2">({{ field.name }})</span>
            <UBadge size="xs" variant="subtle" class="ml-2">
              {{ field.type }}
            </UBadge>
            <UBadge
              v-if="field.required"
              size="xs"
              variant="subtle"
              color="warning"
              class="ml-1"
            >
              required
            </UBadge>
          </div>
          <div class="flex gap-1">
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-chevron-up"
              @click="moveField(field.id, 'up')"
            />
            <UButton
              size="xs"
              variant="ghost"
              icon="i-lucide-chevron-down"
              @click="moveField(field.id, 'down')"
            />
            <UButton
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              @click="removeField(field.id)"
            />
          </div>
        </div>
      </div>

      <div class="border rounded-lg p-4 space-y-3 bg-muted/5">
        <p class="text-sm font-medium">Add Field</p>
        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Machine Name" size="xl">
            <UInput
              v-model="newFieldName"
              placeholder="e.g. summary"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Label" size="xl">
            <UInput
              v-model="newFieldLabel"
              placeholder="e.g. Summary"
              class="w-full"
            />
          </UFormField>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Type" size="xl">
            <USelect
              v-model="newFieldType"
              :items="fieldTypes"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <div class="flex items-end gap-3">
            <UFormField label="Required" size="xl">
              <USwitch v-model="newFieldRequired" />
            </UFormField>
            <UButton
              icon="i-lucide-plus"
              :disabled="!newFieldName || !newFieldLabel"
              @click="addField"
            >
              Add
            </UButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Verify pages render**

Run `pnpm dev`, navigate to `/content-types/new` and `/content-types/[id]`. Verify field builder works (add, remove, reorder).

- [ ] **Step 4: Commit**

```bash
git add pages/content-types/new.vue pages/content-types/[id].vue
git commit -m "feat: add content type create and edit pages with field builder"
```

---

### Task 10: UI — Entry List, Create, Edit Pages

**Files:**

- Create: `pages/content-types/[id]/entries/index.vue`
- Create: `pages/content-types/[id]/entries/new.vue`
- Create: `pages/content-types/[id]/entries/[entryId].vue`
- Create: `composables/useContentEntryEditor.ts`

- [ ] **Step 1: Create the entry editor composable**

Create `composables/useContentEntryEditor.ts`:

```typescript
export function useContentEntryEditor(contentTypeId: string, entryId: string) {
  const toast = useToast();
  const isNew = entryId === 'new';

  const {
    data: entry,
    status: loadingStatus,
    refresh,
  } = isNew
    ? { data: ref(null), status: ref('success'), refresh: async () => {} }
    : useFetch<Record<string, unknown>>(`/api/content-entries/${entryId}`);

  const formState = reactive<Record<string, unknown>>({});
  const isSaving = ref(false);
  const saveError = ref<string | null>(null);

  if (isNew) {
    Object.assign(formState, { status: 'DRAFT' });
  }

  watch(
    () => (entry as Ref<Record<string, unknown> | null>).value,
    (val) => {
      if (val) {
        const data = (val.data ?? {}) as Record<string, unknown>;
        Object.assign(formState, data);
        formState.status = val.status;
      }
    }
  );

  async function save(): Promise<string | void> {
    isSaving.value = true;
    saveError.value = null;
    try {
      const { status, ...data } = formState;
      if (isNew) {
        const created = await $fetch<{ id: string }>('/api/content-entries', {
          method: 'POST',
          body: { contentTypeId, data, status },
        });
        toast.add({
          title: 'Created',
          description: 'Entry created successfully.',
          color: 'success',
        });
        return created.id;
      } else {
        await $fetch(`/api/content-entries/${entryId}`, {
          method: 'PUT',
          body: { data, status },
        });
        await refresh();
        toast.add({
          title: 'Saved',
          description: 'Changes saved successfully.',
          color: 'success',
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save.';
      saveError.value = message;
      toast.add({ title: 'Error', description: message, color: 'error' });
    } finally {
      isSaving.value = false;
    }
  }

  function generateSlug(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  return {
    isNew,
    entry,
    formState,
    loadingStatus,
    isSaving,
    saveError,
    save,
    generateSlug,
  };
}
```

- [ ] **Step 2: Create the entry list page**

Create `pages/content-types/[id]/entries/index.vue`:

```vue
<script setup lang="ts">
const route = useRoute();
const contentTypeId = route.params.id as string;

type FieldData = { name: string; type: string };

const { data: contentType } = await useFetch<{
  name: string;
  fields: FieldData[];
}>(`/api/content-types/${contentTypeId}`);

const titleFieldName = computed(
  () =>
    contentType.value?.fields.find((f) => f.type === 'ENTRY_TITLE')?.name ??
    'title'
);

const page = ref(1);
const { data, status } = await useFetch('/api/content-entries', {
  query: { contentTypeId, page, perPage: 15 },
  watch: [page],
});

// Extract entryTitle from JSONB data using the ENTRY_TITLE field name
const items = computed(() => {
  return (data.value?.items ?? []).map((item: Record<string, unknown>) => {
    const entryData = (item.data ?? {}) as Record<string, unknown>;
    const title = entryData[titleFieldName.value];
    return {
      ...item,
      entryTitle:
        typeof title === 'string' && title.trim() ? title : 'Untitled',
    };
  });
});
</script>

<template>
  <ContentTable
    v-model:page="page"
    :title="contentType?.name ?? 'Entries'"
    :data="items"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => `/content-types/${contentTypeId}/entries/${row.id}`"
  >
    <template #actions>
      <UButton
        icon="i-lucide-plus"
        :to="`/content-types/${contentTypeId}/entries/new`"
      >
        New Entry
      </UButton>
    </template>
  </ContentTable>
</template>
```

- [ ] **Step 3: Create the new entry page**

Create `pages/content-types/[id]/entries/new.vue`:

```vue
<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const router = useRouter();
const contentTypeId = route.params.id as string;

type FieldData = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: { choices?: string[] } | null;
};

const { data: contentType } = await useFetch<{
  name: string;
  fields: FieldData[];
}>(`/api/content-types/${contentTypeId}`);

const fields = computed<FieldConfig[]>(() => {
  return (contentType.value?.fields ?? [])
    .filter((f) => f.type !== 'SLUG')
    .map((f) => {
      switch (f.type) {
        case 'ENTRY_TITLE':
        case 'TEXT':
          return {
            type: 'text' as const,
            key: f.name,
            label: f.label,
            required: f.required,
          };
        case 'TEXTAREA':
          return {
            type: 'textarea' as const,
            key: f.name,
            label: f.label,
            required: f.required,
          };
        case 'NUMBER':
          return {
            type: 'number' as const,
            key: f.name,
            label: f.label,
            required: f.required,
          };
        case 'BOOLEAN':
          return {
            type: 'boolean' as const,
            key: f.name,
            label: f.label,
          };
        case 'DATETIME':
          return {
            type: 'datetime' as const,
            key: f.name,
            label: f.label,
            required: f.required,
          };
        case 'SELECT':
          return {
            type: 'select' as const,
            key: f.name,
            label: f.label,
            required: f.required,
            options: (f.options?.choices ?? []).map((c) => ({
              label: c,
              value: c,
            })),
          };
        default:
          return {
            type: 'text' as const,
            key: f.name,
            label: f.label,
          };
      }
    });
});

const hasSlug = computed(() =>
  contentType.value?.fields.some((f) => f.type === 'SLUG')
);

const slugFieldName = computed(
  () => contentType.value?.fields.find((f) => f.type === 'SLUG')?.name ?? 'slug'
);

const { formState, isSaving, saveError, save, generateSlug } =
  useContentEntryEditor(contentTypeId, 'new');

const titleFieldName = computed(
  () =>
    contentType.value?.fields.find((f) => f.type === 'ENTRY_TITLE')?.name ??
    'title'
);

watch(
  () => formState[titleFieldName.value],
  (val) => {
    if (hasSlug.value && typeof val === 'string') {
      formState[slugFieldName.value] = generateSlug(val);
    }
  }
);

async function handleSave() {
  const newId = await save();
  if (newId) {
    await router.push(`/content-types/${contentTypeId}/entries/${newId}`);
  }
}
</script>

<template>
  <ContentEditor
    v-model:state="formState"
    :title="`New ${contentType?.name ?? 'Entry'}`"
    :fields="fields"
    :loading="false"
    :saving="isSaving"
    :error="saveError"
    :show-slug="hasSlug"
    :on-save="handleSave"
  />
</template>
```

Note: The slug field renders in the Publishing section of `ContentEditor` because `showSlug` is true. The slug value is stored under the slug field's machine name in `formState`, but `ContentEditor` binds to `state.slug`. We need to sync these — if the slug field's machine name is not literally `"slug"`, we'll need to alias it. For simplicity, the convention should be that the SLUG field machine name is `"slug"`. This is enforced by convention in the seed and UI, not at the API level.

- [ ] **Step 4: Create the edit entry page**

Create `pages/content-types/[id]/entries/[entryId].vue`:

```vue
<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const contentTypeId = route.params.id as string;
const entryId = route.params.entryId as string;

type FieldData = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options: { choices?: string[] } | null;
};

const { data: contentType } = await useFetch<{
  name: string;
  fields: FieldData[];
}>(`/api/content-types/${contentTypeId}`);

const fields = computed<FieldConfig[]>(() => {
  return (contentType.value?.fields ?? [])
    .filter((f) => f.type !== 'SLUG')
    .map((f) => {
      switch (f.type) {
        case 'ENTRY_TITLE':
        case 'TEXT':
          return {
            type: 'text' as const,
            key: f.name,
            label: f.label,
            required: f.required,
          };
        case 'TEXTAREA':
          return {
            type: 'textarea' as const,
            key: f.name,
            label: f.label,
            required: f.required,
          };
        case 'NUMBER':
          return {
            type: 'number' as const,
            key: f.name,
            label: f.label,
            required: f.required,
          };
        case 'BOOLEAN':
          return {
            type: 'boolean' as const,
            key: f.name,
            label: f.label,
          };
        case 'DATETIME':
          return {
            type: 'datetime' as const,
            key: f.name,
            label: f.label,
            required: f.required,
          };
        case 'SELECT':
          return {
            type: 'select' as const,
            key: f.name,
            label: f.label,
            required: f.required,
            options: (f.options?.choices ?? []).map((c) => ({
              label: c,
              value: c,
            })),
          };
        default:
          return {
            type: 'text' as const,
            key: f.name,
            label: f.label,
          };
      }
    });
});

const hasSlug = computed(() =>
  contentType.value?.fields.some((f) => f.type === 'SLUG')
);

const { formState, loadingStatus, isSaving, saveError, save } =
  useContentEntryEditor(contentTypeId, entryId);

async function handleSave() {
  await save();
}
</script>

<template>
  <ContentEditor
    v-model:state="formState"
    :title="
      typeof formState[
        contentType?.fields.find((f) => f.type === 'ENTRY_TITLE')?.name ??
          'title'
      ] === 'string'
        ? (formState[
            contentType?.fields.find((f) => f.type === 'ENTRY_TITLE')?.name ??
              'title'
          ] as string)
        : (contentType?.name ?? 'Entry')
    "
    :fields="fields"
    :loading="loadingStatus === 'pending'"
    :saving="isSaving"
    :error="saveError"
    :show-slug="hasSlug"
    :on-save="handleSave"
  />
</template>
```

- [ ] **Step 5: Verify pages render**

Run `pnpm dev`. Navigate to `/content-types/[id]/entries`, create a new entry, edit it. Verify all field types render correctly and save/load round-trips work.

- [ ] **Step 6: Commit**

```bash
git add composables/useContentEntryEditor.ts pages/content-types/
git commit -m "feat: add entry list, create, and edit pages with dynamic field rendering"
```

---

### Task 11: Final Integration — Run Full Test Suite

**Files:** None new — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`

Expected: All existing tests pass, all new tests pass.

- [ ] **Step 2: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`

Expected: No errors.

- [ ] **Step 3: Fix any issues found**

Address any lint, type, or test failures.

- [ ] **Step 4: Commit fixes if needed**

```bash
git add -A
git commit -m "fix: resolve lint/type/test issues for dynamic content types"
```
