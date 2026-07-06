import type { H3Event } from 'h3';
import { rateLimit } from './rateLimit';
import { throwRateLimited } from './rateLimitEndpoint';
import { getClientIp } from './clientIp';

const WINDOW_MS = 60_000;

/**
 * Per-API-key (IP fallback) sliding-window limit for the public WRITE surface,
 * independent of the public READ counter so a bursty sync can't starve reads.
 * Default 120/min, override BOJECT_PUBLIC_WRITE_RATE_LIMIT_RPM. Reuses the
 * 'public' 429 shape.
 */
export function enforcePublicWriteRateLimit(event: H3Event): void {
  const apiKeyId = event.context.apiKeyId as string | undefined;
  const ip = getClientIp(event);
  const key = apiKeyId
    ? `public:write:key:${apiKeyId}`
    : `public:write:ip:${ip}`;
  const max = Number(process.env.BOJECT_PUBLIC_WRITE_RATE_LIMIT_RPM) || 120;
  const snapshot = rateLimit(key, max, WINDOW_MS);
  if (!snapshot.allowed)
    throwRateLimited(event, 'public', snapshot.retryAfterMs);
}
