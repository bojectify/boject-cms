# Navigation & Link Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CMS-managed Navigation, NavigationItem, and Link models with full REST API, GraphQL (including LinkTarget union type), CMS pages, seed data, and tests.

**Architecture:** Three new Prisma models — Link (standalone reusable), NavigationItem (structural join), Navigation (container). Link exposes an `internalLink` field as a GraphQL union type (`LinkTarget`) for type-discriminated queries. REST API follows existing patterns. CMS pages use ContentEditor/ContentTable.

**Tech Stack:** Prisma v7, Pothos (GraphQL), Nuxt 4, Nuxt UI, Vitest

---

### Task 1: Prisma Schema — Link, NavigationItem, Navigation

**Files:**

- Create: `prisma/schema/link.prisma`
- Create: `prisma/schema/navigationItem.prisma`
- Create: `prisma/schema/navigation.prisma`
- Modify: `prisma/schema/article.prisma` (add reverse relation)
- Create: `prisma/migrations/20260403120000_add_navigation_link/migration.sql`

- [ ] **Step 1: Create `prisma/schema/link.prisma`**

```prisma
model Link {
  id              String           @id @default(uuid())
  entryTitle      String           @default("")
  label           String
  url             String?
  article         Article?         @relation(fields: [articleId], references: [id], onDelete: SetNull)
  articleId       String?
  openInNewTab    Boolean          @default(false)
  navigationItems NavigationItem[]
  status          ContentStatus    @default(DRAFT)
  publishedAt     DateTime?
  createdBy       String?
  updatedBy       String?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
}
```

- [ ] **Step 2: Create `prisma/schema/navigationItem.prisma`**

```prisma
model NavigationItem {
  id           String           @id @default(uuid())
  order        Int              @default(0)
  link         Link             @relation(fields: [linkId], references: [id], onDelete: Cascade)
  linkId       String
  navigation   Navigation       @relation(fields: [navigationId], references: [id], onDelete: Cascade)
  navigationId String
  parent       NavigationItem?  @relation("NavigationItemChildren", fields: [parentId], references: [id], onDelete: Cascade)
  parentId     String?
  children     NavigationItem[] @relation("NavigationItemChildren")
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
}
```

- [ ] **Step 3: Create `prisma/schema/navigation.prisma`**

```prisma
model Navigation {
  id          String           @id @default(uuid())
  entryTitle  String           @default("")
  name        String           @unique
  items       NavigationItem[]
  status      ContentStatus    @default(DRAFT)
  publishedAt DateTime?
  createdBy   String?
  updatedBy   String?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
}
```

- [ ] **Step 4: Add reverse relation to Article**

In `prisma/schema/article.prisma`, add after the existing fields:

```prisma
  links       Link[]
```

- [ ] **Step 5: Generate migration SQL**

Run: `pnpx prisma migrate diff --from-schema-datasource prisma/schema --to-schema prisma/schema --script`

Then create the migration directory and file at `prisma/migrations/20260403120000_add_navigation_link/migration.sql` with the output. The SQL should contain:

```sql
-- CreateTable
CREATE TABLE "Link" (
    "id" TEXT NOT NULL,
    "entryTitle" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL,
    "url" TEXT,
    "articleId" TEXT,
    "openInNewTab" BOOLEAN NOT NULL DEFAULT false,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NavigationItem" (
    "id" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "linkId" TEXT NOT NULL,
    "navigationId" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NavigationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Navigation" (
    "id" TEXT NOT NULL,
    "entryTitle" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Navigation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Navigation_name_key" ON "Navigation"("name");

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NavigationItem" ADD CONSTRAINT "NavigationItem_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NavigationItem" ADD CONSTRAINT "NavigationItem_navigationId_fkey" FOREIGN KEY ("navigationId") REFERENCES "Navigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NavigationItem" ADD CONSTRAINT "NavigationItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "NavigationItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 6: Apply migration and regenerate client**

Run: `pnpx prisma migrate deploy && pnpm prisma:generate`

- [ ] **Step 7: Commit**

```bash
git add prisma/schema/link.prisma prisma/schema/navigationItem.prisma prisma/schema/navigation.prisma prisma/schema/article.prisma prisma/migrations/20260403120000_add_navigation_link/
git commit -m "feat: add Link, NavigationItem, Navigation schema and migration"
```

---

### Task 2: Link REST API

**Files:**

- Create: `server/api/links.get.ts`
- Create: `server/api/links/[id].get.ts`
- Create: `server/api/links/index.post.ts`
- Create: `server/api/links/[id].put.ts`
- Create: `server/api/links/options.get.ts`

- [ ] **Step 1: Write failing test — Link list endpoint**

Create `server/api/links/links.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

let _sessionCookie: string | null = null;

async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;

  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'password',
    }),
    headers: { 'Content-Type': 'application/json' },
  });

  const cookies = response.headers.getSetCookie();
  _sessionCookie = cookies.join('; ');
  return _sessionCookie;
}

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

