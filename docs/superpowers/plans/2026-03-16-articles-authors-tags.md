# Articles, Authors & Tags Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Article, Author, and Tag content models with rich text editing (Tiptap) to the CMS.

**Architecture:** Three new Prisma models (Author, Tag, Article) plus a lightweight AuthorSocialLink child table. Each model gets REST endpoints (list, get, put, options), GraphQL types with Relay pagination, CMS list/edit pages, and integration tests. The Article edit page includes a Tiptap rich text editor with a custom CmsEmbed node for embedding references to other content.

**Tech Stack:** Prisma v7, Nuxt 4, Pothos GraphQL, Tiptap (`@tiptap/vue-3`), `@tiptap/starter-kit`, `@tiptap/extension-table`, `@tiptap/extension-link`, `@tiptap/extension-image`, `@tiptap/extension-code-block-lowlight`, `lowlight`.

**Spec:** `docs/superpowers/specs/2026-03-16-articles-authors-tags-design.md`

---

## File Structure

### New Files

| File                                   | Responsibility                                        |
| -------------------------------------- | ----------------------------------------------------- |
| `prisma/schema/author.prisma`          | Author + AuthorSocialLink models                      |
| `prisma/schema/tag.prisma`             | Tag model                                             |
| `prisma/schema/article.prisma`         | Article model                                         |
| `server/api/authors.get.ts`            | Author list endpoint                                  |
| `server/api/authors/[id].get.ts`       | Author single-item GET                                |
| `server/api/authors/[id].put.ts`       | Author update endpoint                                |
| `server/api/authors/options.get.ts`    | Author options for dropdowns                          |
| `server/api/tags.get.ts`               | Tag list endpoint                                     |
| `server/api/tags/[id].get.ts`          | Tag single-item GET                                   |
| `server/api/tags/[id].put.ts`          | Tag update endpoint                                   |
| `server/api/tags/options.get.ts`       | Tag options for dropdowns                             |
| `server/api/articles.get.ts`           | Article list endpoint                                 |
| `server/api/articles/[id].get.ts`      | Article single-item GET                               |
| `server/api/articles/[id].put.ts`      | Article update endpoint                               |
| `server/api/images/options.get.ts`     | Image options for dropdowns (new — doesn't exist yet) |
| `server/graphql/types/author.ts`       | Author + AuthorSocialLink GraphQL types               |
| `server/graphql/types/tag.ts`          | Tag GraphQL type                                      |
| `server/graphql/types/article.ts`      | Article GraphQL type                                  |
| `components/RichTextEditor.vue`        | Tiptap editor wrapper component                       |
| `components/CmsEmbedNode.vue`          | Vue NodeView component for CmsEmbed blocks            |
| `components/CmsEmbedModal.vue`         | Modal for selecting content to embed                  |
| `extensions/cmsEmbed.ts`               | Tiptap CmsEmbed custom node extension                 |
| `pages/authors/index.vue`              | Author list page                                      |
| `pages/authors/[id].vue`               | Author edit page                                      |
| `pages/tags/index.vue`                 | Tag list page                                         |
| `pages/tags/[id].vue`                  | Tag edit page                                         |
| `pages/articles/index.vue`             | Article list page                                     |
| `pages/articles/[id].vue`              | Article edit page                                     |
| `server/api/authors/authors.test.ts`   | Author REST API tests                                 |
| `server/api/tags/tags.test.ts`         | Tag REST API tests                                    |
| `server/api/articles/articles.test.ts` | Article REST API tests                                |

### Modified Files

| File                                 | Change                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `prisma/schema/image.prisma`         | Add back-relations for Author headshot and Article featuredImage                     |
| `prisma/seed.ts`                     | Add seed data for authors, tags, articles                                            |
| `server/api/content.get.ts`          | Add `'Article'`, `'Author'`, `'Tag'` to `CONTENT_TABLES`                             |
| `server/graphql/filters.ts`          | Add AuthorWhere, TagWhere, ArticleWhere, TagListRelationFilter, AuthorRelationFilter |
| `server/graphql/query/index.ts`      | Add article, author, tag root queries                                                |
| `server/graphql/schema.ts`           | Import and register new type files                                                   |
| `types/contentEditor.ts`             | Add `RichtextFieldConfig` and `MultirelationFieldConfig` types                       |
| `components/ContentEditor.vue`       | Handle `richtext` and `multirelation` field types                                    |
| `layouts/default.vue`                | Add Articles, Authors, Tags to sidebar nav                                           |
| `server/api/graphql/graphql.test.ts` | Add article/author/tag GraphQL tests                                                 |
| `server/api/content/content.test.ts` | Add Article/Author/Tag content type tests                                            |
| `server/api/lists/lists.test.ts`     | Add author/tag/article list filter tests                                             |
| `package.json`                       | Add Tiptap dependencies                                                              |

---

## Chunk 1: Database Schema & Migration

### Task 1: All Three Prisma Schema Files

**Files:**

- Create: `prisma/schema/author.prisma`
- Create: `prisma/schema/tag.prisma`
- Create: `prisma/schema/article.prisma`
- Modify: `prisma/schema/image.prisma`

Note: All three schema files must be created together because they have cross-references (Author.articles → Article, Tag.articles → Article, Article.author → Author, Article.tags → Tag). Running `pnpx prisma validate` on partial schemas will fail.

- [ ] **Step 1: Create author.prisma**

```prisma
model Author {
  id          String              @id @default(uuid())
  entryTitle  String              @default("")
  name        String              @unique
  slug        String              @unique
  bio         String?
  headshot    Image?              @relation(name: "AuthorHeadshot", fields: [headshotId], references: [id], onDelete: SetNull)
  headshotId  String?             @unique
  socialLinks AuthorSocialLink[]
  articles    Article[]
  status      ContentStatus       @default(DRAFT)
  publishedAt DateTime?
  createdBy   String?
  updatedBy   String?
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
}

model AuthorSocialLink {
  id        String   @id @default(uuid())
  platform  String
  url       String
  author    Author   @relation(fields: [authorId], references: [id], onDelete: Cascade)
  authorId  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 3: Create tag.prisma**

```prisma
model Tag {
  id          String        @id @default(uuid())
  entryTitle  String        @default("")
  name        String        @unique
  slug        String        @unique
  articles    Article[]
  status      ContentStatus @default(DRAFT)
  publishedAt DateTime?
  createdBy   String?
  updatedBy   String?
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}
```

- [ ] **Step 4: Create article.prisma**

```prisma
model Article {
  id               String        @id @default(uuid())
  entryTitle       String        @default("")
  title            String        @unique
  slug             String        @unique
  summary          String?
  body             Json?
  author           Author?       @relation(fields: [authorId], references: [id], onDelete: SetNull)
  authorId         String?
  featuredImage    Image?        @relation(name: "ArticleFeaturedImage", fields: [featuredImageId], references: [id], onDelete: SetNull)
  featuredImageId  String?       @unique
  tags             Tag[]
  status           ContentStatus @default(DRAFT)
  publishedAt      DateTime?
  createdBy        String?
  updatedBy        String?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
}
```

- [ ] **Step 5: Add back-relations to image.prisma**

Add both back-relations to the Image model, after the existing `crestOf` line:

```prisma
authorHeadshotOf Author? @relation("AuthorHeadshot")
articleFeaturedOf Article? @relation("ArticleFeaturedImage")
```

- [ ] **Step 6: Verify schema is valid**

Run: `pnpx prisma validate`
Expected: "The schemas are valid."

- [ ] **Step 7: Commit**

```bash
git add prisma/schema/author.prisma prisma/schema/tag.prisma prisma/schema/article.prisma prisma/schema/image.prisma
git commit -m "feat: add Author, Tag, Article Prisma schemas"
```

### Task 2: Create & Apply Migration

**Files:**

- Create: `prisma/migrations/<timestamp>_add_article_author_tag/migration.sql`

Note: `prisma migrate dev` requires an interactive terminal. Use the manual migration workflow:

- [ ] **Step 1: Generate migration SQL**

Run: `pnpx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --script`

This outputs the SQL needed. Review it — it should create the `Author`, `AuthorSocialLink`, `Tag`, `Article`, and `_ArticleToTag` tables with appropriate indexes and foreign keys.

- [ ] **Step 2: Create migration directory and file**

Create `prisma/migrations/<YYYYMMDDHHMMSS>_add_article_author_tag/migration.sql` with the generated SQL.

- [ ] **Step 3: Apply migration**

Run: `pnpx prisma migrate deploy`
Expected: "All migrations have been successfully applied."

- [ ] **Step 4: Regenerate Prisma client**

Run: `pnpm prisma:generate`
Expected: Prisma client and Pothos types regenerated in `generated/`.

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations/
git commit -m "feat: migration for Article, Author, Tag models"
```

### Task 5: Seed Data

**Files:**

- Modify: `prisma/seed.ts`

Add seed data after the existing scores section and before the test API key section.

- [ ] **Step 1: Add authors with social links**

```typescript
// Authors
const authorJones = await prisma.author.upsert({
  where: { name: 'Gareth Jones' },
  update: {},
  create: {
    name: 'Gareth Jones',
    slug: 'gareth-jones',
    entryTitle: 'Gareth Jones',
    bio: 'Club press officer and match report writer.',
    status: 'PUBLISHED',
    publishedAt: new Date(),
    socialLinks: {
      create: [
        { platform: 'twitter', url: 'https://twitter.com/garethjones' },
        { platform: 'instagram', url: 'https://instagram.com/garethjones' },
      ],
    },
  },
});

const authorDavies = await prisma.author.upsert({
  where: { name: 'Sarah Davies' },
  update: {},
  create: {
    name: 'Sarah Davies',
    slug: 'sarah-davies',
    entryTitle: 'Sarah Davies',
    bio: 'Youth development coordinator.',
    status: 'PUBLISHED',
    publishedAt: new Date(),
    socialLinks: {
      create: [
        { platform: 'linkedin', url: 'https://linkedin.com/in/sarahdavies' },
      ],
    },
  },
});
```

- [ ] **Step 2: Add tags**

```typescript
// Tags
const tagMatchReport = await prisma.tag.upsert({
  where: { name: 'Match Report' },
  update: {},
  create: {
    name: 'Match Report',
    slug: 'match-report',
    entryTitle: 'Match Report',
    status: 'PUBLISHED',
    publishedAt: new Date(),
  },
});

const tagClubNews = await prisma.tag.upsert({
  where: { name: 'Club News' },
  update: {},
  create: {
    name: 'Club News',
    slug: 'club-news',
    entryTitle: 'Club News',
    status: 'PUBLISHED',
    publishedAt: new Date(),
  },
});

const tagYouth = await prisma.tag.upsert({
  where: { name: 'Youth' },
  update: {},
  create: {
    name: 'Youth',
    slug: 'youth',
    entryTitle: 'Youth',
    status: 'PUBLISHED',
    publishedAt: new Date(),
  },
});
```

- [ ] **Step 3: Add articles**

```typescript
// Articles
await prisma.article.upsert({
  where: { title: 'Opening Day Victory' },
  update: {},
  create: {
    title: 'Opening Day Victory',
    slug: 'opening-day-victory',
    entryTitle: 'Opening Day Victory',
    summary: 'A commanding performance from the 1st XV in the season opener.',
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'The 1st XV kicked off the season with a convincing home win against Oakdale RFC.',
            },
          ],
        },
      ],
    },
    authorId: authorJones.id,
    tags: { connect: [{ id: tagMatchReport.id }] },
    status: 'PUBLISHED',
    publishedAt: new Date(),
  },
});

await prisma.article.upsert({
  where: { title: 'Youth Programme Expands' },
  update: {},
  create: {
    title: 'Youth Programme Expands',
    slug: 'youth-programme-expands',
    entryTitle: 'Youth Programme Expands',
    summary: 'New age groups added to the junior section for 2025/26.',
    authorId: authorDavies.id,
    tags: { connect: [{ id: tagClubNews.id }, { id: tagYouth.id }] },
    status: 'PUBLISHED',
    publishedAt: new Date(),
  },
});

await prisma.article.upsert({
  where: { title: 'Draft: Season Preview' },
  update: {},
  create: {
    title: 'Draft: Season Preview',
    slug: 'draft-season-preview',
    entryTitle: 'Draft: Season Preview',
    summary: 'Looking ahead to the 2025/26 campaign.',
    authorId: authorJones.id,
    tags: { connect: [{ id: tagClubNews.id }] },
    status: 'DRAFT',
  },
});
```

- [ ] **Step 4: Run seed**

Run: `pnpm prisma:seed`
Expected: "Seed complete."

- [ ] **Step 5: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat: seed data for authors, tags, articles"
```

---

## Chunk 2: Author REST API & Tests

### Task 6: Author List Endpoint

**Files:**

- Create: `server/api/authors.get.ts`

- [ ] **Step 1: Write the test**

Create `server/api/authors/authors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { setup, $fetch } from '@nuxt/test-utils/e2e';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

type ListItem = {
  id: string;
  status: string;
  [key: string]: unknown;
};

type ListResponse = { items: ListItem[]; total: number };

function getList(model: string, params: Record<string, string | number> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.append(key, String(value));
  }
  const qs = search.toString();
  return $fetch<ListResponse>(`/api/${model}${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
  });
}

describe('Author endpoints', async () => {
  await setup({ dev: true });

  describe('GET /api/authors', () => {
    it('returns all authors', async () => {
      const { items, total } = await getList('authors');
      expect(total).toBe(2);
      expect(items).toHaveLength(2);
    });

    it('filters by status=PUBLISHED', async () => {
      const { items, total } = await getList('authors', {
        status: 'PUBLISHED',
      });
      expect(total).toBe(2);
      expect(items.every((a) => a.status === 'PUBLISHED')).toBe(true);
    });

    it('filters by status=DRAFT returns empty', async () => {
      const { items, total } = await getList('authors', {
        status: 'DRAFT',
      });
      expect(items).toHaveLength(0);
      expect(total).toBe(0);
    });

    it('ignores invalid status values', async () => {
      const { total } = await getList('authors', { status: 'INVALID' });
      expect(total).toBe(2);
    });

    it('paginates results', async () => {
      const { items } = await getList('authors', { perPage: 1 });
      expect(items).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run -- server/api/authors/authors.test.ts`
Expected: FAIL — 404 because the endpoint doesn't exist yet.

- [ ] **Step 3: Implement the endpoint**

Create `server/api/authors.get.ts`:

```typescript
import type { ContentStatus, Prisma } from '#prisma';

const VALID_STATUSES = new Set<string>([
  'DRAFT',
  'PUBLISHED',
  'CHANGED',
  'ARCHIVED',
]);

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));

  const where: Prisma.AuthorWhereInput = {};

  if (typeof query.status === 'string' && VALID_STATUSES.has(query.status)) {
    where.status = query.status as ContentStatus;
  }

  const [items, total] = await Promise.all([
    prisma.author.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.author.count({ where }),
  ]);

  return { items, total };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run -- server/api/authors/authors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/api/authors.get.ts server/api/authors/authors.test.ts
git commit -m "feat: author list endpoint with status filter"
```

### Task 7: Author Single-Item GET, PUT, and Options

**Files:**

- Create: `server/api/authors/[id].get.ts`
- Create: `server/api/authors/[id].put.ts`
- Create: `server/api/authors/options.get.ts`
- Modify: `server/api/authors/authors.test.ts`

- [ ] **Step 1: Add tests to authors.test.ts**

```typescript
describe('GET /api/authors/:id', () => {
  it('returns a single author with socialLinks', async () => {
    const { items } = await getList('authors');
    const author = await $fetch<Record<string, unknown>>(
      `/api/authors/${items[0].id}`,
      { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
    );
    expect(author.id).toBe(items[0].id);
    expect(author.name).toBeDefined();
    expect(author.socialLinks).toBeDefined();
    expect(Array.isArray(author.socialLinks)).toBe(true);
  });

  it('returns 404 for unknown id', async () => {
    const err = await $fetch(
      '/api/authors/00000000-0000-0000-0000-000000000000',
      {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      }
    ).catch((e: { response: { status: number } }) => e);
    expect((err as { response: { status: number } }).response.status).toBe(404);
  });
});

describe('PUT /api/authors/:id', () => {
  it('updates author name', async () => {
    const { items } = await getList('authors');
    const id = items.find((a) => a.name === 'Gareth Jones')?.id ?? items[0].id;
    const updated = await $fetch<Record<string, unknown>>(
      `/api/authors/${id}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        body: { name: 'Gareth Jones', bio: 'Updated bio.' },
      }
    );
    expect(updated.bio).toBe('Updated bio.');
  });

  it('replaces social links on save', async () => {
    const { items } = await getList('authors');
    const id = items.find((a) => a.name === 'Sarah Davies')?.id ?? items[1].id;
    const updated = await $fetch<Record<string, unknown>>(
      `/api/authors/${id}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        body: {
          socialLinks: [
            { platform: 'twitter', url: 'https://twitter.com/new' },
          ],
        },
      }
    );
    const links = (updated as Record<string, unknown>).socialLinks as Array<{
      platform: string;
      url: string;
    }>;
    expect(links).toHaveLength(1);
    expect(links[0].platform).toBe('twitter');
  });

  it('clears social links with empty array', async () => {
    const { items } = await getList('authors');
    const id = items.find((a) => a.name === 'Sarah Davies')?.id ?? items[1].id;
    const updated = await $fetch<Record<string, unknown>>(
      `/api/authors/${id}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        body: { socialLinks: [] },
      }
    );
    const links = (updated as Record<string, unknown>).socialLinks as unknown[];
    expect(links).toHaveLength(0);
  });
});

