import type { Prisma } from '#prisma';
import { assertUuid } from '../../utils/validation';
import { translatePrismaError } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';
import { assertUniqueFieldValues } from '../../utils/assertUniqueFieldValues';
import { enrichEntryDataWithEmbedIdentifiers } from '../../utils/enrichRichtextEmbeds';
import {
  enqueueWebhookDeliveries,
  enqueueEntryDraftSync,
} from '../../utils/webhooks';
import {
  flattenEntryWithVersion,
  getPublishedVersion,
  isCmsRequest,
} from '../../utils/resolveVersion';
import { slugify } from '../../../utils/slugify';
import {
  CONTENT_STATUSES,
  CONTENT_STATUS_NAMES,
  type ContentStatusName,
} from '../../../utils/contentStatus';

const VALID_STATUSES = new Set<string>(CONTENT_STATUS_NAMES);

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'content:write');
  enforceMutationRateLimit(event, 'content-entries.post');
  const body = await readBody<Record<string, unknown>>(event);

  const contentTypeId = assertUuid(body.contentTypeId, 'contentTypeId');

  const contentType = await prisma.contentType.findUnique({
    where: { id: contentTypeId },
    include: { fields: true },
  });
  if (!contentType) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content type not found',
    });
  }

  const rawData =
    typeof body.data === 'object' && body.data !== null
      ? (body.data as Record<string, unknown>)
      : {};

  const validatedData = await validateEntryData(rawData, contentType.fields);
  await assertUniqueFieldValues(
    validatedData,
    contentType.fields,
    contentTypeId
  );
  const enrichedData = await enrichEntryDataWithEmbedIdentifiers(
    validatedData,
    contentType.fields,
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
    where: { contentTypeId, entryKey },
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

  let status: ContentStatusName = CONTENT_STATUSES.DRAFT;
  if (typeof body.status === 'string' && VALID_STATUSES.has(body.status)) {
    status = body.status as ContentStatusName;
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const entry = await tx.contentEntry.create({
        data: {
          contentTypeId,
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

      // A brand-new entry published in one step must fire ENTRY_PUBLISHED too,
      // exactly like the PUT [id] publish path — otherwise the search-index
      // sync and external subscribers never see it (#330).
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
        // DRAFT entry: the search index hears this only via the internal trigger.
        await enqueueEntryDraftSync(tx, {
          contentType: { id: contentType.id },
          entryId: entry.id,
        });
      }

      return entry;
    });
  } catch (err) {
    // Race: another request inserted the same entryKey between our pre-check
    // and create. Surface the same structured 409 the pre-check would have.
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
          where: { contentTypeId, entryKey },
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

  setResponseStatus(event, 201);

  const isCms = isCmsRequest(event);
  const publishedVersion = getPublishedVersion(created.versions);

  return flattenEntryWithVersion(created, created.versions[0]!, {
    ...(isCms
      ? {
          hasPublishedVersion: publishedVersion !== null,
          publishedVersionPublishedAt: publishedVersion?.publishedAt ?? null,
        }
      : {}),
  });
});