describe('Link endpoints', async () => {
  await setup({ dev: true });

  describe('GET /api/links', () => {
    it('returns all links', async () => {
      const { items, total } = await getList('links');
      expect(total).toBeGreaterThanOrEqual(1);
      expect(items.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by status', async () => {
      const { items } = await getList('links', { status: 'PUBLISHED' });
      expect(items.every((l) => l.status === 'PUBLISHED')).toBe(true);
    });

    it('paginates results', async () => {
      const { items } = await getList('links', { perPage: 1 });
      expect(items).toHaveLength(1);
    });
  });

  describe('GET /api/links/:id', () => {
    it('returns a single link with article', async () => {
      const { items } = await getList('links');
      const link = await $fetch<Record<string, unknown>>(
        `/api/links/${items[0]!.id}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(link.id).toBe(items[0]!.id);
      expect(link.label).toBeDefined();
    });

    it('returns 404 for unknown id', async () => {
      const err = await $fetch(
        '/api/links/00000000-0000-0000-0000-000000000000',
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      ).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        404
      );
    });
  });

  describe('POST /api/links', () => {
    it('creates a link with url', async () => {
      const response = await fetch('/api/links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ label: 'Test Link', url: '/test-page' }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.label).toBe('Test Link');
      expect(body.url).toBe('/test-page');
      expect(body.status).toBe('DRAFT');
    });

    it('returns 400 when label is missing', async () => {
      const response = await fetch('/api/links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ url: '/some-page' }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 400 when both url and articleId are missing', async () => {
      const response = await fetch('/api/links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ label: 'Empty Link' }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('PUT /api/links/:id', () => {
    it('updates link label', async () => {
      const { items } = await getList('links');
      const id = items[0]!.id;
      const updated = await $fetch<Record<string, unknown>>(
        `/api/links/${id}`,
        {
          method: 'PUT',
          headers: { Cookie: await getSessionCookie() },
          body: { label: 'Updated Label' },
        }
      );
      expect(updated.label).toBe('Updated Label');
    });
  });

  describe('GET /api/links/options', () => {
    it('returns label/value pairs', async () => {
      const options = await $fetch<{ label: string; value: string }[]>(
        '/api/links/options',
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(options.length).toBeGreaterThanOrEqual(1);
      expect(options[0]!).toHaveProperty('label');
      expect(options[0]!).toHaveProperty('value');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run -- server/api/links/links.test.ts`
Expected: FAIL — endpoints don't exist yet.

- [ ] **Step 3: Create `server/api/links.get.ts`**

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

  const where: Prisma.LinkWhereInput = {};

  if (typeof query.status === 'string' && VALID_STATUSES.has(query.status)) {
    where.status = query.status as ContentStatus;
  }

  const [items, total] = await Promise.all([
    prisma.link.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
      include: { article: true },
    }),
    prisma.link.count({ where }),
  ]);

  return { items, total };
});
```

- [ ] **Step 4: Create `server/api/links/[id].get.ts`**

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const link = await prisma.link.findUnique({
    where: { id },
    include: { article: true },
  });
  if (!link) {
    throw createError({ statusCode: 404, statusMessage: 'Link not found' });
  }
  return link;
});
```

- [ ] **Step 5: Create `server/api/links/index.post.ts`**

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.label || typeof body.label !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'label is required',
    });
  }

  const hasUrl = 'url' in body && typeof body.url === 'string' && body.url;
  const hasArticleId =
    'articleId' in body && typeof body.articleId === 'string' && body.articleId;
  if (!hasUrl && !hasArticleId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Either url or articleId is required',
    });
  }

  const data: Prisma.LinkUncheckedCreateInput = {
    label: body.label as string,
    entryTitle: (body.label as string) || '',
  };
  if (hasUrl) data.url = body.url as string;
  if (hasArticleId) data.articleId = body.articleId as string;
  if ('openInNewTab' in body) data.openInNewTab = Boolean(body.openInNewTab);
  applyContentMetadata(body, data as Record<string, unknown>, null);

  const created = await prisma.link.create({
    data,
    include: { article: true },
  });
  setResponseStatus(event, 201);
  return created;
});
```

- [ ] **Step 6: Create `server/api/links/[id].put.ts`**

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.link.findUnique({ where: { id } });
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Link not found' });
  }

  const data: Prisma.LinkUncheckedUpdateInput = {};
  if ('label' in body) {
    data.label = body.label as string;
    data.entryTitle = body.label as string;
  }
  if ('url' in body) data.url = (body.url as string) || null;
  if ('articleId' in body) data.articleId = (body.articleId as string) || null;
  if ('openInNewTab' in body) data.openInNewTab = Boolean(body.openInNewTab);
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  return await prisma.link.update({
    where: { id },
    data,
    include: { article: true },
  });
});
```

- [ ] **Step 7: Create `server/api/links/options.get.ts`**

```typescript
export default defineEventHandler(async () => {
  const links = await prisma.link.findMany({
    select: { id: true, label: true },
    orderBy: { label: 'asc' },
  });
  return links.map((l) => ({ label: l.label, value: l.id }));
});
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test:run -- server/api/links/links.test.ts`
Expected: All tests PASS.

- [ ] **Step 9: Commit**

```bash
git add server/api/links.get.ts server/api/links/ server/api/links/links.test.ts
git commit -m "feat: add Link REST API endpoints with tests"
```

---

### Task 3: Navigation REST API

**Files:**

- Create: `server/api/navigations.get.ts`
- Create: `server/api/navigations/[id].get.ts`
- Create: `server/api/navigations/[id].put.ts`

- [ ] **Step 1: Write failing test**

