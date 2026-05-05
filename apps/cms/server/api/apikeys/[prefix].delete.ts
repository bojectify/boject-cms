import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
} from 'h3';
import { assertApiKeyScope } from '../../utils/assertApiKeyScope';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';

const PREFIX_PATTERN = /^boject_[a-f0-9]{4}$/;

export default defineEventHandler(async (event) => {
  assertApiKeyScope(event, 'apikey:write');
  enforceMutationRateLimit(event, 'apikey-revoke');

  const prefix = getRouterParam(event, 'prefix');
  if (!prefix || !PREFIX_PATTERN.test(prefix)) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'INVALID_PREFIX',
        message: 'Invalid prefix shape. Expected `boject_xxxx` (11 chars).',
      },
    });
  }

  const row = await prisma.apiKey.findFirst({
    where: { keyPrefix: prefix, revokedAt: null },
    select: { id: true },
  });
  if (!row) {
    throw createError({
      statusCode: 404,
      data: {
        error: 'APIKEY_NOT_FOUND',
        message: `No active API key found with prefix "${prefix}".`,
      },
    });
  }

  await prisma.apiKey.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
  });

  setResponseStatus(event, 204);
  return null;
});
