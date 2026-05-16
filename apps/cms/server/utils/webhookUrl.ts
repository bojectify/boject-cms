import { createError } from 'h3';
import { isIP } from 'node:net';
import {
  resolvePublicHost,
  WebhookDnsError,
  type DnsErrorReason,
} from './resolvePublicHost';
import { isPrivateHost } from './isPrivateHost';

export async function assertWebhookUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'url must be a valid URL',
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw createError({
      statusCode: 400,
      statusMessage: 'url must use http(s)',
    });
  }

  const allowPrivate =
    process.env.NODE_ENV !== 'production' ||
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS === 'true';
  if (!allowPrivate && isPrivateHost(url.hostname)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'url must not resolve to a private network host',
    });
  }

  if (allowPrivate || isIP(url.hostname) > 0) {
    return url;
  }

  try {
    await resolvePublicHost(url.hostname);
  } catch (err) {
    if (err instanceof WebhookDnsError) {
      throw createError({
        statusCode: 400,
        statusMessage: messageForDnsError(err.reason),
      });
    }
    throw err;
  }

  return url;
}

function messageForDnsError(reason: DnsErrorReason): string {
  switch (reason) {
    case 'PRIVATE_IP':
      return 'url must not resolve to a private network host';
    case 'NXDOMAIN':
      return 'url hostname could not be resolved';
    case 'TIMEOUT':
      return 'url hostname resolution timed out';
  }
}
