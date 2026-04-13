import type { Prisma } from '#prisma';
import { assertUuid } from '../../utils/validation';
import { withPrismaErrors } from '../../utils/prismaErrors';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

const VALID_STATUSES = new Set<string>([
  'DRAFT',
  'PUBLISHED',
  'CHANGED',
  'ARCHIVED',
]);

export default defineEventHandler(async (event) => {
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
  const slug = extractSlug(validatedData, contentType.fields);

  let status = 'DRAFT';
  if (typeof body.status === 'string' && VALID_STATUSES.has(body.status)) {
    status = body.status;
  }

  const created = await withPrismaErrors(
    () =>
      prisma.contentEntry.create({
        data: {
          contentTypeId,
          data: validatedData as Prisma.InputJsonValue,
          slug,
          status: status as 'DRAFT',
          publishedAt: status === 'PUBLISHED' ? new Date() : undefined,
        },
      }),
    {
      uniqueMessage:
        'An entry with this slug already exists for this content type',
    }
  );

  setResponseStatus(event, 201);
  return created;
});
