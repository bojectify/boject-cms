import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../utils/prisma';
import { generateApiKey } from '../../utils/apiKey';
import { FIELD_TYPES } from '../../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../../utils/contentStatus';

await setup({
  rootDir: fileURLToPath(new URL('../../..', import.meta.url)),
  dev: true,
});

async function makeKey(scopes: string[]): Promise<string> {
  const { raw, hash, prefix } = generateApiKey();
  await prisma.apiKey.create({
    data: {
      name: `test-${Math.random().toString(36).slice(2, 8)}`,
      keyHash: hash,
      keyPrefix: prefix,
      scopes,
    },
  });
  return raw;
}

async function seedType(identifier: string): Promise<string> {
  const ct = await prisma.contentType.create({
    data: {
      identifier,
      name: identifier,
      fields: {
        create: [
          {
            identifier: 'title',
            name: 'Title',
            type: FIELD_TYPES.ENTRY_TITLE,
            required: true,
            order: 0,
          },
        ],
      },
    },
  });
  return ct.id;
}

async function seedLinkerType(): Promise<{ typeId: string }> {
  const ct = await prisma.contentType.create({
    data: {
      identifier: 'Linker',
      name: 'Linker',
      fields: {
        create: [
          {
            identifier: 'title',
            name: 'Title',
            type: FIELD_TYPES.ENTRY_TITLE,
            required: true,
            order: 0,
          },
          {
            identifier: 'rel',
            name: 'Rel',
            type: FIELD_TYPES.RELATION,
            required: false,
            order: 1,
            options: { targetContentTypeIds: [] },
          },
        ],
      },
    },
  });
  await prisma.contentTypeField.updateMany({
    where: { contentTypeId: ct.id, identifier: 'rel' },
    data: { options: { targetContentTypeIds: [ct.id] } },
  });
  return { typeId: ct.id };
}

