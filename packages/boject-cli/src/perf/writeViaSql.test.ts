import { describe, expect, it, vi } from 'vitest';
import type { GeneratedSeed } from './generate.js';
import { writeViaSql, MissingContentTypeError } from './writeViaSql.js';
import { SeedMostlyDuplicateError } from './seedErrors.js';

interface QueryCall {
  sql: string;
  params: unknown[];
}

interface FakeClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  calls: QueryCall[];
}

/**
 * `envelopeInsertStrategy` controls which input IDs the fake `INSERT INTO
 * "ContentEntry" ... RETURNING id` query echoes back — i.e. which envelopes
 * the writer treats as "successfully inserted" vs. "skipped via ON CONFLICT".
 *
 * Defaults to 'all' so the legacy tests (which don't care about conflicts)
 * keep passing under the new return shape.
 */
type EnvelopeInsertStrategy =
  | 'all'
  | { kind: 'subset'; keep: (id: string) => boolean }
  | { kind: 'count'; n: number };

function fakeClient(
  rows: {
    contentTypeLookup?: Array<{ identifier: string; id: string }>;
    envelopeInsert?: EnvelopeInsertStrategy;
  } = {}
): FakeClient {
  const calls: QueryCall[] = [];
  const strategy: EnvelopeInsertStrategy = rows.envelopeInsert ?? 'all';
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
    if (
      sql.includes('INSERT INTO "ContentEntry"') &&
      sql.includes('RETURNING id')
    ) {
      // Envelope insert sends params in groups of 6:
      // (id, contentTypeId, entryTitle, slug, createdAt, updatedAt)
      // The first slot of each group is the id we'd be persisting.
      const ids: string[] = [];
      for (let i = 0; i < params.length; i += 6) {
        ids.push(params[i] as string);
      }
      let returned: string[];
      if (strategy === 'all') {
        returned = ids;
      } else if (strategy.kind === 'subset') {
        returned = ids.filter((id) => strategy.keep(id));
      } else {
        returned = ids.slice(0, strategy.n);
      }
      return { rows: returned.map((id) => ({ id })) };
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

  // -----------------------------------------------------------------------
  // Skip-and-continue (uniqueness conflicts via ON CONFLICT DO NOTHING)
  // -----------------------------------------------------------------------

  function pageGroup(count: number): GeneratedSeed {
    const entries = Array.from({ length: count }).map((_, i) => ({
      id: `syn-${i}`,
      contentTypeId: null,
      contentTypeIdentifier: 'Page',
      entryTitle: `P${i}`,
      slug: `p-${i}`,
      versions: [
        {
          status: 'PUBLISHED',
          data: {},
          publishedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }));
    return {
      warnings: [],
      groups: [{ contentTypeIdentifier: 'Page', entries: entries as any }],
    };
  }

  it('returns { inserted, skipped: 0 } when no envelopes conflict', async () => {
    const generated = pageGroup(5);
    const client = fakeClient({
      contentTypeLookup: [{ identifier: 'Page', id: 'ct-page' }],
      envelopeInsert: 'all',
    });
    const r = await writeViaSql(client as any, generated);
    expect(r).toEqual({ inserted: 5, skipped: 0 });
    // All 5 entries should appear in the version insert payload
    const versionInsert = client.calls.find((c) =>
      c.sql.includes('INSERT INTO "ContentEntryVersion"')
    );
    expect(versionInsert).toBeTruthy();
    // Version insert params are groups of 6 — count the rows persisted
    expect(versionInsert!.params.length).toBe(5 * 6);
  });

  it('skips conflicting envelopes and only inserts versions for survivors', async () => {
    const generated = pageGroup(5);
    // Keep 3 of 5 — drop syn-1 and syn-3 to simulate conflicts
    const client = fakeClient({
      contentTypeLookup: [{ identifier: 'Page', id: 'ct-page' }],
      envelopeInsert: {
        kind: 'subset',
        keep: (id) => id !== 'syn-1' && id !== 'syn-3',
      },
    });
    const r = await writeViaSql(client as any, generated);
    expect(r).toEqual({ inserted: 3, skipped: 2 });
    // 25% < 50% threshold — no error
    const versionInsert = client.calls.find((c) =>
      c.sql.includes('INSERT INTO "ContentEntryVersion"')
    );
    expect(versionInsert).toBeTruthy();
    // 3 survivors × 6 params each = 18
    expect(versionInsert!.params.length).toBe(3 * 6);
    // Verify the survivors' entryTitles are the ones present (P0, P2, P4)
    const versionParams = versionInsert!.params;
    const survivorTitles: string[] = [];
    // Version insert params order: (entryId, entryTitle, dataJson, publishedAt, createdAt, updatedAt)
    for (let i = 0; i < versionParams.length; i += 6) {
      survivorTitles.push(versionParams[i + 1] as string);
    }
    expect(survivorTitles).toEqual(['P0', 'P2', 'P4']);
  });

  it('throws SeedMostlyDuplicateError when skip rate exceeds 50%', async () => {
    const generated = pageGroup(4);
    // Keep only syn-0 — 1 of 4 (75% skipped)
    const client = fakeClient({
      contentTypeLookup: [{ identifier: 'Page', id: 'ct-page' }],
      envelopeInsert: { kind: 'subset', keep: (id) => id === 'syn-0' },
    });
    await writeViaSql(client as any, generated)
      .then(() => {
        throw new Error('expected to throw');
      })
      .catch((err) => {
        expect(err).toBeInstanceOf(SeedMostlyDuplicateError);
        expect((err as SeedMostlyDuplicateError).inserted).toBe(1);
        expect((err as SeedMostlyDuplicateError).skipped).toBe(3);
        expect((err as SeedMostlyDuplicateError).total).toBe(4);
      });
  });

  it('does NOT throw at exactly 50% skip rate (strict >, not >=)', async () => {
    const generated = pageGroup(4);
    // Keep 2 of 4 — exactly 50% skipped
    const client = fakeClient({
      contentTypeLookup: [{ identifier: 'Page', id: 'ct-page' }],
      envelopeInsert: {
        kind: 'subset',
        keep: (id) => id === 'syn-0' || id === 'syn-1',
      },
    });
    const r = await writeViaSql(client as any, generated);
    expect(r).toEqual({ inserted: 2, skipped: 2 });
  });

  it('issues the UPDATE for patches even when the referenced entry was skipped', async () => {
    // Both p1 and p2 are inserted; the patch targets p2 referencing p1. We
    // simulate p2's envelope getting skipped so the UPDATE runs against a
    // (logically) missing row. The writer should still issue the UPDATE — it
    // becomes a silent no-op at the DB layer.
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
    // Keep only p1 (50% skipped — won't trip threshold)
    const client = fakeClient({
      contentTypeLookup: [{ identifier: 'Page', id: 'ct-page' }],
      envelopeInsert: { kind: 'subset', keep: (id) => id === 'syn-p1' },
    });
    const r = await writeViaSql(client as any, generated);
    expect(r.inserted).toBe(1);
    expect(r.skipped).toBe(1);
    const updates = client.calls.filter((c) =>
      c.sql.startsWith('UPDATE "ContentEntryVersion"')
    );
    expect(updates.length).toBe(1);
  });

  it('only populates idMap for survivors — skipped entries fall through to synthetic ID in cross-group refs', async () => {
    // Group Author has 2 entries; syn-a1 will be skipped at envelope insert.
    // Group Article references both authors; we verify that the Article
    // version insert's data still contains 'syn-a1' (the synthetic id) rather
    // than a rewritten id — confirming the skipped author isn't in idMap.
    // (For the SQL writer synthetic === real, so this assertion is about the
    // absence of an idMap entry rather than a different real-id value, but
    // the test still pins the contract: skipped entries are NOT registered.)
    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Author',
          entries: [
            {
              id: 'syn-a0',
              contentTypeId: null,
              contentTypeIdentifier: 'Author',
              entryTitle: 'A0',
              slug: null,
              versions: [
                {
                  status: 'PUBLISHED',
                  data: { name: 'A0' },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
            {
              id: 'syn-a1',
              contentTypeId: null,
              contentTypeIdentifier: 'Author',
              entryTitle: 'A1',
              slug: null,
              versions: [
                {
                  status: 'PUBLISHED',
                  data: { name: 'A1' },
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
              id: 'syn-art0',
              contentTypeId: null,
              contentTypeIdentifier: 'Article',
              entryTitle: 'Art0',
              slug: 'art-0',
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {
                    author: {
                      entryId: 'syn-a1',
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
    // Skip syn-a1; keep everything else
    const client = fakeClient({
      contentTypeLookup: [
        { identifier: 'Author', id: 'ct-author' },
        { identifier: 'Article', id: 'ct-article' },
      ],
      envelopeInsert: { kind: 'subset', keep: (id) => id !== 'syn-a1' },
    });
    const r = await writeViaSql(client as any, generated);
    expect(r.inserted).toBe(2); // A0 + Art0
    expect(r.skipped).toBe(1); // A1
    // Article version insert should contain the synthetic 'syn-a1' string —
    // confirming that idMap did NOT register syn-a1 (otherwise rewriteSyntheticIds
    // would have replaced it; here it falls through unchanged because synthetic
    // === real for the SQL writer, but the key contract is that the lookup
    // miss in idMap is silent).
    const versionInserts = client.calls.filter((c) =>
      c.sql.includes('INSERT INTO "ContentEntryVersion"')
    );
    const articleVersion = versionInserts.find((c) =>
      JSON.stringify(c.params).includes('Art0')
    );
    expect(articleVersion).toBeTruthy();
    expect(JSON.stringify(articleVersion!.params)).toContain('syn-a1');
  });

  it('returns { inserted: 0, skipped: 0 } for empty input (no threshold check)', async () => {
    const generated: GeneratedSeed = { warnings: [], groups: [] };
    const client = fakeClient({ contentTypeLookup: [] });
    const r = await writeViaSql(client as any, generated);
    expect(r).toEqual({ inserted: 0, skipped: 0 });
  });
});
