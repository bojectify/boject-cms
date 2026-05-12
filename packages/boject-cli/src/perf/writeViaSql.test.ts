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

  it('skips the patch when its target was skipped at envelope insert (#199)', async () => {
    // The patch targets p2 referencing p1. We simulate p2's envelope getting
    // skipped so the patch's target ends up in skippedIds. The writer should
    // NOT issue the UPDATE (it'd no-op anyway) and should log to stderr.
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
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const r = await writeViaSql(client as any, generated);
    expect(r.inserted).toBe(1);
    expect(r.skipped).toBe(1);
    const updates = client.calls.filter((c) =>
      c.sql.startsWith('UPDATE "ContentEntryVersion"')
    );
    expect(updates.length).toBe(0);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(stderrOutput).toContain('skipping patch');
    expect(stderrOutput).toContain('target entry');
    expect(stderrOutput).toContain('syn-p2');
    stderrSpy.mockRestore();
  });

  it('cascade-skips an entry whose reference points at a previously skipped entry (#199)', async () => {
    // Group Author has 2 entries; syn-a1 will be skipped at envelope insert.
    // Group Article has 1 entry that references syn-a1. Under #199's
    // cascade-skip, the Article must be skipped too (would otherwise leave
    // a dangling reference in its version data).
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
            {
              id: 'syn-art1',
              contentTypeId: null,
              contentTypeIdentifier: 'Article',
              entryTitle: 'Art1',
              slug: 'art-1',
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {
                    author: {
                      entryId: 'syn-a0',
                      contentTypeId: 'ct-author',
                      contentTypeIdentifier: 'Author',
                    },
                  },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
            {
              id: 'syn-art2',
              contentTypeId: null,
              contentTypeIdentifier: 'Article',
              entryTitle: 'Art2',
              slug: 'art-2',
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {
                    author: {
                      entryId: 'syn-a0',
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
    // Skip syn-a1; keep everything else at the envelope-insert layer. A0 +
    // Art1 + Art2 survive; A1 + Art0 cascade. 3/5 inserted (under threshold).
    const client = fakeClient({
      contentTypeLookup: [
        { identifier: 'Author', id: 'ct-author' },
        { identifier: 'Article', id: 'ct-article' },
      ],
      envelopeInsert: { kind: 'subset', keep: (id) => id !== 'syn-a1' },
    });
    const r = await writeViaSql(client as any, generated);
    expect(r.inserted).toBe(3); // A0 + Art1 + Art2
    expect(r.skipped).toBe(2); // A1 + Art0 (cascade)
    // Art0 must NOT have reached the envelope INSERT — the cascade filter
    // runs before insertEnvelopes, so no orphan ContentEntry row is created.
    const art0EnvelopeInsert = client.calls.find(
      (c) =>
        c.sql.startsWith('INSERT INTO "ContentEntry"') &&
        JSON.stringify(c.params).includes('syn-art0')
    );
    expect(art0EnvelopeInsert).toBeUndefined();
    // Art1 and Art2 (referencing the surviving A0) DID reach the envelope.
    const art1EnvelopeInsert = client.calls.find(
      (c) =>
        c.sql.startsWith('INSERT INTO "ContentEntry"') &&
        JSON.stringify(c.params).includes('syn-art1')
    );
    expect(art1EnvelopeInsert).toBeTruthy();
  });

  it('returns { inserted: 0, skipped: 0 } for empty input (no threshold check)', async () => {
    const generated: GeneratedSeed = { warnings: [], groups: [] };
    const client = fakeClient({ contentTypeLookup: [] });
    const r = await writeViaSql(client as any, generated);
    expect(r).toEqual({ inserted: 0, skipped: 0 });
  });

  // -----------------------------------------------------------------------
  // #199 cascade-skip — cross-reference cascade + patch cascade
  // -----------------------------------------------------------------------

  function authorEntry(i: number) {
    return {
      id: `syn-author-${i}`,
      contentTypeId: null,
      contentTypeIdentifier: 'Author',
      entryTitle: `Author ${i}`,
      slug: `author-${i}`,
      versions: [
        {
          status: 'PUBLISHED',
          data: { name: `Author ${i}` },
          publishedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
  }

  function articleEntry(i: number, authorRefId: string) {
    return {
      id: `syn-article-${i}`,
      contentTypeId: null,
      contentTypeIdentifier: 'Article',
      entryTitle: `Article ${i}`,
      slug: `article-${i}`,
      versions: [
        {
          status: 'PUBLISHED',
          data: {
            author: {
              entryId: authorRefId,
              contentTypeId: 'ct-author',
              contentTypeIdentifier: 'Author',
            },
          },
          publishedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
  }

  it('single-hop cascade: dependent group skipped when parent group skipped (#199)', async () => {
    // Authors (N=3) all skipped via ON CONFLICT, Articles (N=3) each reference
    // one author → all cascade-skipped. Total: 0 inserted, 6 skipped. The
    // Article batch's envelope INSERT must not contain any article id.
    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Author',
          entries: [authorEntry(0), authorEntry(1), authorEntry(2)] as any,
        },
        {
          contentTypeIdentifier: 'Article',
          entries: [
            articleEntry(0, 'syn-author-0'),
            articleEntry(1, 'syn-author-1'),
            articleEntry(2, 'syn-author-2'),
          ] as any,
        },
      ],
    };
    const client = fakeClient({
      contentTypeLookup: [
        { identifier: 'Author', id: 'ct-author' },
        { identifier: 'Article', id: 'ct-article' },
      ],
      envelopeInsert: { kind: 'subset', keep: () => false }, // skip all authors
    });
    await writeViaSql(client as any, generated).catch((err) => {
      // 100% skip trips the threshold; that's the intended end-state — the
      // ratio is reported correctly.
      expect(err).toBeInstanceOf(SeedMostlyDuplicateError);
      expect((err as SeedMostlyDuplicateError).inserted).toBe(0);
      expect((err as SeedMostlyDuplicateError).skipped).toBe(6);
      expect((err as SeedMostlyDuplicateError).total).toBe(6);
    });
    // Article envelope INSERT must not have been issued for any article —
    // cascade-skip drops them before insertEnvelopes is called.
    const articleEnvelopeInserts = client.calls.filter(
      (c) =>
        c.sql.startsWith('INSERT INTO "ContentEntry"') &&
        JSON.stringify(c.params).includes('syn-article-')
    );
    expect(articleEnvelopeInserts.length).toBe(0);
  });

  it('multi-hop cascade: Categories → Articles → Comments all skipped (#199)', async () => {
    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Category',
          entries: [
            {
              id: 'syn-cat-0',
              contentTypeId: null,
              contentTypeIdentifier: 'Category',
              entryTitle: 'Cat 0',
              slug: 'cat-0',
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
        {
          contentTypeIdentifier: 'Article',
          entries: [
            {
              id: 'syn-article-0',
              contentTypeId: null,
              contentTypeIdentifier: 'Article',
              entryTitle: 'Article 0',
              slug: 'article-0',
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {
                    category: {
                      entryId: 'syn-cat-0',
                      contentTypeId: 'ct-cat',
                      contentTypeIdentifier: 'Category',
                    },
                  },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
          ],
        },
        {
          contentTypeIdentifier: 'Comment',
          entries: [
            {
              id: 'syn-comment-0',
              contentTypeId: null,
              contentTypeIdentifier: 'Comment',
              entryTitle: 'Comment 0',
              slug: 'comment-0',
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {
                    article: {
                      entryId: 'syn-article-0',
                      contentTypeId: 'ct-article',
                      contentTypeIdentifier: 'Article',
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
        { identifier: 'Category', id: 'ct-cat' },
        { identifier: 'Article', id: 'ct-article' },
        { identifier: 'Comment', id: 'ct-comment' },
      ],
      envelopeInsert: { kind: 'subset', keep: () => false }, // skip categories
    });
    await writeViaSql(client as any, generated).catch((err) => {
      expect(err).toBeInstanceOf(SeedMostlyDuplicateError);
      expect((err as SeedMostlyDuplicateError).inserted).toBe(0);
      expect((err as SeedMostlyDuplicateError).skipped).toBe(3);
    });
    // Neither Article nor Comment envelope INSERT should have been issued.
    const cascadeEnvelopeInserts = client.calls.filter(
      (c) =>
        c.sql.startsWith('INSERT INTO "ContentEntry"') &&
        (JSON.stringify(c.params).includes('syn-article-') ||
          JSON.stringify(c.params).includes('syn-comment-'))
    );
    expect(cascadeEnvelopeInserts.length).toBe(0);
  });

  it('MULTIRELATION with one skipped ref cascade-skips the whole entry (#199)', async () => {
    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Author',
          entries: [authorEntry(0), authorEntry(1)] as any,
        },
        {
          contentTypeIdentifier: 'Article',
          entries: [
            {
              id: 'syn-article-0',
              contentTypeId: null,
              contentTypeIdentifier: 'Article',
              entryTitle: 'Article 0',
              slug: 'article-0',
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {
                    coAuthors: [
                      {
                        entryId: 'syn-author-0',
                        contentTypeId: 'ct-author',
                        contentTypeIdentifier: 'Author',
                      },
                      {
                        entryId: 'syn-author-1',
                        contentTypeId: 'ct-author',
                        contentTypeIdentifier: 'Author',
                      },
                    ],
                  },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
            // Extra survivor article so we don't trip the threshold.
            articleEntry(1, 'syn-author-0'),
            articleEntry(2, 'syn-author-0'),
          ] as any,
        },
      ],
    };
    // Skip author-1 only (one of two MULTIRELATION targets).
    const client = fakeClient({
      contentTypeLookup: [
        { identifier: 'Author', id: 'ct-author' },
        { identifier: 'Article', id: 'ct-article' },
      ],
      envelopeInsert: { kind: 'subset', keep: (id) => id !== 'syn-author-1' },
    });
    const r = await writeViaSql(client as any, generated);
    // A0 + Art1 + Art2 survive; A1 + Art0 cascade. inserted=3, skipped=2.
    expect(r.inserted).toBe(3);
    expect(r.skipped).toBe(2);
    const art0EnvelopeInsert = client.calls.find(
      (c) =>
        c.sql.startsWith('INSERT INTO "ContentEntry"') &&
        JSON.stringify(c.params).includes('syn-article-0')
    );
    expect(art0EnvelopeInsert).toBeUndefined();
  });

  it('RICHTEXT body with cmsEmbed pointing at a skipped entry cascade-skips (#199)', async () => {
    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Author',
          entries: [authorEntry(0), authorEntry(1)] as any,
        },
        {
          contentTypeIdentifier: 'Article',
          entries: [
            {
              id: 'syn-article-0',
              contentTypeId: null,
              contentTypeIdentifier: 'Article',
              entryTitle: 'Article 0',
              slug: 'article-0',
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {
                    body: {
                      type: 'doc',
                      content: [
                        {
                          type: 'cmsEmbed',
                          attrs: {
                            entryId: 'syn-author-1',
                            contentTypeId: 'ct-author',
                            contentTypeIdentifier: 'Author',
                          },
                        },
                      ],
                    },
                  },
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
            articleEntry(1, 'syn-author-0'),
            articleEntry(2, 'syn-author-0'),
          ] as any,
        },
      ],
    };
    const client = fakeClient({
      contentTypeLookup: [
        { identifier: 'Author', id: 'ct-author' },
        { identifier: 'Article', id: 'ct-article' },
      ],
      envelopeInsert: { kind: 'subset', keep: (id) => id !== 'syn-author-1' },
    });
    const r = await writeViaSql(client as any, generated);
    expect(r.inserted).toBe(3);
    expect(r.skipped).toBe(2);
    const art0EnvelopeInsert = client.calls.find(
      (c) =>
        c.sql.startsWith('INSERT INTO "ContentEntry"') &&
        JSON.stringify(c.params).includes('syn-article-0')
    );
    expect(art0EnvelopeInsert).toBeUndefined();
  });

  it('threshold trips via cascade: 100% skip yields SeedMostlyDuplicateError (#199)', async () => {
    const authors = Array.from({ length: 10 }).map((_, i) => authorEntry(i));
    const articles = Array.from({ length: 10 }).map((_, i) =>
      articleEntry(i, `syn-author-${i}`)
    );
    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        { contentTypeIdentifier: 'Author', entries: authors as any },
        { contentTypeIdentifier: 'Article', entries: articles as any },
      ],
    };
    const client = fakeClient({
      contentTypeLookup: [
        { identifier: 'Author', id: 'ct-author' },
        { identifier: 'Article', id: 'ct-article' },
      ],
      envelopeInsert: { kind: 'subset', keep: () => false },
    });
    await writeViaSql(client as any, generated)
      .then(() => {
        throw new Error('expected to throw');
      })
      .catch((err) => {
        expect(err).toBeInstanceOf(SeedMostlyDuplicateError);
        expect((err as SeedMostlyDuplicateError).inserted).toBe(0);
        expect((err as SeedMostlyDuplicateError).skipped).toBe(20);
        expect((err as SeedMostlyDuplicateError).total).toBe(20);
      });
  });

  it('cascade-skipped entries never reach the envelope INSERT — no orphans (#199)', async () => {
    // Belt-and-braces test for the key correctness property of the restructured
    // batch loop: filter runs BEFORE insertEnvelopes, so cascade-skipped IDs
    // must not appear in any ContentEntry INSERT params.
    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Author',
          entries: [authorEntry(0), authorEntry(1)] as any,
        },
        {
          contentTypeIdentifier: 'Article',
          entries: [
            articleEntry(0, 'syn-author-0'),
            articleEntry(1, 'syn-author-1'),
            articleEntry(2, 'syn-author-0'),
          ] as any,
        },
      ],
    };
    const client = fakeClient({
      contentTypeLookup: [
        { identifier: 'Author', id: 'ct-author' },
        { identifier: 'Article', id: 'ct-article' },
      ],
      envelopeInsert: { kind: 'subset', keep: (id) => id !== 'syn-author-1' },
    });
    const r = await writeViaSql(client as any, generated);
    expect(r.inserted).toBe(3); // A0 + Art0 + Art2
    expect(r.skipped).toBe(2); // A1 + Art1 (cascade)

    // Collect all ContentEntry envelope INSERT calls and gather their first
    // id-slot params (params[0], params[6], params[12], ...).
    const envelopeInserts = client.calls.filter((c) =>
      c.sql.startsWith('INSERT INTO "ContentEntry"')
    );
    const allInsertedIds: string[] = [];
    for (const call of envelopeInserts) {
      for (let i = 0; i < call.params.length; i += 6) {
        allInsertedIds.push(call.params[i] as string);
      }
    }
    // syn-article-1 references syn-author-1 (skipped). It must NEVER appear in
    // any envelope INSERT — the cascade filter drops it pre-insert.
    expect(allInsertedIds).not.toContain('syn-article-1');
    // Sanity: the surviving ids DID reach insertEnvelopes.
    expect(allInsertedIds).toContain('syn-article-0');
    expect(allInsertedIds).toContain('syn-article-2');
  });

  it('patch is skipped when its fieldUpdates reference a skipped entry (#199)', async () => {
    // p1 + p2 are inserted; p3 is skipped at envelope insert. The patch targets
    // p2 with fieldUpdates referencing p3 (which is in skippedIds). The UPDATE
    // must NOT be issued; stderr fires with "fieldUpdates reference"; the
    // entry-level skipped counter is unchanged.
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
              slug: 'p1',
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
              slug: 'p2',
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {},
                  publishedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
            },
            {
              id: 'syn-p3',
              contentTypeId: null,
              contentTypeIdentifier: 'Page',
              entryTitle: 'P3',
              slug: 'p3',
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
                relatedPage: {
                  entryId: 'syn-p3',
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
      envelopeInsert: { kind: 'subset', keep: (id) => id !== 'syn-p3' },
    });
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const r = await writeViaSql(client as any, generated);
    // p1 + p2 inserted, p3 skipped. Patch is skipped without bumping the
    // entry counter (patches don't increment skipped).
    expect(r.inserted).toBe(2);
    expect(r.skipped).toBe(1);
    const updates = client.calls.filter((c) =>
      c.sql.startsWith('UPDATE "ContentEntryVersion"')
    );
    expect(updates.length).toBe(0);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(stderrOutput).toContain('skipping patch on');
    expect(stderrOutput).toContain('fieldUpdates reference');
    stderrSpy.mockRestore();
  });

  it('patch is skipped when its target entryId is in skippedIds (#199)', async () => {
    // p1 inserted; p2 skipped at envelope insert. Patch targets p2 → must NOT
    // issue UPDATE; stderr fires with "target entry … was skipped"; entry
    // counter unchanged (patches don't increment).
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
              slug: 'p1',
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
              slug: 'p2',
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
      envelopeInsert: { kind: 'subset', keep: (id) => id === 'syn-p1' },
    });
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const r = await writeViaSql(client as any, generated);
    // p1 inserted, p2 skipped. Patch skipped without bumping the entry counter.
    expect(r.inserted).toBe(1);
    expect(r.skipped).toBe(1);
    const updates = client.calls.filter((c) =>
      c.sql.startsWith('UPDATE "ContentEntryVersion"')
    );
    expect(updates.length).toBe(0);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(stderrOutput).toContain('target entry');
    expect(stderrOutput).toContain('syn-p2');
    expect(stderrOutput).toContain('was skipped');
    stderrSpy.mockRestore();
  });

  it('translates identifier-form contentTypeId values in JSONB to real UUIDs before INSERT', async () => {
    // Portable-bundle shape: generator emits identifier-form contentTypeId in
    // RELATION refs. The writer must translate them to real UUIDs (looked up
    // via the typeIdByIdentifier map) before the JSONB hits the DB — otherwise
    // CMS resolvers can't traverse the relation.
    const generated: GeneratedSeed = {
      warnings: [],
      groups: [
        {
          contentTypeIdentifier: 'Author',
          entries: [
            {
              id: 'author-entry-1',
              contentTypeId: null,
              contentTypeIdentifier: 'Author',
              entryTitle: 'A',
              slug: 'a',
              versions: [
                {
                  status: 'PUBLISHED',
                  data: { name: 'A' },
                  publishedAt: '2026-05-12T00:00:00.000Z',
                },
              ],
            },
          ],
        },
        {
          contentTypeIdentifier: 'Article',
          entries: [
            {
              id: 'article-entry-1',
              contentTypeId: null,
              contentTypeIdentifier: 'Article',
              entryTitle: 'AR',
              slug: 'ar',
              versions: [
                {
                  status: 'PUBLISHED',
                  data: {
                    title: 'AR',
                    author: {
                      // Identifier-form contentTypeId — the bug this test
                      // guards against. After the writer, this must be the
                      // real Author UUID.
                      contentTypeId: 'Author',
                      contentTypeIdentifier: 'Author',
                      entryId: 'author-entry-1',
                    },
                  },
                  publishedAt: '2026-05-12T00:00:00.000Z',
                },
              ],
            },
          ],
        },
      ],
    };
    const client = fakeClient({
      contentTypeLookup: [
        { identifier: 'Author', id: 'ct-author-real-uuid' },
        { identifier: 'Article', id: 'ct-article-real-uuid' },
      ],
    });
    await writeViaSql(client as any, generated);

    // Find the version INSERT call that carries the article-entry-1 row.
    const articleVersionInsert = client.calls.find(
      (c) =>
        c.sql.includes('INSERT INTO "ContentEntryVersion"') &&
        c.params.some(
          (p) => typeof p === 'string' && p.includes('article-entry-1')
        )
    );
    expect(articleVersionInsert).toBeDefined();
    // The data param is a JSON-stringified blob containing 'author' + 'entryId'.
    const dataParam = articleVersionInsert!.params.find(
      (p) =>
        typeof p === 'string' && p.includes('author') && p.includes('entryId')
    ) as string | undefined;
    expect(dataParam).toBeDefined();
    const parsed = JSON.parse(dataParam!);
    expect(parsed.author.contentTypeId).toBe('ct-author-real-uuid');
    expect(parsed.author.contentTypeIdentifier).toBe('Author');
    expect(parsed.author.entryId).toBe('author-entry-1');
  });
});
