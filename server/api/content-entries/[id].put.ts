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
  enforceMutationRateLimit(event, 'content-entries.put');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');
  const body = await readBody<Record<string, unknown>>(event);

  const existing = await prisma.contentEntry.findUnique({
    where: { id },
    include: { contentType: { include: { fields: true } } },
  });
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  const data: Record<string, unknown> = {};

  if (typeof body.data === 'object' && body.data !== null) {
    const rawData = body.data as Record<string, unknown>;
    const validatedData = await validateEntryData(
      rawData,
      existing.contentType.fields
    );
    data.data = validatedData;
    data.slug = extractSlug(validatedData, existing.contentType.fields);
  }

  if (typeof body.status === 'string' && VALID_STATUSES.has(body.status)) {
    data.status = body.status;
    if (body.status === 'PUBLISHED' && !existing.publishedAt) {
      data.publishedAt = new Date();
    }
  }

  return await withPrismaErrors(
    () => prisma.contentEntry.update({ where: { id }, data }),
    {
      uniqueMessage:
        'An entry with this slug already exists for this content type',
    }
  );
});
