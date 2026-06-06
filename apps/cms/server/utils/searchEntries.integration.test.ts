import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runSearch } from './searchEntries';
import { ensureEntriesIndex, resolveEntriesIndex } from './searchIndex';
import { meili } from './meili';
import { clearTestIndex, addTestDocuments } from '../test/meiliTestUtils';
import type { SearchDocument } from './searchDocument';

const index = meili.index<SearchDocument>(resolveEntriesIndex());

function doc(
  id: string,
  contentType: string,
  entryTitle: string,
  fields: SearchDocument['fields']
): SearchDocument {
  return {
    id,
    entryKey: id,
    contentType,
    entryTitle,
    publishedAt: null,
    fields,
  };
}

const article1 = doc('a1', 'Article', 'Coffee brewing guide', {
  body: 'all about whatever pour-over coffee',
  author: 'author-1',
  tags: ['t-coffee', 't-guide'],
});
const article2 = doc('a2', 'Article', 'Tea steeping', {
  body: 'nothing about the other drink',
  author: 'author-2',
  tags: ['t-tea'],
});
const page1 = doc('p1', 'Page', 'About whatever', { body: 'a page body' });

describe('runSearch', () => {
  beforeEach(async () => {
    // Converge the live test index onto Task-1's searchable/filterable
    // settings, then reset + seed.
    await ensureEntriesIndex(meili, resolveEntriesIndex());
    await clearTestIndex();
    await addTestDocuments([article1, article2, page1]);
  });
  afterAll(async () => {
    await clearTestIndex();
  });

  it('free-text q matches title + body across types', async () => {
    const res = await runSearch(index, { q: 'whatever', offset: 0, limit: 20 });
    expect(res.hits.map((h) => h.id).sort()).toEqual(['a1', 'p1']);
    expect(res.total).toBe(2);
    expect(typeof res.processingTimeMs).toBe('number');
  });

  it('contentType scopes results', async () => {
    const res = await runSearch(index, {
      q: 'whatever',
      contentType: 'Article',
      offset: 0,
      limit: 20,
    });
    expect(res.hits.map((h) => h.id)).toEqual(['a1']);
  });

  it('per-field filters (RELATION + MULTIRELATION membership) AND together', async () => {
    const res = await runSearch(index, {
      q: '',
      contentType: 'Article',
      filters: [
        { field: 'author', value: 'author-1' },
        { field: 'tags', value: 't-coffee' },
      ],
      offset: 0,
      limit: 20,
    });
    expect(res.hits.map((h) => h.id)).toEqual(['a1']);
  });

  it('returns a highlighted snippet for the matched text', async () => {
    const res = await runSearch(index, { q: 'whatever', offset: 0, limit: 20 });
    const hit = res.hits.find((h) => h.id === 'a1')!;
    expect(hit.snippet).toContain('<em>whatever</em>');
    expect(hit.entryTitle).toBe('Coffee brewing guide'); // raw, not highlighted
  });

  it('paginates with offset/limit', async () => {
    const p1 = await runSearch(index, { q: 'whatever', offset: 0, limit: 1 });
    const p2 = await runSearch(index, { q: 'whatever', offset: 1, limit: 1 });
    expect(p1.hits).toHaveLength(1);
    expect(p2.hits).toHaveLength(1);
    expect(p1.hits[0]!.id).not.toBe(p2.hits[0]!.id);
    expect(p1.total).toBe(2);
  });

  it('attributesToSearchOn narrows to entryTitle only', async () => {
    // "whatever" is in p1's title and a1's body. Restrict to entryTitle → only p1.
    const res = await runSearch(index, {
      q: 'whatever',
      attributesToSearchOn: ['entryTitle'],
      offset: 0,
      limit: 20,
    });
    expect(res.hits.map((h) => h.id)).toEqual(['p1']);
  });

  it('rejects an unknown attributesToSearchOn value', async () => {
    await expect(
      runSearch(index, {
        q: 'whatever',
        attributesToSearchOn: ['notARealAttribute'],
        offset: 0,
        limit: 20,
      })
    ).rejects.toThrow(/attributesToSearchOn/i);
  });

  it('accepts a nested fields.<id> attributesToSearchOn path', async () => {
    // valid path — should NOT throw and should run a real search
    const res = await runSearch(index, {
      q: 'whatever',
      attributesToSearchOn: ['entryTitle', 'fields.body'],
      offset: 0,
      limit: 20,
    });
    expect(Array.isArray(res.hits)).toBe(true);
  });

  it('rejects a malformed field identifier', async () => {
    await expect(
      runSearch(index, {
        q: '',
        filters: [{ field: 'author OR 1=1', value: 'x' }],
        offset: 0,
        limit: 20,
      })
    ).rejects.toThrow(/field/i);
  });

  it('treats a filter value with quote/operator characters as a literal (no injection)', async () => {
    // An adversarial author value that, unescaped, would break out of the
    // filter literal and OR-in everything.
    const evil = '" OR fields.author = "author-1';
    await addTestDocuments([
      doc('evil', 'Article', 'Evil entry', { body: 'x', author: evil }),
    ]);

    // Filtering for the literal evil value must match ONLY the evil doc — never
    // a1 (whose author is 'author-1'); if escaping were broken the OR would pull
    // a1 in.
    const res = await runSearch(index, {
      q: '',
      filters: [{ field: 'author', value: evil }],
      offset: 0,
      limit: 20,
    });
    expect(res.hits.map((h) => h.id)).toEqual(['evil']);
  });
});
