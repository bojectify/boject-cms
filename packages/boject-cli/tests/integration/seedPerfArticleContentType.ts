import type { PrismaClient } from '../../../../apps/cms/generated/prisma/client.js';
import { FIELD_TYPES } from '../../src/vendor/fieldTypes.js';

export interface PerfArticleSeedResult {
  contentTypeId: string;
  fieldIds: Record<'entryTitle' | 'slug' | 'body' | 'publishDate', string>;
}

/**
 * Idempotently seeds a `PerfArticle` content type with the field shape
 * used by the perf CLI's generated seed data. Returns the IDs so callers
 * can join against them if needed.
 *
 * NOT a real schema-apply — this skips applySchema's plan/validate cycle
 * and inserts ContentType + ContentTypeField rows directly. The writeViaSql
 * integration test only needs the rows to exist; applySchema correctness
 * is covered by apps/cms/scripts/content-bundle/applySchema.test.ts.
 */
export async function seedPerfArticleContentType(
  prisma: PrismaClient
): Promise<PerfArticleSeedResult> {
  const existing = await prisma.contentType.findUnique({
    where: { identifier: 'PerfArticle' },
    include: { fields: true },
  });
  if (existing) {
    const fieldIds = buildFieldIdMap(existing.fields);
    return { contentTypeId: existing.id, fieldIds };
  }

  const created = await prisma.contentType.create({
    data: {
      name: 'Perf Article',
      identifier: 'PerfArticle',
      description: 'Perf-test content type seeded by CLI integration tests.',
      fields: {
        create: [
          {
            identifier: 'entryTitle',
            name: 'Title',
            type: FIELD_TYPES.ENTRY_TITLE,
            required: true,
            unique: true,
            order: 0,
          },
          {
            identifier: 'slug',
            name: 'Slug',
            type: FIELD_TYPES.SLUG,
            required: false,
            unique: true,
            order: 1,
          },
          {
            identifier: 'body',
            name: 'Body',
            type: FIELD_TYPES.TEXT,
            required: false,
            unique: false,
            order: 2,
          },
          {
            identifier: 'publishDate',
            name: 'Publish Date',
            type: FIELD_TYPES.DATETIME,
            required: false,
            unique: false,
            order: 3,
          },
        ],
      },
    },
    include: { fields: true },
  });

  return {
    contentTypeId: created.id,
    fieldIds: buildFieldIdMap(created.fields),
  };
}

function buildFieldIdMap(
  fields: Array<{ identifier: string; id: string }>
): PerfArticleSeedResult['fieldIds'] {
  const byId = Object.fromEntries(fields.map((f) => [f.identifier, f.id]));
  return {
    entryTitle: byId.entryTitle,
    slug: byId.slug,
    body: byId.body,
    publishDate: byId.publishDate,
  };
}
