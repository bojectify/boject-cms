import type { H3Event } from 'h3';
import {
  setResponseHeader,
  createError,
  getRequestHeader,
  getRequestIP,
} from 'h3';
import { rateLimit } from './rateLimit';

const MUTATION_MAX = 50;
const MUTATION_WINDOW_MS = 60_000;
const GRAPHQL_DEFAULT_MAX = 1000;
const GRAPHQL_WINDOW_MS = 1_000;

/**
 * Apply a per-IP, per-endpoint sliding-window rate limit for mutating
 * requests. Throws a 429 if the limit is exceeded.
 */
export function enforceMutationRateLimit(event: H3Event, endpoint: string) {
  const ip =
    getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ||
    getRequestIP(event) ||
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

/**
 * Resolve the configured GraphQL rate-limit cap. Defaults to
 * GRAPHQL_DEFAULT_MAX when GRAPHQL_RATE_LIMIT_RPS is unset, empty, or
 * not a positive integer.
 */
export function getGraphqlMax(): number {
  const raw = process.env.GRAPHQL_RATE_LIMIT_RPS;
  // `!raw` covers undefined and empty string; the integer + positivity
  // checks below cover NaN, fractional, exponential-truncated, and
  // non-positive values. Silent fallback so an operator typo can't
  // crash the server.
  if (!raw) return GRAPHQL_DEFAULT_MAX;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return GRAPHQL_DEFAULT_MAX;
  return parsed;
}

/**
 * Apply a per-API-key sliding-window rate limit on /api/graphql.
 * Threshold defaults to 1000 RPS, override via GRAPHQL_RATE_LIMIT_RPS.
 * Throws a 429 with Retry-After if the limit is exceeded.
 */
export function enforceGraphqlRateLimit(event: H3Event, apiKeyId: string) {
  const { allowed, retryAfterMs } = rateLimit(
    `gql:${apiKeyId}`,
    getGraphqlMax(),
    GRAPHQL_WINDOW_MS
  );
  if (!allowed) {
    setResponseHeader(event, 'Retry-After', Math.ceil(retryAfterMs / 1000));
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many requests',
    });
  }
}