describe('GET /api/authors/options', () => {
  it('returns label/value pairs', async () => {
    const options = await $fetch<{ label: string; value: string }[]>(
      '/api/authors/options',
      { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
    );
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options[0]).toHaveProperty('label');
    expect(options[0]).toHaveProperty('value');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run -- server/api/authors/authors.test.ts`
Expected: FAIL — 404s for missing endpoints.

- [ ] **Step 3: Implement GET /api/authors/[id]**

Create `server/api/authors/[id].get.ts`:

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const author = await prisma.author.findUnique({
    where: { id },
    include: { socialLinks: true, headshot: true },
  });
  if (!author) {
    throw createError({ statusCode: 404, statusMessage: 'Author not found' });
  }
  return author;
});
```

- [ ] **Step 4: Implement PUT /api/authors/[id]**

Create `server/api/authors/[id].put.ts`:

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.author.findUnique({ where: { id } });
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Author not found' });
  }

  const data: Prisma.AuthorUncheckedUpdateInput = {};
  if ('name' in body) data.name = body.name as string;
  if ('bio' in body) data.bio = (body.bio as string) || undefined;
  if ('headshotId' in body)
    data.headshotId = (body.headshotId as string) || undefined;
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  // Social links: delete-and-recreate within a transaction
  const hasSocialLinks =
    'socialLinks' in body && Array.isArray(body.socialLinks);

  try {
    if (hasSocialLinks) {
      const links = body.socialLinks as Array<{
        platform: string;
        url: string;
      }>;
      const [, updated] = await prisma.$transaction([
        prisma.authorSocialLink.deleteMany({ where: { authorId: id! } }),
        prisma.author.update({
          where: { id },
          data: {
            ...data,
            socialLinks: {
              createMany: {
                data: links.map((l) => ({
                  platform: l.platform,
                  url: l.url,
                })),
              },
            },
          },
          include: { socialLinks: true },
        }),
      ]);
      return updated;
    }

    return await prisma.author.update({
      where: { id },
      data,
      include: { socialLinks: true },
    });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'An author with this name or slug already exists',
      });
    }
    throw err;
  }
});
```

- [ ] **Step 5: Implement GET /api/authors/options**

Create `server/api/authors/options.get.ts`:

```typescript
export default defineEventHandler(async () => {
  const authors = await prisma.author.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return authors.map((a) => ({ label: a.name, value: a.id }));
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test:run -- server/api/authors/authors.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/api/authors/
git commit -m "feat: author GET, PUT, options endpoints"
```

---

## Chunk 3: Tag REST API & Tests

### Task 8: Tag Endpoints

**Files:**

- Create: `server/api/tags.get.ts`
- Create: `server/api/tags/[id].get.ts`
- Create: `server/api/tags/[id].put.ts`
- Create: `server/api/tags/options.get.ts`
- Create: `server/api/tags/tags.test.ts`

- [ ] **Step 1: Write all tag tests**

Create `server/api/tags/tags.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { setup, $fetch } from '@nuxt/test-utils/e2e';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

type ListItem = {
  id: string;
  status: string;
  [key: string]: unknown;
};

type ListResponse = { items: ListItem[]; total: number };

function getList(model: string, params: Record<string, string | number> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.append(key, String(value));
  }
  const qs = search.toString();
  return $fetch<ListResponse>(`/api/${model}${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
  });
}

describe('Tag endpoints', async () => {
  await setup({ dev: true });

  describe('GET /api/tags', () => {
    it('returns all tags', async () => {
      const { items, total } = await getList('tags');
      expect(total).toBe(3);
      expect(items).toHaveLength(3);
    });

    it('filters by status=PUBLISHED', async () => {
      const { items } = await getList('tags', { status: 'PUBLISHED' });
      expect(items.every((t) => t.status === 'PUBLISHED')).toBe(true);
    });

    it('filters by status=DRAFT returns empty', async () => {
      const { items, total } = await getList('tags', { status: 'DRAFT' });
      expect(items).toHaveLength(0);
      expect(total).toBe(0);
    });

    it('ignores invalid status values', async () => {
      const { total } = await getList('tags', { status: 'INVALID' });
      expect(total).toBe(3);
    });

    it('paginates results', async () => {
      const { items } = await getList('tags', { perPage: 1 });
      expect(items).toHaveLength(1);
    });
  });

  describe('GET /api/tags/:id', () => {
    it('returns a single tag', async () => {
      const { items } = await getList('tags');
      const tag = await $fetch<Record<string, unknown>>(
        `/api/tags/${items[0].id}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(tag.id).toBe(items[0].id);
      expect(tag.name).toBeDefined();
    });

    it('returns 404 for unknown id', async () => {
      const err = await $fetch(
        '/api/tags/00000000-0000-0000-0000-000000000000',
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      ).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        404
      );
    });
  });

  describe('PUT /api/tags/:id', () => {
    it('updates tag name', async () => {
      const { items } = await getList('tags');
      const id = items.find((t) => t.name === 'Youth')?.id ?? items[0].id;
      const updated = await $fetch<Record<string, unknown>>(`/api/tags/${id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        body: { name: 'Youth' },
      });
      expect(updated.name).toBe('Youth');
    });
  });

  describe('GET /api/tags/options', () => {
    it('returns label/value pairs', async () => {
      const options = await $fetch<{ label: string; value: string }[]>(
        '/api/tags/options',
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(options.length).toBeGreaterThanOrEqual(3);
      expect(options[0]).toHaveProperty('label');
      expect(options[0]).toHaveProperty('value');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run -- server/api/tags/tags.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement all tag endpoints**

Create `server/api/tags.get.ts`:

```typescript
import type { ContentStatus, Prisma } from '#prisma';

const VALID_STATUSES = new Set<string>([
  'DRAFT',
  'PUBLISHED',
  'CHANGED',
  'ARCHIVED',
]);

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));

  const where: Prisma.TagWhereInput = {};

  if (typeof query.status === 'string' && VALID_STATUSES.has(query.status)) {
    where.status = query.status as ContentStatus;
  }

  const [items, total] = await Promise.all([
    prisma.tag.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.tag.count({ where }),
  ]);

  return { items, total };
});
```

Create `server/api/tags/[id].get.ts`:

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const tag = await prisma.tag.findUnique({ where: { id } });
  if (!tag) {
    throw createError({ statusCode: 404, statusMessage: 'Tag not found' });
  }
  return tag;
});
```

Create `server/api/tags/[id].put.ts`:

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.tag.findUnique({ where: { id } });
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Tag not found' });
  }

  const data: Prisma.TagUncheckedUpdateInput = {};
  if ('name' in body) data.name = body.name as string;
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  try {
    return await prisma.tag.update({ where: { id }, data });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A tag with this name or slug already exists',
      });
    }
    throw err;
  }
});
```

Create `server/api/tags/options.get.ts`:

```typescript
export default defineEventHandler(async () => {
  const tags = await prisma.tag.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return tags.map((t) => ({ label: t.name, value: t.id }));
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run -- server/api/tags/tags.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/api/tags.get.ts server/api/tags/
git commit -m "feat: tag list, GET, PUT, options endpoints with tests"
```

---

## Chunk 4: Article REST API & Tests

### Task 9: Article Endpoints & Images Options

**Files:**

- Create: `server/api/articles.get.ts`
- Create: `server/api/articles/[id].get.ts`
- Create: `server/api/articles/[id].put.ts`
- Create: `server/api/images/options.get.ts`
- Create: `server/api/articles/articles.test.ts`

- [ ] **Step 1: Write article tests**

Create `server/api/articles/articles.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { setup, $fetch } from '@nuxt/test-utils/e2e';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

type ListItem = {
  id: string;
  status: string;
  [key: string]: unknown;
};

type ListResponse = { items: ListItem[]; total: number };

function getList(model: string, params: Record<string, string | number> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.append(key, String(value));
  }
  const qs = search.toString();
  return $fetch<ListResponse>(`/api/${model}${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
  });
}

describe('Article endpoints', async () => {
  await setup({ dev: true });

  describe('GET /api/articles', () => {
    it('returns all articles', async () => {
      const { items, total } = await getList('articles');
      expect(total).toBe(3);
      expect(items).toHaveLength(3);
    });

    it('filters by status=PUBLISHED', async () => {
      const { items, total } = await getList('articles', {
        status: 'PUBLISHED',
      });
      expect(total).toBe(2);
      expect(items.every((a) => a.status === 'PUBLISHED')).toBe(true);
    });

    it('filters by status=DRAFT', async () => {
      const { items, total } = await getList('articles', {
        status: 'DRAFT',
      });
      expect(total).toBe(1);
      expect(items[0].status).toBe('DRAFT');
    });

    it('filters by authorId', async () => {
      const authors = await getList('authors');
      const authorId = authors.items[0].id;
      const { items } = await getList('articles', { authorId });
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((a) => a.authorId === authorId)).toBe(true);
    });

    it('filters by tagId', async () => {
      const tags = await getList('tags');
      const tagId =
        tags.items.find((t) => t.name === 'Club News')?.id ?? tags.items[0].id;
      const { items } = await getList('articles', { tagId });
      expect(items.length).toBeGreaterThan(0);
    });

    it('combines status and authorId filters', async () => {
      const authors = await getList('authors');
      const authorId =
        authors.items.find((a) => a.name === 'Gareth Jones')?.id ??
        authors.items[0].id;
      const { items } = await getList('articles', {
        authorId,
        status: 'PUBLISHED',
      });
      expect(items.every((a) => a.status === 'PUBLISHED')).toBe(true);
      expect(items.every((a) => a.authorId === authorId)).toBe(true);
    });

    it('paginates results', async () => {
      const { items } = await getList('articles', { perPage: 1 });
      expect(items).toHaveLength(1);
    });
  });

  describe('GET /api/articles/:id', () => {
    it('returns article with author, tags, featuredImage', async () => {
      const { items } = await getList('articles');
      const article = await $fetch<Record<string, unknown>>(
        `/api/articles/${items[0].id}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(article.id).toBe(items[0].id);
      expect(article.title).toBeDefined();
      expect(article.tags).toBeDefined();
      expect(Array.isArray(article.tags)).toBe(true);
    });

    it('returns 404 for unknown id', async () => {
      const err = await $fetch(
        '/api/articles/00000000-0000-0000-0000-000000000000',
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      ).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        404
      );
    });
  });

  describe('PUT /api/articles/:id', () => {
    it('updates article fields', async () => {
      const { items } = await getList('articles');
      const id =
        items.find((a) => a.title === 'Opening Day Victory')?.id ?? items[0].id;
      const updated = await $fetch<Record<string, unknown>>(
        `/api/articles/${id}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
          body: { summary: 'Updated summary.' },
        }
      );
      expect(updated.summary).toBe('Updated summary.');
    });

    it('assigns tags via tagIds', async () => {
      const { items: articles } = await getList('articles');
      const { items: tags } = await getList('tags');
      const articleId =
        articles.find((a) => a.title === 'Opening Day Victory')?.id ??
        articles[0].id;
      const tagIds = tags.slice(0, 2).map((t) => t.id);
      const updated = await $fetch<Record<string, unknown>>(
        `/api/articles/${articleId}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
          body: { tagIds },
        }
      );
      const updatedTags = updated.tags as Array<{ id: string }>;
      expect(updatedTags).toHaveLength(2);
    });

    it('saves body as JSON', async () => {
      const { items } = await getList('articles');
      const id = items[0].id;
      const body = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Test content.' }],
          },
        ],
      };
      const updated = await $fetch<Record<string, unknown>>(
        `/api/articles/${id}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
          body: { body },
        }
      );
      expect(updated.body).toEqual(body);
    });
  });

  describe('GET /api/images/options', () => {
    it('returns label/value pairs', async () => {
      const options = await $fetch<{ label: string; value: string }[]>(
        '/api/images/options',
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(options.length).toBeGreaterThanOrEqual(1);
      expect(options[0]).toHaveProperty('label');
      expect(options[0]).toHaveProperty('value');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run -- server/api/articles/articles.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement images options endpoint**

Create `server/api/images/options.get.ts`:

```typescript
export default defineEventHandler(async () => {
  const images = await prisma.image.findMany({
    select: { id: true, entryTitle: true, originalName: true },
    orderBy: { updatedAt: 'desc' },
  });
  return images.map((i) => ({
    label: i.entryTitle || i.originalName || i.id,
    value: i.id,
  }));
});
```

- [ ] **Step 4: Implement article list endpoint**

Create `server/api/articles.get.ts`:

```typescript
import type { ContentStatus, Prisma } from '#prisma';

const VALID_STATUSES = new Set<string>([
  'DRAFT',
  'PUBLISHED',
  'CHANGED',
  'ARCHIVED',
]);

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(query.perPage) || 15));

  const where: Prisma.ArticleWhereInput = {};

  if (typeof query.status === 'string' && VALID_STATUSES.has(query.status)) {
    where.status = query.status as ContentStatus;
  }
  if (typeof query.authorId === 'string' && query.authorId) {
    where.authorId = query.authorId;
  }
  if (typeof query.tagId === 'string' && query.tagId) {
    where.tags = { some: { id: query.tagId } };
  }

  const [items, total] = await Promise.all([
    prisma.article.findMany({
      where,
      include: { author: true, tags: true, featuredImage: true },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.article.count({ where }),
  ]);

  return { items, total };
});
```

- [ ] **Step 5: Implement article single-item GET**

Create `server/api/articles/[id].get.ts`:

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const article = await prisma.article.findUnique({
    where: { id },
    include: { author: true, tags: true, featuredImage: true },
  });
  if (!article) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Article not found',
    });
  }
  return article;
});
```

