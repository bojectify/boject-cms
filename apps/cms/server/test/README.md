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
