# Server integration test helpers

Shared utilities for the cms `integration` Vitest project (`server/api/**`,
`server/middleware/**`, `**/*.integration.test.ts`).

## Meilisearch test harness

Search-backed integration tests run against the **real** Meilisearch engine from
`docker-compose.yml` (the `meilisearch` service) — there is no in-memory fake.
So, exactly like Postgres, the engine must be up before the suite runs:

```bash
docker compose up -d   # Postgres + Meilisearch
```

### Separate test index (`entries_test`)

Tests never touch the dev `entries` index. `vitest.config.ts` sets
`MEILI_INDEX=entries_test`; `resolveEntriesIndex()`
(`apps/cms/server/utils/searchIndex.ts`) reads it, and the Nitro dev server that
integration tests boot inherits the env var. `vitest.globalSetup.ts` creates and
configures `entries_test` once before the suite (non-fatal if Meilisearch is
down — non-search tests still run; search tests fail loudly on their own).

### Helpers (`meiliTestUtils.ts`)

| Helper                                | Purpose                                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `clearTestIndex()`                    | Delete every document; waits for the task.                                                                                         |
| `addTestDocuments(docs)`              | Seed documents; waits for indexing.                                                                                                |
| `waitForIndexing()`                   | Poll until no enqueued/processing tasks — for when the _app_ enqueued the task (e.g. the sync handler) and the test has no handle. |
| `getAllDocuments()`                   | Fetch all documents in the index.                                                                                                  |
| `assertDocumentExists(id)`            | Assert a document is present; returns it.                                                                                          |
| `assertAttributeValues(id, expected)` | Assert selected attributes deep-equal `expected`.                                                                                  |

### Required per-file pattern

globalSetup only ensures the index _exists_. Each search-backed test file must
start from an empty index itself:

```ts
import { beforeAll } from 'vitest';
import { clearTestIndex } from '../test/meiliTestUtils';

beforeAll(async () => {
  await clearTestIndex();
});
```

See `meiliTestUtils.integration.test.ts` for a worked example.

## Cache test harness (#262)

Cache-backed integration tests run against the **real** Redis from
`docker-compose.yml` (the `redis` service), on **logical DB 1**
(`getTestRedisUrl()` → `redis://localhost:6379/1`) — never DB 0, the dev cache.
This is the same instance-isolation Postgres (`boject_test`) and search
(`entries_test`) use. `vitest.config.ts` sets `REDIS_URL` to the DB-1 URL, and
the Nitro dev server that integration tests boot inherits it.

`vitest.globalSetup.ts` runs **`FLUSHDB`** on DB 1 before the suite (non-fatal if
Redis is down — cache tests fail loudly on their own; non-cache tests still run).
**Never `FLUSHALL`** — that wipes DB 0 and destroys the developer's dev cache.

### Same keyspace as the server (no base)

The booted server writes via `useStorage('cache')`, but unstorage strips the
`cache` mount prefix before the driver, so the actual Redis keys are
**unprefixed** (e.g. `public:entries:Article:perPage=10:after=`). So
`cacheAssertions.ts` builds its value handle with `redisDriver({ url })` and
**no base**, and reads the raw `__tagindex:` / `__tagindex_p:` sets via a plain
`ioredis` client.

### Helpers (`cacheAssertions.ts`)

| Helper                                                | Purpose                                                                                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assertCached(key)` / `assertNotCached(key)`          | Assert a value is / isn't cached under `key`.                                                                                                        |
| `assertTaggedWith(key, tag)`                          | Assert `key` is a member of `tag`'s reverse index (`__tagindex:` or `__tagindex_p:`).                                                                |
| `expectInvalidationOnEvent(descriptor, expectedTags)` | Run the real #261 subscriber for `{ event, identifier, entryId? }`; assert it clears **exactly** those tags (seeds a control tag that must survive). |
| `clearTestCache()`                                    | `FLUSHDB` — the per-file reset; call in `beforeEach`/`beforeAll`.                                                                                    |
| `closeTestCache()`                                    | Close the Redis client; call in `afterAll`.                                                                                                          |

### Required per-file pattern

globalSetup flushes once before the whole suite. Each cache-backed file should
reset + close its own client:

```ts
import { beforeAll, afterAll } from 'vitest';
import { clearTestCache, closeTestCache } from '../test/cacheAssertions';

beforeAll(async () => {
  await clearTestCache();
});
afterAll(async () => {
  await closeTestCache();
});
```

See `cacheAssertions.integration.test.ts` for a worked example (GET
`/api/public/entries` → assert cached + tagged → invalidate → assert gone).
