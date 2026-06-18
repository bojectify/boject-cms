import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from './prisma';
import {
  fetchDisplayVersions,
  resolveAndFlattenEntries,
  keysetPage,
  encodeCursor,
  InvalidCursorError,
  type PageInfo,
} from './listEntries';
import type { ContentEntry } from '#prisma';
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

describe('resolveAndFlattenEntries', () => {
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

  it('CMS sees the draft-priority (CHANGED) version flattened', async () => {
    const ct = await prisma.contentType.findUniqueOrThrow({
      where: { identifier: 'FetchThing' },
    });
    const rows = await prisma.contentEntry.findMany({
      where: { contentTypeId: ct.id },
    });
    const items = await resolveAndFlattenEntries(prisma, rows, {
      isCms: true,
      archiveFilter: 'active',
    });
    const item = items.find((i) => i.id === entryId)!;
    expect(item).toBeDefined();
    expect(item.status).toBe('CHANGED');
    expect((item.data as { title: string }).title).toBe(
      'Heavy History (draft)'
    );
  });

  it('API-key context sees the PUBLISHED version', async () => {
    const ct = await prisma.contentType.findUniqueOrThrow({
      where: { identifier: 'FetchThing' },
    });
    const rows = await prisma.contentEntry.findMany({
      where: { contentTypeId: ct.id },
    });
    const items = await resolveAndFlattenEntries(prisma, rows, {
      isCms: false,
      archiveFilter: 'active',
    });
    const item = items.find((i) => i.id === entryId)!;
    expect(item.status).toBe('PUBLISHED');
  });
});

