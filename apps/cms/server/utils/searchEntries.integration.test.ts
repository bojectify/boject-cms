import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runSearch } from './searchEntries';
import { ensureEntriesIndex, resolveEntriesIndex } from './searchIndex';
import { meili } from './meili';
import { clearTestIndex, addTestDocuments } from '../test/meiliTestUtils';
import type { SearchDocument } from './searchDocument';
import { FIELD_TYPES, type FieldTypeName } from '../../utils/fieldTypes';

const index = meili.index<SearchDocument>(resolveEntriesIndex());

function doc(
  id: string,
  contentType: string,
  entryTitle: string,
  fields: SearchDocument['fields']
): SearchDocument {
  return {
    id,
    entryId: id, // hit.id projects from entryId; keep it equal to id
    status: 'PUBLISHED',
    isWorkingVersion: true,
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

  it('omits the snippet when there is no free-text query (filters only)', async () => {
    const res = await runSearch(index, {
      q: '',
      contentType: 'Article',
      filters: [{ field: 'author', value: 'author-1' }],
      offset: 0,
      limit: 20,
    });
    expect(res.hits.length).toBeGreaterThan(0);
    for (const hit of res.hits) expect(hit.snippet).toBeNull();
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

describe('runSearch — operators', () => {
  const fieldTypes: Record<string, FieldTypeName> = {
    views: FIELD_TYPES.NUMBER,
    publishedAt: FIELD_TYPES.DATETIME,
    status: FIELD_TYPES.SELECT,
    featured: FIELD_TYPES.BOOLEAN,
    author: FIELD_TYPES.RELATION,
    tags: FIELD_TYPES.MULTIRELATION,
    summary: FIELD_TYPES.TEXT,
    body: FIELD_TYPES.RICHTEXT,
  };

  const o1 = doc('o1', 'Article', 'One', {
    views: 10,
    publishedAt: Date.parse('2026-01-01T00:00:00Z'),
    status: 'draft',
    featured: true,
    author: 'auth-1',
    tags: ['t1', 't2'],
    summary: 'the quick brown fox',
  });
  const o2 = doc('o2', 'Article', 'Two', {
    views: 50,
    publishedAt: Date.parse('2026-06-01T00:00:00Z'),
    status: 'published',
    featured: false,
    author: 'auth-2',
    tags: ['t2', 't3'],
    summary: 'a lazy dog sleeps',
  });
  const o3 = doc('o3', 'Article', 'Three', {
    views: 100,
    publishedAt: Date.parse('2026-12-01T00:00:00Z'),
    status: 'archived',
    featured: true,
    author: 'auth-1',
    tags: ['t3'],
    summary: 'brownstone building',
  });

  const run = (filters: Parameters<typeof runSearch>[1]['filters']) =>
    runSearch(index, {
      q: '',
      contentType: 'Article',
      filters,
      fieldTypes,
      offset: 0,
      limit: 20,
    });

  beforeEach(async () => {
    await ensureEntriesIndex(meili, resolveEntriesIndex());
    await clearTestIndex();
    await addTestDocuments([o1, o2, o3]);
  });
  afterAll(async () => {
    await clearTestIndex();
  });

  it('NUMBER gt / lte', async () => {
    expect(
      (await run([{ field: 'views', op: 'gt', values: ['40'] }])).hits
        .map((h) => h.id)
        .sort()
    ).toEqual(['o2', 'o3']);
    expect(
      (await run([{ field: 'views', op: 'lte', values: ['50'] }])).hits
        .map((h) => h.id)
        .sort()
    ).toEqual(['o1', 'o2']);
  });

  it('DATETIME before / after / between', async () => {
    expect(
      (
        await run([
          {
            field: 'publishedAt',
            op: 'before',
            values: ['2026-05-01T00:00:00Z'],
          },
        ])
      ).hits.map((h) => h.id)
    ).toEqual(['o1']);
    expect(
      (
        await run([
          {
            field: 'publishedAt',
            op: 'after',
            values: ['2026-05-01T00:00:00Z'],
          },
        ])
      ).hits
        .map((h) => h.id)
        .sort()
    ).toEqual(['o2', 'o3']);
    expect(
      (
        await run([
          {
            field: 'publishedAt',
            op: 'between',
            values: ['2026-03-01T00:00:00Z', '2026-09-01T00:00:00Z'],
          },
        ])
      ).hits.map((h) => h.id)
    ).toEqual(['o2']);
  });

  it('SELECT is any of (in) / is not (neq)', async () => {
    expect(
      (
        await run([
          { field: 'status', op: 'in', values: ['draft', 'archived'] },
        ])
      ).hits
        .map((h) => h.id)
        .sort()
    ).toEqual(['o1', 'o3']);
    expect(
      (await run([{ field: 'status', op: 'neq', values: ['draft'] }])).hits
        .map((h) => h.id)
        .sort()
    ).toEqual(['o2', 'o3']);
  });

  it('BOOLEAN is', async () => {
    expect(
      (await run([{ field: 'featured', op: 'eq', values: ['true'] }])).hits
        .map((h) => h.id)
        .sort()
    ).toEqual(['o1', 'o3']);
  });

  it('RELATION is not', async () => {
    expect(
      (
        await run([{ field: 'author', op: 'neq', values: ['auth-1'] }])
      ).hits.map((h) => h.id)
    ).toEqual(['o2']);
  });

  it('MULTIRELATION contains any (OR) vs contains all (AND)', async () => {
    expect(
      (
        await run([{ field: 'tags', op: 'containsAny', values: ['t1', 't2'] }])
      ).hits
        .map((h) => h.id)
        .sort()
    ).toEqual(['o1', 'o2']);
    expect(
      (
        await run([{ field: 'tags', op: 'containsAll', values: ['t2', 't3'] }])
      ).hits.map((h) => h.id)
    ).toEqual(['o2']);
  });

  it('TEXT contains (substring) / starts with', async () => {
    // CONTAINS is a substring match: "brown" matches both "brown fox" and "brownstone".
    expect(
      (
        await run([{ field: 'summary', op: 'contains', values: ['brown'] }])
      ).hits
        .map((h) => h.id)
        .sort()
    ).toEqual(['o1', 'o3']);
    expect(
      (
        await run([{ field: 'summary', op: 'startsWith', values: ['the '] }])
      ).hits.map((h) => h.id)
    ).toEqual(['o1']);
  });

  it('rejects an operator not allowed for the field type → SearchInputError', async () => {
    await expect(
      run([{ field: 'summary', op: 'gt', values: ['1'] }])
    ).rejects.toThrow(/not valid/i);
  });

  it('rejects a filter on a non-filterable RICHTEXT field', async () => {
    await expect(
      run([{ field: 'body', op: 'eq', values: ['x'] }])
    ).rejects.toThrow(/not valid/i);
  });

  it('rejects between with the wrong number of values', async () => {
    await expect(
      run([
        {
          field: 'publishedAt',
          op: 'between',
          values: ['2026-01-01T00:00:00Z'],
        },
      ])
    ).rejects.toThrow(/2 values/i);
  });
});

describe('runSearch — columns', () => {
  const c1 = doc('c1', 'Article', 'First', {
    summary: 'hello world',
    views: 7,
    publishedAt: 1700000000000,
    author: 'auth-1',
    tags: ['t1', 't2'],
    body: 'rich text body that should not be projected',
  });

  beforeEach(async () => {
    await ensureEntriesIndex(meili, resolveEntriesIndex());
    await clearTestIndex();
    await addTestDocuments([c1]);
  });
  afterAll(async () => {
    await clearTestIndex();
  });

  it('projects the requested fields onto hit.fields (raw indexed values)', async () => {
    const res = await runSearch(index, {
      q: '',
      contentType: 'Article',
      filters: [{ field: 'summary', value: 'hello world' }],
      columns: ['summary', 'views', 'publishedAt', 'author', 'tags'],
      offset: 0,
      limit: 20,
    });
    expect(res.hits).toHaveLength(1);
    // RELATION/MULTIRELATION come back as raw entry ids here — the API layer
    // hydrates titles. publishedAt is epoch-ms (a number).
    expect(res.hits[0]!.fields).toEqual({
      summary: 'hello world',
      views: 7,
      publishedAt: 1700000000000,
      author: 'auth-1',
      tags: ['t1', 't2'],
    });
  });

  it('omits hit.fields entirely when no columns are requested', async () => {
    const res = await runSearch(index, {
      q: '',
      contentType: 'Article',
      filters: [{ field: 'summary', value: 'hello world' }],
      offset: 0,
      limit: 20,
    });
    expect(res.hits[0]!.fields).toBeUndefined();
  });

  it('projects a missing field as null', async () => {
    const res = await runSearch(index, {
      q: '',
      contentType: 'Article',
      filters: [{ field: 'summary', value: 'hello world' }],
      columns: ['summary', 'ghost'],
      offset: 0,
      limit: 20,
    });
    expect(res.hits[0]!.fields).toEqual({
      summary: 'hello world',
      ghost: null,
    });
  });
});
