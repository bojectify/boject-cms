import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { generatePerfData } from '../../src/perf/generate.js';
import {
  MissingContentTypeError,
  writeViaSql,
} from '../../src/perf/writeViaSql.js';
import { SeedMostlyDuplicateError } from '../../src/perf/seedErrors.js';
import type {
  Bundle,
  BundleEntry,
} from '../../src/vendor/contentBundleTypes.js';
import type { GeneratedSeed } from '../../src/perf/generate.js';
import { PERF_TEST_DATABASE_URL } from './globalSetup.js';

const PERF_ARTICLE_BUNDLE: Bundle = {
  version: 2,
  exportedAt: '2026-05-12T00:00:00.000Z',
  portable: false,
  contentTypes: [
    {
      id: null,
      identifier: 'PerfArticle',
      name: 'Perf Article',
      description: null,
      fields: [
        {
          id: null,
          identifier: 'entryTitle',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
          unique: true,
          order: 0,
          options: null,
        },
        {
          id: null,
          identifier: 'slug',
          name: 'Slug',
          type: 'SLUG',
          required: false,
          unique: true,
          order: 1,
          options: null,
        },
        {
          id: null,
          identifier: 'body',
          name: 'Body',
          type: 'TEXT',
          required: false,
          unique: false,
          order: 2,
          options: null,
        },
        {
          id: null,
          identifier: 'publishDate',
          name: 'Publish Date',
          type: 'DATETIME',
          required: false,
          unique: false,
          order: 3,
          options: null,
        },
      ],
    },
  ],
};

let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: PERF_TEST_DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  await client.query(
    'TRUNCATE TABLE "ContentEntryVersion", "ContentEntry" CASCADE'
  );
});