- [ ] **Step 6: Implement article PUT**

Create `server/api/articles/[id].put.ts`:

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.article.findUnique({ where: { id } });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Article not found',
    });
  }

  const data: Prisma.ArticleUncheckedUpdateInput = {};
  if ('title' in body) data.title = body.title as string;
  if ('summary' in body) data.summary = (body.summary as string) || undefined;
  if ('body' in body) data.body = body.body as Prisma.InputJsonValue;
  if ('authorId' in body)
    data.authorId = (body.authorId as string) || undefined;
  if ('featuredImageId' in body)
    data.featuredImageId = (body.featuredImageId as string) || undefined;
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  // Handle tag assignment
  const hasTagIds = 'tagIds' in body && Array.isArray(body.tagIds);

  try {
    return await prisma.article.update({
      where: { id },
      data: {
        ...data,
        ...(hasTagIds && {
          tags: {
            set: (body.tagIds as string[]).map((tagId) => ({ id: tagId })),
          },
        }),
      },
      include: { author: true, tags: true, featuredImage: true },
    });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'An article with this title or slug already exists',
      });
    }
    throw err;
  }
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test:run -- server/api/articles/articles.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/api/articles.get.ts server/api/articles/ server/api/images/options.get.ts
git commit -m "feat: article endpoints with filters, tag assignment, images options"
```

---

## Chunk 5: Content Endpoint & GraphQL

### Task 10: Update Content Endpoint

**Files:**

- Modify: `server/api/content.get.ts`

- [ ] **Step 1: Add new models to CONTENT_TABLES**

In `server/api/content.get.ts`, change the `CONTENT_TABLES` array:

```typescript
const CONTENT_TABLES = [
  'Team',
  'Club',
  'Competition',
  'Season',
  'Fixture',
  'Player',
  'Image',
  'Author',
  'Tag',
  'Article',
] as const;
```

- [ ] **Step 2: Run existing content tests**

Run: `pnpm test:run -- server/api/content/content.test.ts`
Expected: Some tests may need updating due to changed totals — update expected counts to include the new seeded data.

- [ ] **Step 3: Add content type filter tests for new models**

Add to `server/api/content/content.test.ts`:

```typescript
it('filters by contentType=Author', async () => {
  const { items, total } = await getContent({ contentType: 'Author' });
  expect(total).toBe(2);
  expect(items.every((i) => i.contentType === 'Author')).toBe(true);
});

