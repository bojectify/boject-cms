# RICHTEXT Field Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `RICHTEXT` to the dynamic content type field system so users can add Tiptap rich text fields to any content type.

**Architecture:** Add enum value to Prisma schema, wire server validation for ProseMirror JSON objects, add to field type dropdowns in CMS pages, and map to existing `RichTextEditor` component via existing `RichtextFieldConfig`. All infrastructure already exists — this is pure wiring.

**Tech Stack:** Prisma (enum migration), Nuxt server utils (validation), Vue pages (field type options + field mapping)

---

### Task 1: Database Migration

**Files:**

- Modify: `prisma/schema/contentType.prisma:1-10`
- Create: `prisma/migrations/<timestamp>_add_richtext_field_type/migration.sql`

- [ ] **Step 1: Add RICHTEXT to the FieldType enum in the Prisma schema**

In `prisma/schema/contentType.prisma`, add `RICHTEXT` to the enum:

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
}
```

- [ ] **Step 2: Create the migration SQL**

Create directory and file `prisma/migrations/20260413120000_add_richtext_field_type/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "FieldType" ADD VALUE 'RICHTEXT';
```

- [ ] **Step 3: Apply migration and regenerate client**

Run:

```bash
pnpx prisma migrate deploy
pnpm prisma:generate
```

Expected: Migration applied successfully, Prisma client regenerated.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema/contentType.prisma prisma/migrations/20260413120000_add_richtext_field_type/
git commit -m "feat: add RICHTEXT to FieldType enum"
```

---

### Task 2: Server Validation

**Files:**

- Modify: `server/utils/validateEntryData.ts:39-101`
- Modify: `server/api/content-types/[id]/fields/index.post.ts:10-19`

- [ ] **Step 1: Add RICHTEXT to VALID_FIELD_TYPES in the field create endpoint**

In `server/api/content-types/[id]/fields/index.post.ts`, add `'RICHTEXT'` to the set:

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
]);
```

- [ ] **Step 2: Add RICHTEXT validation case in validateEntryData**

In `server/utils/validateEntryData.ts`, add a case before the `default` in the switch statement:

```typescript
      case 'RICHTEXT':
        if (typeof value !== 'object' || Array.isArray(value)) {
          throw createError({
            statusCode: 400,
            statusMessage: `${field.name} must be a JSON object`,
          });
        }
        validated[field.identifier] = value;
        break;
```

- [ ] **Step 3: Commit**

```bash
git add server/utils/validateEntryData.ts server/api/content-types/\[id\]/fields/index.post.ts
git commit -m "feat: add RICHTEXT server validation"
```

---

### Task 3: CMS Field Type Dropdowns

**Files:**

- Modify: `pages/content-types/new.vue:35-44`
- Modify: `pages/content-types/[id].vue:90-99`

- [ ] **Step 1: Add Rich Text option to new.vue fieldTypeOptions**

In `pages/content-types/new.vue`, add to the `fieldTypeOptions` array after the SELECT entry:

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
];
```

- [ ] **Step 2: Add Rich Text option to [id].vue fieldTypeOptions**

In `pages/content-types/[id].vue`, same change — add to the `fieldTypeOptions` array after SELECT:

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
];
```

- [ ] **Step 3: Commit**

```bash
git add pages/content-types/new.vue pages/content-types/\[id\].vue
git commit -m "feat: add Rich Text to field type dropdowns"
```

---

### Task 4: Entry Editor Field Mapping

**Files:**

- Modify: `pages/content-types/[id]/entries/new.vue:38-99`
- Modify: `pages/content-types/[id]/entries/[entryId].vue:39-101`

- [ ] **Step 1: Add RICHTEXT case to mapFieldToConfig in entries/new.vue**

In `pages/content-types/[id]/entries/new.vue`, add a case in the `mapFieldToConfig` switch before `default`:

```typescript
    case 'RICHTEXT':
      return {
        type: 'richtext',
        key: field.identifier,
        label: field.name,
      };
```

- [ ] **Step 2: Add RICHTEXT case to mapFieldToConfig in entries/[entryId].vue**

In `pages/content-types/[id]/entries/[entryId].vue`, add the same case in the `mapFieldToConfig` switch before `default`:

```typescript
    case 'RICHTEXT':
      return {
        type: 'richtext',
        key: field.identifier,
        label: field.name,
      };
