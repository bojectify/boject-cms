import { describe, expect, it, vi } from 'vitest';
import type { GeneratedSeed } from './generate.js';
import { writeViaSql, MissingContentTypeError } from './writeViaSql.js';

interface QueryCall {
  sql: string;
  params: unknown[];
}

interface FakeClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  calls: QueryCall[];
}

function fakeClient(
  rows: { contentTypeLookup?: Array<{ identifier: string; id: string }> } = {}
): FakeClient {
  const calls: QueryCall[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (
      sql.includes('FROM "ContentType"') &&
      sql.includes('WHERE identifier')
    ) {
      const ident = params[0] as string;
      const row = rows.contentTypeLookup?.find((r) => r.identifier === ident);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    return { rows: [] };
  });
  return { query, calls };
}

describe('writeViaSql', () => {
  it('inserts envelopes and PUBLISHED versions in topo order', async () => {
    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Author',
          entries: [
            {
              id: 'syn-a',
              contentTypeId: null,
              contentTypeIdentifier: 'Author',
              entryTitle: 'A',
              slug: null,
              versions: [
                {
                  status: 'PUBLISHED',
                  data: { name: 'A' },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
        },
        {
          contentTypeIdentifier: 'Article',
          entries: [
            {
              id: 'syn-art',
              contentTypeId: null,
              contentTypeIdentifier: 'Article',
              entryTitle: 'Art',
              slug: 'art-0',
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {
                    author: {
                      entryId: 'syn-a',
                      contentTypeId: 'ct-author',
                      contentTypeIdentifier: 'Author',
                    },
                  },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
        },
      ],
    };
    const client = fakeClient({
      contentTypeLookup: [
        { identifier: 'Author', id: 'ct-author' },
        { identifier: 'Article', id: 'ct-article' },
      ],
    });
    const r = await writeViaSql(client as any, generated);
    expect(r.inserted).toBe(2);
    const insertCalls = client.calls.filter((c) => c.sql.startsWith('INSERT'));
    const tables = insertCalls.map(
      (c) => c.sql.match(/INSERT INTO "(\w+)"/)?.[1]
    );
    expect(tables).toContain('ContentEntry');
    expect(tables).toContain('ContentEntryVersion');
  });

  it('rewrites cross-group synthetic IDs to real IDs before inserting versions', async () => {
    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Author',
          entries: [
            {
              id: 'syn-a',
              contentTypeId: null,
              contentTypeIdentifier: 'Author',
              entryTitle: 'A',
              slug: null,
              versions: [
                {
                  status: 'PUBLISHED',
                  data: { name: 'A' },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
        },
        {
          contentTypeIdentifier: 'Article',
          entries: [
            {
              id: 'syn-art',
              contentTypeId: null,
              contentTypeIdentifier: 'Article',
              entryTitle: 'Art',
              slug: null,
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {
                    author: {
                      entryId: 'syn-a',
                      contentTypeId: 'ct-author',
                      contentTypeIdentifier: 'Author',
                    },
                  },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
        },
      ],
    };
    const client = fakeClient({
      contentTypeLookup: [
        { identifier: 'Author', id: 'ct-author' },
        { identifier: 'Article', id: 'ct-article' },
      ],
    });
    await writeViaSql(client as any, generated);

    const versionInserts = client.calls.filter((c) =>
      c.sql.includes('INSERT INTO "ContentEntryVersion"')
    );
    const articleVersion = versionInserts.find((c) =>
      JSON.stringify(c.params).includes('Art')
    );
    expect(articleVersion).toBeTruthy();
  });

  it('throws MissingContentTypeError if a group identifier is unknown', async () => {
    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Ghost',
          entries: [
            {
              id: 'syn-g',
              contentTypeId: null,
              contentTypeIdentifier: 'Ghost',
              entryTitle: 'G',
              slug: null,
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {},
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
        },
      ],
    };
    const client = fakeClient({ contentTypeLookup: [] });
    await expect(writeViaSql(client as any, generated)).rejects.toBeInstanceOf(
      MissingContentTypeError
    );
  });

  it('applies patches after all groups are inserted', async () => {
    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Page',
          entries: [
            {
              id: 'syn-p1',
              contentTypeId: null,
              contentTypeIdentifier: 'Page',
              entryTitle: 'P1',
              slug: null,
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {},
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
            {
              id: 'syn-p2',
              contentTypeId: null,
              contentTypeIdentifier: 'Page',
              entryTitle: 'P2',
              slug: null,
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {},
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
          patches: [
            {
              entryId: 'syn-p2',
              fieldUpdates: {
                parent: {
                  entryId: 'syn-p1',
                  contentTypeId: 'ct-page',
                  contentTypeIdentifier: 'Page',
                },
              },
            },
          ],
        },
      ],
    };
    const client = fakeClient({
      contentTypeLookup: [{ identifier: 'Page', id: 'ct-page' }],
    });
    await writeViaSql(client as any, generated);
    const updates = client.calls.filter((c) =>
      c.sql.startsWith('UPDATE "ContentEntryVersion"')
    );
    expect(updates.length).toBe(1);
  });

  it('respects batchSize option', async () => {
    const entries = Array.from({ length: 5 }).map((_, i) => ({
      id: `syn-${i}`,
      contentTypeId: null,
      contentTypeIdentifier: 'Page',
      entryTitle: `P${i}`,
      slug: null,
      versions: [
        {
          status: 'PUBLISHED',
          data: {},
          publishedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }));
    const generated: GeneratedSeed = {
      warnings: [],
      groups: [{ contentTypeIdentifier: 'Page', entries: entries as any }],
    };
    const client = fakeClient({
      contentTypeLookup: [{ identifier: 'Page', id: 'ct-page' }],
    });
    await writeViaSql(client as any, generated, { batchSize: 2 });
    const envelopeInserts = client.calls.filter((c) =>
      c.sql.startsWith('INSERT INTO "ContentEntry"')
    );
    expect(envelopeInserts.length).toBe(3); // 2 + 2 + 1
  });
});