it('filters by contentType=Tag', async () => {
  const { items, total } = await getContent({ contentType: 'Tag' });
  expect(total).toBe(3);
  expect(items.every((i) => i.contentType === 'Tag')).toBe(true);
});

it('filters by contentType=Article', async () => {
  const { items, total } = await getContent({ contentType: 'Article' });
  expect(total).toBe(3);
  expect(items.every((i) => i.contentType === 'Article')).toBe(true);
});
```

- [ ] **Step 4: Run content tests to verify they pass**

Run: `pnpm test:run -- server/api/content/content.test.ts`
Expected: PASS (may need to adjust existing total counts)

- [ ] **Step 5: Commit**

```bash
git add server/api/content.get.ts server/api/content/content.test.ts
git commit -m "feat: add Author, Tag, Article to content endpoint"
```

### Task 11: GraphQL Types

**Files:**

- Create: `server/graphql/types/author.ts`
- Create: `server/graphql/types/tag.ts`
- Create: `server/graphql/types/article.ts`
- Modify: `server/graphql/filters.ts`
- Modify: `server/graphql/query/index.ts`
- Modify: `server/graphql/schema.ts`

- [ ] **Step 1: Add where filters to filters.ts**

Add after the existing `ScoreWhere` in `server/graphql/filters.ts`:

```typescript
export const AuthorWhere = builder.prismaWhere('Author', {
  fields: {
    entryTitle: StringFilter,
    name: StringFilter,
    slug: StringFilter,
    status: ContentStatusFilter,
  },
});

