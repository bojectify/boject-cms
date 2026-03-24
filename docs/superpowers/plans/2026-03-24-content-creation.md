# Content Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to create new content items from the CMS UI for 9 models (Team, Club, Competition, Season, Player, Fixture, Author, Tag, Article).

**Architecture:** Extend `useContentEditor` composable with create mode (`id === 'new'`). Add POST endpoints per model mirroring existing PUT patterns. Reuse existing `[id].vue` edit pages in dual mode. Add `#actions` slot to `ContentTable` for "New" buttons on listing pages.

**Tech Stack:** Nuxt 4 (Vue 3), Prisma v7, Nitro/H3, Vitest + @nuxt/test-utils

**Spec:** `docs/superpowers/specs/2026-03-24-content-creation-design.md`

---

## File Structure

### New files (9 POST endpoints)

- `server/api/teams/index.post.ts` — Create team
- `server/api/clubs/index.post.ts` — Create club
- `server/api/competitions/index.post.ts` — Create competition
- `server/api/seasons/index.post.ts` — Create season
- `server/api/players/index.post.ts` — Create player
- `server/api/fixtures/index.post.ts` — Create fixture
- `server/api/authors/index.post.ts` — Create author
- `server/api/tags/index.post.ts` — Create tag
- `server/api/articles/index.post.ts` — Create article

### Modified files

- `composables/useContentEditor.ts` — Create mode support
- `components/ContentTable.vue` — Add `#actions` slot
- `pages/teams/[id].vue` — Dual-mode + redirect
- `pages/clubs/[id].vue` — Dual-mode + redirect
- `pages/competitions/[id].vue` — Dual-mode + redirect
- `pages/seasons/[id].vue` — Dual-mode + redirect
- `pages/players/[id].vue` — Dual-mode + redirect
- `pages/fixtures/[id].vue` — Dual-mode + redirect
- `pages/authors/[id].vue` — Dual-mode + redirect
- `pages/tags/[id].vue` — Dual-mode + redirect
- `pages/articles/[id].vue` — Dual-mode + redirect
- `pages/images/[id].vue` — Guard `/images/new` → redirect to `/images`
- `pages/teams/index.vue` — Create button
- `pages/clubs/index.vue` — Create button
- `pages/competitions/index.vue` — Create button
- `pages/seasons/index.vue` — Create button
- `pages/players/index.vue` — Create button
- `pages/fixtures/index.vue` — Create button
- `pages/authors/index.vue` — Create button
- `pages/tags/index.vue` — Create button
- `pages/articles/index.vue` — Create button

---

## Task 1: Extend useContentEditor composable with create mode

**Files:**

- Modify: `composables/useContentEditor.ts`

- [ ] **Step 1: Implement create mode in useContentEditor**

Replace the full content of `composables/useContentEditor.ts` with:

```typescript
export function useContentEditor(modelPath: string, id: string) {
  const toast = useToast();
  const isNew = id === 'new';

  const {
    data: item,
    status: loadingStatus,
    refresh,
  } = isNew
    ? { data: ref(null), status: ref('success'), refresh: async () => {} }
    : useFetch<Record<string, unknown>>(`/api/${modelPath}/${id}`);

  const formState = reactive<Record<string, unknown>>({});
  const isSaving = ref(false);
  const saveError = ref<string | null>(null);

  // In create mode, set defaults synchronously before template renders
  if (isNew) {
    Object.assign(formState, { status: 'DRAFT' });
  }

  watch(item, (val) => {
    if (val) {
      Object.assign(formState, val);
    }
  });

  async function save(): Promise<string | void> {
    isSaving.value = true;
    saveError.value = null;
    try {
      if (isNew) {
        const created = await $fetch<{ id: string }>(`/api/${modelPath}`, {
          method: 'POST',
          body: formState,
        });
        toast.add({
          title: 'Created',
          description: 'Content created successfully.',
          color: 'success',
        });
        return created.id;
      } else {
        await $fetch(`/api/${modelPath}/${id}`, {
          method: 'PUT',
          body: formState,
        });
        await refresh();
        toast.add({
          title: 'Saved',
          description: 'Changes saved successfully.',
          color: 'success',
        });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to save changes.';
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
    item,
    formState,
    loadingStatus,
    isSaving,
    saveError,
    save,
    generateSlug,
  };
}
```

