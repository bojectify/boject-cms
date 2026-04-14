# Navigation Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the security findings from the `security-bot` review of `pages/navigations/[id].vue` and its backing REST endpoints — closing cross-navigation IDOR, hardening the reorder batch endpoint, adding CSRF defense-in-depth, and shoring up input validation and error handling.

**Architecture:** Per-endpoint navigation scoping (every mutation must take a `navigationId` and verify the target items belong to it). Shared validation utilities instead of ad-hoc type checks. A Prisma error-translation helper so internals don't leak in responses. A global CSRF middleware that checks `Origin`/`Referer` for non-GET `/api/*` requests (skips API-key bearer requests, which are already read-only). Session cookie hardened to `SameSite=Strict`.

**Tech Stack:** Nuxt 4, Nitro, Prisma v7, Vitest, `nuxt-auth-utils` for sessions, existing `server/utils/rateLimit.ts` for throttling.

**Out of scope (tracked for follow-up, not this plan):**

- **M3** (Link URL scheme validation) — concerns the public consumer renderer, not the CMS edit page.
- **I2 / L3** (DRAFT Article/nav-item visibility to API-key consumers) — these are read-side data-shape concerns, separate from the mutation-security issues that drive this plan.
- **L4** (TOCTOU race on two-level depth check) — a true fix requires a DB trigger or a `depth` column with a check constraint; a Prisma `$transaction` + `SELECT FOR UPDATE` is a half-measure. Leaving for a dedicated schema-level task.

---

### Task 1: Validation Utilities

**Files:**

- Create: `server/utils/validation.ts`
- Create: `server/utils/validation.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `server/utils/validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  isUuid,
  assertUuid,
  assertNonNegativeInt,
  assertStringLength,
} from './validation';

describe('validation utilities', () => {
  describe('isUuid', () => {
    it('accepts a valid v4 UUID', () => {
      expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    });

    it('rejects empty string', () => {
      expect(isUuid('')).toBe(false);
    });

    it('rejects undefined', () => {
      expect(isUuid(undefined)).toBe(false);
    });

    it('rejects non-uuid string', () => {
      expect(isUuid('not-a-uuid')).toBe(false);
    });

    it('rejects numbers', () => {
      expect(isUuid(42 as unknown as string)).toBe(false);
    });
  });

  describe('assertUuid', () => {
    it('passes through a valid UUID', () => {
      const id = '123e4567-e89b-12d3-a456-426614174000';
      expect(assertUuid(id, 'id')).toBe(id);
    });

    it('throws 400 for invalid UUID', () => {
      expect(() => assertUuid('nope', 'id')).toThrow(/id must be a valid UUID/);
    });

    it('throws 400 for undefined', () => {
      expect(() => assertUuid(undefined, 'id')).toThrow(
        /id must be a valid UUID/
      );
    });
  });

  describe('assertNonNegativeInt', () => {
    it('passes 0', () => {
      expect(assertNonNegativeInt(0, 'order')).toBe(0);
    });

    it('passes 42', () => {
      expect(assertNonNegativeInt(42, 'order')).toBe(42);
    });

    it('rejects negative', () => {
      expect(() => assertNonNegativeInt(-1, 'order')).toThrow(
        /order must be a non-negative integer/
      );
    });

    it('rejects NaN', () => {
      expect(() => assertNonNegativeInt(NaN, 'order')).toThrow();
    });

    it('rejects Infinity', () => {
      expect(() => assertNonNegativeInt(Infinity, 'order')).toThrow();
    });

    it('rejects non-integer', () => {
      expect(() => assertNonNegativeInt(1.5, 'order')).toThrow();
    });

    it('rejects strings', () => {
      expect(() =>
        assertNonNegativeInt('1' as unknown as number, 'order')
      ).toThrow();
    });
  });

  describe('assertStringLength', () => {
    it('passes a normal string', () => {
      expect(assertStringLength('hello', 'name', 200)).toBe('hello');
    });

    it('passes an empty string', () => {
      expect(assertStringLength('', 'name', 200)).toBe('');
    });

    it('rejects a string longer than max', () => {
      const long = 'a'.repeat(201);
      expect(() => assertStringLength(long, 'name', 200)).toThrow(
        /name exceeds max length of 200/
      );
    });

    it('rejects non-strings', () => {
      expect(() =>
        assertStringLength(123 as unknown as string, 'name', 200)
      ).toThrow(/name must be a string/);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run -- server/utils/validation.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `server/utils/validation.ts`**

```typescript
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function assertUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be a valid UUID`,
    });
  }
  return value;
}

export function assertNonNegativeInt(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be a non-negative integer`,
    });
  }
  return value;
}

export function assertStringLength(
  value: unknown,
  field: string,
  max: number
): string {
  if (typeof value !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be a string`,
    });
  }
  if (value.length > max) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} exceeds max length of ${max}`,
    });
  }
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run -- server/utils/validation.test.ts`
Expected: All 18 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/utils/validation.ts server/utils/validation.test.ts
git commit -m "feat: add shared input validation helpers"
```

---

### Task 2: Prisma Error Wrapper

**Files:**

- Create: `server/utils/prismaErrors.ts`
- Create: `server/utils/prismaErrors.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `server/utils/prismaErrors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { translatePrismaError } from './prismaErrors';

function fakePrismaError(code: string, message: string, meta?: unknown) {
  const err = new Error(message);
  (err as unknown as { code: string; meta?: unknown; name: string }).code =
    code;
  (err as unknown as { meta?: unknown }).meta = meta;
  (err as unknown as { name: string }).name = 'PrismaClientKnownRequestError';
  return err;
}

describe('translatePrismaError', () => {
  it('maps P2002 (unique) to 409', () => {
    const err = translatePrismaError(
      fakePrismaError('P2002', 'Unique constraint failed', {
        target: ['name'],
      }),
      { uniqueMessage: 'A navigation with this name already exists' }
    );
    expect((err as { statusCode: number }).statusCode).toBe(409);
  });

  it('maps P2003 (foreign key) to 400', () => {
    const err = translatePrismaError(
      fakePrismaError('P2003', 'Foreign key constraint failed')
    );
    expect((err as { statusCode: number }).statusCode).toBe(400);
  });

  it('maps P2025 (record not found) to 404', () => {
    const err = translatePrismaError(
      fakePrismaError('P2025', 'Record not found')
    );
    expect((err as { statusCode: number }).statusCode).toBe(404);
  });

  it('returns original error for unknown Prisma codes', () => {
    const original = fakePrismaError('P9999', 'Something weird');
    const err = translatePrismaError(original);
    expect(err).toBe(original);
  });

  it('returns original error for non-Prisma errors', () => {
    const original = new Error('Plain error');
    const err = translatePrismaError(original);
    expect(err).toBe(original);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run -- server/utils/prismaErrors.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `server/utils/prismaErrors.ts`**

```typescript
type PrismaLikeError = {
  code?: string;
  meta?: unknown;
  message?: string;
};