export const TagWhere = builder.prismaWhere('Tag', {
  fields: {
    entryTitle: StringFilter,
    name: StringFilter,
    slug: StringFilter,
    status: ContentStatusFilter,
  },
});

// List relation filter for many-to-many Tag
const TagListRelationFilter = builder.inputType('TagListRelationFilter', {
  fields: (t) => ({
    some: t.field({ type: TagWhere }),
    every: t.field({ type: TagWhere }),
    none: t.field({ type: TagWhere }),
  }),
});

const AuthorRelationFilter = builder.inputType('AuthorRelationFilter', {
  fields: (t) => ({
    is: t.field({ type: AuthorWhere }),
    isNot: t.field({ type: AuthorWhere }),
  }),
});

export const ArticleWhere = builder.prismaWhere('Article', {
  fields: {
    entryTitle: StringFilter,
    title: StringFilter,
    slug: StringFilter,
    status: ContentStatusFilter,
    author: AuthorRelationFilter,
    tags: TagListRelationFilter,
  } as never,
});
```

- [ ] **Step 2: Create author.ts GraphQL type**

Create `server/graphql/types/author.ts`:

```typescript
import { builder } from '../builder';
import { ArticleWhere, AuthorSocialLinkWhere } from '../filters';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('AuthorSocialLink', {
  fields: (t) => ({
    id: t.exposeID('id'),
    platform: t.exposeString('platform'),
    url: t.exposeString('url'),
  }),
});

builder.prismaObject('Author', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    slug: t.exposeString('slug'),
    bio: t.exposeString('bio', { nullable: true }),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    headshot: t.relation('headshot', { nullable: true }),
    socialLinks: t.relation('socialLinks'),
    articles: t.relatedConnection('articles', {
      cursor: 'id',
      args: { where: t.arg({ type: ArticleWhere }) },
      query: (args) => ({ where: args.where ?? undefined }),
    }),
  }),
});

export const _registered = true;
```

- [ ] **Step 3: Create tag.ts GraphQL type**

Create `server/graphql/types/tag.ts`:

```typescript
import { builder } from '../builder';
import { ArticleWhere } from '../filters';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('Tag', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    slug: t.exposeString('slug'),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    articles: t.relatedConnection('articles', {
      cursor: 'id',
      args: { where: t.arg({ type: ArticleWhere }) },
      query: (args) => ({ where: args.where ?? undefined }),
    }),
  }),
});

export const _registered = true;
```

- [ ] **Step 4: Create article.ts GraphQL type**

Create `server/graphql/types/article.ts`:

```typescript
import { builder } from '../builder';
import { TagWhere } from '../filters';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('Article', {
  fields: (t) => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
    slug: t.exposeString('slug'),
    summary: t.exposeString('summary', { nullable: true }),
    body: t.expose('body', { type: 'JSON', nullable: true }),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    author: t.relation('author', { nullable: true }),
    featuredImage: t.relation('featuredImage', { nullable: true }),
    tags: t.relatedConnection('tags', {
      cursor: 'id',
      args: { where: t.arg({ type: TagWhere }) },
      query: (args) => ({ where: args.where ?? undefined }),
    }),
  }),
});

