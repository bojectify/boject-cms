import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { applySchema } from './applySchema';
import * as snapshotModule from './snapshotCurrentSchema';
import * as schemaModule from '../../server/graphql/schema';
import type { Bundle } from './types';
import { getTestDatabaseUrl } from '../../test/dbUrl';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { CONTENT_STATUSES } from '../../utils/contentStatus';
import {
  articleWithTitleAndSlug,
  articleRenamedWithTitle,
  articleWithTitleAndTagline,
  articleTitleOnly,
  postWithUpdatedSelect,
  articleWithRequiredTagline,
  authorAndArticleWithRelation,
  authorAndArticleWithResolvedRelation,
  tagAndArticleWithMultirelation,
  articleRenamedTitleOnly,
  newTypeBundle,
  dryRunArticleBundle,
  blockedDryRunBundle,
  articleWithFieldDefaults,
  articleRequiredBooleanNoDefault,
  articleWithReservedField,
} from './applySchema.integration.fixtures';
import { SchemaApplyValidationError } from './applySchemaErrors';

const url = getTestDatabaseUrl();
const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

async function reset() {
  await prisma.contentEntry.deleteMany();
  await prisma.contentTypeField.deleteMany();
  await prisma.contentType.deleteMany();
}

const emptyBundle: Bundle = {
  version: 2,
  exportedAt: '2026-05-01T00:00:00.000Z',
  portable: true,
  contentTypes: [],
};

