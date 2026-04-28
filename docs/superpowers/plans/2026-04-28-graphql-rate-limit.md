# GraphQL rate limit (per API key) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a per-API-key sliding-window rate limit to `/api/graphql` in production. Default 1000 RPS, operator-tunable via `GRAPHQL_RATE_LIMIT_RPS`.

**Architecture:** Reuse the existing `rateLimit()` sliding-window primitive. Extend `validateApiKey` to surface `apiKeyId` so requests can be bucketed per key. Add a new `enforceGraphqlRateLimit` helper alongside the existing mutation limiter. Wire into the GraphQL handler after auth in production only — dev mode bypasses both auth and the limiter.

**Tech Stack:** TypeScript, Nuxt 4 / Nitro / H3, Vitest (unit + integration projects), Prisma v7.

**Spec:** [`docs/superpowers/specs/2026-04-28-graphql-rate-limit-design.md`](../specs/2026-04-28-graphql-rate-limit-design.md)

---

## File Structure

| File                                              | Action | Responsibility                                                                                                                                                 |
| ------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cms/server/utils/validateApiKey.ts`         | modify | Extend return shape with `apiKeyId` + `keyPrefix`. Extract pure inner `resolveApiKey(prisma, header)` for unit testability.                                    |
| `apps/cms/server/utils/validateApiKey.test.ts`    | create | Unit tests for `resolveApiKey` covering all branches of the new return shape.                                                                                  |
| `apps/cms/server/utils/rateLimitEndpoint.ts`      | modify | Add `getGraphqlMax()` parser + `enforceGraphqlRateLimit(event, apiKeyId)` helper. Add explicit h3 imports to make the file unit-testable.                      |
| `apps/cms/server/utils/rateLimitEndpoint.test.ts` | create | Unit tests for `getGraphqlMax` (default, env-honoured, invalid fallback) and `enforceGraphqlRateLimit` (cap, Retry-After, independent buckets, window expiry). |
| `apps/cms/server/api/graphql/graphql.ts`          | modify | Call `enforceGraphqlRateLimit(event, result.apiKeyId)` after a successful `validateApiKey` in the production branch.                                           |
| `apps/cms/.env.example`                           | modify | Document `GRAPHQL_RATE_LIMIT_RPS` with a usage hint pointing at the `perf/` sweep.                                                                             |

---

## Task 1: Extend `validateApiKey` return shape (DI extraction + tests)

**Files:**

- Modify: `apps/cms/server/utils/validateApiKey.ts`
- Create: `apps/cms/server/utils/validateApiKey.test.ts`

**Why DI extraction:** The current `validateApiKey(event)` uses Nuxt-auto-imported `prisma` and h3 helpers. To unit-test it without Nitro context, we extract the pure logic into `resolveApiKey(prisma, header)` — same DI pattern as `runCleanup(prisma, …)` in `webhookCleanup.ts`. The outer `validateApiKey(event)` becomes a thin event-glue wrapper.

- [ ] **Step 1: Write the failing test file**

Create `apps/cms/server/utils/validateApiKey.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolveApiKey } from './validateApiKey';
import { hashApiKey } from './apiKey';