describe('GET /api/content-bundle/export', () => {
  beforeEach(async () => {
    await prisma.contentEntry.deleteMany();
    await prisma.contentTypeField.deleteMany();
    await prisma.contentType.deleteMany();
  });

  afterEach(async () => {
    await prisma.apiKey.deleteMany({
      where: { name: { startsWith: 'test-' } },
    });
  });

  it('returns 401 without auth', async () => {
    const res = await fetch('/api/content-bundle/export');
    expect(res.status).toBe(401);
  });

  it('returns 403 INSUFFICIENT_SCOPE without content:export (content:read is not enough)', async () => {
    const key = await makeKey(['content:read']);
    const res = await fetch('/api/content-bundle/export', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data?: { error?: string } };
    expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
  });

  it('returns an entries bundle (no contentTypes) with content:export', async () => {
    const ctId = await seedType('ExportThing');
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ctId,
        entryTitle: 'Published One',
        entryKey: 'published-one',
        slug: 'published-one',
        versions: {
          create: [
            {
              data: { title: 'Published One' },
              entryTitle: 'Published One',
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: new Date(),
            },
          ],
        },
      },
    });
    const key = await makeKey(['content:export']);
    const res = await fetch('/api/content-bundle/export', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      version: number;
      entries: unknown[];
      contentTypes?: unknown;
    };
    expect(body.version).toBe(2);
    expect(body.contentTypes).toBeUndefined();
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it('defaults to published-only — a draft-only entry is absent', async () => {
    const ctId = await seedType('ExportThing');
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ctId,
        entryTitle: 'Published One',
        entryKey: 'published-one',
        slug: 'published-one',
        versions: {
          create: [
            {
              data: { title: 'Published One' },
              entryTitle: 'Published One',
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: new Date(),
            },
          ],
        },
      },
    });
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ctId,
        entryTitle: 'Draft Only',
        entryKey: 'draft-only',
        slug: null,
        versions: {
          create: [
            {
              data: { title: 'Draft Only' },
              entryTitle: 'Draft Only',
              status: CONTENT_STATUSES.DRAFT,
            },
          ],
        },
      },
    });
    const key = await makeKey(['content:export']);
    const res = await fetch('/api/content-bundle/export', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ entryKey: string; versions: Array<{ status: string }> }>;
    };
    expect(
      body.entries
        .flatMap((e) => e.versions)
        .every((v) => v.status === 'PUBLISHED')
    ).toBe(true);
  });

  it('includeDrafts=true surfaces the draft-only entry', async () => {
    const ctId = await seedType('ExportThing');
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ctId,
        entryTitle: 'Draft Only',
        entryKey: 'draft-only',
        slug: null,
        versions: {
          create: [
            {
              data: { title: 'Draft Only' },
              entryTitle: 'Draft Only',
              status: CONTENT_STATUSES.DRAFT,
            },
          ],
        },
      },
    });
    const key = await makeKey(['content:export']);
    const res = await fetch('/api/content-bundle/export?includeDrafts=true', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ versions: Array<{ status: string }> }>;
    };
    expect(
      body.entries
        .flatMap((e) => e.versions)
        .some((v) => v.status !== 'PUBLISHED')
    ).toBe(true);
  });

  it('?contentType= filters by content type identifier', async () => {
    const exportThingId = await seedType('ExportThing');
    const otherThingId = await seedType('OtherThing');
    await prisma.contentEntry.create({
      data: {
        contentTypeId: exportThingId,
        entryTitle: 'Export Entry',
        entryKey: 'export-entry',
        slug: 'export-entry',
        versions: {
          create: [
            {
              data: { title: 'Export Entry' },
              entryTitle: 'Export Entry',
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: new Date(),
            },
          ],
        },
      },
    });
    await prisma.contentEntry.create({
      data: {
        contentTypeId: otherThingId,
        entryTitle: 'Other Entry',
        entryKey: 'other-entry',
        slug: 'other-entry',
        versions: {
          create: [
            {
              data: { title: 'Other Entry' },
              entryTitle: 'Other Entry',
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: new Date(),
            },
          ],
        },
      },
    });
    const key = await makeKey(['content:export']);
    const res = await fetch(
      '/api/content-bundle/export?contentType=ExportThing',
      {
        headers: { Authorization: `Bearer ${key}` },
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ contentTypeIdentifier: string }>;
    };
    expect(body.entries).toHaveLength(1);
    const entry = body.entries[0];
    expect(entry).toBeDefined();
    expect(entry?.contentTypeIdentifier).toBe('ExportThing');
  });

  it('?portable=false preserves real UUID references', async () => {
    const ctId = await seedType('ExportThing');
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ctId,
        entryTitle: 'Published One',
        entryKey: 'published-one',
        slug: 'published-one',
        versions: {
          create: [
            {
              data: { title: 'Published One' },
              entryTitle: 'Published One',
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: new Date(),
            },
          ],
        },
      },
    });
    const key = await makeKey(['content:export']);
    const res = await fetch('/api/content-bundle/export?portable=false', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      portable: boolean;
      entries: Array<{ id: string | null; contentTypeId: string | null }>;
    };
    expect(body.portable).toBe(false);
    const entry = body.entries[0];
    expect(entry).toBeDefined();
    expect(typeof entry?.id).toBe('string');
    expect(entry?.id).not.toBeNull();
    expect(typeof entry?.contentTypeId).toBe('string');
    expect(entry?.contentTypeId).not.toBeNull();
  });

  it('includeDrafts=true returns published AND draft versions, not only drafts', async () => {
    const ctId = await seedType('ExportThing');
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ctId,
        entryTitle: 'Published One',
        entryKey: 'published-one',
        slug: 'published-one',
        versions: {
          create: [
            {
              data: { title: 'Published One' },
              entryTitle: 'Published One',
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: new Date(),
            },
          ],
        },
      },
    });
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ctId,
        entryTitle: 'Draft Only',
        entryKey: 'draft-only',
        slug: null,
        versions: {
          create: [
            {
              data: { title: 'Draft Only' },
              entryTitle: 'Draft Only',
              status: CONTENT_STATUSES.DRAFT,
              publishedAt: null,
            },
          ],
        },
      },
    });
    const key = await makeKey(['content:export']);
    const res = await fetch('/api/content-bundle/export?includeDrafts=true', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ versions: Array<{ status: string }> }>;
    };
    const allVersions = body.entries.flatMap((e) => e.versions);
    expect(allVersions.some((v) => v.status === 'PUBLISHED')).toBe(true);
    expect(allVersions.some((v) => v.status !== 'PUBLISHED')).toBe(true);
  });
});

