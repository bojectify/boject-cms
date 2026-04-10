import type { H3Event } from 'h3';
import { rateLimit } from './rateLimit';

const MUTATION_MAX = 30;
const MUTATION_WINDOW_MS = 60_000;

/**
 * Apply a per-IP, per-endpoint sliding-window rate limit for mutating
 * requests. Throws a 429 if the limit is exceeded.
 */
export function enforceMutationRateLimit(event: H3Event, endpoint: string) {
  const ip =
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ??
    event.node.req.socket.remoteAddress ??
    'unknown';
  const key = `mut:${endpoint}:${ip}`;
  const { allowed, retryAfterMs } = rateLimit(
    key,
    MUTATION_MAX,
    MUTATION_WINDOW_MS
  );
  if (!allowed) {
    setResponseHeader(event, 'Retry-After', Math.ceil(retryAfterMs / 1000));
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many requests',
    });
  }
}