- [ ] **Step 2: Verify no type errors**

Run: `pnpm typecheck`
Expected: PASS (no errors related to useContentEditor)

- [ ] **Step 3: Commit**

```bash
git add composables/useContentEditor.ts
git commit -m "feat: add create mode to useContentEditor composable"
```

---

## Task 2: Add #actions slot to ContentTable

**Files:**

- Modify: `components/ContentTable.vue`

- [ ] **Step 1: Add the actions slot to the header area and filter slot forwarding**

In `components/ContentTable.vue`, replace the existing title `<h1>` line:

```vue
<h1 class="text-2xl font-bold mb-4">{{ title }}</h1>
```

with:

```vue
<div class="flex items-center justify-between mb-4">
  <h1 class="text-2xl font-bold">{{ title }}</h1>
  <slot name="actions" />
</div>
```

Also, in `<script setup>`, add a computed to filter `actions` out of the forwarded slots so it doesn't get passed to UTable:

```typescript
const tableSlots = computed(() => {
  const { actions: _, ...rest } = slots;
  return rest;
});
```

Then update the slot forwarding loop in the template to iterate over `tableSlots` instead of `slots`:

```vue
<template v-for="(_, name) in tableSlots" :key="name" #[name]="slotProps">
  <slot :name="name" v-bind="slotProps" />
</template>
```

- [ ] **Step 2: Verify no type errors**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add components/ContentTable.vue
git commit -m "feat: add actions slot to ContentTable header"
```

---

## Task 3: POST endpoint — Teams

**Files:**

- Create: `server/api/teams/index.post.ts`
- Modify: `server/api/teams/teams.test.ts` (create if it doesn't exist — check `server/api/lists/lists.test.ts` for existing team tests and add POST tests to the appropriate location)

- [ ] **Step 1: Write the POST endpoint**

Create `server/api/teams/index.post.ts`:

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }
  if (!body.slug || typeof body.slug !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'slug is required' });
  }

  const data: Prisma.TeamUncheckedCreateInput = {
    name: body.name as string,
    slug: body.slug as string,
  };
  applyContentMetadata(body, data as Record<string, unknown>, null);

  try {
    const created = await prisma.team.create({ data });
    setResponseStatus(event, 201);
    return created;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A team with this name or slug already exists',
      });
    }
    throw err;
  }
});
```

- [ ] **Step 2: Write integration tests for POST /api/teams**

Add to `server/api/teams/teams.test.ts` (create this file):

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
      email: 'admin@boject.com',
      password: 'password',
    }),
    headers: { 'Content-Type': 'application/json' },
  });

  const cookies = response.headers.getSetCookie();
  _sessionCookie = cookies.join('; ');
  return _sessionCookie;
}

describe('Team POST endpoint', async () => {
  await setup({ dev: true });

  describe('POST /api/teams', () => {
    it('creates a team with valid data', async () => {
      const name = `Test Team ${Date.now()}`;
      const slug = `test-team-${Date.now()}`;
      const response = await fetch('/api/teams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({
          name,
          slug,
          entryTitle: name,
          status: 'DRAFT',
        }),
      });
      expect(response.status).toBe(201);
      const created = await response.json();
      expect(created.id).toBeDefined();
      expect(created.name).toBe(name);
      expect(created.slug).toBe(slug);
      expect(created.status).toBe('DRAFT');
    });

    it('returns 400 when name is missing', async () => {
      const err = await $fetch('/api/teams', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { slug: 'test-slug' },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        400
      );
    });

    it('returns 400 when slug is missing', async () => {
      const err = await $fetch('/api/teams', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { name: 'Some Team' },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        400
      );
    });

    it('returns 409 on duplicate name', async () => {
      const name = `Dup Team ${Date.now()}`;
      const slug = `dup-team-${Date.now()}`;
      await $fetch('/api/teams', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { name, slug, entryTitle: name },
      });
      const err = await $fetch('/api/teams', {
        method: 'POST',
        headers: { Cookie: await getSessionCookie() },
        body: { name, slug: `${slug}-2`, entryTitle: name },
      }).catch((e: { response: { status: number } }) => e);
      expect((err as { response: { status: number } }).response.status).toBe(
        409
      );
    });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm test:run -- server/api/teams/teams.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 4: Commit**