function isPrismaError(err: unknown): err is PrismaLikeError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    (err as { code: string }).code.startsWith('P')
  );
}

export interface TranslateOptions {
  uniqueMessage?: string;
  notFoundMessage?: string;
  foreignKeyMessage?: string;
}

export function translatePrismaError(
  err: unknown,
  options: TranslateOptions = {}
): unknown {
  if (!isPrismaError(err)) return err;

  switch (err.code) {
    case 'P2002':
      return createError({
        statusCode: 409,
        statusMessage: options.uniqueMessage ?? 'Resource already exists',
      });
    case 'P2003':
      return createError({
        statusCode: 400,
        statusMessage:
          options.foreignKeyMessage ?? 'Referenced resource does not exist',
      });
    case 'P2025':
      return createError({
        statusCode: 404,
        statusMessage: options.notFoundMessage ?? 'Resource not found',
      });
    default:
      return err;
  }
}

/**
 * Run a Prisma call and re-throw any known error codes as clean HTTP errors.
 * Unknown errors pass through unchanged.
 */
export async function withPrismaErrors<T>(
  fn: () => Promise<T>,
  options: TranslateOptions = {}
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw translatePrismaError(err, options);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run -- server/utils/prismaErrors.test.ts`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/utils/prismaErrors.ts server/utils/prismaErrors.test.ts
git commit -m "feat: add Prisma error translation helper"
```

---

### Task 3: Scope `POST /api/navigation-items` to a Single Navigation

**Files:**

- Modify: `server/api/navigation-items/index.post.ts`
- Modify: `server/api/navigation-items/navigation-items.test.ts`

Addresses **H1** (cross-navigation IDOR on POST) and part of **M4** (input validation).

- [ ] **Step 1: Write failing cross-nav test**

Add to the `POST /api/navigation-items` `describe` block in `server/api/navigation-items/navigation-items.test.ts`:

The cross-nav attack works as follows: create a parent item under the current (seeded) navigation, then POST a new item that _claims_ to be in a different navigationId but references that parent. The server must look at the parent's actual `navigationId` and reject.

```typescript
it('rejects parentId that does not belong to the same navigation', async () => {
  // Create a parent item under the current (seeded) navigation.
  const parentRes = await fetch('/api/navigation-items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: await getSessionCookie(),
    },
    body: JSON.stringify({ navigationId, linkId, order: 500 }),
  });
  const parent = await parentRes.json();

  // POST a child claiming to be in a DIFFERENT navigationId but
  // referencing the parent we just created. Even if that navigationId
  // does not exist, the scoping check on parent.navigationId must fire
  // first and return 400.
  const otherNavId = '00000000-0000-0000-0000-00000000abcd';
  const response = await fetch('/api/navigation-items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: await getSessionCookie(),
    },
    body: JSON.stringify({
      navigationId: otherNavId,
      linkId,
      parentId: parent.id,
      order: 0,
    }),
  });
  expect(response.status).toBe(400);
});

it('rejects invalid UUID in navigationId', async () => {
  const response = await fetch('/api/navigation-items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: await getSessionCookie(),
    },
    body: JSON.stringify({
      navigationId: 'not-a-uuid',
      linkId,
      order: 0,
    }),
  });
  expect(response.status).toBe(400);
});

it('rejects non-integer order', async () => {
  const response = await fetch('/api/navigation-items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: await getSessionCookie(),
    },
    body: JSON.stringify({
      navigationId,
      linkId,
      order: 1.5,
    }),
  });
  expect(response.status).toBe(400);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:run -- server/api/navigation-items/navigation-items.test.ts`
Expected: 3 failures (scoping not yet enforced; invalid UUID currently accepted; non-integer order currently accepted).

- [ ] **Step 3: Rewrite `server/api/navigation-items/index.post.ts`**

```typescript
import { assertUuid, assertNonNegativeInt } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);

  const navigationId = assertUuid(body.navigationId, 'navigationId');
  const linkId = assertUuid(body.linkId, 'linkId');
  const order = assertNonNegativeInt(body.order ?? 0, 'order');

  let parentId: string | null = null;
  if (body.parentId != null && body.parentId !== '') {
    parentId = assertUuid(body.parentId, 'parentId');

    const parent = await prisma.navigationItem.findUnique({
      where: { id: parentId },
      select: { id: true, navigationId: true, parentId: true },
    });

    if (!parent) {
      throw createError({
        statusCode: 400,
        statusMessage: 'parentId does not exist',
      });
    }

    // H1: parent must belong to the same navigation
    if (parent.navigationId !== navigationId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'parentId does not belong to the same navigation',
      });
    }

    // Two-level depth rule
    if (parent.parentId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Cannot nest more than two levels deep',
      });
    }
  }

  const created = await withPrismaErrors(
    () =>
      prisma.navigationItem.create({
        data: {
          navigationId,
          linkId,
          parentId,
          order,
        },
        include: { link: { include: { article: true } } },
      }),
    {
      foreignKeyMessage: 'navigationId or linkId does not exist',
      notFoundMessage: 'Referenced record not found',
    }
  );

  setResponseStatus(event, 201);
  return created;
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run -- server/api/navigation-items/navigation-items.test.ts`
Expected: All POST tests pass, including the new rejection cases.

- [ ] **Step 5: Commit**

```bash
git add server/api/navigation-items/index.post.ts server/api/navigation-items/navigation-items.test.ts
git commit -m "fix(security): scope POST /api/navigation-items to a single navigation"
```

---

### Task 4: Scope `PUT /api/navigation-items/:id` to a Single Navigation

**Files:**

- Modify: `server/api/navigation-items/[id].put.ts`
- Modify: `server/api/navigation-items/navigation-items.test.ts`

Addresses **H1** (cross-navigation reparenting via PUT) and **L1** (UUID validation).

- [ ] **Step 1: Write failing tests**

Add a new `describe('PUT /api/navigation-items/:id', ...)` block to `server/api/navigation-items/navigation-items.test.ts` (if one already exists, append these tests inside it):

```typescript
describe('PUT /api/navigation-items/:id', () => {
  it('rejects invalid UUID in path param', async () => {
    const response = await fetch('/api/navigation-items/not-a-uuid', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({ order: 1 }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects parentId that does not belong to the same navigation', async () => {
    // Create a top-level item to then update
    const createRes = await fetch('/api/navigation-items', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({ navigationId, linkId, order: 700 }),
    });
    const item = await createRes.json();

    // Try to set parentId to a UUID that doesn't exist
    const phantom = '00000000-0000-0000-0000-00000000c0de';
    const response = await fetch(`/api/navigation-items/${item.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({ parentId: phantom }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects negative order', async () => {
    const createRes = await fetch('/api/navigation-items', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({ navigationId, linkId, order: 800 }),
    });
    const item = await createRes.json();

    const response = await fetch(`/api/navigation-items/${item.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({ order: -1 }),
    });
    expect(response.status).toBe(400);
  });

  it('updates order on a valid request', async () => {
    const createRes = await fetch('/api/navigation-items', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({ navigationId, linkId, order: 900 }),
    });
    const item = await createRes.json();

    const response = await fetch(`/api/navigation-items/${item.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({ order: 950 }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.order).toBe(950);
  });
});
```

- [ ] **Step 2: Run tests to verify failures**

Run: `pnpm test:run -- server/api/navigation-items/navigation-items.test.ts`
Expected: The invalid-UUID and negative-order tests fail (current endpoint accepts both).

- [ ] **Step 3: Rewrite `server/api/navigation-items/[id].put.ts`**

```typescript
import { assertUuid, assertNonNegativeInt } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';