export const _registered = true;
```

**Important:** Before creating this file, register a JSON scalar in `server/graphql/builder.ts`. Add `JSON` to the `Scalars` type parameter and register the scalar:

In the builder type parameter, add alongside `DateTime`:

```typescript
JSON: {
  Input: unknown;
  Output: unknown;
}
```

After the DateTime scalar registration, add:

```typescript
builder.scalarType('JSON', {
  serialize: (value) => value,
  parseValue: (value) => value,
});
```

- [ ] **Step 5: Add root queries to query/index.ts**

Add imports at the top of `server/graphql/query/index.ts`:

```typescript
import {
  // ... existing imports
  AuthorWhere,
  TagWhere,
  ArticleWhere,
} from '../filters';
```

Add inside the `fields` callback:

```typescript
    // Author
    authors: t.prismaConnection({
      type: 'Author',
      cursor: 'id',
      args: { where: t.arg({ type: AuthorWhere }) },
      resolve: (query, _root, args) =>
        prisma.author.findMany({ ...query, where: args.where ?? undefined }),
    }),
    author: t.prismaField({
      type: 'Author',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.author.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Tag
    tags: t.prismaConnection({
      type: 'Tag',
      cursor: 'id',
      args: { where: t.arg({ type: TagWhere }) },
      resolve: (query, _root, args) =>
        prisma.tag.findMany({ ...query, where: args.where ?? undefined }),
    }),
    tag: t.prismaField({
      type: 'Tag',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.tag.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Article
    articles: t.prismaConnection({
      type: 'Article',
      cursor: 'id',
      args: { where: t.arg({ type: ArticleWhere }) },
      resolve: (query, _root, args) =>
        prisma.article.findMany({
          ...query,
          where: args.where ?? undefined,
        }),
    }),
    article: t.prismaField({
      type: 'Article',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.article.findUnique({ ...query, where: { id: args.id } }),
    }),
```

- [ ] **Step 6: Register types in schema.ts**

Add imports to `server/graphql/schema.ts`:

```typescript
import { _registered as _author } from './types/author';
import { _registered as _tag } from './types/tag';
import { _registered as _article } from './types/article';
```

Add to the `void [...]` array:

```typescript
  _author,
  _tag,
  _article,
```

- [ ] **Step 7: Add GraphQL tests**

Add to `server/api/graphql/graphql.test.ts`:

```typescript
describe('Author queries', () => {
  it('lists authors', async () => {
    const { data } = await gql(`{
      authors(first: 10) {
        edges { node { id name slug bio } }
      }
    }`);
    expect(data.authors.edges.length).toBeGreaterThanOrEqual(2);
  });

  it('fetches single author with socialLinks', async () => {
    const { data: list } = await gql(`{
      authors(first: 1) { edges { node { id } } }
    }`);
    const id = list.authors.edges[0].node.id;
    const { data } = await gql(`{
      author(id: "${id}") { id name socialLinks { id platform url } }
    }`);
    expect(data.author.id).toBe(id);
    expect(data.author.socialLinks).toBeDefined();
  });
});

describe('Tag queries', () => {
  it('lists tags', async () => {
    const { data } = await gql(`{
      tags(first: 10) {
        edges { node { id name slug } }
      }
    }`);
    expect(data.tags.edges.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Article queries', () => {
  it('lists articles', async () => {
    const { data } = await gql(`{
      articles(first: 10) {
        edges { node { id title slug summary } }
      }
    }`);
    expect(data.articles.edges.length).toBeGreaterThanOrEqual(3);
  });

  it('fetches single article with relations', async () => {
    const { data: list } = await gql(`{
      articles(first: 1) { edges { node { id } } }
    }`);
    const id = list.articles.edges[0].node.id;
    const { data } = await gql(`{
      article(id: "${id}") {
        id title
        author { id name }
        tags(first: 10) { edges { node { id name } } }
      }
    }`);
    expect(data.article.id).toBe(id);
  });

  it('filters articles by status', async () => {
    const { data } = await gql(`{
      articles(first: 10, where: { status: { equals: DRAFT } }) {
        edges { node { id title status } }
      }
    }`);
    expect(data.articles.edges.length).toBe(1);
  });
});
```

- [ ] **Step 8: Run all GraphQL tests**

Run: `pnpm test:run -- server/api/graphql/graphql.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add server/graphql/ server/api/graphql/graphql.test.ts
git commit -m "feat: GraphQL types and queries for Author, Tag, Article"
```

---

## Chunk 6: CMS Pages (Tag, Author)

### Task 12: New Field Types & ContentEditor Updates

**Files:**

- Modify: `types/contentEditor.ts`
- Modify: `components/ContentEditor.vue`

- [ ] **Step 1: Add RichtextFieldConfig and MultirelationFieldConfig**

Add to `types/contentEditor.ts` before the `FieldConfig` union:

```typescript
export interface RichtextFieldConfig {
  type: 'richtext';
  key: string;
  label: string;
}

export interface MultirelationFieldConfig {
  type: 'multirelation';
  key: string;
  label: string;
  optionsEndpoint: string;
}
```

Update the `FieldConfig` union:

```typescript
export type FieldConfig =
  | TextFieldConfig
  | TextareaFieldConfig
  | NumberFieldConfig
  | BooleanFieldConfig
  | DatetimeFieldConfig
  | SelectFieldConfig
  | RelationFieldConfig
  | RichtextFieldConfig
  | MultirelationFieldConfig;
```

- [ ] **Step 2: Update ContentEditor.vue to handle multirelation**

Add to the `onMounted` block — alongside the existing relation field fetching, also fetch for `multirelation` fields:

```typescript
const multirelationFields = props.fields.filter(
  (f): f is Extract<FieldConfig, { type: 'multirelation' }> =>
    f.type === 'multirelation'
);
await Promise.all([
  ...relationFields.map(async (field) => {
    const data = await $fetch<{ label: string; value: string }[]>(
      field.optionsEndpoint
    );
    relationOptions[field.key] = data;
  }),
  ...multirelationFields.map(async (field) => {
    const data = await $fetch<{ label: string; value: string }[]>(
      field.optionsEndpoint
    );
    relationOptions[field.key] = data;
  }),
]);
```

Add a template block for `multirelation` after the `relation` block:

```vue
<UFormField
  v-else-if="field.type === 'multirelation'"
  :label="field.label"
  :name="field.key"
  size="xl"
>
  <USelectMenu
    :model-value="(state[field.key] as string[]) ?? []"
    :items="relationOptions[field.key] ?? []"
    value-key="value"
    multiple
    placeholder="Select..."
    class="w-full"
    @update:model-value="state[field.key] = $event"
  />
</UFormField>
```

Add a template block for `richtext` (placeholder — will render RichTextEditor once built):

```vue
<UFormField
  v-else-if="field.type === 'richtext'"
  :label="field.label"
  :name="field.key"
  size="xl"
>
  <RichTextEditor
    :model-value="state[field.key]"
    @update:model-value="state[field.key] = $event"
  />
</UFormField>
```

- [ ] **Step 3: Commit**

```bash
git add types/contentEditor.ts components/ContentEditor.vue
git commit -m "feat: add richtext and multirelation field types to ContentEditor"
```

### Task 13: Tag CMS Pages

**Files:**

- Create: `pages/tags/index.vue`
- Create: `pages/tags/[id].vue`

- [ ] **Step 1: Create tag list page**

Create `pages/tags/index.vue`:

```vue
<script setup lang="ts">
const page = ref(1);

const { data, status } = await useFetch('/api/tags', {
  query: { page, perPage: 15 },
  watch: [page],
});
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Tags"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => '/tags/' + row.id"
  />
</template>
```

- [ ] **Step 2: Create tag edit page**

Create `pages/tags/[id].vue`:

```vue
<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const id = route.params.id as string;

const fields: FieldConfig[] = [
  { type: 'text', key: 'name', label: 'Name', required: true },
];

const { formState, loadingStatus, isSaving, saveError, save, generateSlug } =
  useContentEditor('tags', id);

watch(
  () => formState.name,
  (name) => {
    if (typeof name === 'string') {
      formState.entryTitle = name;
      formState.slug = generateSlug(name);
    }
  }
);
</script>

<template>
  <ContentEditor
    v-model:state="formState"
    title="Edit Tag"
    :fields="fields"
    :loading="loadingStatus === 'pending'"
    :saving="isSaving"
    :error="saveError"
    :on-save="save"
  />
</template>
```

- [ ] **Step 3: Commit**

```bash
git add pages/tags/
git commit -m "feat: tag list and edit CMS pages"
```

### Task 14: Author CMS Pages

**Files:**

- Modify: `components/ContentEditor.vue`
- Create: `pages/authors/index.vue`
- Create: `pages/authors/[id].vue`

- [ ] **Step 1: Add `#after-fields` slot to ContentEditor.vue**

In `components/ContentEditor.vue`, add `<slot name="after-fields" />` right before the `<USeparator label="Publishing" />` line.

- [ ] **Step 2: Create author list page**

Create `pages/authors/index.vue`:

```vue
<script setup lang="ts">
const page = ref(1);

const { data, status } = await useFetch('/api/authors', {
  query: { page, perPage: 15 },
  watch: [page],
});
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Authors"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => '/authors/' + row.id"
  />
</template>
```

- [ ] **Step 2: Create author edit page with social links section**

Create `pages/authors/[id].vue`:

```vue
<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const id = route.params.id as string;

const fields: FieldConfig[] = [
  { type: 'text', key: 'name', label: 'Name', required: true },
  { type: 'textarea', key: 'bio', label: 'Bio', rows: 6 },
  {
    type: 'relation',
    key: 'headshotId',
    label: 'Headshot',
    optionsEndpoint: '/api/images/options',
  },
];

const { formState, loadingStatus, isSaving, saveError, save, generateSlug } =
  useContentEditor('authors', id);

watch(
  () => formState.name,
  (name) => {
    if (typeof name === 'string') {
      formState.entryTitle = name;
      formState.slug = generateSlug(name);
    }
  }
);

// Social links management
type SocialLink = { platform: string; url: string };

const socialLinks = computed({
  get: () => (formState.socialLinks as SocialLink[] | undefined) ?? [],
  set: (val) => {
    formState.socialLinks = val;
  },
});

function addSocialLink() {
  socialLinks.value = [...socialLinks.value, { platform: '', url: '' }];
}

function removeSocialLink(index: number) {
  socialLinks.value = socialLinks.value.filter((_, i) => i !== index);
}
</script>

<template>
  <ContentEditor
    v-model:state="formState"
    title="Edit Author"
    :fields="fields"
    :loading="loadingStatus === 'pending'"
    :saving="isSaving"
    :error="saveError"
    :on-save="save"
  >
    <template #after-fields>
      <USeparator label="Social Links" />
      <div class="space-y-3">
        <div
          v-for="(link, index) in socialLinks"
          :key="index"
          class="flex gap-3 items-start"
        >
          <UInput
            :model-value="link.platform"
            placeholder="Platform (e.g. twitter)"
            class="w-40"
            @update:model-value="
              socialLinks = socialLinks.map((l, i) =>
                i === index ? { ...l, platform: $event as string } : l
              )
            "
          />
          <UInput
            :model-value="link.url"
            placeholder="URL"
            class="flex-1"
            @update:model-value="
              socialLinks = socialLinks.map((l, i) =>
                i === index ? { ...l, url: $event as string } : l
              )
            "
          />
          <UButton
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            @click="removeSocialLink(index)"
          />
        </div>
        <UButton
          variant="outline"
          icon="i-lucide-plus"
          @click="addSocialLink()"
        >
          Add Social Link
        </UButton>
      </div>
    </template>
  </ContentEditor>
</template>
```

- [ ] **Step 4: Commit**

```bash
git add components/ContentEditor.vue pages/authors/
git commit -m "feat: author list and edit CMS pages with social links"
```

---

## Chunk 7: Tiptap Rich Text Editor

### Task 15: Install Tiptap Dependencies

- [ ] **Step 1: Install packages**

Run:

```bash
pnpm add @tiptap/vue-3 @tiptap/starter-kit @tiptap/extension-table @tiptap/extension-table-row @tiptap/extension-table-cell @tiptap/extension-table-header @tiptap/extension-link @tiptap/extension-image @tiptap/extension-code-block-lowlight @tiptap/pm lowlight
```

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat: add Tiptap rich text editor dependencies"
```

### Task 16: CmsEmbed Custom Extension

**Files:**

- Create: `extensions/cmsEmbed.ts`
- Create: `components/CmsEmbedNode.vue`
- Create: `components/CmsEmbedModal.vue`

- [ ] **Step 1: Create CmsEmbed Tiptap extension**

Create `extensions/cmsEmbed.ts`:

```typescript
import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import CmsEmbedNode from '~/components/CmsEmbedNode.vue';

export const CmsEmbed = Node.create({
  name: 'cmsEmbed',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      embedType: { default: null },
      embedId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-cms-embed]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-cms-embed': '' })];
  },

  addNodeView() {
    return VueNodeViewRenderer(CmsEmbedNode);
  },
});
```

- [ ] **Step 2: Create CmsEmbedNode Vue component**

Create `components/CmsEmbedNode.vue`:

```vue
<script setup lang="ts">
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';

const props = defineProps(nodeViewProps);

const embedType = computed(() => props.node.attrs.embedType as string);
const embedId = computed(() => props.node.attrs.embedId as string);

const { data: item } = useFetch<Record<string, unknown>>(
  () => `/api/${embedType.value}s/${embedId.value}`,
  { watch: [embedType, embedId] }
);

const label = computed(() => {
  if (!item.value) return 'Loading...';
  return (
    (item.value.entryTitle as string) ||
    (item.value.name as string) ||
    (item.value.title as string) ||
    embedId.value
  );
});
</script>

<template>
  <NodeViewWrapper
    class="border rounded-lg p-3 my-2 bg-gray-50 dark:bg-gray-900 flex items-center gap-3"
    data-cms-embed
  >
    <UBadge :label="embedType" variant="subtle" size="xs" />
    <span class="font-medium">{{ label }}</span>
    <UButton
      variant="ghost"
      icon="i-lucide-x"
      size="xs"
      class="ml-auto"
      @click="props.deleteNode()"
    />
  </NodeViewWrapper>
</template>
```

Note: `NodeViewWrapper` and `deleteNode` come from `@tiptap/vue-3` node view props.

- [ ] **Step 3: Create CmsEmbedModal**

Create `components/CmsEmbedModal.vue`:

```vue
<script setup lang="ts">
const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  select: [embedType: string, embedId: string];
}>();

// Only models with /api/{model}s/options endpoints
const modelTypes = [
  { label: 'Team', value: 'team' },
  { label: 'Club', value: 'club' },
  { label: 'Competition', value: 'competition' },
  { label: 'Season', value: 'season' },
];

const selectedType = ref('fixture');
const { data: options } = useFetch<{ label: string; value: string }[]>(
  () => `/api/${selectedType.value}s/options`,
  { watch: [selectedType] }
);

const selectedId = ref('');

function confirm() {
  if (selectedId.value) {
    emit('select', selectedType.value, selectedId.value);
    emit('close');
    selectedId.value = '';
  }
}
</script>

<template>
  <UModal :open="open" @close="emit('close')">
    <template #header>
      <h3 class="text-lg font-semibold">Embed Content</h3>
    </template>

    <template #body>
      <div class="space-y-4">
        <UFormField label="Content Type">
          <USelect
            v-model="selectedType"
            :items="modelTypes"
            value-key="value"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Select Item">
          <USelect
            v-model="selectedId"
            :items="options ?? []"
            value-key="value"
            placeholder="Choose..."
            class="w-full"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="ghost" @click="emit('close')">Cancel</UButton>
        <UButton :disabled="!selectedId" @click="confirm">Embed</UButton>
      </div>
    </template>
  </UModal>
</template>
```

- [ ] **Step 4: Commit**

```bash
git add extensions/cmsEmbed.ts components/CmsEmbedNode.vue components/CmsEmbedModal.vue
git commit -m "feat: CmsEmbed Tiptap extension with NodeView and selection modal"
```

### Task 17: RichTextEditor Component

**Files:**

- Create: `components/RichTextEditor.vue`

- [ ] **Step 1: Create the editor component**

Create `components/RichTextEditor.vue`:

```vue
<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { CmsEmbed } from '~/extensions/cmsEmbed';

const props = defineProps<{
  modelValue: unknown;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: unknown];
}>();

const lowlight = createLowlight(common);

const showEmbedModal = ref(false);

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      codeBlock: false,
    }),
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    Link.configure({ openOnClick: false }),
    Image,
    CodeBlockLowlight.configure({ lowlight }),
    CmsEmbed,
  ],
  content: props.modelValue as Record<string, unknown> | null,
  onUpdate: ({ editor: e }) => {
    emit('update:modelValue', e.getJSON());
  },
});