```bash
git add server/api/teams/index.post.ts server/api/teams/teams.test.ts
git commit -m "feat: add POST /api/teams endpoint with tests"
```

---

## Task 4: POST endpoint — Clubs

**Files:**

- Create: `server/api/clubs/index.post.ts`
- Create: `server/api/clubs/clubs.test.ts`

- [ ] **Step 1: Write the POST endpoint**

Create `server/api/clubs/index.post.ts`:

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }
  if (!body.slug || typeof body.slug !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'slug is required' });
  }

  const data: Prisma.ClubUncheckedCreateInput = {
    name: body.name as string,
    slug: body.slug as string,
  };
  applyContentMetadata(body, data as Record<string, unknown>, null);

  try {
    const created = await prisma.club.create({ data });
    setResponseStatus(event, 201);
    return created;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A club with this name or slug already exists',
      });
    }
    throw err;
  }
});
```

- [ ] **Step 2: Write integration tests**

Create `server/api/clubs/clubs.test.ts` following the same pattern as teams (4 tests: valid create → 201, missing name → 400, missing slug → 400, duplicate → 409). Use `Club` in names and `/api/clubs` endpoint.

- [ ] **Step 3: Run tests**

Run: `pnpm test:run -- server/api/clubs/clubs.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/api/clubs/index.post.ts server/api/clubs/clubs.test.ts
git commit -m "feat: add POST /api/clubs endpoint with tests"
```

---

## Task 5: POST endpoint — Tags

**Files:**

- Create: `server/api/tags/index.post.ts`
- Modify: `server/api/tags/tags.test.ts` (add POST tests to existing file)

- [ ] **Step 1: Write the POST endpoint**

Create `server/api/tags/index.post.ts`:

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }
  if (!body.slug || typeof body.slug !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'slug is required' });
  }

  const data: Prisma.TagUncheckedCreateInput = {
    name: body.name as string,
    slug: body.slug as string,
  };
  applyContentMetadata(body, data as Record<string, unknown>, null);

  try {
    const created = await prisma.tag.create({ data });
    setResponseStatus(event, 201);
    return created;
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

- [ ] **Step 2: Add POST tests to existing tags.test.ts**

Add a new `describe('POST /api/tags', ...)` block to `server/api/tags/tags.test.ts` with the same 4 test cases (201, 400 name, 400 slug, 409 duplicate).

- [ ] **Step 3: Run tests**

Run: `pnpm test:run -- server/api/tags/tags.test.ts`
Expected: PASS (13 tests — 9 existing + 4 new)

- [ ] **Step 4: Commit**

```bash
git add server/api/tags/index.post.ts server/api/tags/tags.test.ts
git commit -m "feat: add POST /api/tags endpoint with tests"
```

---

## Task 6: POST endpoint — Seasons

**Files:**

- Create: `server/api/seasons/index.post.ts`
- Create: `server/api/seasons/seasons.test.ts`

- [ ] **Step 1: Write the POST endpoint**

Create `server/api/seasons/index.post.ts`:

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }
  if (!body.slug || typeof body.slug !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'slug is required' });
  }
  if (!body.startDate) {
    throw createError({
      statusCode: 400,
      statusMessage: 'startDate is required',
    });
  }
  if (!body.endDate) {
    throw createError({
      statusCode: 400,
      statusMessage: 'endDate is required',
    });
  }

  const data: Prisma.SeasonUncheckedCreateInput = {
    name: body.name as string,
    slug: body.slug as string,
    startDate: new Date(body.startDate as string),
    endDate: new Date(body.endDate as string),
  };
  applyContentMetadata(body, data as Record<string, unknown>, null);

  try {
    const created = await prisma.season.create({ data });
    setResponseStatus(event, 201);
    return created;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A season with this name or slug already exists',
      });
    }
    throw err;
  }
});
```

- [ ] **Step 2: Write tests (5 tests: 201, 400 name, 400 slug, 400 startDate, 409 duplicate)**

Create `server/api/seasons/seasons.test.ts` with the standard pattern. Include test for missing `startDate` → 400.

- [ ] **Step 3: Run tests**

Run: `pnpm test:run -- server/api/seasons/seasons.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/api/seasons/index.post.ts server/api/seasons/seasons.test.ts
git commit -m "feat: add POST /api/seasons endpoint with tests"
```

---

## Task 7: POST endpoint — Competitions

