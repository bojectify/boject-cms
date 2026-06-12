import { isCmsRequest } from '../../utils/resolveVersion';
import { enforceMutationRateLimit } from '../../utils/rateLimitEndpoint';
import { assertStringLength } from '../../utils/validation';
import { assertWebhookUrl } from '../../utils/webhookUrl';
import { generateWebhookSecret } from '../../utils/webhooks';
import { isExternalWebhookEventName } from '../../../utils/webhookEvents';

export default defineEventHandler(async (event) => {
  if (!isCmsRequest(event)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Webhook management requires a CMS session',
    });
  }
  enforceMutationRateLimit(event, 'webhooks.post');
  const body = await readBody<Record<string, unknown>>(event);

  const name = assertStringLength(body.name, 'name', 200);
  await assertWebhookUrl(typeof body.url === 'string' ? body.url : '');
  const url = body.url as string;

  if (!Array.isArray(body.events) || body.events.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'events must be a non-empty array',
    });
  }
  const events = body.events.map((e, i) => {
    if (!isExternalWebhookEventName(e)) {
      throw createError({
        statusCode: 400,
        statusMessage: `events[${i}] is not a valid WebhookEvent`,
      });
    }
    return e;
  });

  const contentTypeIds = Array.isArray(body.contentTypeIds)
    ? body.contentTypeIds.map((id, i) => {
        if (typeof id !== 'string') {
          throw createError({
            statusCode: 400,
            statusMessage: `contentTypeIds[${i}] must be a string`,
          });
        }
        return id;
      })
    : [];

  const enabled = typeof body.enabled === 'boolean' ? body.enabled : true;
  const secret = generateWebhookSecret();

  const created = await prisma.webhook.create({
    data: { name, url, secret, enabled, contentTypeIds, events },
  });

  setResponseStatus(event, 201);
  return { ...created };
});
