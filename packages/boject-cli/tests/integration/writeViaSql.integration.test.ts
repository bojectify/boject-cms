import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { generatePerfData } from '../../src/perf/generate.js';
import {
  MissingContentTypeError,
  writeViaSql,
} from '../../src/perf/writeViaSql.js';
import { SeedMostlyDuplicateError } from '../../src/perf/seedErrors.js';
import type { Bundle } from '../../src/vendor/contentBundleTypes.js';
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
});
