import { assertUuid } from '../../utils/validation';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';
import { createEntry } from '../../utils/createEntry';
import {
  flattenEntryWithVersion,
  getPublishedVersion,
  isCmsRequest,
} from '../../utils/resolveVersion';
import {
  CONTENT_STATUSES,
  CONTENT_STATUS_NAMES,
  type ContentStatusName,
} from '../../../utils/contentStatus';

const VALID_STATUSES = new Set<string>(CONTENT_STATUS_NAMES);

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'content:write');
  enforceMutationRateLimit(event, 'entries.post');
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

  let status: ContentStatusName = CONTENT_STATUSES.DRAFT;
  if (typeof body.status === 'string' && VALID_STATUSES.has(body.status)) {
    status = body.status as ContentStatusName;
  }

  const created = await createEntry(contentType, rawData, { status });

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