```

- [ ] **Step 3: Commit**

```bash
git add pages/content-types/\[id\]/entries/new.vue pages/content-types/\[id\]/entries/\[entryId\].vue
git commit -m "feat: map RICHTEXT fields to Tiptap editor in entry forms"
```

---

### Task 5: Integration Tests

**Files:**

- Modify: `server/api/content-types/content-types.test.ts`
- Modify: `server/api/content-entries/content-entries.test.ts`

- [ ] **Step 1: Add test for adding a RICHTEXT field to content-types.test.ts**

Add this test inside the `POST /api/content-types/[id]/fields` describe block in `server/api/content-types/content-types.test.ts`:

```typescript
it('adds a RICHTEXT field', async () => {
  const cookie = await getSessionCookie();
  const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
    method: 'POST',
    headers: { cookie },
    body: {
      name: `Richtext Test ${Date.now()}`,
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

  const field = await $fetch<FieldResponse>(
    `/api/content-types/${ct.id}/fields`,
    {
      method: 'POST',
      headers: { cookie },
      body: { identifier: 'body', name: 'Body', type: 'RICHTEXT' },
    }
  );

  expect(field.type).toBe('RICHTEXT');
  expect(field.identifier).toBe('body');
});
```

- [ ] **Step 2: Run test to verify it passes**

Run:

```bash
pnpm test:run -- server/api/content-types/content-types.test.ts
```

Expected: All tests pass including the new RICHTEXT field test.

- [ ] **Step 3: Add RICHTEXT field to test content type in content-entries.test.ts**

In the `beforeAll` block of `server/api/content-entries/content-entries.test.ts`, add a RICHTEXT field to the test content type's `fields` array:

```typescript
          {
            identifier: 'content',
            name: 'Content',
            type: 'RICHTEXT',
          },
```

- [ ] **Step 4: Add test for creating an entry with RICHTEXT data**

Add inside the `POST /api/content-entries` describe block:

```typescript
it('creates an entry with RICHTEXT data', async () => {
  const cookie = await getSessionCookie();
  const proseMirrorDoc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hello world' }],
      },
    ],
  };

  const res = await fetch('/api/content-entries', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentTypeId: testContentType.id,
      data: {
        title: `Richtext Entry ${Date.now()}`,
        content: proseMirrorDoc,
      },
    }),
  });

  expect(res.status).toBe(201);
  const body = (await res.json()) as EntryResponse;
  expect(body.data.content).toEqual(proseMirrorDoc);
});
```

- [ ] **Step 5: Add test for rejecting non-object RICHTEXT values**

Add inside the `POST /api/content-entries` describe block:

```typescript
it('rejects non-object RICHTEXT value', async () => {
  const cookie = await getSessionCookie();
  const res = await fetch('/api/content-entries', {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentTypeId: testContentType.id,
      data: {
        title: `Bad Richtext ${Date.now()}`,
        content: 'this is a string not an object',
      },
    }),
  });

  expect(res.status).toBe(400);
});
```

- [ ] **Step 6: Run all content entry tests to verify they pass**

Run:

```bash
pnpm test:run -- server/api/content-entries/content-entries.test.ts
```

Expected: All tests pass including the two new RICHTEXT tests.

- [ ] **Step 7: Commit**

```bash
git add server/api/content-types/content-types.test.ts server/api/content-entries/content-entries.test.ts
git commit -m "test: add RICHTEXT field integration tests"
```

---

### Task 6: Update Documentation

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Update FieldType enum references in CLAUDE.md**

Add `RICHTEXT` to the FieldType enum description in the Dynamic Content Types section. Update the line:

```
- **FieldType enum** — `ENTRY_TITLE` (required, exactly one per type, used as display name in listings), `SLUG` (optional, at most one per type, unique per content type), `TEXT`, `TEXTAREA`, `NUMBER`, `BOOLEAN`, `DATETIME`, `SELECT`.
```

to:

```
- **FieldType enum** — `ENTRY_TITLE` (required, exactly one per type, used as display name in listings), `SLUG` (optional, at most one per type, unique per content type), `TEXT`, `TEXTAREA`, `NUMBER`, `BOOLEAN`, `DATETIME`, `SELECT`, `RICHTEXT` (renders Tiptap editor, stores ProseMirror JSON).
```

Also update the ContentEditor Integration mapping section to add:

```
- `RICHTEXT` → `richtext` field config (renders Tiptap rich text editor, stores ProseMirror JSON)
```

- [ ] **Step 2: Update FieldType enum in README.md**

In the Dynamic Content Types section of `README.md`, add `RICHTEXT` to the FieldType enum description. Update to include:

```
| **ContentTypeField** | Field definition within a content type. Fields: `identifier` (unique camelCase within content type, e.g. `publishDate`), `name` (display name, e.g. "Publish Date"), `type` (`FieldType` enum), `required`, `order`, optional `options` (Json, e.g. select choices). Unique constraint on `(contentTypeId, identifier)`. The `identifier` is the key used in the JSONB `data` column of ContentEntry. |
```

Update the FieldType enum line to include `RICHTEXT`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: add RICHTEXT field type to documentation"
```
