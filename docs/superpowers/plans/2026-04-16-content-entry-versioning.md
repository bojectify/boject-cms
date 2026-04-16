# Content Entry Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-slot versioning layer so published and draft content can coexist — CMS works on drafts, external APIs serve published versions.

**Architecture:** New `ContentEntryVersion` table holds content data and status. `ContentEntry` becomes an envelope owning identity, slug, and entryTitle. A `resolveVersion` server utility determines which version to serve based on auth context (session = CMS, API key = external). REST responses are flattened for backward compatibility.

**Tech Stack:** Prisma v7, PostgreSQL, Nuxt 4, GraphQL Yoga + Pothos, Vitest

**Spec:** `docs/superpowers/specs/2026-04-16-content-entry-versioning-design.md`

---

## File Structure

### New files

| File                                                                        | Responsibility                                                                                                                           |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/migrations/20260416120000_add_content_entry_versions/migration.sql` | Schema migration                                                                                                                         |
| `server/utils/resolveVersion.ts`                                            | Version resolution helpers (`isCmsRequest`, `getDraftVersion`, `getPublishedVersion`, `getVersionForContext`, `flattenEntryWithVersion`) |
| `server/utils/resolveVersion.test.ts`                                       | Unit tests for version resolution                                                                                                        |
| `server/api/content-entries/[id]/draft.delete.ts`                           | Discard draft endpoint                                                                                                                   |
| `utils/mapFieldToConfig.ts`                                                 | Extracted shared field-to-config mapping                                                                                                 |

### Modified files

| File                                                 | Change summary                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| `prisma/schema/contentEntry.prisma`                  | Strip columns from ContentEntry, add ContentEntryVersion model |
| `server/middleware/auth.ts`                          | Add `event.context.authMethod`                                 |
| `server/api/content-entries/index.post.ts`           | Create envelope + version                                      |
| `server/api/content-entries/[id].get.ts`             | Resolve version by auth context                                |
| `server/api/content-entries/[id].put.ts`             | Split into save-draft and publish flows                        |
| `server/api/content-entries.get.ts`                  | Join versions, filter by auth context                          |
| `server/api/content.get.ts`                          | Join versions, filter by auth context                          |
| `server/graphql/dynamicTypes.ts`                     | Query published versions only                                  |
| `server/graphql/jsonbFilters.ts`                     | JOIN ContentEntryVersion in raw SQL                            |
| `composables/useContentEntryEditor.ts`               | `saveDraft()`, `publish()`, `discardChanges()`, dirty tracking |
| `components/content-editor/ContentEditor.vue`        | Two-button UI, remove status dropdown                          |
| `components/content-editor/contentEditor.types.ts`   | Updated props                                                  |
| `components/entry-editor-pane/EntryEditorPane.vue`   | Two-button treatment                                           |
| `pages/content-types/[id]/entries/[entryId].vue`     | Wire up new composable, dirty guards, use mapFieldToConfig     |
| `pages/content-types/[id]/entries/new.vue`           | Wire up new composable, use mapFieldToConfig                   |
| `pages/content-types/[id]/entries/index.vue`         | Status from version                                            |
| `scripts/content-bundle/types.ts`                    | V2 bundle format                                               |
| `scripts/content-bundle/export.ts`                   | Query with versions                                            |
| `scripts/content-bundle/import.ts`                   | Create envelope + versions                                     |
| `scripts/content-bundle/validate.ts`                 | Handle V1 and V2                                               |
| `starters/base.boject.json`                          | V2 format                                                      |
| `server/api/content-entries/content-entries.test.ts` | Updated + new tests                                            |
| `server/api/graphql/graphql.test.ts`                 | Updated + new tests                                            |
| `server/api/content/content.test.ts`                 | Updated tests                                                  |

---

## Task 1: Prisma Schema + Migration

**Files:**

- Modify: `prisma/schema/contentEntry.prisma`
- Create: `prisma/migrations/20260416120000_add_content_entry_versions/migration.sql`

- [ ] **Step 1: Update Prisma schema**

Replace the contents of `prisma/schema/contentEntry.prisma`:

```prisma
model ContentEntry {
  id            String                @id @default(uuid())
  contentType   ContentType           @relation(fields: [contentTypeId], references: [id])
  contentTypeId String
  entryTitle    String
  slug          String?
  createdAt     DateTime              @default(now())
  updatedAt     DateTime              @updatedAt
  versions      ContentEntryVersion[]

  @@unique([contentTypeId, slug])
  @@unique([contentTypeId, entryTitle])
}

