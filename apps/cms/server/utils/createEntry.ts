import type { Prisma, ContentEntry, ContentEntryVersion } from '#prisma';
import { applyFieldDefaults } from './applyFieldDefaults';
import {
  validateAndEnrichEntryData,
  type WriteContentType,
} from './validateAndEnrichEntryData';
import { translatePrismaError } from './prismaErrors';
import { enqueueWebhookDeliveries, enqueueEntryDraftSync } from './webhooks';
import { slugify } from '../../utils/slugify';
import {
  CONTENT_STATUSES,
  type ContentStatusName,
} from '../../utils/contentStatus';

export async function createEntry(
  contentType: WriteContentType,
  rawData: Record<string, unknown>,
  opts: { status?: ContentStatusName } = {}
): Promise<ContentEntry & { versions: ContentEntryVersion[] }> {
  const status: ContentStatusName = opts.status ?? CONTENT_STATUSES.DRAFT;

  const dataWithDefaults = applyFieldDefaults(rawData, contentType.fields);
  const enrichedData = await validateAndEnrichEntryData(
    contentType,
    dataWithDefaults
  );

  const slug = extractSlug(enrichedData, contentType.fields);
  const entryTitle = extractEntryTitle(enrichedData, contentType.fields);

  const entryKey = slugify(entryTitle);
  if (entryKey === '') {
    throw createError({
      statusCode: 400,
      statusMessage: 'entryTitle contains no slug-safe characters',
      data: {
        error: 'ENTRY_KEY_EMPTY',
        message:
          'entryTitle must contain at least one alphanumeric character to derive an entryKey.',
      },
    });
  }

  const conflict = await prisma.contentEntry.findFirst({
    where: { contentTypeId: contentType.id, entryKey },
    select: { id: true, entryTitle: true },
  });
  if (conflict) {
    throw createError({
      statusCode: 409,
      statusMessage: 'entryKey conflict',
      data: {
        error: 'ENTRY_KEY_CONFLICT',
        entryKey,
        conflictingEntryId: conflict.id,
        conflictingEntryTitle: conflict.entryTitle,
        message: 'Adjust entryTitle to produce a different entryKey.',
      },
    });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const entry = await tx.contentEntry.create({
        data: {
          contentTypeId: contentType.id,
          entryTitle,
          entryKey,
          slug,
          versions: {
            create: {
              data: enrichedData as Prisma.InputJsonValue,
              entryTitle,
              status,
              publishedAt:
                status === CONTENT_STATUSES.PUBLISHED ? new Date() : undefined,
            },
          },
        },
        include: { versions: true },
      });

      if (status === CONTENT_STATUSES.PUBLISHED) {
        const version = entry.versions[0]!;
        await enqueueWebhookDeliveries(tx, {
          event: 'ENTRY_PUBLISHED',
          contentType: {
            id: contentType.id,
            identifier: contentType.identifier,
          },
          entry: {
            id: entry.id,
            entryTitle,
            slug,
            status: CONTENT_STATUSES.PUBLISHED,
            publishedAt: version.publishedAt,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            data: version.data,
          },
        });
      } else {
        await enqueueEntryDraftSync(tx, {
          contentType: { id: contentType.id },
          entryId: entry.id,
        });
      }

      return entry;
    });
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      const target = (err as { meta?: { target?: string[] | string } }).meta
        ?.target;
      const targets = Array.isArray(target)
        ? target
        : typeof target === 'string'
          ? [target]
          : [];
      if (targets.includes('entryKey')) {
        const raceConflict = await prisma.contentEntry.findFirst({
          where: { contentTypeId: contentType.id, entryKey },
          select: { id: true, entryTitle: true },
        });
        throw createError({
          statusCode: 409,
          statusMessage: 'entryKey conflict',
          data: {
            error: 'ENTRY_KEY_CONFLICT',
            entryKey,
            conflictingEntryId: raceConflict?.id ?? null,
            conflictingEntryTitle: raceConflict?.entryTitle ?? null,
            message: 'Adjust entryTitle to produce a different entryKey.',
          },
        });
      }
    }
    throw translatePrismaError(err, {
      uniqueMessage:
        'An entry with this slug, title, or entryKey already exists for this content type',
    });
  }
}