watch(
  () => props.modelValue,
  (val) => {
    if (!editor.value) return;
    const currentJson = JSON.stringify(editor.value.getJSON());
    const newJson = JSON.stringify(val);
    if (currentJson !== newJson) {
      editor.value.commands.setContent(val as Record<string, unknown> | null);
    }
  }
);

function insertEmbed(embedType: string, embedId: string) {
  editor.value
    ?.chain()
    .focus()
    .insertContent({
      type: 'cmsEmbed',
      attrs: { embedType, embedId },
    })
    .run();
}

onBeforeUnmount(() => {
  editor.value?.destroy();
});
</script>

<template>
  <div class="border rounded-lg overflow-hidden">
    <div
      v-if="editor"
      class="flex flex-wrap gap-1 p-2 border-b bg-gray-50 dark:bg-gray-900"
    >
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-bold"
        :color="editor.isActive('bold') ? 'primary' : 'neutral'"
        @click="editor.chain().focus().toggleBold().run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-italic"
        :color="editor.isActive('italic') ? 'primary' : 'neutral'"
        @click="editor.chain().focus().toggleItalic().run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-heading-1"
        :color="
          editor.isActive('heading', { level: 1 }) ? 'primary' : 'neutral'
        "
        @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-heading-2"
        :color="
          editor.isActive('heading', { level: 2 }) ? 'primary' : 'neutral'
        "
        @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-heading-3"
        :color="
          editor.isActive('heading', { level: 3 }) ? 'primary' : 'neutral'
        "
        @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-list"
        :color="editor.isActive('bulletList') ? 'primary' : 'neutral'"
        @click="editor.chain().focus().toggleBulletList().run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-list-ordered"
        :color="editor.isActive('orderedList') ? 'primary' : 'neutral'"
        @click="editor.chain().focus().toggleOrderedList().run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-quote"
        :color="editor.isActive('blockquote') ? 'primary' : 'neutral'"
        @click="editor.chain().focus().toggleBlockquote().run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-code"
        :color="editor.isActive('codeBlock') ? 'primary' : 'neutral'"
        @click="editor.chain().focus().toggleCodeBlock().run()"
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-table"
        @click="
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        "
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-link"
        @click="
          () => {
            const url = window.prompt('URL');
            if (url) editor.chain().focus().setLink({ href: url }).run();
          }
        "
      />
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-box"
        @click="showEmbedModal = true"
      />
    </div>

    <EditorContent
      :editor="editor"
      class="prose dark:prose-invert max-w-none p-4 min-h-[200px]"
    />

    <CmsEmbedModal
      :open="showEmbedModal"
      @close="showEmbedModal = false"
      @select="insertEmbed"
    />
  </div>
