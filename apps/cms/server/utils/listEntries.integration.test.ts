import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from './prisma';
import { fetchDisplayVersions } from './listEntries';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

describe('fetchDisplayVersions', () => {
  let entryId: string;

  beforeEach(async () => {
    await prisma.contentEntry.deleteMany();
    await prisma.contentTypeField.deleteMany();
    await prisma.contentType.deleteMany();

    const ct = await prisma.contentType.create({
      data: {
        identifier: 'FetchThing',
        name: 'FetchThing',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
            },
          ],
        },
      },
    });

    const entry = await prisma.contentEntry.create({
      data: {
        contentTypeId: ct.id,
        entryTitle: 'Heavy History',
        entryKey: 'heavy-history',
        slug: 'heavy-history',
        versions: {
          create: [
            {
              data: { title: 'Heavy History' },
              entryTitle: 'Heavy History',
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: new Date(),
            },
            {
              data: { title: 'Heavy History (draft)' },
              entryTitle: 'Heavy History',
              status: CONTENT_STATUSES.CHANGED,
            },
          ],
        },
      },
    });
    entryId = entry.id;

    for (let i = 0; i < 30; i++) {
      await prisma.contentEntryVersion.create({
        data: {
          entryId,
          data: { title: `archived ${i}` },
          entryTitle: 'Heavy History',
          status: CONTENT_STATUSES.ARCHIVED,
          publishedAt: new Date(2020, 0, i + 1),
        },
      });
    }
  });

  it('returns at most one row per (entry, status) — not all 32 versions', async () => {
    const byEntry = await fetchDisplayVersions(prisma, [entryId], {
      includeData: false,
    });
    const rows = byEntry.get(entryId) ?? [];
    expect(rows.length).toBeLessThanOrEqual(4);
    expect(new Set(rows.map((r) => r.status))).toEqual(
      new Set(['PUBLISHED', 'CHANGED', 'ARCHIVED'])
    );
  });

  it('includeData: true carries the chosen version data', async () => {
    const byEntry = await fetchDisplayVersions(prisma, [entryId], {
      includeData: true,
    });
    const rows = byEntry.get(entryId) ?? [];
    const published = rows.find((r) => r.status === 'PUBLISHED');
    expect(published?.data).toEqual({ title: 'Heavy History' });
  });

  it('empty input returns an empty map', async () => {
    const byEntry = await fetchDisplayVersions(prisma, [], {
      includeData: false,
    });
    expect(byEntry.size).toBe(0);
  });

  it('groups versions per entry without cross-contamination', async () => {
    const ct = await prisma.contentType.findUniqueOrThrow({
      where: { identifier: 'FetchThing' },
    });

    const second = await prisma.contentEntry.create({
      data: {
        contentTypeId: ct.id,
        entryTitle: 'Second',
        entryKey: 'second',
        slug: 'second',
        versions: {
          create: [
            {
              data: { title: 'Second' },
              entryTitle: 'Second',
              status: CONTENT_STATUSES.PUBLISHED,
              publishedAt: new Date(),
            },
          ],
        },
      },
    });
    const secondId = second.id;

    const byEntry = await fetchDisplayVersions(prisma, [entryId, secondId], {
      includeData: false,
    });

    expect(byEntry.size).toBe(2);
    expect(new Set((byEntry.get(entryId) ?? []).map((r) => r.status))).toEqual(
      new Set(['PUBLISHED', 'CHANGED', 'ARCHIVED'])
    );
    expect(new Set((byEntry.get(secondId) ?? []).map((r) => r.status))).toEqual(
      new Set(['PUBLISHED'])
    );
  });
});
