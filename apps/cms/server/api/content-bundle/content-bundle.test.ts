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
});
