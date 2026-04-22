import type { Prisma, ContentEntryVersion, FieldType } from '#prisma';
import { assertUuid } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { assertUniqueFieldValues } from '../../utils/assertUniqueFieldValues';
import { enqueueWebhookDeliveries } from '../../utils/webhooks';
import {
  isCmsRequest,
  getDraftVersion,
  getPublishedVersion,
  getVersionForContext,
  flattenEntryWithVersion,
} from '../../utils/resolveVersion';

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-entries.put');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: {
      versions: true,
      contentType: { include: { fields: true } },
    },
  });
  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  // Validate data if provided
  let validatedData: Record<string, unknown> | null = null;
  if (typeof body.data === 'object' && body.data !== null) {
    validatedData = await validateEntryData(
      body.data as Record<string, unknown>,
      entry.contentType.fields
    );
    await assertUniqueFieldValues(
      validatedData,
      entry.contentType.fields,
      entry.contentTypeId,
      entry.id
    );
  }

  const isPublish = body.status === 'PUBLISHED';

  if (isPublish) {
    await publishFlow(entry, validatedData);
  } else {
    await saveDraftFlow(entry, validatedData);
  }

  // Re-fetch the updated entry with versions
  const updated = await prisma.contentEntry.findUniqueOrThrow({
    where: { id },
    include: {
      versions: true,
      contentType: { include: { fields: { orderBy: { order: 'asc' } } } },
    },
  });

  const isCms = isCmsRequest(event);
  const version = getVersionForContext(updated.versions, isCms);
  if (!version) {
    throw createError({
      statusCode: 404,
      statusMessage: 'No visible version for this entry',
    });
  }

  const publishedVersion = getPublishedVersion(updated.versions);

  return flattenEntryWithVersion(updated, version, {
    contentType: updated.contentType,
    ...(isCms
      ? {
          hasPublishedVersion: publishedVersion !== null,
          publishedVersionPublishedAt: publishedVersion?.publishedAt ?? null,
        }
      : {}),
  });
});

type EntryWithVersionsAndType = NonNullable<
  Awaited<ReturnType<typeof prisma.contentEntry.findUnique>>
> & {
  versions: ContentEntryVersion[];
  contentType: {
    fields: Array<{
      id: string;
      identifier: string;
      name: string;
      type: FieldType;
      required: boolean;
      options: unknown;
      order: number;
    }>;
  };
};

/**
 * Save Draft Flow
 *
 * If a PUBLISHED version exists, upsert a CHANGED version.
 * If no PUBLISHED version exists, upsert a DRAFT version.
 * Update envelope slug/entryTitle if data changed.
 */
async function saveDraftFlow(
  entry: EntryWithVersionsAndType,
  validatedData: Record<string, unknown> | null
): Promise<void> {
  const publishedVersion = getPublishedVersion(entry.versions);
  const draftVersion = getDraftVersion(entry.versions);
  const targetStatus = publishedVersion ? 'CHANGED' : 'DRAFT';

  // Determine the data to save — use provided data or fall back to existing draft data
  const dataToSave =
    validatedData ?? (draftVersion?.data as Record<string, unknown> | null);
  if (!dataToSave) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No data provided and no existing draft to update',
    });
  }

  const entryTitle = extractEntryTitle(dataToSave, entry.contentType.fields);
  const slug = extractSlug(dataToSave, entry.contentType.fields);

  await withPrismaErrors(
    async () => {
      if (draftVersion) {
        // Update existing draft/changed version
        await prisma.contentEntryVersion.update({
          where: { id: draftVersion.id },
          data: {
            data: dataToSave as Prisma.InputJsonValue,
            entryTitle,
            status: targetStatus,
          },
        });
      } else {
        // Create a new draft/changed version
        await prisma.contentEntryVersion.create({
          data: {
            entryId: entry.id,
            data: dataToSave as Prisma.InputJsonValue,
            entryTitle,
            status: targetStatus,
          },
        });
      }

      // Update envelope slug and entryTitle for uniqueness constraint enforcement
      await prisma.contentEntry.update({
        where: { id: entry.id },
        data: { slug, entryTitle },
      });
    },
    {
      uniqueMessage:
        'An entry with this slug or title already exists for this content type',
    }
  );
}

/**
 * Publish Flow
 *
 * In a transaction:
 * 1. Delete old PUBLISHED version (to respect partial unique index)
 * 2. Promote existing draft to PUBLISHED, or create a new PUBLISHED version
 * Update envelope slug/entryTitle.
 */
async function publishFlow(
  entry: EntryWithVersionsAndType,
  validatedData: Record<string, unknown> | null
): Promise<void> {
  const publishedVersion = getPublishedVersion(entry.versions);
  const draftVersion = getDraftVersion(entry.versions);

  // Determine the data to publish
  const dataToPublish =
    validatedData ??
    (draftVersion?.data as Record<string, unknown> | null) ??
    (publishedVersion?.data as Record<string, unknown> | null);
  if (!dataToPublish) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No data provided and no existing version to publish',
    });
  }

  const entryTitle = extractEntryTitle(dataToPublish, entry.contentType.fields);
  const slug = extractSlug(dataToPublish, entry.contentType.fields);
  const now = new Date();
  // Preserve original publishedAt from the existing PUBLISHED version, or set now
  const publishedAt = publishedVersion?.publishedAt ?? now;

  await withPrismaErrors(
    () =>
      prisma.$transaction(async (tx) => {
        // Step 1: Delete old PUBLISHED version first (partial unique index)
        if (publishedVersion) {
          await tx.contentEntryVersion.delete({
            where: { id: publishedVersion.id },
          });
        }

        // Step 2: Promote draft or create new PUBLISHED version
        if (draftVersion) {
          await tx.contentEntryVersion.update({
            where: { id: draftVersion.id },
            data: {
              data: (validatedData ??
                draftVersion.data) as Prisma.InputJsonValue,
              entryTitle,
              status: 'PUBLISHED',
              publishedAt,
            },
          });
        } else {
          await tx.contentEntryVersion.create({
            data: {
              entryId: entry.id,
              data: dataToPublish as Prisma.InputJsonValue,
              entryTitle,
              status: 'PUBLISHED',
              publishedAt,
            },
          });
        }

        // Step 3: Update envelope slug and entryTitle
        await tx.contentEntry.update({
          where: { id: entry.id },
          data: { slug, entryTitle },
        });

        // Re-read the canonical published version inside this transaction so
        // the snapshot matches what consumers would see via GraphQL/REST.
        const published = await tx.contentEntryVersion.findFirstOrThrow({
          where: { entryId: entry.id, status: 'PUBLISHED' },
        });
        const ct = await tx.contentType.findUniqueOrThrow({
          where: { id: entry.contentTypeId },
          select: { id: true, identifier: true },
        });
        await enqueueWebhookDeliveries(tx, {
          event: 'ENTRY_PUBLISHED',
          contentType: ct,
          entry: {
            id: entry.id,
            entryTitle,
            slug,
            status: 'PUBLISHED',
            publishedAt: published.publishedAt,
            createdAt: entry.createdAt,
            updatedAt: new Date(),
            data: published.data,
          },
        });
      }),
    {
      uniqueMessage:
        'An entry with this slug or title already exists for this content type',
    }
  );
}