function entriesBundle(title: string) {
  return {
    version: 2,
    exportedAt: '2026-06-01T00:00:00.000Z',
    portable: true,
    entries: [
      {
        id: null,
        contentTypeId: null,
        contentTypeIdentifier: 'Note',
        entryTitle: title,
        entryKey: title.toLowerCase(),
        slug: null,
        versions: [{ status: 'PUBLISHED', data: { title }, publishedAt: null }],
      },
    ],
  };
}

describe('POST /api/content-bundle/import', () => {
  beforeEach(async () => {
    await prisma.contentEntry.deleteMany();
    await prisma.contentTypeField.deleteMany();
    await prisma.contentType.deleteMany();
    await seedType('Note');
  });

  afterEach(async () => {
    await prisma.apiKey.deleteMany({
      where: { name: { startsWith: 'test-' } },
    });
  });

  it('returns 403 INSUFFICIENT_SCOPE without content:import', async () => {
    const key = await makeKey(['content:write']); // content:write is NOT enough
    const res = await fetch('/api/content-bundle/import', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bundle: entriesBundle('Alpha') }),
    });
    expect(res.status).toBe(403);
  });

  it('imports entries and returns a summary with content:import', async () => {
    const key = await makeKey(['content:import']);
    const res = await fetch('/api/content-bundle/import', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bundle: entriesBundle('Alpha') }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entriesCreated: number };
    expect(body.entriesCreated).toBe(1);
  });

  it('400 BAD_REQUEST when body has no bundle', async () => {
    const key = await makeKey(['content:import']);
    const res = await fetch('/api/content-bundle/import', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('409 ENTRY_IMPORT_CONFLICT on a fail-mode collision', async () => {
    const key = await makeKey(['content:import']);
    const headers = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
    const body = JSON.stringify({ bundle: entriesBundle('Dup') });
    await fetch('/api/content-bundle/import', {
      method: 'POST',
      headers,
      body,
    });
    const res = await fetch('/api/content-bundle/import', {
      method: 'POST',
      headers,
      body,
    });
    expect(res.status).toBe(409);
    const j = (await res.json()) as {
      data?: {
        error?: string;
        contentTypeIdentifier?: string;
        entryKey?: string;
      };
    };
    expect(j.data?.error).toBe('ENTRY_IMPORT_CONFLICT');
    expect(j.data?.contentTypeIdentifier).toBe('Note');
    expect(j.data?.entryKey).toBe('dup');
  });

  it('dryRun: true reports planned counts but persists nothing', async () => {
    const key = await makeKey(['content:import']);
    const res = await fetch('/api/content-bundle/import', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bundle: entriesBundle('Dry'), dryRun: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entriesCreated: number };
    expect(body.entriesCreated).toBe(1);
    expect(await prisma.contentEntry.count()).toBe(0);
  });

  it('skip onConflict leaves the existing entry and reports entriesSkipped', async () => {
    const key = await makeKey(['content:import']);
    const headers = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
    await fetch('/api/content-bundle/import', {
      method: 'POST',
      headers,
      body: JSON.stringify({ bundle: entriesBundle('Skp') }),
    });
    const res = await fetch('/api/content-bundle/import', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        bundle: entriesBundle('Skp'),
        onConflict: 'skip',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entriesCreated: number;
      entriesSkipped: number;
    };
    expect(body.entriesSkipped).toBe(1);
    expect(body.entriesCreated).toBe(0);
  });

  it('400 BUNDLE_INVALID when the bundle fails validateBundle', async () => {
    const key = await makeKey(['content:import']);
    const res = await fetch('/api/content-bundle/import', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bundle: { version: 99 } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { data?: { error?: string } };
    expect(body.data?.error).toBe('BUNDLE_INVALID');
  });

  it('replace onConflict overwrites instead of 409', async () => {
    const key = await makeKey(['content:import']);
    const headers = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
    await fetch('/api/content-bundle/import', {
      method: 'POST',
      headers,
      body: JSON.stringify({ bundle: entriesBundle('Rep') }),
    });
    const res = await fetch('/api/content-bundle/import', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        bundle: entriesBundle('Rep'),
        onConflict: 'replace',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entriesUpdated: number };
    expect(body.entriesUpdated).toBe(1);
  });

  it('400 ENTRY_IMPORT_REFERENCE_INVALID on a dangling non-portable RELATION', async () => {
    const { typeId } = await seedLinkerType();
    const key = await makeKey(['content:import']);
    const missing = randomUUID();
    const bundle = {
      version: 2,
      exportedAt: '2026-06-01T00:00:00.000Z',
      portable: false,
      entries: [
        {
          id: randomUUID(),
          contentTypeId: typeId,
          contentTypeIdentifier: 'Linker',
          entryTitle: 'A',
          entryKey: 'a',
          slug: null,
          versions: [
            {
              status: 'PUBLISHED',
              data: {
                title: 'A',
                rel: { contentTypeId: typeId, entryId: missing },
              },
              publishedAt: null,
            },
          ],
        },
      ],
    };
    const res = await fetch('/api/content-bundle/import', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bundle }),
    });
    expect(res.status).toBe(400);
    const j = (await res.json()) as {
      message?: string;
      data?: { error?: string; message?: string };
    };
    expect(j.data?.error).toBe('ENTRY_IMPORT_REFERENCE_INVALID');
    // The human-readable reason must be surfaced at the top-level `message`,
    // not only under `data` — REST clients and the CLI (which reads the outer
    // message) otherwise show a blank error.
    expect(j.message).toContain('references missing entry');
  });

  it('400 ENTRY_IMPORT_REFERENCE_INVALID on a dangling PORTABLE RELATION (parity with non-portable), and rolls back', async () => {
    const { typeId } = await seedLinkerType();
    const key = await makeKey(['content:import']);
    const bundle = {
      version: 2,
      exportedAt: '2026-06-01T00:00:00.000Z',
      portable: true,
      entries: [
        {
          id: null,
          contentTypeId: null,
          contentTypeIdentifier: 'Linker',
          entryTitle: 'A',
          entryKey: 'a',
          slug: null,
          versions: [
            {
              status: 'PUBLISHED',
              data: {
                title: 'A',
                // entryKey 'ghost' resolves to no entry in the bundle nor on
                // the target — the portable decode path must fail the same way
                // the non-portable guard does: a clean 400, not an h3 500.
                rel: { contentTypeIdentifier: 'Linker', entryKey: 'ghost' },
              },
              publishedAt: null,
            },
          ],
        },
      ],
    };
    const res = await fetch('/api/content-bundle/import', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bundle }),
    });
    expect(res.status).toBe(400);
    const j = (await res.json()) as {
      message?: string;
      data?: { error?: string; message?: string };
    };
    expect(j.data?.error).toBe('ENTRY_IMPORT_REFERENCE_INVALID');
    expect(j.message).toContain('not found');
    // The entry is created before the dangling ref is decoded; a clean
    // rollback means nothing persists.
    expect(
      await prisma.contentEntry.count({ where: { contentTypeId: typeId } })
    ).toBe(0);
  });
});
