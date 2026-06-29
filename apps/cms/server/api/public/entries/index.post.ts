import { assertUuid } from '../../../utils/validation';
import { assertApiKeyScope } from '../../../utils/assertApiKeyScope';
import { enforcePublicWriteRateLimit } from '../../../utils/publicWriteRateLimit';
import { createEntry } from '../../../utils/createEntry';
import { flattenEntryWithVersion } from '../../../utils/resolveVersion';
import { CONTENT_STATUSES } from '../../../../utils/contentStatus';

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'content:write');
  enforcePublicWriteRateLimit(event);

  const body = (await readBody<Record<string, unknown>>(event)) ?? {};
  const contentTypeId = assertUuid(body.contentTypeId, 'contentTypeId');

  const contentType = await prisma.contentType.findUnique({
    where: { id: contentTypeId },
    include: { fields: true },
  });
  if (!contentType) {
    throw createError({ statusCode: 404, statusMessage: 'Content type not found' });
  }

  const rawData =
    typeof body.data === 'object' && body.data !== null
      ? (body.data as Record<string, unknown>)
      : {};
  const status = body.publish === true ? CONTENT_STATUSES.PUBLISHED : CONTENT_STATUSES.DRAFT;

  const created = await createEntry(contentType, rawData, { status });
  setResponseStatus(event, 201);
  // Public surface is token-only ⇒ never CMS context ⇒ no draft-priority extras.
  return flattenEntryWithVersion(created, created.versions[0]!, {});
});