type FakePrisma = {
  apiKey: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

function makePrisma(row: unknown): FakePrisma {
  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(row),
      update: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('resolveApiKey', () => {
  it('returns invalid when header is missing', async () => {
    const prisma = makePrisma(null);
    const result = await resolveApiKey(prisma, undefined);
    expect(result).toEqual({
      valid: false,
      message: 'Missing Authorization header',
    });
    expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it('returns invalid for malformed Bearer header', async () => {
    const prisma = makePrisma(null);
    const result = await resolveApiKey(prisma, 'Basic xyz');
    expect(result).toEqual({
      valid: false,
      message: 'Invalid Authorization format',
    });
    expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it('returns invalid when no key matches the hash', async () => {
    const prisma = makePrisma(null);
    const result = await resolveApiKey(prisma, 'Bearer boject_unknown');
    expect(result).toEqual({ valid: false, message: 'Invalid API key' });
    expect(prisma.apiKey.findUnique).toHaveBeenCalledWith({
      where: { keyHash: hashApiKey('boject_unknown') },
    });
  });

  it('returns invalid for a revoked key', async () => {
    const prisma = makePrisma({
      id: 'key-1',
      keyPrefix: 'boject_test',
      revokedAt: new Date('2026-04-01'),
    });
    const result = await resolveApiKey(prisma, 'Bearer boject_test_revoked');
    expect(result).toEqual({
      valid: false,
      message: 'API key has been revoked',
    });
  });

  it('returns valid with apiKeyId + keyPrefix on success', async () => {
    const prisma = makePrisma({
      id: 'key-1',
      keyPrefix: 'boject_test',
      revokedAt: null,
    });
    const result = await resolveApiKey(prisma, 'Bearer boject_test_active');
    expect(result).toEqual({
      valid: true,
      apiKeyId: 'key-1',
      keyPrefix: 'boject_test',
    });
    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: { lastUsedAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: Run test, verify all five fail**

Run: `pnpm --filter cms test:unit -- --run validateApiKey`

Expected: FAIL — `resolveApiKey` is not exported from `./validateApiKey`.

- [ ] **Step 3: Refactor `validateApiKey.ts` to expose `resolveApiKey`**

Replace the contents of `apps/cms/server/utils/validateApiKey.ts` with:

```ts
import type { H3Event } from 'h3';
import { getRequestHeader } from 'h3';
import { prisma } from './prisma';
import { hashApiKey } from './apiKey';

export type ValidateApiKeyResult =
  | { valid: true; apiKeyId: string; keyPrefix: string }
  | { valid: false; message: string };

type ApiKeyClient = {
  apiKey: {
    findUnique: (args: { where: { keyHash: string } }) => Promise<{
      id: string;
      keyPrefix: string;
      revokedAt: Date | null;
    } | null>;
    update: (args: {
      where: { id: string };
      data: { lastUsedAt: Date };
    }) => Promise<unknown>;
  };
};

export async function resolveApiKey(
  client: ApiKeyClient,
  header: string | undefined
): Promise<ValidateApiKeyResult> {
  if (!header) {
    return { valid: false, message: 'Missing Authorization header' };
  }

  const match = header.match(/^Bearer (boject_.+)$/);
  if (!match) {
    return { valid: false, message: 'Invalid Authorization format' };
  }

  const keyHash = hashApiKey(match[1]!);
  const apiKey = await client.apiKey.findUnique({ where: { keyHash } });

  if (!apiKey) {
    return { valid: false, message: 'Invalid API key' };
  }

  if (apiKey.revokedAt) {
    return { valid: false, message: 'API key has been revoked' };
  }

  // Fire-and-forget lastUsedAt update
  client.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { valid: true, apiKeyId: apiKey.id, keyPrefix: apiKey.keyPrefix };
}

export async function validateApiKey(
  event: H3Event
): Promise<ValidateApiKeyResult> {
  const header = getRequestHeader(event, 'authorization');
  return resolveApiKey(prisma, header);
}
```

Note: `prisma` and h3 helpers are explicitly imported now. Auto-imports still work in Nuxt runtime, but explicit imports make the file self-contained for unit testing.

- [ ] **Step 4: Run unit tests, verify they pass**

Run: `pnpm --filter cms test:unit -- --run validateApiKey`

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Run typecheck + integration suite — confirm no regressions**

Run: `pnpm --filter cms typecheck`
Expected: PASS.

Run: `pnpm --filter cms test:integration -- --run auth`
Expected: PASS (existing auth integration tests should be unaffected).

- [ ] **Step 6: Commit**

```bash
git add apps/cms/server/utils/validateApiKey.ts \
        apps/cms/server/utils/validateApiKey.test.ts
git commit -m "$(cat <<'EOF'
feat(auth): extract resolveApiKey + return apiKeyId on success

validateApiKey now returns { apiKeyId, keyPrefix } alongside `valid: true`,
so downstream consumers can bucket per key. The pure inner resolveApiKey
takes the prisma client by parameter, matching the runCleanup DI pattern
and enabling fast unit tests without Nitro context.

Refs: #121
EOF
)"
```

---

## Task 2: Add `getGraphqlMax` env-var parser

**Files:**

- Modify: `apps/cms/server/utils/rateLimitEndpoint.ts`
- Create: `apps/cms/server/utils/rateLimitEndpoint.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `apps/cms/server/utils/rateLimitEndpoint.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getGraphqlMax } from './rateLimitEndpoint';

describe('getGraphqlMax', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 1000 when env var is unset', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '');
    expect(getGraphqlMax()).toBe(1000);
  });

  it('honours a positive integer env var', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '500');
    expect(getGraphqlMax()).toBe(500);
  });

  it('falls back to 1000 for non-numeric values', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', 'abc');
    expect(getGraphqlMax()).toBe(1000);
  });

  it('falls back to 1000 for zero or negative values', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '0');
    expect(getGraphqlMax()).toBe(1000);
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '-1');
    expect(getGraphqlMax()).toBe(1000);
  });

  it('falls back to 1000 for "NaN"', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', 'NaN');
    expect(getGraphqlMax()).toBe(1000);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter cms test:unit -- --run rateLimitEndpoint`

Expected: FAIL — `getGraphqlMax` is not exported.

- [ ] **Step 3: Add `getGraphqlMax` and explicit h3 imports**

Replace the contents of `apps/cms/server/utils/rateLimitEndpoint.ts` with:

```ts
import type { H3Event } from 'h3';
import {
  setResponseHeader,
  createError,
  getRequestHeader,
  getRequestIP,
} from 'h3';
import { rateLimit } from './rateLimit';

const MUTATION_MAX = 50;
const MUTATION_WINDOW_MS = 60_000;
const GRAPHQL_DEFAULT_MAX = 1000;
const GRAPHQL_WINDOW_MS = 1_000;

/**
 * Apply a per-IP, per-endpoint sliding-window rate limit for mutating
 * requests. Throws a 429 if the limit is exceeded.
 */
export function enforceMutationRateLimit(event: H3Event, endpoint: string) {
  const ip =
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ||
    getRequestIP(event) ||
    'unknown';
  const key = `mut:${endpoint}:${ip}`;
  const { allowed, retryAfterMs } = rateLimit(
    key,
    MUTATION_MAX,
    MUTATION_WINDOW_MS
  );
  if (!allowed) {
    setResponseHeader(event, 'Retry-After', Math.ceil(retryAfterMs / 1000));
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many requests',
    });
  }
}

/**
 * Resolve the configured GraphQL rate-limit cap. Defaults to
 * GRAPHQL_DEFAULT_MAX when GRAPHQL_RATE_LIMIT_RPS is unset, empty, or
 * not a positive integer.
 */
export function getGraphqlMax(): number {
  const raw = process.env.GRAPHQL_RATE_LIMIT_RPS;
  if (!raw) return GRAPHQL_DEFAULT_MAX;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return GRAPHQL_DEFAULT_MAX;
  return parsed;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter cms test:unit -- --run rateLimitEndpoint`

Expected: PASS — all 5 `getGraphqlMax` tests green.

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter cms typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/server/utils/rateLimitEndpoint.ts \
        apps/cms/server/utils/rateLimitEndpoint.test.ts
git commit -m "$(cat <<'EOF'
feat(graphql): add GRAPHQL_RATE_LIMIT_RPS env parser

getGraphqlMax() reads the env var at runtime and falls back to 1000 for
unset / empty / non-numeric / zero / negative values. Runtime read avoids
vi.resetModules() gymnastics in tests; silent fallback avoids crashing
the server on operator typos.

Refs: #121
EOF
)"
```

---

## Task 3: Add `enforceGraphqlRateLimit` helper

**Files:**

- Modify: `apps/cms/server/utils/rateLimitEndpoint.ts`
- Modify: `apps/cms/server/utils/rateLimitEndpoint.test.ts`

- [ ] **Step 1: Replace the test file with the full test suite**

Replace the entire contents of `apps/cms/server/utils/rateLimitEndpoint.test.ts` with:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { H3Event } from 'h3';
import { enforceGraphqlRateLimit, getGraphqlMax } from './rateLimitEndpoint';
import { resetRateLimitStore } from './rateLimit';

type MockEvent = {
  headers: Map<string, string>;
  event: H3Event;
};

function makeMockEvent(): MockEvent {
  const headers = new Map<string, string>();
  const event = {
    node: {
      req: { headers: {} },
      res: {
        headersSent: false,
        setHeader(name: string, value: string | number | string[]) {
          headers.set(name.toLowerCase(), String(value));
        },
        getHeader(name: string) {
          return headers.get(name.toLowerCase());
        },
      },
    },
  } as unknown as H3Event;
  return { headers, event };
}

describe('getGraphqlMax', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 1000 when env var is unset', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '');
    expect(getGraphqlMax()).toBe(1000);
  });

  it('honours a positive integer env var', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '500');
    expect(getGraphqlMax()).toBe(500);
  });

  it('falls back to 1000 for non-numeric values', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', 'abc');
    expect(getGraphqlMax()).toBe(1000);
  });

  it('falls back to 1000 for zero or negative values', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '0');
    expect(getGraphqlMax()).toBe(1000);
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '-1');
    expect(getGraphqlMax()).toBe(1000);
  });

  it('falls back to 1000 for "NaN"', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', 'NaN');
    expect(getGraphqlMax()).toBe(1000);
  });
});

