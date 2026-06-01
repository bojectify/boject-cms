import { fileURLToPath } from 'node:url';
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