model ContentEntryVersion {
  id          String        @id @default(uuid())
  entry       ContentEntry  @relation(fields: [entryId], references: [id], onDelete: Cascade)
  entryId     String
  data        Json
  entryTitle  String
  status      ContentStatus @default(DRAFT)
  publishedAt DateTime?
  createdBy   String?
  updatedBy   String?
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260416120000_add_content_entry_versions/migration.sql`:

```sql
-- Step 1: Create ContentEntryVersion table
CREATE TABLE "ContentEntryVersion" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "entryTitle" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentEntryVersion_pkey" PRIMARY KEY ("id")
);

-- Step 2: Migrate existing ContentEntry data into versions
INSERT INTO "ContentEntryVersion" ("id", "entryId", "data", "entryTitle", "status", "publishedAt", "createdBy", "updatedBy", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    "id",
    "data",
    "entryTitle",
    "status",
    "publishedAt",
    "createdBy",
    "updatedBy",
    "createdAt",
    "updatedAt"
FROM "ContentEntry";

-- Step 3: Drop migrated columns from ContentEntry
ALTER TABLE "ContentEntry" DROP COLUMN "data";
ALTER TABLE "ContentEntry" DROP COLUMN "status";
ALTER TABLE "ContentEntry" DROP COLUMN "publishedAt";
ALTER TABLE "ContentEntry" DROP COLUMN "createdBy";
ALTER TABLE "ContentEntry" DROP COLUMN "updatedBy";

-- Step 4: Add foreign key constraint
ALTER TABLE "ContentEntryVersion" ADD CONSTRAINT "ContentEntryVersion_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "ContentEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 5: Index for fast version lookups by entry
CREATE INDEX "ContentEntryVersion_entryId_idx" ON "ContentEntryVersion"("entryId");

-- Step 6: Partial unique index — at most one active version per status per entry
CREATE UNIQUE INDEX "ContentEntryVersion_entryId_active_status"
    ON "ContentEntryVersion" ("entryId", "status")
    WHERE "status" IN ('DRAFT', 'PUBLISHED', 'CHANGED');
```

- [ ] **Step 3: Apply migration and regenerate client**

```bash
pnpx prisma migrate deploy
pnpm prisma:generate
```

Expected: Migration applied, client regenerated with `ContentEntryVersion` model.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema/contentEntry.prisma prisma/migrations/20260416120000_add_content_entry_versions/
git commit -m "feat: add ContentEntryVersion schema + migration (#50)"
```

---

## Task 2: Version Resolution Utility

**Files:**

- Create: `server/utils/resolveVersion.ts`
- Create: `server/utils/resolveVersion.test.ts`

- [ ] **Step 1: Write failing tests for version resolution**

Create `server/utils/resolveVersion.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  getDraftVersion,
  getPublishedVersion,
  getVersionForContext,
} from './resolveVersion';

const makeVersion = (
  status: string,
  overrides: Record<string, unknown> = {}
) => ({
  id: `v-${status.toLowerCase()}`,
  entryId: 'entry-1',
  data: {},
  entryTitle: 'Test',
  status: status as 'DRAFT' | 'PUBLISHED' | 'CHANGED' | 'ARCHIVED',
  publishedAt: status === 'PUBLISHED' ? new Date() : null,
  createdBy: null,
  updatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('getDraftVersion', () => {
  it('returns CHANGED over DRAFT', () => {
    const versions = [makeVersion('DRAFT'), makeVersion('CHANGED')];
    expect(getDraftVersion(versions)?.status).toBe('CHANGED');
  });

  it('returns DRAFT when no CHANGED', () => {
    const versions = [makeVersion('DRAFT'), makeVersion('PUBLISHED')];
    expect(getDraftVersion(versions)?.status).toBe('DRAFT');
  });

  it('returns null when no draft versions', () => {
    const versions = [makeVersion('PUBLISHED')];
    expect(getDraftVersion(versions)).toBeNull();
  });
});

describe('getPublishedVersion', () => {
  it('returns PUBLISHED version', () => {
    const versions = [makeVersion('DRAFT'), makeVersion('PUBLISHED')];
    expect(getPublishedVersion(versions)?.status).toBe('PUBLISHED');
  });

  it('returns null when no PUBLISHED', () => {
    const versions = [makeVersion('DRAFT')];
    expect(getPublishedVersion(versions)).toBeNull();
  });
});

describe('getVersionForContext', () => {
  it('CMS: returns draft version, fallback to published', () => {
    const versions = [makeVersion('CHANGED'), makeVersion('PUBLISHED')];
    expect(getVersionForContext(versions, true)?.status).toBe('CHANGED');
  });

  it('CMS: returns published when no draft', () => {
    const versions = [makeVersion('PUBLISHED')];
    expect(getVersionForContext(versions, true)?.status).toBe('PUBLISHED');
  });

  it('external: returns published only', () => {
    const versions = [makeVersion('CHANGED'), makeVersion('PUBLISHED')];
    expect(getVersionForContext(versions, false)?.status).toBe('PUBLISHED');
  });

  it('external: returns null when no published', () => {
    const versions = [makeVersion('DRAFT')];
    expect(getVersionForContext(versions, false)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:unit -- --filter resolveVersion
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement resolveVersion utility**

Create `server/utils/resolveVersion.ts`:

```typescript
import type { H3Event } from 'h3';
import type { ContentEntryVersion, ContentEntry } from '#prisma';

export function isCmsRequest(event: H3Event): boolean {
  return event.context.authMethod === 'session';
}

export function getDraftVersion(
  versions: ContentEntryVersion[]
): ContentEntryVersion | null {
  return (
    versions.find((v) => v.status === 'CHANGED') ??
    versions.find((v) => v.status === 'DRAFT') ??
    null
  );
}

export function getPublishedVersion(
  versions: ContentEntryVersion[]
): ContentEntryVersion | null {
  return versions.find((v) => v.status === 'PUBLISHED') ?? null;
}

export function getVersionForContext(
  versions: ContentEntryVersion[],
  isCms: boolean
): ContentEntryVersion | null {
  if (isCms) {
    return getDraftVersion(versions) ?? getPublishedVersion(versions);
  }
  return getPublishedVersion(versions);
}

export function flattenEntryWithVersion(
  entry: ContentEntry & { versions?: ContentEntryVersion[] },
  version: ContentEntryVersion,
  extras?: Record<string, unknown>
): Record<string, unknown> {
  return {
    id: entry.id,
    contentTypeId: entry.contentTypeId,
    data: version.data,
    entryTitle: entry.entryTitle,
    slug: entry.slug,
    status: version.status,
    publishedAt: version.publishedAt,
    createdBy: version.createdBy,
    updatedBy: version.updatedBy,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    ...extras,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test:unit -- --filter resolveVersion
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/utils/resolveVersion.ts server/utils/resolveVersion.test.ts
git commit -m "feat: add version resolution utility (#50)"
```

---

## Task 3: Auth Middleware — Add authMethod Context

**Files:**

- Modify: `server/middleware/auth.ts`

- [ ] **Step 1: Add authMethod to event context**

In `server/middleware/auth.ts`, add `event.context.authMethod` after each successful auth check:

After line 19 (`if (session.user) return;`), change to:

```typescript
if (session.user) {
  event.context.authMethod = 'session';
  return;
}
```

After line 23 (`if (result.valid) {`), add:

```typescript
event.context.authMethod = 'apikey';
```

- [ ] **Step 2: Run existing auth tests to verify no regression**

```bash
pnpm test:integration -- --filter auth.test
```

Expected: All existing auth tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/middleware/auth.ts
git commit -m "feat: expose authMethod on event context (#50)"
```

---

## Task 4: REST API — POST Create Entry

**Files:**

- Modify: `server/api/content-entries/index.post.ts`

- [ ] **Step 1: Update POST endpoint to create envelope + version**

Replace `server/api/content-entries/index.post.ts` to create a `ContentEntry` envelope with a nested `ContentEntryVersion`:

```typescript
import type { Prisma } from '#prisma';
import { assertUuid } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { flattenEntryWithVersion } from '../../utils/resolveVersion';

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

  const validatedData = await validateEntryData(rawData, contentType.fields);
  const slug = extractSlug(validatedData, contentType.fields);
  const entryTitle = extractEntryTitle(validatedData, contentType.fields);

  let status = 'DRAFT';
  if (typeof body.status === 'string' && VALID_STATUSES.has(body.status)) {
    status = body.status;
  }

  const created = await withPrismaErrors(
    () =>
      prisma.contentEntry.create({
        data: {
          contentTypeId,
          entryTitle,
          slug,
          versions: {
            create: {
              data: validatedData as Prisma.InputJsonValue,
              entryTitle,
              status: status as 'DRAFT',
              publishedAt: status === 'PUBLISHED' ? new Date() : undefined,
            },
          },
        },
        include: { versions: true },
      }),
    {
      uniqueMessage:
        'An entry with this slug or title already exists for this content type',
    }
  );

  setResponseStatus(event, 201);
  return flattenEntryWithVersion(created, created.versions[0]!);
});
```

- [ ] **Step 2: Run content-entries tests**

```bash
pnpm test:integration -- --filter content-entries.test
```

Expected: Some tests may fail due to response shape differences — we'll update tests in Task 10.

- [ ] **Step 3: Commit**

```bash
git add server/api/content-entries/index.post.ts
git commit -m "feat: POST creates envelope + version (#50)"
```

---

## Task 5: REST API — GET Single Entry

**Files:**

- Modify: `server/api/content-entries/[id].get.ts`

- [ ] **Step 1: Update GET endpoint to resolve version by auth context**

Replace `server/api/content-entries/[id].get.ts`:

```typescript
import {
  isCmsRequest,
  getVersionForContext,
  getPublishedVersion,
  flattenEntryWithVersion,
} from '../../utils/resolveVersion';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: {
      versions: true,
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

  const isCms = isCmsRequest(event);
  const version = getVersionForContext(entry.versions, isCms);
  if (!version) {
    throw createError({
      statusCode: 404,
      statusMessage: 'No visible version for this entry',
    });
  }

  return flattenEntryWithVersion(entry, version, {
    contentType: entry.contentType,
    ...(isCms
      ? { hasPublishedVersion: getPublishedVersion(entry.versions) !== null }
      : {}),
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add server/api/content-entries/[id].get.ts
git commit -m "feat: GET resolves version by auth context (#50)"
```

---

## Task 6: REST API — PUT Save Draft / Publish

**Files:**

- Modify: `server/api/content-entries/[id].put.ts`

- [ ] **Step 1: Rewrite PUT endpoint with save-draft and publish flows**

Replace `server/api/content-entries/[id].put.ts`. The endpoint infers the action from `body.status`:

- `PUBLISHED` → publish flow (promote draft, delete old published)
- Anything else → save-draft flow (upsert DRAFT/CHANGED version)

This is the most complex endpoint. See the full implementation in the spec's "PUT endpoint actions" section. Key details:

- **Save draft:** Check if PUBLISHED version exists. If yes, upsert a CHANGED version. If no, upsert a DRAFT version. Update envelope's `slug` and `entryTitle` if data changed.
- **Publish:** Delete old PUBLISHED version first (in transaction), then promote CHANGED/DRAFT to PUBLISHED, or create new PUBLISHED directly. Update envelope.
- Both flows use `withPrismaErrors` for uniqueness constraint handling.
- Both flows re-fetch and return `flattenEntryWithVersion`.

- [ ] **Step 2: Commit**

```bash
git add server/api/content-entries/[id].put.ts
git commit -m "feat: PUT splits into save-draft and publish flows (#50)"
```

---

## Task 7: REST API — GET List + Unified Content

**Files:**

- Modify: `server/api/content-entries.get.ts`
- Modify: `server/api/content.get.ts`

- [ ] **Step 1: Update content-entries list to join versions**

Both endpoints need the same treatment: join `versions`, use `isCmsRequest` to determine filtering, pick best version via `getVersionForContext`, flatten results.

For CMS requests: show all entries with their draft version's status. For API key requests: only show entries with a PUBLISHED version.

- [ ] **Step 2: Update unified content listing**

Same pattern — join versions, resolve per auth context. Status in the response comes from the version, not the envelope.

- [ ] **Step 3: Commit**

```bash
git add server/api/content-entries.get.ts server/api/content.get.ts
git commit -m "feat: list endpoints join versions, filter by auth context (#50)"
```

---

## Task 8: REST API — Discard Draft Endpoint

**Files:**

- Create: `server/api/content-entries/[id]/draft.delete.ts`

- [ ] **Step 1: Create the discard draft endpoint**

```typescript
import { assertUuid } from '../../../utils/validation';
import { enforceMutationRateLimit } from '../../../utils/rateLimitEndpoint';
import {
  getDraftVersion,
  getPublishedVersion,
  flattenEntryWithVersion,
} from '../../../utils/resolveVersion';

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-entries.draft.delete');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: { versions: true },
  });
  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  const draft = getDraftVersion(entry.versions);
  if (!draft) {
    throw createError({
      statusCode: 404,
      statusMessage: 'No draft version to discard',
    });
  }

  await prisma.contentEntryVersion.delete({ where: { id: draft.id } });

  const published = getPublishedVersion(entry.versions);
  if (!published) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Cannot discard the only version — delete the entry instead',
    });
  }

  return flattenEntryWithVersion(entry, published);
});
```

- [ ] **Step 2: Commit**

```bash
git add server/api/content-entries/[id]/draft.delete.ts
git commit -m "feat: add discard draft endpoint (#50)"
```

---

## Task 9: GraphQL — Serve Published Versions Only

**Files:**

- Modify: `server/graphql/dynamicTypes.ts`
- Modify: `server/graphql/jsonbFilters.ts`

- [ ] **Step 1: Update dynamicTypes.ts**

Key changes:

- `ContentEntryShape` stays the same interface (flattened) — add a helper `flattenToShape(entry, version)` to build it from envelope + version.
- All `prisma.contentEntry.findFirst/findUnique` calls add `include: { versions: { where: { status: 'PUBLISHED' } } }` and extract the published version.
- RELATION resolution: include published version, return null if no published version.
- MULTIRELATION resolution: include published versions, filter out entries without published versions.
- Cross-type `contentEntryList` raw SQL: JOIN ContentEntryVersion with `v."status" = 'PUBLISHED'`.

- [ ] **Step 2: Update jsonbFilters.ts**

Change `queryDynamicEntries()` raw SQL:

- `SELECT * FROM "ContentEntry"` → `SELECT e."id", e."contentTypeId", v."data", e."slug", v."status", v."publishedAt", v."createdAt", v."updatedAt" FROM "ContentEntry" e JOIN "ContentEntryVersion" v ON v."entryId" = e."id"`
- Add base condition: `v."status" = 'PUBLISHED'`
- JSONB field references: `data->>` → `v."data"->>`
- System field references: `"status"` → `v."status"`, `"createdAt"` → `v."createdAt"`, `"updatedAt"` → `v."updatedAt"`

- [ ] **Step 3: Commit**

```bash
git add server/graphql/dynamicTypes.ts server/graphql/jsonbFilters.ts
git commit -m "feat: GraphQL serves PUBLISHED versions only (#50)"
```

---

## Task 10: Update Integration Tests

**Files:**

- Modify: `server/api/content-entries/content-entries.test.ts`
- Modify: `server/api/graphql/graphql.test.ts`
- Modify: `server/api/content/content.test.ts`

- [ ] **Step 1: Update content-entries tests**

All existing assertions remain valid — response shape is flattened to match the legacy format. Add new tests:

- "Save draft on published entry creates CHANGED version"
- "Publish promotes CHANGED to PUBLISHED and deletes old published"
- "API key GET returns only published entries"
- "Draft entries invisible to API key"
- "Discard draft deletes CHANGED version and returns published"
- "Cannot discard the only version"

- [ ] **Step 2: Update GraphQL tests**

Ensure test setup creates PUBLISHED entries (most already do). Add:

- "Draft entries are not visible in GraphQL queries"
- "After publishing a CHANGED version, GraphQL serves the new data"

- [ ] **Step 3: Update content listing tests**

Update status filter assertions for version-based status.

- [ ] **Step 4: Run all tests**

```bash
pnpm test
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/api/content-entries/content-entries.test.ts server/api/graphql/graphql.test.ts server/api/content/content.test.ts
git commit -m "test: update integration tests for versioning (#50)"
```

---

## Task 11: Extract mapFieldToConfig Utility

**Files:**

- Create: `utils/mapFieldToConfig.ts`
- Modify: `pages/content-types/[id]/entries/[entryId].vue`
- Modify: `pages/content-types/[id]/entries/new.vue`
- Modify: `components/entry-editor-pane/EntryEditorPane.vue`

- [ ] **Step 1: Extract the shared mapFieldToConfig function**

Move `mapFieldToConfig` from `pages/content-types/[id]/entries/[entryId].vue` (lines 39-137) to `utils/mapFieldToConfig.ts`. Import it in all three consumers.

- [ ] **Step 2: Update all three consumers**

Replace the inline `mapFieldToConfig` in `[entryId].vue`, `new.vue`, and `EntryEditorPane.vue` with imports from the shared utility.

- [ ] **Step 3: Verify typecheck passes**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add utils/mapFieldToConfig.ts pages/content-types/[id]/entries/[entryId].vue pages/content-types/[id]/entries/new.vue components/entry-editor-pane/EntryEditorPane.vue
git commit -m "refactor: extract mapFieldToConfig to shared utility (#50)"
```

---

## Task 12: CMS UI — Composable Refactor

**Files:**

- Modify: `composables/useContentEntryEditor.ts`

- [ ] **Step 1: Replace save() with saveDraft(), publish(), discardChanges()**

Key changes:

- `saveDraft()`: POST (new) or PUT without status (server auto-determines DRAFT vs CHANGED)
- `publish()`: POST with `status: 'PUBLISHED'` (new) or PUT with `status: 'PUBLISHED'`
- `discardChanges()`: DELETE `/api/content-entries/${entryId}/draft`, then refresh
- Add `hasPublishedVersion` ref (from API response's `hasPublishedVersion` field)
- Add `isDirty` ref with JSON snapshot comparison
- Remove `status` from `formState` — it's now read-only, derived from the version

- [ ] **Step 2: Commit**

```bash
git add composables/useContentEntryEditor.ts
git commit -m "feat: composable with saveDraft/publish/discardChanges (#50)"
```

---

## Task 13: CMS UI — ContentEditor Two-Button UI

**Files:**

- Modify: `components/content-editor/ContentEditor.vue`
- Modify: `components/content-editor/contentEditor.types.ts`

- [ ] **Step 1: Update props type**

```typescript
export type ContentEditorProps = BasicComponentProps & {
  title: string;
  fields: FieldConfig[];
  loading?: boolean;
  saving?: boolean;
  error?: string | null;
  showSlug?: boolean;
  status?: 'DRAFT' | 'PUBLISHED' | 'CHANGED' | 'ARCHIVED';
  hasPublishedVersion?: boolean;
  isDirty?: boolean;
  onSaveDraft: () => void;
  onPublish: () => void;
  onDiscardChanges?: () => void;
};
```

- [ ] **Step 2: Update ContentEditor template**

- Replace single Save button with state-dependent buttons (Save Draft / Save Changes / Publish / Publish Changes)
- Remove status `<USelect>` dropdown from Publishing section
- Add read-only status badge
- Button state logic:
  - New entry (DRAFT): Publish active, Save Draft active
  - Published (no dirty): both disabled
  - Published (dirty): Save Draft active with blue accent, Publish disabled
  - Changed: Publish Changes active, Save Changes active, Discard Changes shown

- [ ] **Step 3: Commit**

```bash
git add components/content-editor/ContentEditor.vue components/content-editor/contentEditor.types.ts
git commit -m "feat: two-button editor UI with status badge (#50)"
```

---

## Task 14: CMS UI — Entry Pages + Dirty Detection

**Files:**

- Modify: `pages/content-types/[id]/entries/[entryId].vue`
- Modify: `pages/content-types/[id]/entries/new.vue`
- Modify: `components/entry-editor-pane/EntryEditorPane.vue`

- [ ] **Step 1: Wire up entry edit page**

- Destructure `saveDraft`, `publish`, `discardChanges`, `hasPublishedVersion`, `isDirty` from composable
- Pass to ContentEditor as props
- Add `beforeunload` handler and `onBeforeRouteLeave` guard for dirty detection

- [ ] **Step 2: Wire up new entry page**

Same treatment — both buttons available from the start.

- [ ] **Step 3: Wire up EntryEditorPane**

Same two-button treatment for the sliding pane.

- [ ] **Step 4: Verify in browser**

Start dev server, create an entry as draft, publish it, edit it, save changes, publish changes, discard changes. Test dirty detection (navigate away with unsaved changes).

- [ ] **Step 5: Commit**

```bash
git add pages/content-types/[id]/entries/ components/entry-editor-pane/EntryEditorPane.vue
git commit -m "feat: wire up versioning UI in entry pages (#50)"
```

---

## Task 15: Content Bundle CLI — V2 Format

**Files:**

- Modify: `scripts/content-bundle/types.ts`
- Modify: `scripts/content-bundle/export.ts`
- Modify: `scripts/content-bundle/import.ts`
- Modify: `scripts/content-bundle/validate.ts`
- Modify: `starters/base.boject.json`

- [ ] **Step 1: Update bundle types**

Add `BundleEntryVersion` type. `BundleEntry` gains optional `versions` array. Keep V1 flat fields for backward compatibility.

- [ ] **Step 2: Update export to V2**

Query with `include: { versions: true }`. Map to V2 format with `versions` array.

- [ ] **Step 3: Update import for V1 + V2**

Detect format version. V1: create envelope + single version from flat fields. V2: create envelope + versions from array.

- [ ] **Step 4: Update validate for both formats**

Accept both V1 and V2 entry shapes.

- [ ] **Step 5: Update starter bundles**

Update `starters/base.boject.json` to V2 format. Rebuild overlay starters with `pnpm starters:build`.

- [ ] **Step 6: Run all tests**

```bash
pnpm test
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/content-bundle/ starters/
git commit -m "feat: content bundle V2 format with versioning (#50)"
```

---

## Task 16: Update CLAUDE.md + Final Verification

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

Document: ContentEntryVersion model, version resolution, authMethod context, two-button save/publish, discard draft endpoint, content bundle V2.

- [ ] **Step 2: Full verification**

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: All pass.

- [ ] **Step 3: Manual verification**

1. Create entry as draft → status DRAFT, both buttons active
2. Publish → status PUBLISHED, both buttons disabled
3. Edit a field → Save Draft enables
4. Save Draft → status CHANGED, Publish Changes + Save Changes active
5. Publish Changes → status PUBLISHED, old published gone
6. Edit again, Save Changes, Discard Changes → reverts to published
7. GraphQL playground: only published entries visible
8. `pnpm content:export` → `pnpm content:import` round-trip works

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for content entry versioning (#50)"
```