Create `server/api/navigations/navigations.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

let _sessionCookie: string | null = null;

async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;

  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'password',
    }),
    headers: { 'Content-Type': 'application/json' },
  });

  const cookies = response.headers.getSetCookie();
  _sessionCookie = cookies.join('; ');
  return _sessionCookie;
}

type ListItem = {
  id: string;
  status: string;
  [key: string]: unknown;
};

type ListResponse = { items: ListItem[]; total: number };

describe('Navigation endpoints', async () => {
  await setup({ dev: true });

  describe('GET /api/navigations', () => {
    it('returns all navigations', async () => {
      const { items, total } = await $fetch<ListResponse>('/api/navigations', {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      expect(total).toBeGreaterThanOrEqual(1);
      expect(items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/navigations/:id', () => {
    it('returns navigation with nested items and links', async () => {
      const { items } = await $fetch<ListResponse>('/api/navigations', {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      const nav = await $fetch<Record<string, unknown>>(
        `/api/navigations/${items[0]!.id}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(nav.id).toBe(items[0]!.id);
      expect(nav.name).toBeDefined();
      expect(Array.isArray(nav.items)).toBe(true);
    });

    it('returns items ordered by order field', async () => {
      const { items } = await $fetch<ListResponse>('/api/navigations', {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      const nav = await $fetch<{
        items: { order: number; children: { order: number }[] }[];
      }>(`/api/navigations/${items[0]!.id}`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      const orders = nav.items.map((i) => i.order);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    });

    it('returns 404 for unknown id', async () => {
      const err = await $fetch(
        '/api/navigations/00000000-0000-0000-0000-000000000000',
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      ).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        404
      );
    });
  });

  describe('PUT /api/navigations/:id', () => {
    it('updates navigation name', async () => {
      const { items } = await $fetch<ListResponse>('/api/navigations', {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      const id = items[0]!.id;
      const updated = await $fetch<Record<string, unknown>>(
        `/api/navigations/${id}`,
        {
          method: 'PUT',
          headers: { Cookie: await getSessionCookie() },
          body: { name: 'Main Navigation' },
        }
      );
      expect(updated.name).toBe('Main Navigation');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run -- server/api/navigations/navigations.test.ts`
Expected: FAIL — endpoints don't exist yet.

- [ ] **Step 3: Create `server/api/navigations.get.ts`**

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

  const where: Prisma.NavigationWhereInput = {};

  if (typeof query.status === 'string' && VALID_STATUSES.has(query.status)) {
    where.status = query.status as ContentStatus;
  }

  const [items, total] = await Promise.all([
    prisma.navigation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.navigation.count({ where }),
  ]);

  return { items, total };
});
```

- [ ] **Step 4: Create `server/api/navigations/[id].get.ts`**

Returns the navigation with top-level items (parentId null), each including their children, all ordered by `order`:

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const navigation = await prisma.navigation.findUnique({
    where: { id },
    include: {
      items: {
        where: { parentId: null },
        orderBy: { order: 'asc' },
        include: {
          link: { include: { article: true } },
          children: {
            orderBy: { order: 'asc' },
            include: {
              link: { include: { article: true } },
            },
          },
        },
      },
    },
  });
  if (!navigation) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Navigation not found',
    });
  }
  return navigation;
});
```

- [ ] **Step 5: Create `server/api/navigations/[id].put.ts`**

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.navigation.findUnique({ where: { id } });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Navigation not found',
    });
  }

  const data: Prisma.NavigationUncheckedUpdateInput = {};
  if ('name' in body) {
    data.name = body.name as string;
    data.entryTitle = body.name as string;
  }
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  try {
    return await prisma.navigation.update({
      where: { id },
      data,
      include: {
        items: {
          where: { parentId: null },
          orderBy: { order: 'asc' },
          include: {
            link: { include: { article: true } },
            children: {
              orderBy: { order: 'asc' },
              include: { link: { include: { article: true } } },
            },
          },
        },
      },
    });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A navigation with this name already exists',
      });
    }
    throw err;
  }
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test:run -- server/api/navigations/navigations.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/api/navigations.get.ts server/api/navigations/
git commit -m "feat: add Navigation REST API endpoints with tests"
```

---

### Task 4: NavigationItem REST API

**Files:**

- Create: `server/api/navigation-items.get.ts`
- Create: `server/api/navigation-items/index.post.ts`
- Create: `server/api/navigation-items/[id].put.ts`
- Create: `server/api/navigation-items/[id].delete.ts`
- Create: `server/api/navigation-items/reorder.put.ts`

- [ ] **Step 1: Write failing test**

Create `server/api/navigation-items/navigation-items.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

let _sessionCookie: string | null = null;

async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;

  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'password',
    }),
    headers: { 'Content-Type': 'application/json' },
  });

  const cookies = response.headers.getSetCookie();
  _sessionCookie = cookies.join('; ');
  return _sessionCookie;
}

type NavResponse = {
  items: { id: string; order: number; parentId: string | null }[];
  total: number;
};

describe('NavigationItem endpoints', async () => {
  await setup({ dev: true });

  let navigationId: string;
  let linkId: string;

  it('setup: get navigation and create a test link', async () => {
    const navs = await $fetch<{ items: { id: string }[]; total: number }>(
      '/api/navigations',
      { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
    );
    navigationId = navs.items[0]!.id;

    const response = await fetch('/api/links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({
        label: `NavItem Test ${Date.now()}`,
        url: '/nav-test',
      }),
    });
    const link = await response.json();
    linkId = link.id;
  });

  describe('GET /api/navigation-items', () => {
    it('returns items for a navigation', async () => {
      const { items } = await $fetch<NavResponse>(
        `/api/navigation-items?navigationId=${navigationId}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(Array.isArray(items)).toBe(true);
    });

    it('returns 400 without navigationId', async () => {
      const err = await $fetch('/api/navigation-items', {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        400
      );
    });
  });

  describe('POST /api/navigation-items', () => {
    it('creates a top-level item', async () => {
      const response = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          navigationId,
          linkId,
          order: 99,
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.linkId).toBe(linkId);
      expect(body.navigationId).toBe(navigationId);
      expect(body.parentId).toBeNull();
    });

    it('creates a child item', async () => {
      const { items } = await $fetch<NavResponse>(
        `/api/navigation-items?navigationId=${navigationId}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      const parentId = items.find((i) => !i.parentId)?.id;

      const response = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          navigationId,
          linkId,
          parentId,
          order: 0,
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.parentId).toBe(parentId);
    });

    it('rejects nesting beyond two levels', async () => {
      const { items } = await $fetch<NavResponse>(
        `/api/navigation-items?navigationId=${navigationId}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      const childItem = items.find((i) => i.parentId);

      const response = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          navigationId,
          linkId,
          parentId: childItem?.id,
          order: 0,
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/navigation-items/:id', () => {
    it('deletes an item without deleting the link', async () => {
      // Create an item to delete
      const createRes = await fetch('/api/navigation-items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ navigationId, linkId, order: 999 }),
      });
      const created = await createRes.json();

      const deleteRes = await fetch(`/api/navigation-items/${created.id}`, {
        method: 'DELETE',
        headers: { Cookie: await getSessionCookie() },
      });
      expect(deleteRes.status).toBe(200);

      // Link should still exist
      const link = await $fetch<Record<string, unknown>>(
        `/api/links/${linkId}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      expect(link.id).toBe(linkId);
    });
  });

  describe('PUT /api/navigation-items/reorder', () => {
    it('bulk updates order values', async () => {
      const { items } = await $fetch<NavResponse>(
        `/api/navigation-items?navigationId=${navigationId}`,
        { headers: { Authorization: `Bearer ${TEST_API_KEY}` } }
      );
      const topLevel = items.filter((i) => !i.parentId);
      if (topLevel.length < 2) return; // skip if not enough items

      const reordered = topLevel.map((item, idx) => ({
        id: item.id,
        order: topLevel.length - 1 - idx,
        parentId: null,
      }));

      const updated = await $fetch<{ id: string; order: number }[]>(
        '/api/navigation-items/reorder',
        {
          method: 'PUT',
          headers: { Cookie: await getSessionCookie() },
          body: { items: reordered },
        }
      );

      expect(Array.isArray(updated)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run -- server/api/navigation-items/navigation-items.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `server/api/navigation-items.get.ts`**

```typescript
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const navigationId = query.navigationId as string;

  if (!navigationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'navigationId is required',
    });
  }

  const items = await prisma.navigationItem.findMany({
    where: { navigationId },
    orderBy: { order: 'asc' },
    include: {
      link: { include: { article: true } },
    },
  });

  return { items, total: items.length };
});
```

- [ ] **Step 4: Create `server/api/navigation-items/index.post.ts`**

```typescript
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.navigationId || typeof body.navigationId !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'navigationId is required',
    });
  }
  if (!body.linkId || typeof body.linkId !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'linkId is required',
    });
  }

  // Enforce two-level depth
  if (body.parentId && typeof body.parentId === 'string') {
    const parent = await prisma.navigationItem.findUnique({
      where: { id: body.parentId },
    });
    if (parent?.parentId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Cannot nest more than two levels deep',
      });
    }
  }

  const created = await prisma.navigationItem.create({
    data: {
      navigationId: body.navigationId as string,
      linkId: body.linkId as string,
      parentId: (body.parentId as string) || null,
      order: typeof body.order === 'number' ? body.order : 0,
    },
    include: { link: { include: { article: true } } },
  });
  setResponseStatus(event, 201);
  return created;
});
```

- [ ] **Step 5: Create `server/api/navigation-items/[id].put.ts`**

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.navigationItem.findUnique({ where: { id } });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Navigation item not found',
    });
  }

  // Enforce two-level depth if parentId is changing
  if ('parentId' in body && body.parentId) {
    const parent = await prisma.navigationItem.findUnique({
      where: { id: body.parentId as string },
    });
    if (parent?.parentId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Cannot nest more than two levels deep',
      });
    }
  }

  const data: Record<string, unknown> = {};
  if ('order' in body) data.order = Number(body.order);
  if ('parentId' in body) data.parentId = (body.parentId as string) || null;
  if ('linkId' in body) data.linkId = body.linkId as string;

  return await prisma.navigationItem.update({
    where: { id },
    data,
    include: { link: { include: { article: true } } },
  });
});
```