export default defineEventHandler(async (event) => {
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.navigationItem.findUnique({
    where: { id },
    select: { id: true, navigationId: true },
  });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Navigation item not found',
    });
  }

  const data: {
    order?: number;
    parentId?: string | null;
    linkId?: string;
  } = {};

  if ('order' in body) {
    data.order = assertNonNegativeInt(body.order, 'order');
  }

  if ('linkId' in body) {
    data.linkId = assertUuid(body.linkId, 'linkId');
  }

  if ('parentId' in body) {
    if (body.parentId == null || body.parentId === '') {
      data.parentId = null;
    } else {
      const parentId = assertUuid(body.parentId, 'parentId');

      const parent = await prisma.navigationItem.findUnique({
        where: { id: parentId },
        select: { id: true, navigationId: true, parentId: true },
      });

      if (!parent) {
        throw createError({
          statusCode: 400,
          statusMessage: 'parentId does not exist',
        });
      }

      // H1: parent must belong to the same navigation as the item
      if (parent.navigationId !== existing.navigationId) {
        throw createError({
          statusCode: 400,
          statusMessage: 'parentId does not belong to the same navigation',
        });
      }

      // Two-level depth rule
      if (parent.parentId) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Cannot nest more than two levels deep',
        });
      }

      // Prevent self-parenting
      if (parent.id === id) {
        throw createError({
          statusCode: 400,
          statusMessage: 'An item cannot be its own parent',
        });
      }

      data.parentId = parentId;
    }
  }

  return await withPrismaErrors(
    () =>
      prisma.navigationItem.update({
        where: { id },
        data,
        include: { link: { include: { article: true } } },
      }),
    { notFoundMessage: 'Navigation item not found' }
  );
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run -- server/api/navigation-items/navigation-items.test.ts`
Expected: All PUT tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/api/navigation-items/[id].put.ts server/api/navigation-items/navigation-items.test.ts
git commit -m "fix(security): scope PUT /api/navigation-items/:id to a single navigation"
```