describe('keysetPage', () => {
  let ctId: string;
  // Entry ids in presentation order (updatedAt DESC, id ASC), derived from the
  // DB after seeding so the assertions hold regardless of how Prisma's
  // `@updatedAt` resolves an explicit-on-create timestamp.
  let ordered: string[];

  beforeEach(async () => {
    await prisma.contentEntry.deleteMany();
    await prisma.contentTypeField.deleteMany();
    await prisma.contentType.deleteMany();

    const ct = await prisma.contentType.create({
      data: { identifier: 'KeysetThing', name: 'KeysetThing' },
    });
    ctId = ct.id;

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const e = await prisma.contentEntry.create({
        data: {
          contentTypeId: ctId,
          entryTitle: `K${i}`,
          entryKey: `k-${i}`,
          slug: `k-${i}`,
          versions: {
            create: [
              {
                data: { title: `K${i}` },
                entryTitle: `K${i}`,
                status: CONTENT_STATUSES.PUBLISHED,
                publishedAt: new Date(),
              },
            ],
          },
        },
      });
      ids.push(e.id);
    }

    // Prisma's `@updatedAt` ignores an explicit value on create, so set distinct
    // timestamps via raw SQL to exercise the updatedAt-vs-id tiebreaker.
    // i=0 newest => earliest in presentation order (updatedAt DESC).
    for (let i = 0; i < ids.length; i++) {
      await prisma.$executeRawUnsafe(
        `UPDATE "ContentEntry" SET "updatedAt" = $1 WHERE id = $2`,
        new Date(2026, 0, 10 - i),
        ids[i]
      );
    }

    // Derive the canonical presentation order straight from the DB so the walk
    // assertions are deterministic no matter how the timestamps land.
    ordered = (
      await prisma.contentEntry.findMany({
        where: { contentTypeId: ctId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: { id: true },
      })
    ).map((r) => r.id);
  });

  const where = () => ({ contentTypeId: ctId });

  it('forward walk tiles with no dupes/gaps and reports hasNextPage', async () => {
    const p1 = await keysetPage<ContentEntry>(prisma, {
      where: where(),
      perPage: 2,
    });
    expect(p1.rows.map((r) => r.id)).toEqual(ordered.slice(0, 2));
    expect(p1.pageInfo.hasNextPage).toBe(true);
    expect(p1.pageInfo.hasPreviousPage).toBe(false);
    expect(p1.pageInfo.startCursor).not.toBeNull();
    expect(p1.pageInfo.endCursor).not.toBeNull();

    const p2 = await keysetPage<ContentEntry>(prisma, {
      where: where(),
      perPage: 2,
      after: p1.pageInfo.endCursor!,
    });
    expect(p2.rows.map((r) => r.id)).toEqual(ordered.slice(2, 4));
    expect(p2.pageInfo.hasNextPage).toBe(true);
    expect(p2.pageInfo.hasPreviousPage).toBe(true);

    const p3 = await keysetPage<ContentEntry>(prisma, {
      where: where(),
      perPage: 2,
      after: p2.pageInfo.endCursor!,
    });
    expect(p3.rows.map((r) => r.id)).toEqual(ordered.slice(4, 5));
    expect(p3.pageInfo.hasNextPage).toBe(false);

    // The forward walk tiles to exactly `ordered` — no dupes, no gaps.
    expect([
      ...p1.rows.map((r) => r.id),
      ...p2.rows.map((r) => r.id),
      ...p3.rows.map((r) => r.id),
    ]).toEqual(ordered);
  });

  it('backward walk returns the previous page in presentation order', async () => {
    const p1 = await keysetPage<ContentEntry>(prisma, {
      where: where(),
      perPage: 2,
    });
    const p2 = await keysetPage<ContentEntry>(prisma, {
      where: where(),
      perPage: 2,
      after: p1.pageInfo.endCursor!,
    });
    const back = await keysetPage<ContentEntry>(prisma, {
      where: where(),
      perPage: 2,
      before: p2.pageInfo.startCursor!,
    });
    expect(back.rows.map((r) => r.id)).toEqual(ordered.slice(0, 2));
    expect(back.pageInfo.hasNextPage).toBe(true);
    expect(back.pageInfo.hasPreviousPage).toBe(false);
  });

  it('throws InvalidCursorError on a malformed cursor', async () => {
    await expect(
      keysetPage<ContentEntry>(prisma, {
        where: where(),
        perPage: 2,
        after: 'garbage',
      })
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });

  // Equal `updatedAt` is common in production: DateTime is timestamp(3)
  // (ms precision), so bulk-publish + same-millisecond saves collide. When
  // every row shares `updatedAt`, the entire walk is driven by the `id`
  // tiebreaker arm ({ updatedAt: cursor.updatedAt, id: { gt/lt } }), which the
  // distinct-timestamp tests above never reach.
  describe('equal updatedAt (id-tiebreaker arm)', () => {
    let eqOrdered: string[];

    beforeEach(async () => {
      await prisma.contentEntry.deleteMany();
      await prisma.contentTypeField.deleteMany();
      await prisma.contentType.deleteMany();

      const ct = await prisma.contentType.create({
        data: { identifier: 'KeysetTie', name: 'KeysetTie' },
      });
      ctId = ct.id;

      for (let i = 0; i < 6; i++) {
        await prisma.contentEntry.create({
          data: {
            contentTypeId: ctId,
            entryTitle: `T${i}`,
            entryKey: `t-${i}`,
            slug: `t-${i}`,
            versions: {
              create: [
                {
                  data: { title: `T${i}` },
                  entryTitle: `T${i}`,
                  status: CONTENT_STATUSES.PUBLISHED,
                  publishedAt: new Date(),
                },
              ],
            },
          },
        });
      }

      // Prisma's `@updatedAt` overrides any explicit value on create, so stamp
      // a single shared timestamp onto every row AFTER create via raw SQL. Use
      // a parameterised tagged-template $executeRaw (no string interpolation).
      const sharedDate = new Date('2026-06-18T12:00:00.000Z');
      await prisma.$executeRaw`UPDATE "ContentEntry" SET "updatedAt" = ${sharedDate} WHERE "contentTypeId" = ${ctId}`;

      // Canonical presentation order straight from the DB. With identical
      // updatedAt this is purely the id ASC tiebreaker.
      eqOrdered = (
        await prisma.contentEntry.findMany({
          where: { contentTypeId: ctId },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          select: { id: true },
        })
      ).map((r) => r.id);
    });

    it('forward walk tiles to `ordered` via the id tiebreaker (no dupes/gaps/reorder)', async () => {
      const collected: string[] = [];
      let after: string | null = null;
      // Bounded loop guards against an infinite walk if the keyset regresses.
      for (let guard = 0; guard < 20; guard++) {
        const page: { rows: ContentEntry[]; pageInfo: PageInfo } =
          await keysetPage<ContentEntry>(prisma, {
            where: { contentTypeId: ctId },
            perPage: 2,
            after,
          });
        collected.push(...page.rows.map((r) => r.id));
        if (!page.pageInfo.hasNextPage) break;
        after = page.pageInfo.endCursor;
      }
      // Identical updatedAt across all rows means this walk is driven ENTIRELY
      // by the id-tiebreaker arm — so an exact match proves that arm correct.
      expect(collected).toEqual(eqOrdered);
    });

    it('backward page under hasExtra:true returns the correct contiguous slice', async () => {
      // A `before` cursor near the END of the set leaves more rows behind the
      // returned page than perPage, so the backward fetch overflows (hasExtra)
      // and exercises the slice-then-reverse path on the id-tiebreaker arm.
      // before = the last row's cursor; page backward with perPage 2 →
      // the page immediately preceding it, i.e. ordered[3..5).
      const lastId = eqOrdered[eqOrdered.length - 1];
      const lastRow = await prisma.contentEntry.findUniqueOrThrow({
        where: { id: lastId },
        select: { updatedAt: true, id: true },
      });
      const beforeCursor = encodeCursor(lastRow.updatedAt, lastRow.id);

      const back = await keysetPage<ContentEntry>(prisma, {
        where: { contentTypeId: ctId },
        perPage: 2,
        before: beforeCursor,
      });
      // eqOrdered has 6 rows (indices 0..5). The page before index 5 is
      // indices 3 and 4, in presentation order.
      expect(back.rows.map((r) => r.id)).toEqual(eqOrdered.slice(3, 5));
      // More rows (indices 0..2) remain behind this page → hasExtra path.
      expect(back.pageInfo.hasPreviousPage).toBe(true);
      expect(back.pageInfo.hasNextPage).toBe(true);
    });
  });
});
