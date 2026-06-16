import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { exportBundle } from './export';
import { importBundle } from './import';
import { getTestDatabaseUrl } from '../../test/dbUrl';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../utils/contentStatus';

const url = getTestDatabaseUrl();
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

async function seed() {
  const category = await prisma.contentType.create({
    data: {
      identifier: 'Category',
      name: 'Category',
      fields: {
        create: {
          identifier: 'name',
          name: 'Name',
          type: FIELD_TYPES.ENTRY_TITLE,
          required: true,
          order: 0,
        },
      },
    },
  });
  const categoryEntry = await prisma.contentEntry.create({
    data: {
      contentTypeId: category.id,
      entryTitle: 'News',
      entryKey: 'news',
      slug: 'news',
      versions: {
        create: {
          data: { name: 'News' },
          entryTitle: 'News',
          status: CONTENT_STATUSES.PUBLISHED,
        },
      },
    },
  });
  const post = await prisma.contentType.create({
    data: {
      identifier: 'Post',
      name: 'Post',
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
            identifier: 'category',
            name: 'Category',
            type: FIELD_TYPES.RELATION,
            required: false,
            order: 1,
            options: { targetContentTypeIds: [category.id] },
          },
        ],
      },
    },
  });
  await prisma.contentEntry.create({
    data: {
      contentTypeId: post.id,
      entryTitle: 'Welcome',
      entryKey: 'welcome',
      slug: 'welcome',
      versions: {
        create: {
          data: {
            title: 'Welcome',
            category: {
              contentTypeId: category.id,
              entryId: categoryEntry.id,
            },
          },
          entryTitle: 'Welcome',
          status: CONTENT_STATUSES.DRAFT,
        },
      },
    },
  });
}

describe('export → import round-trip', () => {
  beforeEach(async () => await reset());
  afterEach(async () => await reset());

  it('preserves schema and entries in portable mode', async () => {
    await seed();
    const bundle = await exportBundle(prisma, { mode: 'all', portable: true });

    await reset();

    const result = await importBundle(prisma, bundle, { mode: 'all' });
    expect(result.contentTypesCreated).toBe(2);
    expect(result.entriesCreated).toBe(2);

    const post = await prisma.contentType.findUnique({
      where: { identifier: 'Post' },
    });
    const category = await prisma.contentType.findUnique({
      where: { identifier: 'Category' },
    });
    const welcome = await prisma.contentEntry.findFirst({
      where: { contentTypeId: post!.id, slug: 'welcome' },
      include: { versions: true },
    });
    const news = await prisma.contentEntry.findFirst({
      where: { contentTypeId: category!.id, slug: 'news' },
    });
    const data = welcome!.versions[0]!.data as Record<string, unknown>;
    expect(data.category).toEqual({
      contentTypeId: category!.id,
      entryId: news!.id,
    });
  });

  it('preserves the unique flag on TEXT fields and implicit-true on ENTRY_TITLE', async () => {
    await reset();
    await prisma.contentType.create({
      data: {
        identifier: 'UniqueRoundtrip',
        name: 'UniqueRoundtrip',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              unique: true,
              order: 0,
            },
            {
              identifier: 'sku',
              name: 'SKU',
              type: FIELD_TYPES.TEXT,
              required: false,
              unique: true,
              order: 1,
            },
            {
              identifier: 'tagline',
              name: 'Tagline',
              type: FIELD_TYPES.TEXT,
              required: false,
              unique: false,
              order: 2,
            },
          ],
        },
      },
    });

    const exported = await exportBundle(prisma, {
      mode: 'schema',
      portable: true,
    });
    const exportedType = exported.contentTypes!.find(
      (c) => c.identifier === 'UniqueRoundtrip'
    )!;
    expect(
      exportedType.fields.find((f) => f.identifier === 'title')!.unique
    ).toBe(true);
    expect(
      exportedType.fields.find((f) => f.identifier === 'sku')!.unique
    ).toBe(true);
    expect(
      exportedType.fields.find((f) => f.identifier === 'tagline')!.unique
    ).toBe(false);

    await reset();
    await importBundle(prisma, exported, { mode: 'schema' });

    const reimportedTitle = await prisma.contentTypeField.findFirst({
      where: { identifier: 'title' },
    });
    const reimportedSku = await prisma.contentTypeField.findFirst({
      where: { identifier: 'sku' },
    });
    const reimportedTagline = await prisma.contentTypeField.findFirst({
      where: { identifier: 'tagline' },
    });
    expect(reimportedTitle?.unique).toBe(true);
    expect(reimportedSku?.unique).toBe(true);
    expect(reimportedTagline?.unique).toBe(false);
  });

  it('preserves a field default (options.default) through export → import (#344)', async () => {
    // A field's `default` lives inside its `options` JSON. Because export
    // serialises `options` verbatim and import writes it back verbatim, the
    // default round-trips with zero default-aware code in the bundle path.
    await reset();
    await prisma.contentType.create({
      data: {
        identifier: 'DefaultRoundtrip',
        name: 'DefaultRoundtrip',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              unique: true,
              order: 0,
            },
            {
              identifier: 'flag',
              name: 'Flag',
              type: FIELD_TYPES.BOOLEAN,
              required: false,
              order: 1,
              options: { default: false },
            },
          ],
        },
      },
    });

    const exported = await exportBundle(prisma, {
      mode: 'schema',
      portable: true,
    });
    const exportedFlag = exported
      .contentTypes!.find((c) => c.identifier === 'DefaultRoundtrip')!
      .fields.find((f) => f.identifier === 'flag')!;
    expect(exportedFlag.options).toEqual({ default: false });

    await reset();
    await importBundle(prisma, exported, { mode: 'schema' });

    const reimportedFlag = await prisma.contentTypeField.findFirst({
      where: { identifier: 'flag' },
    });
    // The default survived the round-trip, byte-for-byte.
    expect(reimportedFlag!.options).toEqual({ default: false });
  });

  it('imports a legacy bundle (no unique field) with ENTRY_TITLE/SLUG implicit-true', async () => {
    // Simulates a bundle exported by an older version of the CMS that
    // didn't carry `unique`. ENTRY_TITLE and SLUG must still come in
    // as unique=true; everything else defaults to false.
    await reset();
    const legacyBundle = {
      version: 2,
      exportedAt: '2026-04-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'LegacyType',
          name: 'Legacy',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              order: 0,
              options: null,
            },
            {
              id: null,
              identifier: 'slug',
              name: 'Slug',
              type: FIELD_TYPES.SLUG,
              required: false,
              order: 1,
              options: null,
            },
            {
              id: null,
              identifier: 'note',
              name: 'Note',
              type: FIELD_TYPES.TEXT,
              required: false,
              order: 2,
              options: null,
            },
          ],
        },
      ],
    };

    await importBundle(prisma, legacyBundle, { mode: 'schema' });

    const title = await prisma.contentTypeField.findFirst({
      where: { identifier: 'title' },
    });
    const slug = await prisma.contentTypeField.findFirst({
      where: { identifier: 'slug' },
    });
    const note = await prisma.contentTypeField.findFirst({
      where: { identifier: 'note' },
    });
    expect(title?.unique).toBe(true);
    expect(slug?.unique).toBe(true);
    expect(note?.unique).toBe(false);
  });
});