---

### Task 5: Scope `DELETE /api/navigation-items/:id`

**Files:**

- Modify: `server/api/navigation-items/[id].delete.ts`
- Modify: `pages/navigations/[id].vue` (client must now pass `navigationId`)
- Modify: `server/api/navigation-items/navigation-items.test.ts`

Addresses **H1** (allowing deletion of any item by ID without navigation scope). The caller must declare which navigation it is editing, and the server verifies the item belongs to it.

- [ ] **Step 1: Write failing tests**

Add a new test inside the existing `describe('DELETE /api/navigation-items/:id', ...)` block in `server/api/navigation-items/navigation-items.test.ts`:

```typescript
it('rejects invalid UUID in path param', async () => {
  const response = await fetch('/api/navigation-items/not-a-uuid', {
    method: 'DELETE',
    headers: { Cookie: await getSessionCookie() },
  });
  expect(response.status).toBe(400);
});

it('rejects delete without navigationId query param', async () => {
  const createRes = await fetch('/api/navigation-items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: await getSessionCookie(),
    },
    body: JSON.stringify({ navigationId, linkId, order: 1100 }),
  });
  const item = await createRes.json();

  const response = await fetch(`/api/navigation-items/${item.id}`, {
    method: 'DELETE',
    headers: { Cookie: await getSessionCookie() },
  });
  expect(response.status).toBe(400);
});

it('rejects delete when navigationId does not match the item', async () => {
  const createRes = await fetch('/api/navigation-items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: await getSessionCookie(),
    },
    body: JSON.stringify({ navigationId, linkId, order: 1200 }),
  });
  const item = await createRes.json();

  const wrongNav = '00000000-0000-0000-0000-00000000dead';
  const response = await fetch(
    `/api/navigation-items/${item.id}?navigationId=${wrongNav}`,
    {
      method: 'DELETE',
      headers: { Cookie: await getSessionCookie() },
    }
  );
  expect(response.status).toBe(400);
});
```

Also update the existing "deletes an item without deleting the link" test to pass `navigationId` as a query param:

```typescript
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

  const deleteRes = await fetch(
    `/api/navigation-items/${created.id}?navigationId=${navigationId}`,
    {
      method: 'DELETE',
      headers: { Cookie: await getSessionCookie() },
    }
  );
  expect(deleteRes.status).toBe(200);

  // Link should still exist
  const link = await $fetch<Record<string, unknown>>(`/api/links/${linkId}`, {
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
  });
  expect(link.id).toBe(linkId);
});
```

- [ ] **Step 2: Run tests to verify failures**

Run: `pnpm test:run -- server/api/navigation-items/navigation-items.test.ts`
Expected: The new tests fail, and the pre-existing delete test fails because the endpoint does not yet require `navigationId`.

- [ ] **Step 3: Rewrite `server/api/navigation-items/[id].delete.ts`**

```typescript
import { assertUuid } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';

export default defineEventHandler(async (event) => {
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const query = getQuery(event);
  const navigationId = assertUuid(query.navigationId, 'navigationId');

  const existing = await prisma.navigationItem.findUnique({
    where: { id },
    select: { id: true, navigationId: true },
  });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Navigation item not found',
    });
  }

  // H1: item must belong to the declared navigation
  if (existing.navigationId !== navigationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Navigation item does not belong to the given navigation',
    });
  }

  await withPrismaErrors(
    () => prisma.navigationItem.delete({ where: { id } }),
    { notFoundMessage: 'Navigation item not found' }
  );
  return { success: true };
});
```

- [ ] **Step 4: Update the client `removeItem` to pass `navigationId`**

In `pages/navigations/[id].vue`, update the `removeItem` function:

```typescript
async function removeItem(itemId: string) {
  await fetch(
    `/api/navigation-items/${itemId}?navigationId=${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  );
  await refreshNav();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:run -- server/api/navigation-items/navigation-items.test.ts`
Expected: All DELETE tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/api/navigation-items/[id].delete.ts server/api/navigation-items/navigation-items.test.ts pages/navigations/[id].vue
git commit -m "fix(security): require navigationId scope on DELETE /api/navigation-items/:id"
```

---

### Task 6: Harden `PUT /api/navigation-items/reorder`

**Files:**

- Modify: `server/api/navigation-items/reorder.put.ts`
- Modify: `server/api/navigation-items/navigation-items.test.ts`
- Modify: `pages/navigations/[id].vue` (client must pass `navigationId`)

Addresses **H2** (unbounded batch + cross-nav IDOR via reorder).

- [ ] **Step 1: Write failing tests**

Add these inside the `describe('PUT /api/navigation-items/reorder', ...)` block:

