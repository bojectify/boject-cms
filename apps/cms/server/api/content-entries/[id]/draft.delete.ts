import { assertUuid } from '../../../utils/validation';
import { enforceMutationRateLimit } from '../../../utils/rateLimitEndpoint';
import { assertApiKeyScope } from '../../../utils/assertApiKeyScope';
import {
  getDraftVersion,
  getPublishedVersion,
  flattenEntryWithVersion,
} from '../../../utils/resolveVersion';

export default defineEventHandler(async (event) => {
  enforceMutationRateLimit(event, 'content-entries.draft.delete');
  assertApiKeyScope(event, 'content:write');
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const entry = await prisma.contentEntry.findUnique({
    where: { id },
    include: { versions: true },
  });
  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Content entry not found',
    });
  }

  const draft = getDraftVersion(entry.versions);
  if (!draft) {
    throw createError({
      statusCode: 404,
      statusMessage: 'No draft version to discard',
    });
  }

  const published = getPublishedVersion(entry.versions);
  if (!published) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Cannot discard the only version — delete the entry instead',
    });
  }

  await prisma.contentEntryVersion.delete({ where: { id: draft.id } });

  return flattenEntryWithVersion(entry, published);
});