**Files:**

- Create: `server/api/competitions/index.post.ts`
- Create: `server/api/competitions/competitions.test.ts`

- [ ] **Step 1: Write the POST endpoint**

Create `server/api/competitions/index.post.ts`:

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }
  if (!body.slug || typeof body.slug !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'slug is required' });
  }

  const data: Prisma.CompetitionUncheckedCreateInput = {
    name: body.name as string,
    slug: body.slug as string,
  };
  if ('seasonId' in body)
    data.seasonId = (body.seasonId as string) || undefined;
  applyContentMetadata(body, data as Record<string, unknown>, null);

  try {
    const created = await prisma.competition.create({ data });
    setResponseStatus(event, 201);
    return created;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A competition with this name or slug already exists',
      });
    }
    throw err;
  }
});
```

- [ ] **Step 2: Write tests (4 tests: 201, 400 name, 400 slug, 409 duplicate)**

Create `server/api/competitions/competitions.test.ts`.

- [ ] **Step 3: Run tests**

Run: `pnpm test:run -- server/api/competitions/competitions.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/api/competitions/index.post.ts server/api/competitions/competitions.test.ts
git commit -m "feat: add POST /api/competitions endpoint with tests"
```

---

## Task 8: POST endpoint — Players

**Files:**

- Create: `server/api/players/index.post.ts`
- Create: `server/api/players/players.test.ts`

- [ ] **Step 1: Write the POST endpoint**

Create `server/api/players/index.post.ts`:

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.firstName || typeof body.firstName !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'firstName is required',
    });
  }
  if (!body.lastName || typeof body.lastName !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'lastName is required',
    });
  }
  if (!body.slug || typeof body.slug !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'slug is required' });
  }

  const data: Prisma.PlayerUncheckedCreateInput = {
    firstName: body.firstName as string,
    lastName: body.lastName as string,
    slug: body.slug as string,
  };
  if ('positionId' in body)
    data.positionId = (body.positionId as string) || undefined;
  if ('bio' in body) data.bio = (body.bio as string) || undefined;
  applyContentMetadata(body, data as Record<string, unknown>, null);

  try {
    const created = await prisma.player.create({ data });
    setResponseStatus(event, 201);
    return created;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A player with this slug already exists',
      });
    }
    throw err;
  }
});
```

- [ ] **Step 2: Write tests (5 tests: 201, 400 firstName, 400 lastName, 400 slug, 409 duplicate slug)**

Create `server/api/players/players.test.ts`.

- [ ] **Step 3: Run tests**

Run: `pnpm test:run -- server/api/players/players.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/api/players/index.post.ts server/api/players/players.test.ts
git commit -m "feat: add POST /api/players endpoint with tests"
```

---

## Task 9: POST endpoint — Fixtures

**Files:**

- Create: `server/api/fixtures/index.post.ts`
- Modify: `server/api/fixtures/fixtures.test.ts` (add POST tests)

- [ ] **Step 1: Write the POST endpoint**

