import type { Prisma } from '#prisma';
import { assertUuid } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';
import { assertUniqueFieldValues } from '../../utils/assertUniqueFieldValues';
import { enrichEntryDataWithEmbedIdentifiers } from '../../utils/enrichRichtextEmbeds';
import {
  flattenEntryWithVersion,
  getPublishedVersion,
  isCmsRequest,
} from '../../utils/resolveVersion';
import { slugify } from '../../../utils/slugify';

const VALID_STATUSES = new Set<string>([
  'DRAFT',
  'PUBLISHED',
  'CHANGED',
  'ARCHIVED',
]);

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

  let status = 'DRAFT';
  if (typeof body.status === 'string' && VALID_STATUSES.has(body.status)) {
    status = body.status;
  }

  const created = await withPrismaErrors(
    () =>
      prisma.contentEntry.create({
        data: {
          contentTypeId,
          entryTitle,
          entryKey,
          slug,
          versions: {
            create: {
              data: enrichedData as Prisma.InputJsonValue,
              entryTitle,
              status: status as 'DRAFT',
              publishedAt: status === 'PUBLISHED' ? new Date() : undefined,
            },
          },
        },
        include: { versions: true },
      }),
    {
      uniqueMessage:
        'An entry with this slug, title, or entryKey already exists for this content type',
    }
  );

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
