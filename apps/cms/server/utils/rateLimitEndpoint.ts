import type { H3Event } from 'h3';
import { setResponseHeader, createError } from 'h3';
import { rateLimit, type RateLimitSnapshot } from './rateLimit';
import { getClientIp } from './clientIp';

const MUTATION_MAX = 50;
const MUTATION_WINDOW_MS = 60_000;
const GRAPHQL_DEFAULT_MAX = 1000;
const GRAPHQL_WINDOW_MS = 1_000;

/**
 * Apply a per-IP, per-endpoint sliding-window rate limit for mutating
 * requests. Throws a 429 with the structured RATE_LIMITED body if the
 * limit is exceeded.
 */
export function enforceMutationRateLimit(event: H3Event, endpoint: string) {
  const ip = getClientIp(event);
  const key = `mut:${endpoint}:${ip}`;
  const { allowed, retryAfterMs } = rateLimit(
    key,
    MUTATION_MAX,
    MUTATION_WINDOW_MS
  );
  if (!allowed) {
    throwRateLimited(event, 'mutation', retryAfterMs);
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
 * Per-API-key sliding-window rate limit on /api/graphql.
 * Threshold defaults to 1000 RPS, override via GRAPHQL_RATE_LIMIT_RPS.
 * Returns {allowed,retryAfterMs} — callers construct the GraphQL-shaped
 * error envelope themselves so the response uses HTTP 429 with the
 * canonical `errors[]` body rather than h3's default error JSON.
 *
 * The bucket is in-process. In horizontally-scaled deployments the
 * effective cap is N × replicas; use a shared rate limiter (Redis /
 * postgres / external gateway) when scaling beyond one process.
 */
export function checkGraphqlRateLimit(apiKeyId: string): RateLimitSnapshot {
  return rateLimit(`gql:${apiKeyId}`, getGraphqlMax(), GRAPHQL_WINDOW_MS);
}

/**
 * Write rate-limit observability headers in both IETF (RateLimit-*) and
 * legacy (X-RateLimit-*) form. Called from /api/graphql on both 200 and
 * 429 paths so consumers can pace themselves before they trip the limit.
 */
export function setRateLimitHeaders(
  event: H3Event,
  snapshot: RateLimitSnapshot
): void {
  setResponseHeader(event, 'RateLimit-Limit', snapshot.limit);
  setResponseHeader(event, 'RateLimit-Remaining', snapshot.remaining);
  setResponseHeader(event, 'RateLimit-Reset', snapshot.resetSeconds);
  setResponseHeader(event, 'X-RateLimit-Limit', snapshot.limit);
  setResponseHeader(event, 'X-RateLimit-Remaining', snapshot.remaining);
  setResponseHeader(event, 'X-RateLimit-Reset', snapshot.resetSeconds);
}

export type RateLimitKind =
  | 'graphql'
  | 'mutation'
  | 'login'
  | 'password'
  | 'transform'
  | 'search'
  | 'public';

export const RATE_LIMIT_SUGGESTIONS: Record<RateLimitKind, string> = {
  graphql:
    'Honour Retry-After and back off. Sustained traffic above the per-key cap is throttled; batch where possible.',
  mutation:
    'Realistic write workloads must back off rather than retry tight. The write limit guards content endpoints from runaway clients.',
  login:
    'Wait before retrying. Repeated 429s on login usually indicate a credential problem rather than congestion.',
  password:
    'Wait before retrying. The password endpoint is heavily rate-limited per IP to deter brute-force.',
  transform:
    'Honour Retry-After. Cache transformed images at your edge; the public transform endpoint is not designed for hot-path serving.',
  search: 'Slow your search request rate, or cache results client-side.',
  public:
    'Honour Retry-After and cache responses at your edge — the public read API is cache-fronted, not built for un-cached hot-path polling.',
};

export interface RateLimitedBody {
  error: 'RATE_LIMITED';
  message: 'Too many requests';
  retryAfter: number;
  suggestion: string;
}

export interface RateLimitedExtensions {
  code: 'RATE_LIMITED';
  retryAfter: number;
  suggestion: string;
}

export function buildRateLimitedBody(
  kind: RateLimitKind,
  retryAfterMs: number
): RateLimitedBody {
  return {
    error: 'RATE_LIMITED',
    message: 'Too many requests',
    retryAfter: Math.ceil(retryAfterMs / 1000),
    suggestion: RATE_LIMIT_SUGGESTIONS[kind],
  };
}

export function buildRateLimitedExtensions(
  kind: RateLimitKind,
  retryAfterMs: number
): RateLimitedExtensions {
  return {
    code: 'RATE_LIMITED',
    retryAfter: Math.ceil(retryAfterMs / 1000),
    suggestion: RATE_LIMIT_SUGGESTIONS[kind],
  };
}

export function throwRateLimited(
  event: H3Event,
  kind: RateLimitKind,
  retryAfterMs: number
): never {
  setResponseHeader(event, 'Retry-After', Math.ceil(retryAfterMs / 1000));
  throw createError({
    statusCode: 429,
    statusMessage: 'Too many requests',
    data: buildRateLimitedBody(kind, retryAfterMs),
  });
}