describe('enforceGraphqlRateLimit', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('honours the configured cap and throws 429 with Retry-After when exceeded', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '5');
    const { event, headers } = makeMockEvent();

    for (let i = 0; i < 5; i++) {
      expect(() => enforceGraphqlRateLimit(event, 'key-1')).not.toThrow();
    }

    let thrown: unknown;
    try {
      enforceGraphqlRateLimit(event, 'key-1');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ statusCode: 429 });
    expect(headers.get('retry-after')).toBeDefined();
  });

  it('keeps independent buckets per apiKeyId', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '3');
    const { event } = makeMockEvent();

    for (let i = 0; i < 3; i++) {
      enforceGraphqlRateLimit(event, 'key-a');
    }
    expect(() => enforceGraphqlRateLimit(event, 'key-a')).toThrow();
    expect(() => enforceGraphqlRateLimit(event, 'key-b')).not.toThrow();
  });

  it('lets traffic resume after the 1-second window expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-28T12:00:00.000Z'));
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '2');
    const { event } = makeMockEvent();

    enforceGraphqlRateLimit(event, 'key-1');
    enforceGraphqlRateLimit(event, 'key-1');
    expect(() => enforceGraphqlRateLimit(event, 'key-1')).toThrow();

    // Advance past the 1s window
    vi.advanceTimersByTime(1_100);
    expect(() => enforceGraphqlRateLimit(event, 'key-1')).not.toThrow();
  });

  it('falls back to 1000 cap when env var is unset', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '');
    const { event } = makeMockEvent();
    for (let i = 0; i < 1000; i++) {
      enforceGraphqlRateLimit(event, 'key-default');
    }
    expect(() => enforceGraphqlRateLimit(event, 'key-default')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter cms test:unit -- --run rateLimitEndpoint`

Expected: FAIL — `enforceGraphqlRateLimit` is not exported.

- [ ] **Step 3: Implement `enforceGraphqlRateLimit`**

Append to `apps/cms/server/utils/rateLimitEndpoint.ts`:

```ts
/**
 * Apply a per-API-key sliding-window rate limit on /api/graphql.
 * Threshold defaults to 1000 RPS, override via GRAPHQL_RATE_LIMIT_RPS.
 * Throws a 429 with Retry-After if the limit is exceeded.
 */
export function enforceGraphqlRateLimit(event: H3Event, apiKeyId: string) {
  const { allowed, retryAfterMs } = rateLimit(
    `gql:${apiKeyId}`,
    getGraphqlMax(),
    GRAPHQL_WINDOW_MS
  );
  if (!allowed) {
    setResponseHeader(event, 'Retry-After', Math.ceil(retryAfterMs / 1000));
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many requests',
    });
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter cms test:unit -- --run rateLimitEndpoint`

Expected: PASS — all 9 tests in the file green (5 from Task 2 + 4 new).

- [ ] **Step 5: Run typecheck + lint**

Run: `pnpm --filter cms typecheck`
Expected: PASS.

Run: `pnpm --filter cms lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cms/server/utils/rateLimitEndpoint.ts \
        apps/cms/server/utils/rateLimitEndpoint.test.ts
git commit -m "$(cat <<'EOF'
feat(graphql): add enforceGraphqlRateLimit helper

Sliding 1-second window keyed by API key id, threshold from getGraphqlMax.
Sets Retry-After on 429 (seconds until the oldest tracked timestamp ages
out). Same shape as enforceMutationRateLimit; #124 will enrich the body
later.

Refs: #121
EOF
)"
```

---

## Task 4: Wire `enforceGraphqlRateLimit` into the GraphQL handler

**Files:**

- Modify: `apps/cms/server/api/graphql/graphql.ts`

No new test in this task. The existing `apps/cms/server/api/graphql/graphql.test.ts` runs against `setup({ dev: true })`, where the production branch (and therefore the rate limiter) is bypassed. Production-mode integration coverage is out of scope for this ticket — the helper's logic is exhaustively unit-tested in Tasks 2/3, and the wiring is a single line that we'll smoke-test by ensuring the existing GraphQL integration suite still passes after the change.

- [ ] **Step 1: Wire the helper into the production branch**

Replace the contents of `apps/cms/server/api/graphql/graphql.ts` with:

```ts
import { createYoga } from 'graphql-yoga';
import { defineEventHandler } from 'h3';
import { maxDepthPlugin } from '@escape.tech/graphql-armor-max-depth';
import { getSchema } from '../../graphql/schema';
import { validateApiKey } from '../../utils/validateApiKey';
import { enforceGraphqlRateLimit } from '../../utils/rateLimitEndpoint';