describe('applySchema', () => {
  beforeEach(async () => {
    await reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  describe('happy path — no-op', () => {
    it('returns changed=false for an empty bundle on an empty DB', async () => {
      const result = await applySchema(prisma, emptyBundle);
      expect(result.changed).toBe(false);
      expect(result.applied).toEqual({
        contentTypesCreated: 0,
        contentTypesUpdated: 0,
        contentTypesRemoved: 0,
        fieldsCreated: 0,
        fieldsUpdated: 0,
        fieldsRemoved: 0,
      });
      expect(result.plan.contentTypes.create).toEqual([]);
      expect(result.plan.blockers).toEqual([]);
    });
  });

  describe('validateBundle integration', () => {
    it('throws SchemaApplyValidationError on a malformed bundle, no transaction opened', async () => {
      const malformedBundle = {
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [
          {
            id: null,
            identifier: 'Article',
            name: 'Article',
            description: null,
            // No fields array → validateBundle rejects "fields must be an array"
          },
        ],
      } as Bundle;

      await expect(applySchema(prisma, malformedBundle)).rejects.toThrow(
        /Bundle validation failed/
      );
      await expect(applySchema(prisma, malformedBundle)).rejects.toMatchObject({
        code: 'BUNDLE_INVALID',
      });
    });

    it('throws SchemaApplyValidationError for a required BOOLEAN with no default, DB unchanged (#344)', async () => {
      await expect(
        applySchema(prisma, articleRequiredBooleanNoDefault)
      ).rejects.toThrow(/required BOOLEAN/i);
      await expect(
        applySchema(prisma, articleRequiredBooleanNoDefault)
      ).rejects.toMatchObject({ code: 'BUNDLE_INVALID' });

      // Rejected before the transaction — nothing was created.
      expect(await prisma.contentType.count()).toBe(0);
    });

    it('rejects a bundle field with a reserved identifier', async () => {
      await expect(
        applySchema(prisma, articleWithReservedField, {})
      ).rejects.toThrow(SchemaApplyValidationError);

      // Rejected before the transaction — nothing was created.
      expect(await prisma.contentType.count()).toBe(0);
    });
  });

  describe('blocker handling — refuses before mutating', () => {
    it('throws SchemaApplyBlockedError on a blocker, DB unchanged', async () => {
      // Seed a content type with an entry. An empty bundle would try to
      // remove it, which is blocked even with allowDestructive.
      const ct = await prisma.contentType.create({
        data: {
          identifier: 'Locked',
          name: 'Locked',
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
            ],
          },
        },
      });
      await prisma.contentEntry.create({
        data: {
          contentTypeId: ct.id,
          entryTitle: 'X',
          entryKey: 'x',
          slug: 'x',
          versions: {
            create: {
              data: { title: 'X' },
              entryTitle: 'X',
              status: CONTENT_STATUSES.PUBLISHED,
            },
          },
        },
      });

      await expect(
        applySchema(prisma, emptyBundle, { allowDestructive: true })
      ).rejects.toMatchObject({
        code: 'SCHEMA_APPLY_BLOCKED',
      });

      // DB unchanged — content type still exists.
      const stillThere = await prisma.contentType.findUnique({
        where: { identifier: 'Locked' },
      });
      expect(stillThere).not.toBeNull();
    });

    it('blocker error carries the blockers array and the plan', async () => {
      await prisma.contentType.create({
        data: {
          identifier: 'WithEntries',
          name: 'WithEntries',
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
            ],
          },
        },
      });
      await prisma.contentEntry.create({
        data: {
          contentTypeId: (
            await prisma.contentType.findUniqueOrThrow({
              where: { identifier: 'WithEntries' },
            })
          ).id,
          entryTitle: 'X',
          entryKey: 'x',
          slug: 'x',
          versions: {
            create: {
              data: { title: 'X' },
              entryTitle: 'X',
              status: CONTENT_STATUSES.PUBLISHED,
            },
          },
        },
      });

      try {
        await applySchema(prisma, emptyBundle);
        throw new Error('expected applySchema to throw');
      } catch (e) {
        const err = e as { code: string; blockers: unknown[]; plan: unknown };
        expect(err.code).toBe('SCHEMA_APPLY_BLOCKED');
        expect(err.blockers.length).toBeGreaterThan(0);
        expect(err.plan).toBeDefined();
      }
    });
  });

  describe('happy path — pass 1 (types)', () => {
    it('creates a new content type from an empty DB, with its fields embedded', async () => {
      const result = await applySchema(prisma, articleWithTitleAndSlug);
      expect(result.changed).toBe(true);
      expect(result.applied.contentTypesCreated).toBe(1);

      const ct = await prisma.contentType.findUnique({
        where: { identifier: 'Article' },
        include: { fields: true },
      });
      expect(ct).not.toBeNull();
      expect(ct!.name).toBe('Article');
      expect(ct!.description).toBe('Blog article');
      expect(ct!.fields).toHaveLength(2);
      expect(ct!.fields.find((f) => f.identifier === 'title')!.unique).toBe(
        true
      );
      expect(ct!.fields.find((f) => f.identifier === 'slug')!.unique).toBe(
        true
      );
    });

    it('updates a content type display name (identifier unchanged)', async () => {
      await prisma.contentType.create({
        data: {
          identifier: 'Article',
          name: 'Old Name',
          description: null,
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
            ],
          },
        },
      });

      const result = await applySchema(prisma, articleRenamedWithTitle);
      expect(result.changed).toBe(true);
      expect(result.applied.contentTypesUpdated).toBe(1);

      const ct = await prisma.contentType.findUnique({
        where: { identifier: 'Article' },
      });
      expect(ct!.name).toBe('New Name');
      expect(ct!.description).toBe('Renamed');
    });
  });

  describe('happy path — pass 1 removes', () => {
    it('removes an empty content type with allowDestructive', async () => {
      await prisma.contentType.create({
        data: {
          identifier: 'Stale',
          name: 'Stale',
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
            ],
          },
        },
      });

      const result = await applySchema(prisma, emptyBundle, {
        allowDestructive: true,
      });
      expect(result.changed).toBe(true);
      expect(result.applied.contentTypesRemoved).toBe(1);

      const gone = await prisma.contentType.findUnique({
        where: { identifier: 'Stale' },
      });
      expect(gone).toBeNull();
    });
  });

  describe('happy path — pass 2 (field creates)', () => {
    it('adds a field to an existing content type', async () => {
      await prisma.contentType.create({
        data: {
          identifier: 'Article',
          name: 'Article',
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
            ],
          },
        },
      });

      const result = await applySchema(prisma, articleWithTitleAndTagline);
      expect(result.changed).toBe(true);
      expect(result.applied.fieldsCreated).toBe(1);

      const tagline = await prisma.contentTypeField.findFirst({
        where: { identifier: 'tagline' },
      });
      expect(tagline).not.toBeNull();
      expect(tagline!.type).toBe(FIELD_TYPES.TEXT);
    });
  });

  describe('happy path — pass 2 (field updates)', () => {
    it('updates a field name and order', async () => {
      await prisma.contentType.create({
        data: {
          identifier: 'Article',
          name: 'Article',
          fields: {
            create: [
              {
                identifier: 'title',
                name: 'Old Title',
                type: FIELD_TYPES.ENTRY_TITLE,
                required: true,
                unique: true,
                order: 5,
              },
            ],
          },
        },
      });

      const result = await applySchema(prisma, articleTitleOnly);
      expect(result.changed).toBe(true);
      expect(result.applied.fieldsUpdated).toBe(1);

      const f = await prisma.contentTypeField.findFirst({
        where: { identifier: 'title' },
      });
      expect(f!.name).toBe('Title');
      expect(f!.order).toBe(0);
    });

    it('updates a SELECT field options when a choice is added', async () => {
      await prisma.contentType.create({
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
                unique: true,
                order: 0,
              },
              {
                identifier: 'category',
                name: 'Category',
                type: FIELD_TYPES.SELECT,
                required: false,
                unique: false,
                order: 1,
                options: { choices: ['news'] },
              },
            ],
          },
        },
      });

      const result = await applySchema(prisma, postWithUpdatedSelect);
      expect(result.changed).toBe(true);
      expect(result.applied.fieldsUpdated).toBe(1);

      const f = await prisma.contentTypeField.findFirst({
        where: { identifier: 'category' },
      });
      expect((f!.options as { choices: string[] }).choices).toEqual([
        'news',
        'opinion',
      ]);
    });

    it('updates required false → true when no entries have null', async () => {
      const ct = await prisma.contentType.create({
        data: {
          identifier: 'Article',
          name: 'Article',
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
                identifier: 'tagline',
                name: 'Tagline',
                type: FIELD_TYPES.TEXT,
                required: false,
                unique: false,
                order: 1,
              },
            ],
          },
        },
      });
      // Seed an entry whose tagline is set, so required: true is safe.
      await prisma.contentEntry.create({
        data: {
          contentTypeId: ct.id,
          entryTitle: 'A',
          entryKey: 'a',
          slug: 'a',
          versions: {
            create: {
              data: { title: 'A', tagline: 'Hello' },
              entryTitle: 'A',
              status: CONTENT_STATUSES.PUBLISHED,
            },
          },
        },
      });

      const result = await applySchema(prisma, articleWithRequiredTagline);
      expect(result.applied.fieldsUpdated).toBe(1);

      const f = await prisma.contentTypeField.findFirst({
        where: { identifier: 'tagline' },
      });
      expect(f!.required).toBe(true);
    });
  });

  describe('happy path — pass 2 (field removes)', () => {
    it('removes a field with allowDestructive', async () => {
      await prisma.contentType.create({
        data: {
          identifier: 'Article',
          name: 'Article',
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
                identifier: 'oldField',
                name: 'Old',
                type: FIELD_TYPES.TEXT,
                required: false,
                unique: false,
                order: 1,
              },
            ],
          },
        },
      });

      const result = await applySchema(prisma, articleTitleOnly, {
        allowDestructive: true,
      });
      expect(result.changed).toBe(true);
      expect(result.applied.fieldsRemoved).toBe(1);

      const gone = await prisma.contentTypeField.findFirst({
        where: { identifier: 'oldField' },
      });
      expect(gone).toBeNull();
    });
  });

  describe('field defaults (#344)', () => {
    it('persists options.default on a fresh apply and is idempotent on re-apply', async () => {
      // First apply: creates Article with a BOOLEAN `flag` default false and a
      // NUMBER `qty` default 0. The defaults ride inside `options`.
      const first = await applySchema(prisma, articleWithFieldDefaults);
      expect(first.changed).toBe(true);
      expect(first.applied.contentTypesCreated).toBe(1);

      const flag = await prisma.contentTypeField.findFirst({
        where: { identifier: 'flag' },
      });
      const qty = await prisma.contentTypeField.findFirst({
        where: { identifier: 'qty' },
      });
      expect(flag!.options).toEqual({ default: false });
      expect(qty!.options).toEqual({ default: 0 });

      // Second apply of the SAME bundle: applySchema diffs `options`, so the
      // unchanged defaults make the re-apply a complete no-op (no field churn).
      const second = await applySchema(prisma, articleWithFieldDefaults);
      expect(second.changed).toBe(false);
      expect(second.applied.fieldsCreated).toBe(0);
      expect(second.applied.fieldsUpdated).toBe(0);
      expect(second.applied.fieldsRemoved).toBe(0);
    });
  });

  describe('two-pass ordering', () => {
    it('creates a content type and a RELATION field targeting it in one apply', async () => {
      // Article exists; Author is brand new; Article gets a RELATION field
      // targeting Author, all in one bundle.
      await prisma.contentType.create({
        data: {
          identifier: 'Article',
          name: 'Article',
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
            ],
          },
        },
      });

      const result = await applySchema(prisma, authorAndArticleWithRelation);
      expect(result.changed).toBe(true);
      expect(result.applied.contentTypesCreated).toBe(1);
      expect(result.applied.fieldsCreated).toBe(1);

      const authorField = await prisma.contentTypeField.findFirst({
        where: { identifier: 'author' },
      });
      expect(authorField).not.toBeNull();
      const opts = authorField!.options as {
        targetContentTypeIds?: string[];
        targetContentTypeIdentifiers?: string[];
      };
      // DB stores UUIDs, not identifiers — runtime (GraphQL, validation)
      // reads targetContentTypeIds. Identifiers belong only in bundles.
      expect(opts.targetContentTypeIdentifiers).toBeUndefined();
      expect(opts.targetContentTypeIds).toHaveLength(1);
      const authorType = await prisma.contentType.findUniqueOrThrow({
        where: { identifier: 'Author' },
      });
      expect(opts.targetContentTypeIds).toEqual([authorType.id]);
    });

    it('creates two content types that mutually relate in one apply', async () => {
      const result = await applySchema(prisma, authorAndArticleWithRelation);
      expect(result.applied.contentTypesCreated).toBe(2);
      // Both types created with their fields embedded (no separate
      // pass 2 entries — both rode along with pass 1).
      expect(result.applied.fieldsCreated).toBe(0);
    });

    it('is a no-op when the DB was seeded by importBundle and apply-schema runs against the same portable bundle', async () => {
      // Mirrors the smoke-test scenario: import-starter writes the
      // bundle (resolves identifiers → UUIDs), then apply-schema runs
      // against the same bundle. The second pass must not re-update
      // RELATION fields just because the DB stores UUIDs and the
      // bundle has identifiers.
      const { importBundle } = await import('./import');
      const bundle = authorAndArticleWithResolvedRelation;

      await importBundle(prisma, bundle, { mode: 'all', author: 'system' });

      const result = await applySchema(prisma, bundle);
      expect(result.changed).toBe(false);
      expect(result.applied.fieldsUpdated).toBe(0);
    });

    it('is a no-op on second apply of the same portable bundle (RELATION targets resolve identically)', async () => {
      const bundle = tagAndArticleWithMultirelation;

      const first = await applySchema(prisma, bundle);
      expect(first.changed).toBe(true);

      const second = await applySchema(prisma, bundle);
      expect(second.changed).toBe(false);
      expect(second.applied.fieldsUpdated).toBe(0);
    });
  });

  describe('concurrency — re-plan equality check', () => {
    it('throws SchemaChangedDuringApplyError when the snapshot changes between reads', async () => {
      await prisma.contentType.create({
        data: {
          identifier: 'Article',
          name: 'Article',
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
            ],
          },
        },
      });

      let callCount = 0;
      const realSnapshot = snapshotModule.snapshotCurrentSchema;
      const spy = vi.spyOn(snapshotModule, 'snapshotCurrentSchema');
      spy.mockImplementation(async (tx) => {
        callCount += 1;
        // Real snapshot for both calls — but inject a synthetic content
        // type into the second call's result so plansEqual returns false.
        const real = await realSnapshot(tx);
        if (callCount >= 2) {
          return {
            ...real,
            contentTypes: [
              ...real.contentTypes,
              {
                id: 'synthetic-id',
                identifier: 'InjectedType',
                name: 'Injected',
                description: null,
                fields: [],
                entryCount: 0,
              },
            ],
          };
        }
        return real;
      });

      await expect(
        applySchema(prisma, articleRenamedTitleOnly, {
          allowDestructive: true,
        })
      ).rejects.toMatchObject({ code: 'SCHEMA_CHANGED_DURING_APPLY' });

      spy.mockRestore();

      // DB unchanged — name should still be Article (the rename rolled back).
      const ct = await prisma.contentType.findUnique({
        where: { identifier: 'Article' },
      });
      expect(ct!.name).toBe('Article');
    });
  });

  describe('invalidateSchema integration', () => {
    it('does NOT call invalidateSchema on a no-op apply', async () => {
      const spy = vi.spyOn(schemaModule, 'invalidateSchema');
      spy.mockImplementation(() => {});

      const result = await applySchema(prisma, emptyBundle);
      expect(result.changed).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it('calls invalidateSchema once on a non-empty apply', async () => {
      const spy = vi.spyOn(schemaModule, 'invalidateSchema');
      spy.mockImplementation(() => {});

      const result = await applySchema(prisma, newTypeBundle);
      expect(result.changed).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('dryRun', () => {
    it('returns the plan and applied counts but rolls back the transaction', async () => {
      const result = await applySchema(prisma, dryRunArticleBundle, {
        dryRun: true,
      });

      expect(result.changed).toBe(true);
      expect(result.applied.contentTypesCreated).toBe(1);
      // Fields embedded in a new content type ride along with the
      // pass 1 create — they don't get counted under fieldsCreated
      // (which only tracks fields added to *existing* types in pass 2).
      expect(result.applied.fieldsCreated).toBe(0);

      const inDb = await prisma.contentType.findUnique({
        where: { identifier: 'DryRunArticle' },
      });
      expect(inDb).toBeNull(); // Transaction rolled back.
    });

    it('returns changed=false on a no-op without throwing', async () => {
      const result = await applySchema(prisma, emptyBundle, { dryRun: true });
      expect(result.changed).toBe(false);
    });

    it('still surfaces blockers in dryRun mode (no rollback needed because tx never started mutating)', async () => {
      // Apply once to seed.
      await applySchema(prisma, blockedDryRunBundle);
      // Seed an entry so removal is a destructive blocker.
      const ct = await prisma.contentType.findUniqueOrThrow({
        where: { identifier: 'BlockedDryRun' },
      });
      await prisma.contentEntry.create({
        data: {
          contentTypeId: ct.id,
          entryTitle: 'X',
          entryKey: 'x',
          slug: 'x',
          versions: {
            create: {
              data: { title: 'X' },
              entryTitle: 'X',
              status: CONTENT_STATUSES.PUBLISHED,
            },
          },
        },
      });

      await expect(
        applySchema(prisma, emptyBundle, { dryRun: true })
      ).rejects.toMatchObject({ code: 'SCHEMA_APPLY_BLOCKED' });
    });
  });
});