Create `server/api/fixtures/index.post.ts`:

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }
  if (!body.slug || typeof body.slug !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'slug is required' });
  }
  if (!body.kickoff) {
    throw createError({
      statusCode: 400,
      statusMessage: 'kickoff is required',
    });
  }

  const data: Prisma.FixtureUncheckedCreateInput = {
    name: body.name as string,
    slug: body.slug as string,
    kickoff: new Date(body.kickoff as string),
    venue: (body.venue as string) || '',
    isHome: typeof body.isHome === 'boolean' ? body.isHome : true,
  };
  if ('teamId' in body) data.teamId = (body.teamId as string) || undefined;
  if ('opponentId' in body)
    data.opponentId = (body.opponentId as string) || undefined;
  if ('competitionId' in body)
    data.competitionId = (body.competitionId as string) || undefined;
  if ('seasonId' in body)
    data.seasonId = (body.seasonId as string) || undefined;
  applyContentMetadata(body, data as Record<string, unknown>, null);

  try {
    const created = await prisma.fixture.create({ data });
    setResponseStatus(event, 201);
    return created;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint failed')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A fixture with this slug already exists',
      });
    }
    throw err;
  }
});
```

- [ ] **Step 2: Add POST tests to existing fixtures.test.ts**

Add `describe('POST /api/fixtures', ...)` with 5 tests (201, 400 name, 400 slug, 400 kickoff, 409 duplicate slug).

- [ ] **Step 3: Run tests**

Run: `pnpm test:run -- server/api/fixtures/fixtures.test.ts`
Expected: PASS (21 tests — 16 existing + 5 new)

- [ ] **Step 4: Commit**

```bash
git add server/api/fixtures/index.post.ts server/api/fixtures/fixtures.test.ts
git commit -m "feat: add POST /api/fixtures endpoint with tests"
```

---

## Task 10: POST endpoint — Authors

**Files:**

- Create: `server/api/authors/index.post.ts`
- Modify: `server/api/authors/authors.test.ts` (add POST tests)

- [ ] **Step 1: Write the POST endpoint**

Create `server/api/authors/index.post.ts`:

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.name || typeof body.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name is required' });
  }
  if (!body.slug || typeof body.slug !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'slug is required' });
  }

  const data: Prisma.AuthorUncheckedCreateInput = {
    name: body.name as string,
    slug: body.slug as string,
  };
  if ('bio' in body) data.bio = (body.bio as string) || undefined;
  if ('headshotId' in body)
    data.headshotId = (body.headshotId as string) || undefined;
  applyContentMetadata(body, data as Record<string, unknown>, null);

  // Handle social links via nested create
  const hasSocialLinks =
    'socialLinks' in body && Array.isArray(body.socialLinks);
  if (hasSocialLinks) {
    const links = body.socialLinks as Array<{
      platform: string;
      url: string;
    }>;
    data.socialLinks = {
      createMany: {
        data: links.map((l) => ({ platform: l.platform, url: l.url })),
      },
    };
  }

  try {
    const created = await prisma.author.create({
      data,
      include: { socialLinks: true },
    });
    setResponseStatus(event, 201);
    return created;
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

- [ ] **Step 2: Add POST tests to existing authors.test.ts**

Add `describe('POST /api/authors', ...)` with 5 tests:

1. Creates author with valid data → 201, returned object has `id`, `name`, `slug`, `status: 'DRAFT'`
2. Creates author with socialLinks → 201, returned `socialLinks` array matches input
3. Returns 400 when name missing
4. Returns 400 when slug missing
5. Returns 409 on duplicate name

- [ ] **Step 3: Run tests**

Run: `pnpm test:run -- server/api/authors/authors.test.ts`
Expected: PASS (16 tests — 11 existing + 5 new)

- [ ] **Step 4: Commit**

```bash
git add server/api/authors/index.post.ts server/api/authors/authors.test.ts
git commit -m "feat: add POST /api/authors endpoint with tests"
```

---

## Task 11: POST endpoint — Articles

**Files:**

- Create: `server/api/articles/index.post.ts`
- Modify: `server/api/articles/articles.test.ts` (add POST tests)

- [ ] **Step 1: Write the POST endpoint**

Create `server/api/articles/index.post.ts`:

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  if (!body.title || typeof body.title !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'title is required' });
  }
  if (!body.slug || typeof body.slug !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'slug is required' });
  }

  const data: Prisma.ArticleUncheckedCreateInput = {
    title: body.title as string,
    slug: body.slug as string,
  };
  if ('summary' in body) data.summary = (body.summary as string) || undefined;
  if ('body' in body) data.body = body.body as Prisma.InputJsonValue;
  if ('authorId' in body)
    data.authorId = (body.authorId as string) || undefined;
  if ('featuredImageId' in body)
    data.featuredImageId = (body.featuredImageId as string) || undefined;
  applyContentMetadata(body, data as Record<string, unknown>, null);

  // Handle tag assignment
  const hasTagIds = 'tagIds' in body && Array.isArray(body.tagIds);

  try {
    const created = await prisma.article.create({
      data: {
        ...data,
        ...(hasTagIds && {
          tags: {
            connect: (body.tagIds as string[]).map((tagId) => ({ id: tagId })),
          },
        }),
      },
      include: { author: true, tags: true, featuredImage: true },
    });
    setResponseStatus(event, 201);
    return created;
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

- [ ] **Step 2: Add POST tests to existing articles.test.ts**

Add `describe('POST /api/articles', ...)` with 5 tests:

1. Creates article with valid data → 201
2. Creates article with tagIds → 201, returned `tags` array has correct length
3. Returns 400 when title missing
4. Returns 400 when slug missing
5. Returns 409 on duplicate title

- [ ] **Step 3: Run tests**

Run: `pnpm test:run -- server/api/articles/articles.test.ts`
Expected: PASS (18 tests — 13 existing + 5 new)

- [ ] **Step 4: Commit**

```bash
git add server/api/articles/index.post.ts server/api/articles/articles.test.ts
git commit -m "feat: add POST /api/articles endpoint with tests"
```

---

## Task 12: Update edit pages — simple models (Teams, Clubs, Tags)

These three models follow the simplest pattern: single `name` field, watcher sets entryTitle + slug.

**Files:**

- Modify: `pages/teams/[id].vue`
- Modify: `pages/clubs/[id].vue`
- Modify: `pages/tags/[id].vue`

- [ ] **Step 1: Update pages/teams/[id].vue**

```vue
<script setup lang="ts">
import type { FieldConfig } from '~/types/contentEditor';