const yoga = createYoga({
  schema: () => getSchema(),
  graphqlEndpoint: '/api/graphql',
  graphiql: process.env.NODE_ENV !== 'production',
  plugins: [maxDepthPlugin({ n: 15 })],
});

export default defineEventHandler(async (event) => {
  const { req, res } = event.node;

  // Allow all requests without auth in dev (GraphiQL playground needs POST for introspection)
  if (process.env.NODE_ENV !== 'production') {
    return yoga(req, res);
  }

  const result = await validateApiKey(event);
  if (!result.valid) {
    setResponseStatus(event, 401);
    return { error: result.message };
  }

  enforceGraphqlRateLimit(event, result.apiKeyId);

  return yoga(req, res);
});
```

Note: `validateApiKey` and `enforceGraphqlRateLimit` were previously auto-imported. We're being explicit here to match the pattern established in Tasks 1–3 and to keep the production branch easy to read.

- [ ] **Step 2: Run typecheck — confirm `result.apiKeyId` narrows correctly**

Run: `pnpm --filter cms typecheck`

Expected: PASS. The discriminated union from Task 1 narrows `result` to `{ valid: true; apiKeyId: string; keyPrefix: string }` after the `if (!result.valid)` early return.

- [ ] **Step 3: Run the existing GraphQL integration suite — confirm no regressions**

Run: `pnpm --filter cms test:integration -- --run graphql`

Expected: PASS. Dev mode bypasses the limiter, so no behaviour change for these tests.

- [ ] **Step 4: Run the full test suite to catch unrelated regressions**

Run: `pnpm --filter cms test`

Expected: PASS — all unit + integration + storybook projects green.

- [ ] **Step 5: Commit**

```bash
git add apps/cms/server/api/graphql/graphql.ts
git commit -m "$(cat <<'EOF'
feat(graphql): enforce per-API-key rate limit in production

