# Relation Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `RELATION` and `MULTIRELATION` field types to the dynamic content type system — polymorphic relation fields that can target entries from multiple content types.

**Architecture:** Add enum values to Prisma, create a content type options endpoint, add validation for relation values in entry data (check target type is allowed + referenced entry exists), and add a target content type chips picker to the `#type-options` slot in both content type pages. Entry editor UI (picking actual entries) is out of scope — separate spec.

**Tech Stack:** Prisma (enum migration), Nuxt server routes (validation, options endpoint), Vue (chips UI in `#type-options` slot), Nuxt UI components (UBadge for chips, USelect for picker)

---

### Task 1: Database Migration

**Files:**

- Modify: `prisma/schema/contentType.prisma`
- Create: `prisma/migrations/20260413130000_add_relation_field_types/migration.sql`

- [ ] **Step 1: Add RELATION and MULTIRELATION to the FieldType enum**

In `prisma/schema/contentType.prisma`, update the enum:

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
  RICHTEXT
  RELATION
  MULTIRELATION
}
```

- [ ] **Step 2: Create the migration SQL**

Create `prisma/migrations/20260413130000_add_relation_field_types/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "FieldType" ADD VALUE 'RELATION';
ALTER TYPE "FieldType" ADD VALUE 'MULTIRELATION';
```

- [ ] **Step 3: Apply migration and regenerate client**

```bash
pnpx prisma migrate deploy
pnpm prisma:generate
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema/contentType.prisma prisma/migrations/20260413130000_add_relation_field_types/
git commit -m "feat: add RELATION and MULTIRELATION to FieldType enum"
```

---

### Task 2: Content Type Options Endpoint

**Files:**

- Create: `server/api/content-types/options.get.ts`

- [ ] **Step 1: Create the endpoint**

Create `server/api/content-types/options.get.ts`:

```typescript
export default defineEventHandler(async () => {
  const types = await prisma.contentType.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return types.map((t) => ({ label: t.name, value: t.id }));
});
```

- [ ] **Step 2: Commit**

```bash
git add server/api/content-types/options.get.ts
git commit -m "feat: add content type options endpoint"
```

---

### Task 3: Add RELATION/MULTIRELATION to VALID_FIELD_TYPES

**Files:**

- Modify: `server/api/content-types/index.post.ts:11-21`
- Modify: `server/api/content-types/[id]/fields/index.post.ts:10-20`
- Modify: `server/api/content-types/[id]/fields/[fieldId].put.ts:6-16`

- [ ] **Step 1: Add to all three VALID_FIELD_TYPES sets**

In each of the three files, add `'RELATION'` and `'MULTIRELATION'` to the `VALID_FIELD_TYPES` set. The updated set in each file should be:

```typescript
const VALID_FIELD_TYPES = new Set<string>([
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
```

- [ ] **Step 2: Add targetContentTypeIds validation to the field creation endpoint**

In `server/api/content-types/[id]/fields/index.post.ts`, after the type validation block (after line `const type = body.type as FieldType;`), add validation for relation options:

```typescript
// Validate targetContentTypeIds for relation fields
if (type === 'RELATION' || type === 'MULTIRELATION') {
  const opts = body.options as { targetContentTypeIds?: unknown } | null;
  if (
    !opts ||
    !Array.isArray(opts.targetContentTypeIds) ||
    opts.targetContentTypeIds.length === 0
  ) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'options.targetContentTypeIds is required for relation fields and must be a non-empty array',
    });
  }
  for (const targetId of opts.targetContentTypeIds) {
    if (!isUuid(targetId)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Invalid UUID in targetContentTypeIds: ${targetId}`,
      });
    }
  }
  const existingCount = await prisma.contentType.count({
    where: { id: { in: opts.targetContentTypeIds as string[] } },
  });
  if (existingCount !== (opts.targetContentTypeIds as string[]).length) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'One or more targetContentTypeIds do not reference existing content types',
    });
  }
}
```

Also add `isUuid` to the import from `../../../../utils/validation`:

```typescript
import {
  assertUuid,
  assertStringLength,
  assertFieldIdentifier,
  isUuid,
} from '../../../../utils/validation';
```

- [ ] **Step 3: Add the same validation to the content type creation endpoint**

In `server/api/content-types/index.post.ts`, inside the `fieldsData` map callback, after the type validation block (after `const type = f.type as FieldType;`), add:

```typescript
if (type === 'RELATION' || type === 'MULTIRELATION') {
  const opts = f.options as { targetContentTypeIds?: unknown } | null;
  if (
    !opts ||
    !Array.isArray(opts.targetContentTypeIds) ||
    opts.targetContentTypeIds.length === 0
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: `fields[${idx}].options.targetContentTypeIds is required for relation fields`,
    });
  }
  for (const targetId of opts.targetContentTypeIds) {
    if (!isUuid(targetId)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Invalid UUID in fields[${idx}].options.targetContentTypeIds`,
      });
    }
  }
}
```

Also add `isUuid` to the import:

```typescript
import {
  assertStringLength,
  assertIdentifier,
  assertFieldIdentifier,
  toPascalCase,
  isUuid,
} from '../../utils/validation';
```

Note: the content type creation endpoint cannot validate that targetContentTypeIds exist because the content type being created doesn't exist yet (so self-references would fail). Skip the existence check here — the field creation endpoint validates on subsequent adds.

- [ ] **Step 4: Commit**

```bash
git add server/api/content-types/index.post.ts server/api/content-types/\[id\]/fields/index.post.ts server/api/content-types/\[id\]/fields/\[fieldId\].put.ts
git commit -m "feat: add RELATION/MULTIRELATION to field endpoints with targetContentTypeIds validation"
```

---

### Task 4: Entry Data Validation

**Files:**

- Modify: `server/utils/validateEntryData.ts`

- [ ] **Step 1: Add RELATION and MULTIRELATION validation cases**

In `server/utils/validateEntryData.ts`, add `isUuid` to imports:

```typescript
import { isUuid } from './validation';
```

Change the function signature to `async` since we need to check entry existence:

```typescript
export async function validateEntryData(
```

Add two new cases before the `default` in the switch statement:

```typescript
      case 'RELATION': {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must be an object with contentTypeId and entryId`,
          });
        }
        const rel = value as Record<string, unknown>;
        if (!isUuid(rel.contentTypeId) || !isUuid(rel.entryId)) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must have valid contentTypeId and entryId UUIDs`,
          });
        }
        const opts = field.options as {
          targetContentTypeIds?: string[];
        } | null;
        const allowedTypes = opts?.targetContentTypeIds ?? [];
        if (
          allowedTypes.length > 0 &&
          !allowedTypes.includes(rel.contentTypeId as string)
        ) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} references a content type that is not allowed for this field`,
          });
        }
        const entryExists = await prisma.contentEntry.findFirst({
          where: {
            id: rel.entryId as string,
            contentTypeId: rel.contentTypeId as string,
          },
          select: { id: true },
        });
        if (!entryExists) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} references an entry that does not exist`,
          });
        }
        validated[field.identifier] = {
          contentTypeId: rel.contentTypeId,
          entryId: rel.entryId,
        };
        break;
      }

      case 'MULTIRELATION': {
        if (!Array.isArray(value)) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must be an array`,
          });
        }
        const opts = field.options as {
          targetContentTypeIds?: string[];
        } | null;
        const allowedTypes = opts?.targetContentTypeIds ?? [];
        const seenEntryIds = new Set<string>();
        const validatedRefs: Array<{
          contentTypeId: string;
          entryId: string;
        }> = [];

        for (const item of value) {
          if (
            typeof item !== 'object' ||
            item === null ||
            Array.isArray(item)
          ) {
            throw createError({
              statusCode: 400,
              statusMessage: `${field.name} items must be objects with contentTypeId and entryId`,
            });
          }
          const rel = item as Record<string, unknown>;
          if (!isUuid(rel.contentTypeId) || !isUuid(rel.entryId)) {
            throw createError({
              statusCode: 400,
              statusMessage: `${field.name} items must have valid contentTypeId and entryId UUIDs`,
            });
          }
          if (
            allowedTypes.length > 0 &&
            !allowedTypes.includes(rel.contentTypeId as string)
          ) {
            throw createError({
              statusCode: 400,
              statusMessage: `${field.name} references a content type that is not allowed for this field`,
            });
          }
          if (seenEntryIds.has(rel.entryId as string)) {
            throw createError({
              statusCode: 400,
              statusMessage: `${field.name} contains duplicate entry references`,
            });
          }
          seenEntryIds.add(rel.entryId as string);
          const entryExists = await prisma.contentEntry.findFirst({
            where: {
              id: rel.entryId as string,
              contentTypeId: rel.contentTypeId as string,
            },
            select: { id: true },
          });
          if (!entryExists) {
            throw createError({
              statusCode: 400,
              statusMessage: `${field.name} references an entry that does not exist`,
            });
          }
          validatedRefs.push({
            contentTypeId: rel.contentTypeId as string,
            entryId: rel.entryId as string,
          });
        }
        validated[field.identifier] = validatedRefs;
        break;
      }
```

- [ ] **Step 2: Update all callers to await validateEntryData**

The function is now async, so all callers need `await`. Search for `validateEntryData(` in:

- `server/api/content-entries/index.post.ts` — change `validateEntryData(` to `await validateEntryData(`
- `server/api/content-entries/[id].put.ts` — change `validateEntryData(` to `await validateEntryData(`

- [ ] **Step 3: Commit**

```bash
git add server/utils/validateEntryData.ts server/api/content-entries/index.post.ts server/api/content-entries/\[id\].put.ts
git commit -m "feat: add RELATION/MULTIRELATION entry data validation"
```

---

### Task 5: Field Type Dropdown Options

**Files:**

- Modify: `pages/content-types/[id].vue` — the `fieldTypeOptions` array
- Modify: `pages/content-types/new.vue` — the `fieldTypeOptions` array

- [ ] **Step 1: Add Relation and Multi Relation to both fieldTypeOptions arrays**

In both `pages/content-types/[id].vue` and `pages/content-types/new.vue`, add to the `fieldTypeOptions` array:

```typescript
const fieldTypeOptions = [
  { label: 'Entry Title', value: 'ENTRY_TITLE' },
  { label: 'Slug', value: 'SLUG' },
  { label: 'Text', value: 'TEXT' },
  { label: 'Textarea', value: 'TEXTAREA' },
  { label: 'Number', value: 'NUMBER' },
  { label: 'Boolean', value: 'BOOLEAN' },
  { label: 'Date/Time', value: 'DATETIME' },
  { label: 'Select', value: 'SELECT' },
  { label: 'Rich Text', value: 'RICHTEXT' },
  { label: 'Relation', value: 'RELATION' },
  { label: 'Multi Relation', value: 'MULTIRELATION' },
];
```

- [ ] **Step 2: Commit**

```bash
git add pages/content-types/\[id\].vue pages/content-types/new.vue
git commit -m "feat: add Relation and Multi Relation to field type dropdowns"
```

---

### Task 6: Target Content Types Picker in #type-options Slot

**Files:**

- Modify: `pages/content-types/[id].vue` — the `#type-options` template slot
- Modify: `pages/content-types/new.vue` — the `#type-options` template slot

Both pages need the same slot content added for RELATION/MULTIRELATION. The slot already handles SELECT with a choices input. We add a second condition for relation types.

- [ ] **Step 1: Update the #type-options slot in [id].vue**

In `pages/content-types/[id].vue`, add a script-level fetch for content type options and the slot content. First, add to the script section (after the `fieldTypeOptions` array):

```typescript
// Content type options for relation field target picker
const { data: contentTypeOptions } = useFetch<
  { label: string; value: string }[]
>('/api/content-types/options');
```

Then update the `#type-options` template slot to add the relation picker after the SELECT block. The full slot becomes:

```vue
<template #type-options="{ type, options, updateOptions }">
  <UFormField v-if="type === 'SELECT'" label="Choices (comma-separated)">
    <UInput
      :model-value="
              options && typeof options === 'object' && 'choices' in options
                ? (options as { choices: string[] }).choices.join(', ')
                : ''
            "
      placeholder="e.g. option_a, option_b, option_c"
      class="w-full"
      @update:model-value="
              (val: string) =>
                updateOptions({
                  choices: val
                    .split(',')
                    .map((c: string) => c.trim())
                    .filter(Boolean),
                })
            "
    />
  </UFormField>
  <UFormField
    v-else-if="type === 'RELATION' || type === 'MULTIRELATION'"
    label="Target Content Types"
    required
  >
    <div class="space-y-2">
      <div
        v-if="
                options &&
                typeof options === 'object' &&
                'targetContentTypeIds' in options &&
                ((options as { targetContentTypeIds: string[] })
                  .targetContentTypeIds?.length ?? 0) > 0
              "
        class="flex flex-wrap gap-2"
      >
        <UBadge
          v-for="targetId in (
                  options as { targetContentTypeIds: string[] }
                ).targetContentTypeIds"
          :key="targetId"
          size="md"
          variant="subtle"
          color="info"
          class="cursor-pointer"
          @click="
                  updateOptions({
                    targetContentTypeIds: (
                      options as { targetContentTypeIds: string[] }
                    ).targetContentTypeIds.filter(
                      (id: string) => id !== targetId
                    ),
                  })
                "
        >
          {{
            contentTypeOptions?.find((o) => o.value === targetId)?.label ??
            targetId
          }}
          <UIcon name="i-lucide-x" class="size-3 ml-1" />
        </UBadge>
      </div>
      <USelect
        :model-value="''"
        :items="
                (contentTypeOptions ?? []).filter(
                  (o) =>
                    !(
                      options &&
                      typeof options === 'object' &&
                      'targetContentTypeIds' in options &&
                      (
                        options as { targetContentTypeIds: string[] }
                      ).targetContentTypeIds.includes(o.value)
                    )
                )
              "
        value-key="value"
        placeholder="Add content type..."
        class="w-full"
        @update:model-value="
                (val: string) => {
                  if (!val) return;
                  const current =
                    options &&
                    typeof options === 'object' &&
                    'targetContentTypeIds' in options
                      ? (options as { targetContentTypeIds: string[] })
                          .targetContentTypeIds
                      : [];
                  updateOptions({
                    targetContentTypeIds: [...current, val],
                  });
                }
              "
      />
    </div>
  </UFormField>
</template>
```

- [ ] **Step 2: Update the #type-options slot in new.vue**

In `pages/content-types/new.vue`, add the same content type options fetch and the same slot content. The code is identical to step 1 — add the `useFetch` call to the script and update the `#type-options` slot template with the same markup.

- [ ] **Step 3: Verify lint and typecheck pass**

```bash
pnpm lint && pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add pages/content-types/\[id\].vue pages/content-types/new.vue
git commit -m "feat: add target content types picker to relation field type-options slot"
```

---

### Task 7: Integration Tests

**Files:**

- Modify: `server/api/content-types/content-types.test.ts`
- Modify: `server/api/content-entries/content-entries.test.ts`

- [ ] **Step 1: Add content type options endpoint test**

Add to `content-types.test.ts` (new describe block):

```typescript
describe('GET /api/content-types/options', () => {
  it('returns content types as label/value pairs', async () => {
    const cookie = await getSessionCookie();
    const options = await $fetch<{ label: string; value: string }[]>(
      '/api/content-types/options',
      { headers: { cookie } }
    );
    expect(Array.isArray(options)).toBe(true);
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]).toHaveProperty('label');
    expect(options[0]).toHaveProperty('value');
  });
});
```

- [ ] **Step 2: Add RELATION field creation tests**

Add to the field creation describe block in `content-types.test.ts`:

```typescript
it('creates a RELATION field with targetContentTypeIds', async () => {
  const cookie = await getSessionCookie();
  // Create a target content type first
  const target = await $fetch<ContentTypeResponse>('/api/content-types', {
    method: 'POST',
    headers: { cookie },
    body: {
      name: `Relation Target ${Date.now()}`,
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

  // Create a content type with a RELATION field
  const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
    method: 'POST',
    headers: { cookie },
    body: {
      name: `Has Relation ${Date.now()}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
        {
          identifier: 'relatedItem',
          name: 'Related Item',
          type: 'RELATION',
          options: { targetContentTypeIds: [target.id] },
        },
      ],
    },
  });

  const relField = ct.fields.find((f) => f.type === 'RELATION');
  expect(relField).toBeDefined();
  expect(
    (relField!.options as { targetContentTypeIds: string[] })
      .targetContentTypeIds
  ).toContain(target.id);
});