const route = useRoute();
const id = route.params.id as string;
const isNew = id === 'new';

const fields: FieldConfig[] = [
  { type: 'text', key: 'name', label: 'Name', required: true },
];

const { formState, loadingStatus, isSaving, saveError, save, generateSlug } =
  useContentEditor('teams', id);

watch(
  () => formState.name,
  (name) => {
    if (typeof name === 'string') {
      formState.entryTitle = name;
      formState.slug = generateSlug(name);
    }
  }
);

async function handleSave() {
  const newId = await save();
  if (newId) {
    await navigateTo(`/teams/${newId}`);
  }
}
</script>

<template>
  <ContentEditor
    v-model:state="formState"
    :title="isNew ? 'New Team' : 'Edit Team'"
    :fields="fields"
    :loading="!isNew && loadingStatus === 'pending'"
    :saving="isSaving"
    :error="saveError"
    :on-save="handleSave"
  />
</template>
```

- [ ] **Step 2: Update pages/clubs/[id].vue**

Same pattern as teams. Replace `teams` → `clubs`, `Team` → `Club`.

- [ ] **Step 3: Update pages/tags/[id].vue**

Same pattern as teams. Replace `teams` → `tags`, `Team` → `Tag`.

- [ ] **Step 4: Verify no type errors**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pages/teams/[id].vue pages/clubs/[id].vue pages/tags/[id].vue
git commit -m "feat: add create mode to team, club, tag edit pages"
```

---

## Task 13: Update edit pages — Competitions, Seasons

**Files:**

- Modify: `pages/competitions/[id].vue`
- Modify: `pages/seasons/[id].vue`

- [ ] **Step 1: Update pages/competitions/[id].vue**

Same dual-mode pattern. The competition page has a `seasonId` relation field — no special handling needed for create mode.

Key differences from teams:

- Fields include `{ type: 'relation', key: 'seasonId', label: 'Season', optionsEndpoint: '/api/seasons/options' }`
- Title: `isNew ? 'New Competition' : 'Edit Competition'`
- Redirect: `navigateTo(\`/competitions/${newId}\`)`

- [ ] **Step 2: Update pages/seasons/[id].vue**

Key differences:

- Fields include `startDate` (datetime) and `endDate` (datetime) — both required
- Title: `isNew ? 'New Season' : 'Edit Season'`
- Redirect: `navigateTo(\`/seasons/${newId}\`)`

