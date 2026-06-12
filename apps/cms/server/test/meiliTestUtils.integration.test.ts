import { describe, it, expect, beforeAll } from 'vitest';
import {
  clearTestIndex,
  addTestDocuments,
  waitForIndexing,
  assertDocumentExists,
  assertAttributeValues,
  getAllDocuments,
} from './meiliTestUtils';
import type { SearchDocument } from '../utils/searchDocument';

const docA: SearchDocument = {
  id: '11111111-1111-1111-1111-111111111111',
  entryId: '11111111-1111-1111-1111-111111111111',
  status: 'PUBLISHED',
  isWorkingVersion: true,
  entryKey: 'harness-smoke-a',
  contentType: 'Article',
  entryTitle: 'Harness smoke A',
  publishedAt: '2026-06-06T00:00:00.000Z',
  fields: { body: 'hello world', tags: [] },
};

const docB: SearchDocument = {
  id: '22222222-2222-2222-2222-222222222222',
  entryId: '22222222-2222-2222-2222-222222222222',
  status: 'PUBLISHED',
  isWorkingVersion: true,
  entryKey: 'harness-smoke-b',
  contentType: 'Page',
  entryTitle: 'Harness smoke B',
  publishedAt: null,
  fields: { body: 'second doc' },
};

describe('meili test harness helpers', () => {
  // Every search-backed integration file must start from an empty index. This
  // is the canonical pattern downstream issues (#225 sync, #227 query) copy.
  beforeAll(async () => {
    await clearTestIndex();
  });

  it('starts from an empty index', async () => {
    expect(await getAllDocuments()).toEqual([]);
  });

  it('round-trips documents through add / waitForIndexing / assert / fetch', async () => {
    await addTestDocuments([docA, docB]);
    await waitForIndexing(); // no pending tasks → returns promptly

    const fetched = await assertDocumentExists(docA.id);
    expect(fetched.entryTitle).toBe('Harness smoke A');

    await assertAttributeValues(docA.id, {
      contentType: 'Article',
      entryKey: 'harness-smoke-a',
      publishedAt: '2026-06-06T00:00:00.000Z',
    });

    const all = await getAllDocuments();
    expect(all.map((d) => d.id).sort()).toEqual([docA.id, docB.id].sort());
  });

  it('clears the index back to empty', async () => {
    await addTestDocuments([docA]);
    await clearTestIndex();
    expect(await getAllDocuments()).toEqual([]);
  });

  it('assertDocumentExists throws for a missing id', async () => {
    await clearTestIndex();
    await expect(
      assertDocumentExists('00000000-0000-0000-0000-000000000000')
    ).rejects.toThrow(/not found/i);
  });
});
