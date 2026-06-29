import { assertUuid } from '../../../utils/validation';
import { assertApiKeyScope } from '../../../utils/assertApiKeyScope';
import { enforcePublicWriteRateLimit } from '../../../utils/publicWriteRateLimit';
import { deleteEntry } from '../../../utils/deleteEntry';

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'content:write');
  enforcePublicWriteRateLimit(event);
  const id = assertUuid(getRouterParam(event, 'id'), 'id');

  const existing = await prisma.contentEntry.findUnique({
    where: { id },
    include: {
      versions: true,
      contentType: { select: { id: true, identifier: true } },
    },
  });
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Content entry not found' });
  }

  await deleteEntry(existing);
  setResponseStatus(event, 204);
  return null;
});