```typescript
it('rejects missing navigationId', async () => {
  const response = await fetch('/api/navigation-items/reorder', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: await getSessionCookie(),
    },
    body: JSON.stringify({
      items: [
        {
          id: '00000000-0000-0000-0000-00000000beef',
          order: 0,
          parentId: null,
        },
      ],
    }),
  });
  expect(response.status).toBe(400);
});

it('rejects a batch larger than 500 items', async () => {
  const items = Array.from({ length: 501 }, (_, i) => ({
    id: '00000000-0000-0000-0000-000000000000',
    order: i,
    parentId: null,
  }));
  const response = await fetch('/api/navigation-items/reorder', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: await getSessionCookie(),
    },
    body: JSON.stringify({ navigationId, items }),
  });
  expect(response.status).toBe(400);
});

it('rejects non-integer order values', async () => {
  const response = await fetch('/api/navigation-items/reorder', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: await getSessionCookie(),
    },
    body: JSON.stringify({
      navigationId,
      items: [
        {
          id: '00000000-0000-0000-0000-000000000000',
          order: 'zero',
          parentId: null,
        },
      ],
    }),
  });
  expect(response.status).toBe(400);
});

it('rejects items that do not belong to the given navigation', async () => {
  // Create an item under the current navigation
  const createRes = await fetch('/api/navigation-items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: await getSessionCookie(),
    },
    body: JSON.stringify({ navigationId, linkId, order: 1400 }),
  });
  const item = await createRes.json();

  // Send the item under a FAKE navigationId in reorder
  const wrongNav = '00000000-0000-0000-0000-00000000fade';
  const response = await fetch('/api/navigation-items/reorder', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: await getSessionCookie(),
    },
    body: JSON.stringify({
      navigationId: wrongNav,
      items: [{ id: item.id, order: 0, parentId: null }],
    }),
  });
  expect(response.status).toBe(400);
});
```

Also update the existing "bulk updates order values" test so it passes the new `navigationId` body field (read the current test; it does not currently send `navigationId`):

```typescript
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
      body: { navigationId, items: reordered },
    }
  );

  expect(Array.isArray(updated)).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify failures**

Run: `pnpm test:run -- server/api/navigation-items/navigation-items.test.ts`
Expected: All four new reorder tests fail; the modified existing test may pass since the server currently ignores the new body field.

- [ ] **Step 3: Rewrite `server/api/navigation-items/reorder.put.ts`**

```typescript
import { assertUuid, assertNonNegativeInt } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';

const MAX_REORDER_ITEMS = 500;

interface ReorderItem {
  id: string;
  order: number;
  parentId: string | null;
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    navigationId?: unknown;
    items?: unknown;
  }>(event);

  const navigationId = assertUuid(body.navigationId, 'navigationId');

  if (!Array.isArray(body.items)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'items array is required',
    });
  }

  if (body.items.length > MAX_REORDER_ITEMS) {
    throw createError({
      statusCode: 400,
      statusMessage: `items array exceeds max size of ${MAX_REORDER_ITEMS}`,
    });
  }

  const validated: ReorderItem[] = body.items.map((raw, idx) => {
    if (typeof raw !== 'object' || raw === null) {
      throw createError({
        statusCode: 400,
        statusMessage: `items[${idx}] must be an object`,
      });
    }
    const item = raw as Record<string, unknown>;
    const id = assertUuid(item.id, `items[${idx}].id`);
    const order = assertNonNegativeInt(item.order, `items[${idx}].order`);

    let parentId: string | null = null;
    if (item.parentId != null && item.parentId !== '') {
      parentId = assertUuid(item.parentId, `items[${idx}].parentId`);
    }

    return { id, order, parentId };
  });

  // H1: all items must belong to the declared navigation. Look up the
  // set of item IDs that actually belong to this navigation in one query;
  // reject if any submitted ID is missing from that set.
  const ids = validated.map((i) => i.id);
  const existing = await prisma.navigationItem.findMany({
    where: { id: { in: ids }, navigationId },
    select: { id: true },
  });
  if (existing.length !== ids.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'one or more items do not belong to the given navigation',
    });
  }

  // Optional: validate that every parentId in the batch also belongs to the
  // same navigation (prevents cross-nav reparenting mid-batch). Look up any
  // non-null parent IDs and ensure they belong here too.
  const parentIds = Array.from(
    new Set(
      validated
        .map((i) => i.parentId)
        .filter((p): p is string => typeof p === 'string')
    )
  );
  if (parentIds.length > 0) {
    const parents = await prisma.navigationItem.findMany({
      where: { id: { in: parentIds }, navigationId },
      select: { id: true },
    });
    if (parents.length !== parentIds.length) {
      throw createError({
        statusCode: 400,
        statusMessage:
          'one or more parentIds do not belong to the given navigation',
      });
    }
  }

  const updated = await withPrismaErrors(() =>
    prisma.$transaction(
      validated.map((item) =>
        prisma.navigationItem.update({
          where: { id: item.id },
          data: { order: item.order, parentId: item.parentId },
        })
      )
    )
  );

  return updated;
});
```

- [ ] **Step 4: Update the client to pass `navigationId`**

In `pages/navigations/[id].vue`, update `moveItem`:

```typescript
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
    body: { navigationId: id, items: reordered },
  });
  await refreshNav();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:run -- server/api/navigation-items/navigation-items.test.ts`
Expected: All reorder tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/api/navigation-items/reorder.put.ts server/api/navigation-items/navigation-items.test.ts pages/navigations/[id].vue
git commit -m "fix(security): harden reorder endpoint with scoping, batch cap, and validation"
```