it('rejects RELATION field without targetContentTypeIds', async () => {
  const cookie = await getSessionCookie();
  const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
    method: 'POST',
    headers: { cookie },
    body: {
      name: `No Targets ${Date.now()}`,
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

  const res = await fetch(`/api/content-types/${ct.id}/fields`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'link',
      name: 'Link',
      type: 'RELATION',
    }),
  });
  expect(res.status).toBe(400);
});

it('rejects RELATION field with non-existent targetContentTypeId', async () => {
  const cookie = await getSessionCookie();
  const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
    method: 'POST',
    headers: { cookie },
    body: {
      name: `Bad Target ${Date.now()}`,
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

  const res = await fetch(`/api/content-types/${ct.id}/fields`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'link',
      name: 'Link',
      type: 'RELATION',
      options: {
        targetContentTypeIds: ['00000000-0000-0000-0000-000000000000'],
      },
    }),
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 3: Add RELATION/MULTIRELATION entry validation tests**

In `content-entries.test.ts`, the `beforeAll` creates a test content type. We need a second content type to use as the relation target and to create entries in it. Add these after the existing `beforeAll`:

```typescript
let relationContentType: ContentTypeResponse;
let targetEntry: EntryResponse;

beforeAll(async () => {
  const cookie = await getSessionCookie();

  // Create a target content type for relation tests
  const targetType = await $fetch<ContentTypeResponse>('/api/content-types', {
    method: 'POST',
    headers: { cookie },
    body: {
      name: `Relation Target ${Date.now()}`,
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

  // Create an entry in the target type
  const entryRes = await fetch('/api/content-entries', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentTypeId: targetType.id,
      data: { title: 'Target Entry' },
    }),
  });
  targetEntry = (await entryRes.json()) as EntryResponse;

  // Create a content type with RELATION and MULTIRELATION fields
  relationContentType = await $fetch<ContentTypeResponse>(
    '/api/content-types',
    {
      method: 'POST',
      headers: { cookie },
      body: {
        name: `Relation Test ${Date.now()}`,
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
          {
            identifier: 'link',
            name: 'Link',
            type: 'RELATION',
            options: { targetContentTypeIds: [targetType.id] },
          },
          {
            identifier: 'relatedItems',
            name: 'Related Items',
            type: 'MULTIRELATION',
            options: { targetContentTypeIds: [targetType.id] },
          },
        ],
      },
    }
  );
});
```

Then add the entry tests:

```typescript
describe('RELATION/MULTIRELATION entries', () => {
  it('creates an entry with a valid RELATION value', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch('/api/content-entries', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentTypeId: relationContentType.id,
        data: {
          title: `Rel Entry ${Date.now()}`,
          link: {
            contentTypeId: targetEntry.contentTypeId,
            entryId: targetEntry.id,
          },
        },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as EntryResponse;
    expect(body.data.link).toEqual({
      contentTypeId: targetEntry.contentTypeId,
      entryId: targetEntry.id,
    });
  });

  it('creates an entry with a valid MULTIRELATION value', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch('/api/content-entries', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentTypeId: relationContentType.id,
        data: {
          title: `Multi Rel ${Date.now()}`,
          relatedItems: [
            {
              contentTypeId: targetEntry.contentTypeId,
              entryId: targetEntry.id,
            },
          ],
        },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as EntryResponse;
    expect(body.data.relatedItems).toEqual([
      {
        contentTypeId: targetEntry.contentTypeId,
        entryId: targetEntry.id,
      },
    ]);
  });

  it('accepts null RELATION value for non-required field', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch('/api/content-entries', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentTypeId: relationContentType.id,
        data: {
          title: `No Link ${Date.now()}`,
        },
      }),
    });
    expect(res.status).toBe(201);
  });

  it('accepts empty array for MULTIRELATION', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch('/api/content-entries', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentTypeId: relationContentType.id,
        data: {
          title: `Empty Multi ${Date.now()}`,
          relatedItems: [],
        },
      }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects RELATION with non-existent entryId', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch('/api/content-entries', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentTypeId: relationContentType.id,
        data: {
          title: `Bad Link ${Date.now()}`,
          link: {
            contentTypeId: targetEntry.contentTypeId,
            entryId: '00000000-0000-0000-0000-000000000000',
          },
        },
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects RELATION with disallowed contentTypeId', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch('/api/content-entries', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentTypeId: relationContentType.id,
        data: {
          title: `Wrong Type ${Date.now()}`,
          link: {
            contentTypeId: '00000000-0000-0000-0000-000000000000',
            entryId: targetEntry.id,
          },
        },
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects MULTIRELATION with duplicate entryIds', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch('/api/content-entries', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentTypeId: relationContentType.id,
        data: {
          title: `Dup Multi ${Date.now()}`,
          relatedItems: [
            {
              contentTypeId: targetEntry.contentTypeId,
              entryId: targetEntry.id,
            },
            {
              contentTypeId: targetEntry.contentTypeId,
              entryId: targetEntry.id,
            },
          ],
        },
      }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4: Run all tests**

```bash
pnpm test -- --run server/api/content-types/content-types.test.ts
pnpm test -- --run server/api/content-entries/content-entries.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/api/content-types/content-types.test.ts server/api/content-entries/content-entries.test.ts
git commit -m "test: add RELATION/MULTIRELATION integration tests"
```

---

### Task 8: Update Documentation

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update FieldType enum description**

Update the FieldType enum line in the Dynamic Content Types section to include RELATION and MULTIRELATION:

```
- **FieldType enum** — `ENTRY_TITLE` (required, exactly one per type, used as display name in listings), `SLUG` (optional, at most one per type, unique per content type), `TEXT`, `TEXTAREA`, `NUMBER`, `BOOLEAN`, `DATETIME`, `SELECT`, `RICHTEXT` (renders Tiptap editor, stores ProseMirror JSON), `RELATION` (polymorphic single reference, stores `{ contentTypeId, entryId }`, requires `options.targetContentTypeIds`), `MULTIRELATION` (polymorphic ordered array of references, stores `[{ contentTypeId, entryId }, ...]`, requires `options.targetContentTypeIds`).
```

Add the options endpoint to the Key Files section:

```
- `server/api/content-types/options.get.ts` — Content type options for relation field target picker (`{ label, value }[]`)
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add RELATION/MULTIRELATION to documentation"
```
