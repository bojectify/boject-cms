import { createHmac } from 'node:crypto';

/**
 * HMAC-SHA256 signature over `${timestamp}.${body}` using the webhook secret.
 * Returns lowercase hex. Callers emit as `X-Boject-Signature: sha256=<hex>`.
 */
export function signPayload(
  secret: string,
  timestampSeconds: number,
  body: string
): string {
  return createHmac('sha256', secret)
    .update(`${timestampSeconds}.${body}`)
    .digest('hex');
}