Production GraphQL requests are now bucketed per apiKeyId via the new
enforceGraphqlRateLimit helper. Dev mode is unchanged (auth + limiter
both bypassed for GraphiQL).

Closes #121
EOF
)"
```

---

## Task 5: Document `GRAPHQL_RATE_LIMIT_RPS` in `.env.example`

**Files:**

- Modify: `apps/cms/.env.example`

- [ ] **Step 1: Add the env var to `.env.example`**

Replace the contents of `apps/cms/.env.example` with:

```env
# Environment variables declared in this file are NOT automatically loaded by Prisma.
# Please add `import "dotenv/config";` to your `prisma.config.ts` file, or use the Prisma CLI with Bun
# to load environment variables from .env files: https://pris.ly/prisma-config-env-vars.

# Prisma supports the native connection string format for PostgreSQL, MySQL, SQLite, SQL Server, MongoDB and CockroachDB.
# See the documentation for all the connection string options: https://pris.ly/d/connection-strings

DATABASE_URL="postgresql://boject:boject@localhost:5432/boject"

# Required in production. 32+ char random secret used to seal session cookies.
# Generate: openssl rand -hex 32
NUXT_SESSION_PASSWORD=

# Integration test credentials
INTEGRATION_TEST_USERNAME=
INTEGRATION_TEST_PASSWORD=

# GraphQL rate limit (per API key, per second). Defaults to 1000 if unset
# or invalid. Run the perf/ sweep against your own infrastructure to pick
# a threshold that matches your hardware's measured headroom.
GRAPHQL_RATE_LIMIT_RPS=1000
```

- [ ] **Step 2: Verify formatting**

Run: `pnpm --filter cms format`
Expected: No changes needed (the file is plain `.env`, not parsed by Prettier).

- [ ] **Step 3: Commit**

```bash
git add apps/cms/.env.example
git commit -m "$(cat <<'EOF'
docs(env): document GRAPHQL_RATE_LIMIT_RPS

Tunable via env, default 1000. Operators tune from their own perf/ sweep
results.

Refs: #121
EOF
)"
```

---

## Final verification checklist

After all 5 tasks are committed, verify the branch end-to-end before opening a PR:

- [ ] `pnpm --filter cms typecheck` — clean
- [ ] `pnpm --filter cms lint` — clean
- [ ] `pnpm --filter cms test` — all unit + integration + storybook projects green
- [ ] `git log --oneline main..HEAD` shows 5 focused commits in the order above
- [ ] Manual smoke check: `pnpm dev`, hit `http://localhost:4000/api/graphql` with GraphiQL — still works in dev (limiter bypassed)
- [ ] Spot-check `apps/cms/.env.example` was updated and the new var has a comment explaining the perf sweep