</template>
```

- [ ] **Step 2: Verify the editor renders**

Run: `pnpm dev`
Navigate to any page that would use the editor (will be the article edit page in the next task). For now, verify no build errors.

- [ ] **Step 3: Commit**

```bash
git add components/RichTextEditor.vue
git commit -m "feat: RichTextEditor component with Tiptap toolbar and CmsEmbed"
```

---

## Chunk 8: Article CMS Pages & Navigation

### Task 18: Article CMS Pages

**Files:**

- Create: `pages/articles/index.vue`
- Create: `pages/articles/[id].vue`

- [ ] **Step 1: Create article list page**

Create `pages/articles/index.vue`:

```vue
<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';

const page = ref(1);

const { data, status } = await useFetch('/api/articles', {
  query: { page, perPage: 15 },
  watch: [page],
});

const extraColumns: TableColumn<Record<string, unknown>>[] = [
  { accessorKey: 'author', header: 'Author' },
  { accessorKey: 'tags', header: 'Tags' },
];
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Articles"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :columns="extraColumns"
    :row-link="(row) => '/articles/' + row.id"
  >
    <template #author-cell="{ row }">
      {{ (row.original.author as Record<string, unknown>)?.name ?? '—' }}
    </template>
    <template #tags-cell="{ row }">
      {{
        (row.original.tags as Array<{ name: string }>)
          ?.map((t) => t.name)
          .join(', ') || '—'
      }}
    </template>
  </ContentTable>
</template>
```

- [ ] **Step 2: Create article edit page**

Create `pages/articles/[id].vue`:

```vue
<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const id = route.params.id as string;

const fields: FieldConfig[] = [
  { type: 'text', key: 'title', label: 'Title', required: true },
  { type: 'textarea', key: 'summary', label: 'Summary', rows: 3 },
  {
    type: 'relation',
    key: 'authorId',
    label: 'Author',
    optionsEndpoint: '/api/authors/options',
  },
  {
    type: 'relation',
    key: 'featuredImageId',
    label: 'Featured Image',
    optionsEndpoint: '/api/images/options',
  },
  {
    type: 'multirelation',
    key: 'tagIds',
    label: 'Tags',
    optionsEndpoint: '/api/tags/options',
  },
  { type: 'richtext', key: 'body', label: 'Body' },
];

const { formState, loadingStatus, isSaving, saveError, save, generateSlug } =
  useContentEditor('articles', id);

watch(
  () => formState.title,
  (title) => {
    if (typeof title === 'string') {
      formState.entryTitle = title;
      formState.slug = generateSlug(title);
    }
  }
);

// Map tags array from API response to tagIds array for the multirelation field
watch(
  () => formState.tags,
  (tags) => {
    if (Array.isArray(tags)) {
      formState.tagIds = (tags as Array<{ id: string }>).map((t) => t.id);
    }
  },
  { immediate: true }
);
</script>

<template>
  <ContentEditor
    v-model:state="formState"
    title="Edit Article"
    :fields="fields"
    :loading="loadingStatus === 'pending'"
    :saving="isSaving"
    :error="saveError"
    :on-save="save"
  />
</template>
```

- [ ] **Step 3: Commit**

```bash
git add pages/articles/
git commit -m "feat: article list and edit CMS pages"
```

### Task 19: Sidebar Navigation

**Files:**

- Modify: `layouts/default.vue`

- [ ] **Step 1: Add new nav items**

In `layouts/default.vue`, add to the `navItems` array after the Images entry:

```typescript
  { label: 'Articles', icon: 'i-lucide-newspaper', to: '/articles' },
  { label: 'Authors', icon: 'i-lucide-pen-tool', to: '/authors' },
  { label: 'Tags', icon: 'i-lucide-tag', to: '/tags' },
```

- [ ] **Step 2: Commit**

```bash
git add layouts/default.vue
git commit -m "feat: add Articles, Authors, Tags to sidebar navigation"
```

---

## Chunk 9: Final Verification

### Task 20: Run All Tests & Lint

- [ ] **Step 1: Run full test suite**

Run: `pnpm test:run`
Expected: All tests pass. Fix any failures.

- [ ] **Step 2: Run linter**

Run: `pnpm lint:fix`
Expected: No errors (warnings OK).

- [ ] **Step 3: Run formatter**

Run: `pnpm format:fix`

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: No type errors.

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev`
Verify:

- Sidebar shows Articles, Authors, Tags links
- Each list page loads and shows seeded data
- Each edit page loads and shows the form
- Tag edit works (change name, save)
- Author edit works (change bio, add/remove social links, save)
- Article edit works (change title, assign tags, write rich text, embed content, save)
- All Content page shows articles, authors, tags in the unified listing

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address lint/type/test issues"
```

---

## Chunk 10: CLAUDE.md Update

### Task 21: Update CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update relevant sections**

Add to the Database Schema section:

- Author, AuthorSocialLink, Tag, Article model descriptions

Add to the Key Files section:

- New API route files, GraphQL types, CMS pages, RichTextEditor component, CmsEmbed extension

Add to the Architecture section:

- Rich text editing via Tiptap note
- `multirelation` and `richtext` field types in ContentEditor
- `#after-fields` slot in ContentEditor

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with article, author, tag documentation"
```