- [ ] **Step 3: Verify no type errors**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add pages/competitions/[id].vue pages/seasons/[id].vue
git commit -m "feat: add create mode to competition, season edit pages"
```

---

## Task 14: Update edit pages — Players, Fixtures

**Files:**

- Modify: `pages/players/[id].vue`
- Modify: `pages/fixtures/[id].vue`

- [ ] **Step 1: Update pages/players/[id].vue**

Key differences:

- Has `firstName` and `lastName` fields
- The entryTitle watcher builds from `firstName + ' ' + lastName`
- Title: `isNew ? 'New Player' : 'Edit Player'`
- Redirect: `navigateTo(\`/players/${newId}\`)`

- [ ] **Step 2: Update pages/fixtures/[id].vue**

Key differences:

- Has `kickoff` (datetime), `venue` (text), `isHome` (boolean), plus 4 relation fields
- Title: `isNew ? 'New Fixture' : 'Edit Fixture'`
- Redirect: `navigateTo(\`/fixtures/${newId}\`)`

- [ ] **Step 3: Verify no type errors**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add pages/players/[id].vue pages/fixtures/[id].vue
git commit -m "feat: add create mode to player, fixture edit pages"
```

---

## Task 15: Update edit pages — Authors, Articles

**Files:**

- Modify: `pages/authors/[id].vue`
- Modify: `pages/articles/[id].vue`

- [ ] **Step 1: Update pages/authors/[id].vue**

Key differences:

- Has `#after-fields` slot for social links management
- Title: `isNew ? 'New Author' : 'Edit Author'`
- Redirect: `navigateTo(\`/authors/${newId}\`)`
- Social links section should still render in create mode (user can add social links on initial creation)

- [ ] **Step 2: Update pages/articles/[id].vue**

Key differences:

- Has `tagIds` multirelation field and rich text `body` field
- The `tags` → `tagIds` watcher must be guarded:
  ```typescript
  watch(
    () => formState.tags,
    (tags) => {
      if (!isNew && Array.isArray(tags)) {
        formState.tagIds = (tags as Array<{ id: string }>).map((t) => t.id);
      }
    },
    { immediate: true }
  );
  ```
- Title: `isNew ? 'New Article' : 'Edit Article'`
- Redirect: `navigateTo(\`/articles/${newId}\`)`

- [ ] **Step 3: Verify no type errors**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add pages/authors/[id].vue pages/articles/[id].vue
git commit -m "feat: add create mode to author, article edit pages"
```

---

## Task 16: Guard /images/new route

**Files:**

- Modify: `pages/images/[id].vue`

- [ ] **Step 1: Add redirect guard**

At the top of `<script setup>` in `pages/images/[id].vue`, after deriving `id` from the route, add:

```typescript
const id = route.params.id as string;

if (id === 'new') {
  await navigateTo('/images', { replace: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add pages/images/[id].vue
git commit -m "feat: redirect /images/new to /images"
```

---

## Task 17: Add create buttons to listing pages

**Files:**

- Modify: `pages/teams/index.vue`
- Modify: `pages/clubs/index.vue`
- Modify: `pages/competitions/index.vue`
- Modify: `pages/seasons/index.vue`
- Modify: `pages/players/index.vue`
- Modify: `pages/fixtures/index.vue`
- Modify: `pages/authors/index.vue`
- Modify: `pages/tags/index.vue`
- Modify: `pages/articles/index.vue`

- [ ] **Step 1: Add create button to all 9 listing pages**

Each listing page already has a `<ContentTable>` component. Add the `#actions` slot with a create button. Example for teams:

```vue
<ContentTable
  v-model:page="page"
  title="Teams"
  :data="data?.items ?? []"
  :loading="status === 'pending'"
  :total="data?.total ?? 0"
  :row-link="(row) => '/teams/' + row.id"
>
  <template #actions>
    <UButton to="/teams/new" icon="i-lucide-plus">New Team</UButton>
  </template>
</ContentTable>
```

Apply the same pattern to all 9 listing pages with the appropriate model name and path:

- Teams: `to="/teams/new"` label "New Team"
- Clubs: `to="/clubs/new"` label "New Club"
- Competitions: `to="/competitions/new"` label "New Competition"
- Seasons: `to="/seasons/new"` label "New Season"
- Players: `to="/players/new"` label "New Player"
- Fixtures: `to="/fixtures/new"` label "New Fixture"
- Authors: `to="/authors/new"` label "New Author"
- Tags: `to="/tags/new"` label "New Tag"
- Articles: `to="/articles/new"` label "New Article"

Do NOT add a button to `pages/images/index.vue`.

- [ ] **Step 2: Verify no type errors**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add pages/teams/index.vue pages/clubs/index.vue pages/competitions/index.vue pages/seasons/index.vue pages/players/index.vue pages/fixtures/index.vue pages/authors/index.vue pages/tags/index.vue pages/articles/index.vue
git commit -m "feat: add create buttons to all content listing pages"
```

---

## Task 18: Run full test suite

- [ ] **Step 1: Run all tests**

Run: `pnpm test:run`
Expected: All tests PASS (existing + new POST tests)

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS (or fix any issues)

- [ ] **Step 4: Fix any issues found and commit**

If any issues found, fix and commit with an appropriate message.
