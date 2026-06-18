import { assertUuid } from './validation';
import type { PrismaClient } from '#prisma';

/** Resolve a list endpoint's content-type filter from query params: accepts
 *  `contentTypeId` (UUID, wins if both) or `contentType` (PascalCase identifier).
 *  Returns the resolved UUID, or null if a given identifier doesn't exist
 *  (caller renders an empty page). Throws h3 400 if neither param is present. */
export async function resolveContentTypeIdParam(
  prisma: PrismaClient,
  query: Record<string, unknown>
): Promise<string | null> {
  if (
    typeof query.contentTypeId === 'string' &&
    query.contentTypeId.length > 0
  ) {
    return assertUuid(query.contentTypeId, 'contentTypeId');
  }
  if (typeof query.contentType === 'string' && query.contentType.length > 0) {
    const ct = await prisma.contentType.findUnique({
      where: { identifier: query.contentType },
      select: { id: true },
    });
    return ct?.id ?? null;
  }
  throw createError({
    statusCode: 400,
    statusMessage: 'contentType or contentTypeId is required',
  });
}

/** Public read surface: resolve the content type from the `contentType`
 *  IDENTIFIER only — the public contract never accepts an internal UUID as
 *  input. Returns the UUID, or null if the identifier doesn't exist (caller
 *  renders an empty page). Throws h3 400 if `contentType` is absent. */
export async function resolvePublicContentTypeId(
  prisma: PrismaClient,
  query: Record<string, unknown>
): Promise<string | null> {
  if (typeof query.contentType !== 'string' || query.contentType.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'contentType is required',
    });
  }
  const ct = await prisma.contentType.findUnique({
    where: { identifier: query.contentType },
    select: { id: true },
  });
  return ct?.id ?? null;
}