---

### Task 7: Validate `PUT /api/navigations/:id` Body

**Files:**

- Modify: `server/api/navigations/[id].put.ts`
- Modify: `server/api/navigations/navigations.test.ts`

Addresses **M4** (name length cap + UUID validation) and **L2** (Prisma error handling).

- [ ] **Step 1: Write failing tests**

Add to `server/api/navigations/navigations.test.ts` inside the existing `describe('PUT /api/navigations/:id', ...)` block:

```typescript
it('rejects invalid UUID in path param', async () => {
  const response = await fetch('/api/navigations/not-a-uuid', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: await getSessionCookie(),
    },
    body: JSON.stringify({ name: 'Irrelevant' }),
  });
  expect(response.status).toBe(400);
});

it('rejects a name longer than 200 chars', async () => {
  const { items } = await $fetch<ListResponse>('/api/navigations', {
    headers: { Authorization: `Bearer ${TEST_API_KEY}` },
  });
  const id = items[0]!.id;

  const response = await fetch(`/api/navigations/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: await getSessionCookie(),
    },
    body: JSON.stringify({ name: 'A'.repeat(201) }),
  });
  expect(response.status).toBe(400);
});
```

- [ ] **Step 2: Run tests to verify failures**

Run: `pnpm test:run -- server/api/navigations/navigations.test.ts`
Expected: Both new tests fail.

- [ ] **Step 3: Update `server/api/navigations/[id].put.ts`**

```typescript
import type { Prisma } from '#prisma';
import { applyContentMetadata } from '../../utils/contentUpdate';
import { assertUuid, assertStringLength } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';

const NAME_MAX = 200;

export default defineEventHandler(async (event) => {
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
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
    const name = assertStringLength(body.name, 'name', NAME_MAX);
    data.name = name;
    data.entryTitle = name;
  }
  applyContentMetadata(
    body,
    data as Record<string, unknown>,
    existing.publishedAt
  );

  return await withPrismaErrors(
    () =>
      prisma.navigation.update({
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
      }),
    {
      uniqueMessage: 'A navigation with this name already exists',
      notFoundMessage: 'Navigation not found',
    }
  );
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:run -- server/api/navigations/navigations.test.ts`
Expected: All PUT tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/api/navigations/[id].put.ts server/api/navigations/navigations.test.ts
git commit -m "fix(security): validate navigation PUT body (UUID, name length, prisma errors)"
```

---

### Task 8: Rate Limiting for Mutating Navigation Endpoints

**Files:**

- Create: `server/utils/rateLimitEndpoint.ts`
- Modify: `server/api/navigation-items/index.post.ts`
- Modify: `server/api/navigation-items/[id].put.ts`
- Modify: `server/api/navigation-items/[id].delete.ts`
- Modify: `server/api/navigation-items/reorder.put.ts`
- Modify: `server/api/navigations/[id].put.ts`
- Modify: `server/api/links.get.ts` (no — **do not** add here; only mutations)
- Create: `server/api/navigation-items/rate-limit.test.ts`

Addresses **M5**. Uses the existing `server/utils/rateLimit.ts` sliding-window helper.

- [ ] **Step 1: Write failing test**

Create `server/api/navigation-items/rate-limit.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { resetRateLimitStore } from '../../utils/rateLimit';

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

describe('Mutating nav endpoints rate limit', async () => {
  await setup({ dev: true });

  beforeAll(() => {
    resetRateLimitStore();
  });

  it('returns 429 after exceeding the per-endpoint mutation limit', async () => {
    // Grab the seeded navigation's id for a harmless PUT payload
    const navsRes = await fetch('/api/navigations', {
      headers: {
        Authorization: `Bearer boject_test_key_for_integration_tests_only`,
      },
    });
    const navs = (await navsRes.json()) as {
      items: { id: string; name: string }[];
    };
    const navId = navs.items[0]!.id;
    const currentName = navs.items[0]!.name;

    // Fire 31 requests to a mutating endpoint; the configured limit is 30/60s
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await fetch(`/api/navigations/${navId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ name: currentName }),
      });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run -- server/api/navigation-items/rate-limit.test.ts`
Expected: FAIL — no rate limiting applied yet.

- [ ] **Step 3: Create `server/utils/rateLimitEndpoint.ts`**

```typescript
import type { H3Event } from 'h3';
import { rateLimit } from './rateLimit';

const MUTATION_MAX = 30;
const MUTATION_WINDOW_MS = 60_000;

/**
 * Apply a per-IP, per-endpoint sliding-window rate limit for mutating
 * requests. Throws a 429 if the limit is exceeded.
 */
