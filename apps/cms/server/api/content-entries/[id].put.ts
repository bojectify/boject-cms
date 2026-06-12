import type { Prisma, ContentEntryVersion, FieldType } from '#prisma';
import { assertUuid } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';
import { assertUniqueFieldValues } from '../../utils/assertUniqueFieldValues';
import { enrichEntryDataWithEmbedIdentifiers } from '../../utils/enrichRichtextEmbeds';
import { enqueueEntryDraftSync } from '../../utils/webhooks';
import { publishEntry } from '../../utils/publishEntry';
import {
  isCmsRequest,
  getDraftVersion,
  getPublishedVersion,
  getVersionForContext,
  flattenEntryWithVersion,
} from '../../utils/resolveVersion';
import { CONTENT_STATUSES } from '../../../utils/contentStatus';

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'content:write');
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
    const rawValidated = await validateEntryData(
      body.data as Record<string, unknown>,
      entry.contentType.fields
    );
    await assertUniqueFieldValues(
      rawValidated,
      entry.contentType.fields,
      entry.contentTypeId,
      entry.id
    );
    validatedData = await enrichEntryDataWithEmbedIdentifiers(
      rawValidated,
      entry.contentType.fields,
      {
        loadIdentifiers: async (ids) => {
          const types = await prisma.contentType.findMany({
            where: { id: { in: ids } },
            select: { id: true, identifier: true },
          });
          return new Map(types.map((t) => [t.id, t.identifier] as const));
        },
      }
    );
  }

  const isPublish = body.status === CONTENT_STATUSES.PUBLISHED;

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
    id: string;
    identifier: string;
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
  const targetStatus = publishedVersion
    ? CONTENT_STATUSES.CHANGED
    : CONTENT_STATUSES.DRAFT;

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
    () =>
      prisma.$transaction(async (tx) => {
        if (draftVersion) {
          // Update existing draft/changed version
          await tx.contentEntryVersion.update({
            where: { id: draftVersion.id },
            data: {
              data: dataToSave as Prisma.InputJsonValue,
              entryTitle,
              status: targetStatus,
            },
          });
        } else {
          // Create a new draft/changed version
          await tx.contentEntryVersion.create({
            data: {
              entryId: entry.id,
              data: dataToSave as Prisma.InputJsonValue,
              entryTitle,
              status: targetStatus,
            },
          });
        }

        // Update envelope slug and entryTitle for uniqueness constraint enforcement
        await tx.contentEntry.update({
          where: { id: entry.id },
          data: { slug, entryTitle },
        });

        // DRAFT-side save: the search index hears this only via the internal trigger.
        await enqueueEntryDraftSync(tx, {
          contentType: { id: entry.contentType.id },
          entryId: entry.id,
        });
      }),
    {
      uniqueMessage:
        'An entry with this slug or title already exists for this content type',
    }
  );
}

/** Publish via the shared util (the PUT path supplies the request's validated data). */
async function publishFlow(
  entry: EntryWithVersionsAndType,
  validatedData: Record<string, unknown> | null
): Promise<void> {
  await publishEntry(entry, validatedData);
}
