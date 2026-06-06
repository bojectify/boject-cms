import { expect } from 'vitest';
import { meili } from '../utils/meili';
import { resolveEntriesIndex } from '../utils/searchIndex';
import type { SearchDocument } from '../utils/searchDocument';

/**
 * Test helpers for the Meilisearch integration suite. All operate on the
 * resolved test index (`entries_test` under vitest — see resolveEntriesIndex).
 * Mutating helpers wait for the enqueued task to finish, so a read later in the
 * same test sees a settled index.
 *
 * Requires a reachable Meilisearch (docker-compose `meilisearch` service).
 * globalSetup bootstraps the index; each search-backed test file clears it in
 * its own `beforeAll` via clearTestIndex().
 */

function testIndex() {
  return meili.index<SearchDocument>(resolveEntriesIndex());
}

/** Remove every document from the test index; waits for the deletion task. */
export async function clearTestIndex(): Promise<void> {
  await testIndex().deleteAllDocuments().waitTask();
}

/** Add documents to the test index; waits for the indexing task to finish. */
export async function addTestDocuments(docs: SearchDocument[]): Promise<void> {
  await testIndex().addDocuments(docs).waitTask();
}

/**
 * Poll until the test index has no enqueued/processing tasks. For cases where
 * the *application* (e.g. the #225 sync handler) enqueued the indexing task
 * out-of-band, so the test has no task handle to await. Throws on timeout.
 */
export async function waitForIndexing(timeoutMs = 5000): Promise<void> {
  const index = resolveEntriesIndex();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { results } = await meili.tasks.getTasks({
      indexUids: [index],
      statuses: ['enqueued', 'processing'],
      limit: 20,
    });
    if (results.length === 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `waitForIndexing: index "${index}" still had ${results.length} pending task(s) after ${timeoutMs}ms`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Fetch every document currently in the test index (small index — one page). */
export async function getAllDocuments(): Promise<SearchDocument[]> {
  const { results } = await testIndex().getDocuments({ limit: 1000 });
  return results;
}

/**
 * Assert a document with the given id exists in the test index; return it.
 * Throws a clear error (failing the test) if it is missing.
 */
export async function assertDocumentExists(
  id: string
): Promise<SearchDocument> {
  const doc = (await getAllDocuments()).find((d) => d.id === id);
  if (!doc) {
    throw new Error(
      `Expected document "${id}" to exist in the test index, but it was not found`
    );
  }
  return doc;
}

/**
 * Assert the document with the given id has the expected attribute values
 * (deep-equality per key). Only the provided keys are checked.
 */
export async function assertAttributeValues(
  id: string,
  expected: Partial<SearchDocument>
): Promise<void> {
  const doc = await assertDocumentExists(id);
  for (const [key, value] of Object.entries(expected)) {
    expect(doc[key as keyof SearchDocument]).toEqual(value);
  }
}