export function enforceMutationRateLimit(event: H3Event, endpoint: string) {
  const ip =
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ??
    event.node.req.socket.remoteAddress ??
    'unknown';
  const key = `mut:${endpoint}:${ip}`;
  const { allowed, retryAfterMs } = rateLimit(
    key,
    MUTATION_MAX,
    MUTATION_WINDOW_MS
  );
  if (!allowed) {
    setResponseHeader(
      event,
      'Retry-After',
      String(Math.ceil(retryAfterMs / 1000))
    );
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many requests',
    });
  }
}
```

- [ ] **Step 4: Apply to every mutating nav endpoint**

In each of the following files, add an `enforceMutationRateLimit(event, '<endpoint-id>')` call as the first line of the handler body (after `const body = await readBody(event)` would be too late because the error-thrown from limit should happen before reading the body; put it before `readBody`):

- `server/api/navigation-items/index.post.ts`:
  ```typescript
  import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
  // ...
  export default defineEventHandler(async (event) => {
    enforceMutationRateLimit(event, 'navigation-items.post');
    const body = await readBody<Record<string, unknown>>(event);
    // ...
  ```
- `server/api/navigation-items/[id].put.ts`:
  ```typescript
  import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
  // ...
  export default defineEventHandler(async (event) => {
    enforceMutationRateLimit(event, 'navigation-items.put');
    const id = assertUuid(getRouterParam(event, 'id'), 'id');
    // ...
  ```
- `server/api/navigation-items/[id].delete.ts`:
  ```typescript
  import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
  // ...
  export default defineEventHandler(async (event) => {
    enforceMutationRateLimit(event, 'navigation-items.delete');
    const id = assertUuid(getRouterParam(event, 'id'), 'id');
    // ...
  ```
- `server/api/navigation-items/reorder.put.ts`:
  ```typescript
  import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
  // ...
  export default defineEventHandler(async (event) => {
    enforceMutationRateLimit(event, 'navigation-items.reorder');
    const body = await readBody<{
      navigationId?: unknown;
      items?: unknown;
    }>(event);
    // ...
  ```
- `server/api/navigations/[id].put.ts`:

  ```typescript
  import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
  // ...
  export default defineEventHandler(async (event) => {
    enforceMutationRateLimit(event, 'navigations.put');
    const id = assertUuid(getRouterParam(event, 'id'), 'id');
    // ...
  ```

- [ ] **Step 5: Ensure other mutation tests do not blow the limit**

The existing `server/api/navigation-items/navigation-items.test.ts` fires fewer than 30 POSTs inside a single file, but because `fileParallelism` is false, each test file runs sequentially against a fresh dev server. Add a `beforeAll` block at the top of `navigation-items.test.ts`, `navigations.test.ts`, and `rate-limit.test.ts` that resets the rate-limit store so tests never pollute each other:

```typescript
import { resetRateLimitStore } from '../../utils/rateLimit';

// ...

beforeAll(() => {
  resetRateLimitStore();
});
```

(Import `beforeAll` from `vitest` if not already imported.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test:run -- server/api/navigation-items/ server/api/navigations/`
Expected: All navigation-related tests pass, including the new rate-limit test.

- [ ] **Step 7: Commit**

```bash
git add server/utils/rateLimitEndpoint.ts server/api/navigation-items/ server/api/navigations/
git commit -m "fix(security): rate limit mutating navigation endpoints"
```

---

### Task 9: CSRF Defense-in-Depth — SameSite=Strict + Origin Check

**Files:**

- Modify: `nuxt.config.ts` (session cookie config)
- Modify: `.env.example` (document `NUXT_SESSION_PASSWORD`)
- Create: `server/middleware/csrf.ts`
- Create: `server/middleware/csrf.test.ts`

Addresses **M1**. Two layers:

1. Harden the `nuxt-auth-utils` session cookie to `SameSite=Strict`.
2. Add a global server middleware that rejects non-GET/HEAD `/api/*` requests whose `Origin` header does not match the host, unless the request carries a valid API-key bearer token (API keys are already read-only in `server/middleware/auth.ts`, so this branch is a no-op guard for API-key-issued read-only calls). `/api/auth/**` and the same skip list as the auth middleware are exempt.

- [ ] **Step 1: Write failing tests**

Create `server/middleware/csrf.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { resetRateLimitStore } from '../utils/rateLimit';

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

describe('CSRF Origin check', async () => {
  await setup({ dev: true });

  beforeAll(() => {
    resetRateLimitStore();
  });

  it('rejects a mutating request with a foreign Origin header', async () => {
    const navsRes = await fetch('/api/navigations', {
      headers: {
        Authorization: `Bearer boject_test_key_for_integration_tests_only`,
      },
    });
    const navs = (await navsRes.json()) as { items: { id: string }[] };
    const navId = navs.items[0]!.id;

    const response = await fetch(`/api/navigations/${navId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example.com',
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({ name: 'anything' }),
    });
    expect(response.status).toBe(403);
  });

  it('allows a mutating request from the same Origin', async () => {
    const navsRes = await fetch('/api/navigations', {
      headers: {
        Authorization: `Bearer boject_test_key_for_integration_tests_only`,
      },
    });
    const navs = (await navsRes.json()) as {
      items: { id: string; name: string }[];
    };
    const nav = navs.items[0]!;

    // Use the dev-server's own host in the Origin header. @nuxt/test-utils
    // exposes the URL via an env var the fetch helper already knows about;
    // simplest: rely on the relative path being resolved against the same
    // host, and set Origin to match that.
    const baseUrl = process.env._NUXT_TEST_URL ?? 'http://localhost:4000';
    const response = await fetch(`/api/navigations/${nav.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({ name: nav.name }),
    });
    expect(response.status).toBe(200);
  });

  it('allows requests without an Origin header (server-to-server, e.g. API key)', async () => {
    const response = await fetch('/api/navigations', {
      method: 'GET',
      headers: {
        Authorization: `Bearer boject_test_key_for_integration_tests_only`,
      },
    });
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run -- server/middleware/csrf.test.ts`
Expected: FAIL — `csrf.ts` middleware does not exist; the foreign-origin test gets 200 from the current server.

- [ ] **Step 3: Create `server/middleware/csrf.ts`**

Middleware runs **before** the auth middleware alphabetically (`csrf.ts` < `auth.ts` is false — actually `auth.ts` < `csrf.ts` alphabetically). Nitro loads middleware in lexicographic order. Rename to `a-csrf.ts` if needed, but Nitro guarantees no specific order across middlewares beyond file-system listing. To keep things explicit, make this middleware tolerant: it does not need to run before auth; it only needs to run before the handler.

```typescript
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const SKIP_PREFIXES = ['/api/auth/', '/api/_auth/', '/api/graphql'];

function isSkipped(path: string): boolean {
  if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return true;
  if (/^\/api\/images\/[^/]+\/transform$/.test(path)) return true;
  if (/^\/api\/images\/[^/]+\/placeholder$/.test(path)) return true;
  return false;
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname;

  // Only gate /api/*
  if (!path.startsWith('/api/')) return;
  if (isSkipped(path)) return;

  const method = getMethod(event).toUpperCase();
  if (SAFE_METHODS.has(method)) return;

  // API-key requests are read-only (enforced by auth middleware), but they
  // can still hit mutating paths and get a 403 from auth. We don't need a
  // CSRF check on them because API keys are not ambient credentials — the
  // browser does not attach them automatically. Let them through; auth
  // will reject on method.
  const authHeader = getRequestHeader(event, 'authorization');
  if (authHeader?.startsWith('Bearer ')) return;

  const origin = getRequestHeader(event, 'origin');
  const referer = getRequestHeader(event, 'referer');
  const host = getRequestHeader(event, 'host');

  if (!host) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Missing Host header',
    });
  }

  const sourceHost = origin
    ? hostFromUrl(origin)
    : referer
      ? hostFromUrl(referer)
      : null;

  // No Origin and no Referer on a mutating cookie-authed request is a
  // red flag (some legitimate cases exist, but the CMS only runs from a
  // real browser — reject).
  if (!sourceHost) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Missing Origin/Referer',
    });
  }

  if (sourceHost !== host) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Cross-origin request rejected',
    });
  }
});
```

- [ ] **Step 4: Harden the session cookie in `nuxt.config.ts`**

Add `runtimeConfig.session.cookie` configuration:

```typescript
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL ?? '',
    session: {
      cookie: {
        sameSite: 'strict',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
```

(Keep the existing `databaseUrl` property.)

- [ ] **Step 5: Run CSRF tests**

Run: `pnpm test:run -- server/middleware/csrf.test.ts`
Expected: All three tests pass.

- [ ] **Step 6: Run the full nav-related test suite**

Run: `pnpm test:run -- server/api/navigations/ server/api/navigation-items/ server/api/links/ server/middleware/`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add nuxt.config.ts server/middleware/csrf.ts server/middleware/csrf.test.ts
git commit -m "fix(security): add CSRF origin check middleware and SameSite=Strict session cookie"
```

---

### Task 10: Update CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the new utilities, CSRF policy, and rate limits**

Add the following bullets in the appropriate sections:

- Under the **Architecture** bullet list (after the REST API filtering line), add:

  ```markdown
  - **CSRF protection** — `server/middleware/csrf.ts` rejects non-GET/HEAD `/api/*` requests whose `Origin`/`Referer` does not match the request `Host`, unless the request carries a `Bearer` API key (API keys are ambient-credential-free). Session cookie is `SameSite=Strict, HttpOnly, Secure` (secure only in production) via `runtimeConfig.session.cookie` in `nuxt.config.ts`.
  - **Mutation rate limiting** — `server/utils/rateLimitEndpoint.ts` applies a per-IP, per-endpoint sliding window (30 req/60s) to mutating navigation endpoints via `enforceMutationRateLimit(event, '<id>')`. Uses the existing `rateLimit()` sliding-window helper.
  - **Shared validation** — `server/utils/validation.ts` exports `isUuid`, `assertUuid`, `assertNonNegativeInt`, `assertStringLength` for consistent 400 errors on bad input.
  - **Prisma error translation** — `server/utils/prismaErrors.ts` exports `translatePrismaError` and `withPrismaErrors(fn, opts)` which translate P2002 → 409, P2003 → 400, P2025 → 404 with configurable messages.
  - **Navigation-item scoping** — all mutating nav-item endpoints (POST, PUT `[id]`, DELETE `[id]`, PUT `reorder`) require a `navigationId` and verify that every item (and `parentId`, where relevant) belongs to that navigation. `reorder` additionally caps the batch at 500 items and validates each element's shape.
  ```

- Under **Key Files**, add:

  ```markdown
  - `server/utils/validation.ts` — Shared input validation helpers
  - `server/utils/prismaErrors.ts` — Prisma error-code → HTTP error translation
  - `server/utils/rateLimitEndpoint.ts` — Per-endpoint mutation rate limiter
  - `server/middleware/csrf.ts` — CSRF origin/referer check for mutating `/api/*` routes
  ```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document navigation security hardening"
```

---

### Task 11: Full Verification Pass

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test:run`
Expected: All tests pass.

- [ ] **Step 2: Lint, typecheck, format**

Run: `pnpm lint && pnpm typecheck && pnpm format`
Expected: No errors.

- [ ] **Step 3: If formatting changed anything, commit it**

```bash
git add -A
git commit -m "chore: formatting"
```