- [ ] **Step 6: Create `server/api/navigation-items/[id].delete.ts`**

```typescript
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');

  const existing = await prisma.navigationItem.findUnique({ where: { id } });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Navigation item not found',
    });
  }

  await prisma.navigationItem.delete({ where: { id } });
  return { success: true };
});
```

- [ ] **Step 7: Create `server/api/navigation-items/reorder.put.ts`**

```typescript
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    items: { id: string; order: number; parentId: string | null }[];
  }>(event);

  if (!Array.isArray(body.items)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'items array is required',
    });
  }

  const updated = await prisma.$transaction(
    body.items.map((item) =>
      prisma.navigationItem.update({
        where: { id: item.id },
        data: { order: item.order, parentId: item.parentId },
      })
    )
  );

  return updated;
});
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test:run -- server/api/navigation-items/navigation-items.test.ts`
Expected: All tests PASS.

- [ ] **Step 9: Commit**

```bash
git add server/api/navigation-items.get.ts server/api/navigation-items/
git commit -m "feat: add NavigationItem REST API endpoints with tests"
```

---

### Task 5: Seed Data

**Files:**

- Modify: `prisma/seed.ts`

- [ ] **Step 1: Add Link, Navigation, and NavigationItem seed data to `prisma/seed.ts`**

Add the following before the test API key section (before `// Test API key`):