describe('writeViaSql against real Postgres', () => {
  it('inserts 500 entries end-to-end (envelopes + PUBLISHED versions)', async () => {
    const generated = generatePerfData(PERF_ARTICLE_BUNDLE, {
      contentTypeIdentifier: 'PerfArticle',
      count: 500,
      seed: 1,
    });

    const result = await writeViaSql(client, generated);

    expect(result).toEqual({ inserted: 500, skipped: 0 });

    const envelopes = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "ContentEntry"'
    );
    expect(envelopes.rows[0]!.count).toBe('500');

    const versions = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "ContentEntryVersion" WHERE status = 'PUBLISHED'`
    );
    expect(versions.rows[0]!.count).toBe('500');

    // Sample a row to confirm the JSONB data shape matches what the writer produced.
    const sample = await client.query<{
      entryTitle: string;
      data: Record<string, unknown>;
    }>(
      `SELECT ce."entryTitle", cev."data"
       FROM "ContentEntry" ce
       JOIN "ContentEntryVersion" cev ON cev."entryId" = ce.id
       LIMIT 1`
    );
    const row = sample.rows[0]!;
    expect(row.entryTitle).toBeTypeOf('string');
    expect(row.entryTitle.length).toBeGreaterThan(0);
    expect(row.data).toHaveProperty('entryTitle');
    expect(row.data).toHaveProperty('slug');
    expect(row.data).toHaveProperty('publishDate');
  });

  it('preserves synthetic IDs as ContentEntry primary keys', async () => {
    const generated = generatePerfData(PERF_ARTICLE_BUNDLE, {
      contentTypeIdentifier: 'PerfArticle',
      count: 5,
      seed: 42,
    });
    const expectedIds = new Set(generated.groups[0]!.entries.map((e) => e.id));

    await writeViaSql(client, generated);

    const r = await client.query<{ id: string }>(
      'SELECT id FROM "ContentEntry"'
    );
    const actualIds = new Set(r.rows.map((row) => row.id));
    expect(actualIds).toEqual(expectedIds);
  });

  it('re-running the same seed trips SeedMostlyDuplicateError via ON CONFLICT', async () => {
    const generated = generatePerfData(PERF_ARTICLE_BUNDLE, {
      contentTypeIdentifier: 'PerfArticle',
      count: 5,
      seed: 1,
    });

    const first = await writeViaSql(client, generated);
    expect(first).toEqual({ inserted: 5, skipped: 0 });

    await expect(writeViaSql(client, generated)).rejects.toBeInstanceOf(
      SeedMostlyDuplicateError
    );

    // Row counts must not have doubled — the ON CONFLICT clause skipped all 5.
    const r = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "ContentEntry"'
    );
    expect(r.rows[0]!.count).toBe('5');
  });

  it('throws MissingContentTypeError when the content type is absent', async () => {
    const generated = generatePerfData(PERF_ARTICLE_BUNDLE, {
      contentTypeIdentifier: 'PerfArticle',
      count: 3,
      seed: 1,
    });
    // Re-target the group at an identifier that doesn't exist in the DB.
    generated.groups[0]!.contentTypeIdentifier = 'NonexistentPerfType';

    await expect(writeViaSql(client, generated)).rejects.toBeInstanceOf(
      MissingContentTypeError
    );

    // Client must still be usable after the throw — no hung query, no
    // half-open transaction. Issuing another query and ending cleanly proves it.
    const probe = await client.query<{ ok: number }>('SELECT 1 AS ok');
    expect(probe.rows[0]!.ok).toBe(1);
  });

  it('leaves the connection in a clean state after a successful run', async () => {
    const generated = generatePerfData(PERF_ARTICLE_BUNDLE, {
      contentTypeIdentifier: 'PerfArticle',
      count: 10,
      seed: 7,
    });
    await writeViaSql(client, generated);

    // Issue a follow-up query on the same client — if writeViaSql had left a
    // transaction open or a query in flight, this would hang or error.
    const probe = await client.query<{ ok: number }>('SELECT 1 AS ok');
    expect(probe.rows[0]!.ok).toBe(1);
  });

  it('persists relation contentTypeId fields as real UUIDs in JSONB', async () => {
    // Seed two content types: Author (target) + Article (with `author`
    // RELATION). Use distinct identifiers so we don't collide with the
    // suite-wide PerfArticle type seeded in globalSetup. ContentType isn't
    // touched by the per-test TRUNCATE, so we clean these up at the end.
    const authorRow = await client.query<{ id: string }>(
      `INSERT INTO "ContentType" ("id", "name", "identifier", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, NOW(), NOW())
       RETURNING id`,
      ['PerfWriterAuthor', 'PerfWriterAuthor']
    );
    const authorCtId = authorRow.rows[0]!.id;
    await client.query(
      `INSERT INTO "ContentTypeField" ("id", "contentTypeId", "identifier", "name", "type", "required", "unique", "order", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'entryTitle', 'Title', 'ENTRY_TITLE', true, true, 0, NOW(), NOW())`,
      [authorCtId]
    );

    const articleRow = await client.query<{ id: string }>(
      `INSERT INTO "ContentType" ("id", "name", "identifier", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, NOW(), NOW())
       RETURNING id`,
      ['PerfWriterArticle', 'PerfWriterArticle']
    );
    const articleCtId = articleRow.rows[0]!.id;
    await client.query(
      `INSERT INTO "ContentTypeField" ("id", "contentTypeId", "identifier", "name", "type", "required", "unique", "order", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'entryTitle', 'Title', 'ENTRY_TITLE', true, true, 0, NOW(), NOW())`,
      [articleCtId]
    );
    await client.query(
      `INSERT INTO "ContentTypeField" ("id", "contentTypeId", "identifier", "name", "type", "required", "unique", "order", "options", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, 'author', 'Author', 'RELATION', false, false, 1, $2::jsonb, NOW(), NOW())`,
      [articleCtId, JSON.stringify({ targetContentTypeIds: [authorCtId] })]
    );

    try {
      // Hand-build a portable-shape `generated` with one Author + one Article
      // whose `author` ref uses identifier-form contentTypeId.
      const authorEntry: BundleEntry = {
        id: '00000000-0000-4000-8000-000000000001',
        contentTypeId: null,
        contentTypeIdentifier: 'PerfWriterAuthor',
        entryTitle: 'Author One',
        slug: 'author-one',
        versions: [
          {
            status: 'PUBLISHED',
            data: { entryTitle: 'Author One', slug: 'author-one' },
            publishedAt: '2026-05-12T00:00:00.000Z',
          },
        ],
      };
      const articleEntry: BundleEntry = {
        id: '00000000-0000-4000-8000-000000000002',
        contentTypeId: null,
        contentTypeIdentifier: 'PerfWriterArticle',
        entryTitle: 'Article One',
        slug: 'article-one',
        versions: [
          {
            status: 'PUBLISHED',
            data: {
              entryTitle: 'Article One',
              slug: 'article-one',
              author: {
                // Identifier-form contentTypeId — the writer must translate
                // this to the real Author UUID before insert.
                contentTypeId: 'PerfWriterAuthor',
                contentTypeIdentifier: 'PerfWriterAuthor',
                entryId: '00000000-0000-4000-8000-000000000001',
              },
            },
            publishedAt: '2026-05-12T00:00:00.000Z',
          },
        ],
      };
      const generated: GeneratedSeed = {
        warnings: [],
        groups: [
          {
            contentTypeIdentifier: 'PerfWriterAuthor',
            entries: [authorEntry],
          },
          {
            contentTypeIdentifier: 'PerfWriterArticle',
            entries: [articleEntry],
          },
        ],
      };

      await writeViaSql(client, generated);

      // Query the persisted Article version's `author` field — contentTypeId
      // must be the real Author content-type UUID, not the identifier string.
      const result = await client.query<{
        data: {
          author: {
            contentTypeId: string;
            entryId: string;
            contentTypeIdentifier: string;
          };
        };
      }>(
        `SELECT cev."data"
         FROM "ContentEntryVersion" cev
         JOIN "ContentEntry" ce ON ce.id = cev."entryId"
         WHERE ce."contentTypeId" = $1`,
        [articleCtId]
      );
      expect(result.rows.length).toBe(1);
      const data = result.rows[0]!.data;
      expect(data.author.contentTypeId).toBe(authorCtId);
      expect(data.author.contentTypeId).not.toBe('PerfWriterAuthor');
      expect(data.author.contentTypeIdentifier).toBe('PerfWriterAuthor');
      expect(data.author.entryId).toBe('00000000-0000-4000-8000-000000000001');
    } finally {
      // Cleanup so the suite is idempotent across re-runs — ContentType is
      // NOT truncated by the per-test hook. Drop the dependent ContentEntry
      // (+ ContentEntryVersion via cascade) first so the FK lets us delete
      // the ContentType rows. ContentTypeField cascades on ContentType delete.
      await client.query(
        `DELETE FROM "ContentEntry" WHERE "contentTypeId" IN ($1, $2)`,
        [authorCtId, articleCtId]
      );
      await client.query(
        `DELETE FROM "ContentType" WHERE "identifier" IN ($1, $2)`,
        ['PerfWriterAuthor', 'PerfWriterArticle']
      );
    }
  });
});