```typescript
// Links
const linkHome = await prisma.link.upsert({
  where: { id: '00000000-0000-0000-0000-000000000100' },
  update: {},
  create: {
    id: '00000000-0000-0000-0000-000000000100',
    entryTitle: 'Home',
    label: 'Home',
    url: '/',
    status: 'PUBLISHED',
    publishedAt: new Date(),
  },
});

const linkArticles = await prisma.link.upsert({
  where: { id: '00000000-0000-0000-0000-000000000101' },
  update: {},
  create: {
    id: '00000000-0000-0000-0000-000000000101',
    entryTitle: 'Articles',
    label: 'Articles',
    url: '/articles',
    status: 'PUBLISHED',
    publishedAt: new Date(),
  },
});

// Look up an article to link to
const openingDayArticle = await prisma.article.findUnique({
  where: { title: 'Opening Day Victory' },
});

const linkOpeningDay = await prisma.link.upsert({
  where: { id: '00000000-0000-0000-0000-000000000102' },
  update: {},
  create: {
    id: '00000000-0000-0000-0000-000000000102',
    entryTitle: 'Opening Day Victory',
    label: 'Opening Day Victory',
    articleId: openingDayArticle?.id ?? null,
    status: 'PUBLISHED',
    publishedAt: new Date(),
  },
});

const linkYouthProgramme = await prisma.link.upsert({
  where: { id: '00000000-0000-0000-0000-000000000103' },
  update: {},
  create: {
    id: '00000000-0000-0000-0000-000000000103',
    entryTitle: 'Youth Programme',
    label: 'Youth Programme',
    url: '/youth',
    status: 'PUBLISHED',
    publishedAt: new Date(),
  },
});

const linkContact = await prisma.link.upsert({
  where: { id: '00000000-0000-0000-0000-000000000104' },
  update: {},
  create: {
    id: '00000000-0000-0000-0000-000000000104',
    entryTitle: 'Contact Us',
    label: 'Contact Us',
    url: '/contact',
    openInNewTab: false,
    status: 'PUBLISHED',
    publishedAt: new Date(),
  },
});

const linkExternal = await prisma.link.upsert({
  where: { id: '00000000-0000-0000-0000-000000000105' },
  update: {},
  create: {
    id: '00000000-0000-0000-0000-000000000105',
    entryTitle: 'WRU Website',
    label: 'WRU',
    url: 'https://www.wru.wales',
    openInNewTab: true,
    status: 'PUBLISHED',
    publishedAt: new Date(),
  },
});

// Navigation
const mainNav = await prisma.navigation.upsert({
  where: { name: 'Main Navigation' },
  update: {},
  create: {
    name: 'Main Navigation',
    entryTitle: 'Main Navigation',
    status: 'PUBLISHED',
    publishedAt: new Date(),
  },
});

// Clear existing navigation items for this nav, then recreate
await prisma.navigationItem.deleteMany({
  where: { navigationId: mainNav.id },
});

// Top-level items
const navItemHome = await prisma.navigationItem.create({
  data: {
    navigationId: mainNav.id,
    linkId: linkHome.id,
    order: 0,
  },
});

const navItemArticles = await prisma.navigationItem.create({
  data: {
    navigationId: mainNav.id,
    linkId: linkArticles.id,
    order: 1,
  },
});

await prisma.navigationItem.create({
  data: {
    navigationId: mainNav.id,
    linkId: linkContact.id,
    order: 2,
  },
});

await prisma.navigationItem.create({
  data: {
    navigationId: mainNav.id,
    linkId: linkExternal.id,
    order: 3,
  },
});

// Sub-links under Articles
await prisma.navigationItem.create({
  data: {
    navigationId: mainNav.id,
    linkId: linkOpeningDay.id,
    parentId: navItemArticles.id,
    order: 0,
  },
});

await prisma.navigationItem.create({
  data: {
    navigationId: mainNav.id,
    linkId: linkYouthProgramme.id,
    parentId: navItemArticles.id,
    order: 1,
  },
});
```

- [ ] **Step 2: Run seed**

Run: `pnpm prisma:seed`
Expected: `Seed complete.` with no errors.

- [ ] **Step 3: Verify seed data**

Run: `pnpm test:run -- server/api/links/links.test.ts server/api/navigations/navigations.test.ts`
Expected: All tests pass with seeded data.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat: add Link, Navigation, NavigationItem seed data"
```

---

### Task 6: Content Endpoint — Add Link and Navigation

**Files:**

- Modify: `server/api/content.get.ts`

- [ ] **Step 1: Write failing test**

Add to `server/api/content/content.test.ts` (at the end of the existing test suite, inside the main `describe` block):

```typescript
it('filters by contentType=Link', async () => {
  const { items, total } = await getList('content', {
    contentType: 'Link',
  });
  expect(total).toBeGreaterThanOrEqual(1);
  expect(items.every((i) => i.contentType === 'Link')).toBe(true);
});

it('filters by contentType=Navigation', async () => {
  const { items, total } = await getList('content', {
    contentType: 'Navigation',
  });
  expect(total).toBeGreaterThanOrEqual(1);
  expect(items.every((i) => i.contentType === 'Navigation')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run -- server/api/content/content.test.ts`
Expected: FAIL — Link and Navigation not in CONTENT_TABLES.

- [ ] **Step 3: Add Link and Navigation to CONTENT_TABLES**

In `server/api/content.get.ts`, update the `CONTENT_TABLES` array:

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
  'TagGroup',
  'Article',
  'Link',
  'Navigation',
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run -- server/api/content/content.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/api/content.get.ts server/api/content/content.test.ts
git commit -m "feat: add Link and Navigation to content endpoint"
```

---

### Task 7: GraphQL — Link Type with LinkTarget Union

**Files:**

- Create: `server/graphql/types/link.ts`
- Create: `server/graphql/types/navigationItem.ts`
- Create: `server/graphql/types/navigation.ts`
- Modify: `server/graphql/filters.ts`
- Modify: `server/graphql/query/index.ts`
- Modify: `server/graphql/schema.ts`

- [ ] **Step 1: Write failing test**

Add to `server/api/graphql/graphql.test.ts` (at the end of the existing test suite, inside the main `describe` block):

```typescript
describe('Link queries', () => {
  it('fetches links with internalLink union', async () => {
    const { data } = await gql(`{
        links(first: 10) {
          edges {
            node {
              id
              label
              url
              openInNewTab
              internalLink {
                __typename
                ... on Article {
                  slug
                  title
                }
              }
            }
          }
        }
      }`);
    expect(data.links.edges.length).toBeGreaterThanOrEqual(1);
    const node = data.links.edges[0].node;
    expect(node.label).toBeDefined();
  });

  it('fetches a single link by id', async () => {
    const { data: listData } = await gql(`{
        links(first: 1) { edges { node { id } } }
      }`);
    const id = listData.links.edges[0].node.id;
    const { data } = await gql(`{
        link(id: "${id}") {
          id
          label
          internalLink {
            __typename
          }
        }
      }`);
    expect(data.link.id).toBe(id);
  });
});

describe('Navigation queries', () => {
  it('fetches navigations with nested items and links', async () => {
    const { data } = await gql(`{
        navigations(first: 1) {
          edges {
            node {
              id
              name
              items(first: 50) {
                edges {
                  node {
                    order
                    link {
                      label
                      url
                      internalLink {
                        __typename
                        ... on Article {
                          slug
                        }
                      }
                    }
                    children(first: 20) {
                      edges {
                        node {
                          order
                          link { label url }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`);
    expect(data.navigations.edges.length).toBeGreaterThanOrEqual(1);
    const nav = data.navigations.edges[0].node;
    expect(nav.name).toBeDefined();
    expect(nav.items.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('fetches a single navigation by id', async () => {
    const { data: listData } = await gql(`{
        navigations(first: 1) { edges { node { id } } }
      }`);
    const id = listData.navigations.edges[0].node.id;
    const { data } = await gql(`{
        navigation(id: "${id}") {
          id
          name
        }
      }`);
    expect(data.navigation.id).toBe(id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run -- server/api/graphql/graphql.test.ts`
Expected: FAIL — types and queries don't exist yet.

- [ ] **Step 3: Create `server/graphql/types/link.ts`**

```typescript
import { builder } from '../builder';
import { contentMetadataFields } from './contentFields';
import { prisma } from '../../utils/prisma';

const LinkTarget = builder.unionType('LinkTarget', {
  types: ['Article'],
  resolveType: (value) => {
    // All current union members are Articles.
    // When adding new types, check for a discriminating field.
    if ('title' in value) return 'Article';
    return 'Article';
  },
});

builder.prismaObject('Link', {
  fields: (t) => ({
    id: t.exposeID('id'),
    label: t.exposeString('label'),
    url: t.exposeString('url', { nullable: true }),
    openInNewTab: t.exposeBoolean('openInNewTab'),
    article: t.relation('article', { nullable: true }),
    internalLink: t.field({
      type: LinkTarget,
      nullable: true,
      resolve: async (link) => {
        if (link.articleId) {
          return prisma.article.findUnique({
            where: { id: link.articleId },
          });
        }
        return null;
      },
    }),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
  }),
});

export const _registered = true;
```

- [ ] **Step 4: Create `server/graphql/types/navigationItem.ts`**

```typescript
import { builder } from '../builder';

builder.prismaObject('NavigationItem', {
  fields: (t) => ({
    id: t.exposeID('id'),
    order: t.exposeInt('order'),
    link: t.relation('link'),
    parent: t.relation('parent', { nullable: true }),
    children: t.relatedConnection('children', {
      cursor: 'id',
      query: () => ({ orderBy: { order: 'asc' } }),
    }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
  }),
});

export const _registered = true;
```

- [ ] **Step 5: Create `server/graphql/types/navigation.ts`**

```typescript
import { builder } from '../builder';
import { contentMetadataFields } from './contentFields';

builder.prismaObject('Navigation', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    ...contentMetadataFields(t),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    items: t.relatedConnection('items', {
      cursor: 'id',
      query: () => ({
        where: { parentId: null },
        orderBy: { order: 'asc' },
      }),
    }),
  }),
});

export const _registered = true;
```

- [ ] **Step 6: Add Link and Navigation filters to `server/graphql/filters.ts`**

Add before the `export const _registered = true;` line:

```typescript
export const LinkWhere = builder.prismaWhere('Link', {
  fields: {
    entryTitle: StringFilter,
    label: StringFilter,
    url: StringFilter,
    status: ContentStatusFilter,
  },
});

export const NavigationWhere = builder.prismaWhere('Navigation', {
  fields: {
    entryTitle: StringFilter,
    name: StringFilter,
    status: ContentStatusFilter,
  },
});
```

- [ ] **Step 7: Add Link and Navigation root queries to `server/graphql/query/index.ts`**

Add imports at the top:

```typescript
import {
  // ...existing imports...
  LinkWhere,
  NavigationWhere,
} from '../filters';
```

Add inside the `fields` callback, after the existing Article queries:

```typescript
    // Link
    links: t.prismaConnection({
      type: 'Link',
      cursor: 'id',
      args: { where: t.arg({ type: LinkWhere }) },
      resolve: (query, _root, args) =>
        prisma.link.findMany({ ...query, where: args.where ?? undefined }),
    }),
    link: t.prismaField({
      type: 'Link',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.link.findUnique({ ...query, where: { id: args.id } }),
    }),

    // Navigation
    navigations: t.prismaConnection({
      type: 'Navigation',
      cursor: 'id',
      args: { where: t.arg({ type: NavigationWhere }) },
      resolve: (query, _root, args) =>
        prisma.navigation.findMany({
          ...query,
          where: args.where ?? undefined,
        }),
    }),
    navigation: t.prismaField({
      type: 'Navigation',
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: (query, _root, args) =>
        prisma.navigation.findUnique({ ...query, where: { id: args.id } }),
    }),
```

- [ ] **Step 8: Register types in `server/graphql/schema.ts`**

Add imports:

```typescript
import { _registered as _link } from './types/link';
import { _registered as _navigationItem } from './types/navigationItem';
import { _registered as _navigation } from './types/navigation';
```

Add to the `void [...]` array:

```typescript
  _link,
  _navigationItem,
  _navigation,
```

- [ ] **Step 9: Regenerate Prisma client (needed for new model types)**

Run: `pnpm prisma:generate`

- [ ] **Step 10: Run tests to verify they pass**

Run: `pnpm test:run -- server/api/graphql/graphql.test.ts`
Expected: All tests PASS.

- [ ] **Step 11: Commit**

```bash
git add server/graphql/types/link.ts server/graphql/types/navigationItem.ts server/graphql/types/navigation.ts server/graphql/filters.ts server/graphql/query/index.ts server/graphql/schema.ts
git commit -m "feat: add Link, NavigationItem, Navigation GraphQL types with LinkTarget union"
```

---

### Task 8: ContentEditor — Add showSlug Prop

**Files:**

- Modify: `components/ContentEditor.vue`

- [ ] **Step 1: Add `showSlug` prop to ContentEditor**

In `components/ContentEditor.vue`, update the props definition:

```typescript
const props = defineProps<{
  title: string;
  fields: FieldConfig[];
  loading?: boolean;
  saving?: boolean;
  error?: string | null;
  showSlug?: boolean;
  onSave: () => void;
}>();
```

- [ ] **Step 2: Conditionally render the slug field**

Replace the slug `UFormField` block (lines 289-295) with:

```vue
<UFormField
  v-if="props.showSlug !== false"
  label="Slug"
  name="slug"
  required
  size="xl"
>
        <UInput
          :model-value="(state.slug as string) ?? ''"
          class="w-full"
          @update:model-value="state.slug = $event"
        />
      </UFormField>
```

- [ ] **Step 3: Update the validate function to skip slug when hidden**

Update the slug validation check (lines 82-88) to:

```typescript
if (
  props.showSlug !== false &&
  (!formData.slug ||
    (typeof formData.slug === 'string' && !formData.slug.trim()))
) {
  errors.push({ name: 'slug', message: 'Slug is required' });
}
```

- [ ] **Step 4: Commit**

```bash
git add components/ContentEditor.vue
git commit -m "feat: add showSlug prop to ContentEditor for slug-less models"
```

---

### Task 9: CMS Pages — Links

**Files:**

- Create: `pages/links/index.vue`
- Create: `pages/links/[id].vue`
- Modify: `layouts/default.vue`

- [ ] **Step 1: Create `pages/links/index.vue`**

```vue
<script setup lang="ts">
const page = ref(1);
const { data, status } = await useFetch('/api/links', {
  query: { page, perPage: 15 },
  watch: [page],
});
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Links"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => '/links/' + row.id"
  >
    <template #actions>
      <UButton to="/links/new" icon="i-lucide-plus">New Link</UButton>
    </template>
  </ContentTable>
</template>
```

- [ ] **Step 2: Create `pages/links/[id].vue`**

```vue
<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const id = route.params.id as string;

const fields: FieldConfig[] = [
  { type: 'text', key: 'label', label: 'Label', required: true },
  {
    type: 'text',
    key: 'url',
    label: 'URL',
    placeholder: '/page or https://...',
  },
  {
    type: 'relation',
    key: 'articleId',
    label: 'Article',
    optionsEndpoint: '/api/articles/options',
  },
  { type: 'boolean', key: 'openInNewTab', label: 'Open in new tab' },
];

const { formState, loadingStatus, isSaving, saveError, save } =
  useContentEditor('links', id);

watch(
  () => formState.label,
  (label) => {
    if (typeof label === 'string') {
      formState.entryTitle = label;
    }
  }
);

async function handleSave() {
  const newId = await save();
  if (newId) {
    await navigateTo(`/links/${newId}`);
  }
}
</script>

<template>
  <ContentEditor
    :title="formState.label ? String(formState.label) : 'New Link'"
    :fields="fields"
    :loading="loadingStatus === 'pending'"
    :saving="isSaving"
    :error="saveError"
    :show-slug="false"
    :on-save="handleSave"
    v-model:state="formState"
  />
</template>
```

- [ ] **Step 3: Add Links and Navigations to sidebar**

In `layouts/default.vue`, add to the `navItems` array after the Tag Groups entry:

```typescript
  { label: 'Links', icon: 'i-lucide-link', to: '/links' },
  { label: 'Navigations', icon: 'i-lucide-menu', to: '/navigations' },
```

- [ ] **Step 4: Commit**

```bash
git add pages/links/ layouts/default.vue
git commit -m "feat: add Link CMS listing and edit pages"
```

---

### Task 10: CMS Pages — Navigations

**Files:**

- Create: `pages/navigations/index.vue`
- Create: `pages/navigations/[id].vue`

- [ ] **Step 1: Create `pages/navigations/index.vue`**

```vue
<script setup lang="ts">
const page = ref(1);
const { data, status } = await useFetch('/api/navigations', {
  query: { page, perPage: 15 },
  watch: [page],
});
</script>

<template>
  <ContentTable
    v-model:page="page"
    title="Navigations"
    :data="data?.items ?? []"
    :loading="status === 'pending'"
    :total="data?.total ?? 0"
    :row-link="(row) => '/navigations/' + row.id"
  />
</template>
```

- [ ] **Step 2: Create `pages/navigations/[id].vue`**

This page has two parts: the ContentEditor for the navigation's own fields, and an items manager below it for managing the navigation tree.

```vue
<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const id = route.params.id as string;

const fields: FieldConfig[] = [
  { type: 'text', key: 'name', label: 'Name', required: true },
];

const { formState, loadingStatus, isSaving, saveError, save, generateSlug } =
  useContentEditor('navigations', id);

watch(
  () => formState.name,
  (name) => {
    if (typeof name === 'string') {
      formState.entryTitle = name;
    }
  }
);

async function handleSave() {
  await save();
}

// Navigation items management
type NavItemData = {
  id: string;
  order: number;
  linkId: string;
  parentId: string | null;
  link: { id: string; label: string; url: string | null };
  children?: NavItemData[];
};

const { data: navData, refresh: refreshNav } = await useFetch<{
  items: NavItemData[];
}>(`/api/navigations/${id}`, {
  transform: (data) => data as { items: NavItemData[] },
});

const items = computed(() => navData.value?.items ?? []);

const linkOptions = ref<{ label: string; value: string }[]>([]);
const selectedLinkId = ref('');

onMounted(async () => {
  linkOptions.value =
    await $fetch<{ label: string; value: string }[]>('/api/links/options');
});

async function addItem() {
  if (!selectedLinkId.value) return;
  await $fetch('/api/navigation-items', {
    method: 'POST',
    body: {
      navigationId: id,
      linkId: selectedLinkId.value,
      order: items.value.length,
    },
  });
  selectedLinkId.value = '';
  await refreshNav();
}

async function removeItem(itemId: string) {
  await $fetch(`/api/navigation-items/${itemId}`, { method: 'DELETE' });
  await refreshNav();
}

async function moveItem(
  itemId: string,
  direction: 'up' | 'down',
  siblings: NavItemData[]
) {
  const idx = siblings.findIndex((i) => i.id === itemId);
  if (
    (direction === 'up' && idx <= 0) ||
    (direction === 'down' && idx >= siblings.length - 1)
  )
    return;

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  const reordered = siblings.map((item, i) => ({
    id: item.id,
    order:
      i === idx
        ? siblings[swapIdx]!.order
        : i === swapIdx
          ? siblings[idx]!.order
          : item.order,
    parentId: item.parentId,
  }));

  await $fetch('/api/navigation-items/reorder', {
    method: 'PUT',
    body: { items: reordered },
  });
  await refreshNav();
}
</script>

<template>
  <div>
    <ContentEditor
      :title="formState.name ? String(formState.name) : 'Navigation'"
      :fields="fields"
      :loading="loadingStatus === 'pending'"
      :saving="isSaving"
      :error="saveError"
      :show-slug="false"
      :on-save="handleSave"
      v-model:state="formState"
    />

    <div class="p-6 max-w-2xl">
      <USeparator label="Navigation Items" class="mb-6" />

      <div class="space-y-2">
        <div v-for="item in items" :key="item.id" class="border rounded-lg p-3">
          <div class="flex items-center justify-between">
            <span class="font-medium">{{ item.link.label }}</span>
            <div class="flex gap-1">
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-chevron-up"
                @click="moveItem(item.id, 'up', items)"
              />
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-chevron-down"
                @click="moveItem(item.id, 'down', items)"
              />
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                @click="removeItem(item.id)"
              />
            </div>
          </div>
          <div v-if="item.children?.length" class="ml-6 mt-2 space-y-2">
            <div
              v-for="child in item.children"
              :key="child.id"
              class="flex items-center justify-between border rounded p-2"
            >
              <span class="text-sm">{{ child.link.label }}</span>
              <div class="flex gap-1">
                <UButton
                  size="xs"
                  variant="ghost"
                  icon="i-lucide-chevron-up"
                  @click="moveItem(child.id, 'up', item.children!)"
                />
                <UButton
                  size="xs"
                  variant="ghost"
                  icon="i-lucide-chevron-down"
                  @click="moveItem(child.id, 'down', item.children!)"
                />
                <UButton
                  size="xs"
                  variant="ghost"
                  color="error"
                  icon="i-lucide-trash-2"
                  @click="removeItem(child.id)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="flex gap-2 mt-4">
        <USelect
          v-model="selectedLinkId"
          :items="linkOptions"
          value-key="value"
          placeholder="Select a link..."
          class="flex-1"
        />
        <UButton
          icon="i-lucide-plus"
          :disabled="!selectedLinkId"
          @click="addItem"
        >
          Add Item
        </UButton>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Commit**

```bash
git add pages/navigations/
git commit -m "feat: add Navigation CMS listing and edit pages with item management"
```

---

### Task 11: Add Articles Options Endpoint (if missing)

**Files:**

- Check: `server/api/articles/options.get.ts`

- [ ] **Step 1: Check if endpoint exists**

Check whether `server/api/articles/options.get.ts` exists. If it does, skip this task.

- [ ] **Step 2: Create `server/api/articles/options.get.ts` if missing**

```typescript
export default defineEventHandler(async () => {
  const articles = await prisma.article.findMany({
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
  });
  return articles.map((a) => ({ label: a.title, value: a.id }));
});
```

- [ ] **Step 3: Commit (if file was created)**

```bash
git add server/api/articles/options.get.ts
git commit -m "feat: add articles options endpoint for relation dropdowns"
```

---

### Task 12: Update CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md with new model documentation**

Add to the relevant sections:

1. **Database Schema section** — add Link, NavigationItem, Navigation model descriptions
2. **Key Files section** — add new file entries
3. **Architecture section** — mention Navigation CMS pages and LinkTarget union type
4. **Testing section** — add Link, Navigation, NavigationItem test descriptions
5. **REST API filtering section** — add links (`status`) and navigations (`status`)

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Navigation, Link model documentation"
```

---

### Task 13: Run Full Test Suite

- [ ] **Step 1: Run all tests**

Run: `pnpm test:run`
Expected: All tests pass, including new Link, Navigation, NavigationItem, content, and GraphQL tests.

- [ ] **Step 2: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Format**

Run: `pnpm format:fix`

- [ ] **Step 4: Final commit if formatting changes**

```bash
git add -A
git commit -m "chore: formatting"
```
