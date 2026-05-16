import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { H3Event } from 'h3';
import {
  checkGraphqlRateLimit,
  getGraphqlMax,
  RATE_LIMIT_SUGGESTIONS,
  buildRateLimitedBody,
  buildRateLimitedExtensions,
  throwRateLimited,
  setRateLimitHeaders,
  type RateLimitSnapshot,
} from './rateLimitEndpoint';
import { resetRateLimitStore } from './rateLimit';

type MockEvent = {
  headers: Map<string, string>;
  event: H3Event;
};

function makeMockEvent(): MockEvent {
  const headers = new Map<string, string>();
  const event = {
    node: {
      req: { headers: {} },
      res: {
        headersSent: false,
        setHeader(name: string, value: string | number | string[]) {
          headers.set(name.toLowerCase(), String(value));
        },
        getHeader(name: string) {
          return headers.get(name.toLowerCase());
        },
      },
    },
  } as unknown as H3Event;
  return { headers, event };
}

describe('getGraphqlMax', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 1000 when env var is unset', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '');
    expect(getGraphqlMax()).toBe(1000);
  });

  it('honours a positive integer env var', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '500');
    expect(getGraphqlMax()).toBe(500);
  });

  it('falls back to 1000 for non-numeric values', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', 'abc');
    expect(getGraphqlMax()).toBe(1000);
  });

  it('falls back to 1000 for zero or negative values', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '0');
    expect(getGraphqlMax()).toBe(1000);
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '-1');
    expect(getGraphqlMax()).toBe(1000);
  });

  it('falls back to 1000 for "NaN"', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', 'NaN');
    expect(getGraphqlMax()).toBe(1000);
  });

  it('parses scientific notation as an integer', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '1e3');
    expect(getGraphqlMax()).toBe(1000);
  });

  it('falls back to 1000 for fractional values', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '1.5');
    expect(getGraphqlMax()).toBe(1000);
  });

  it('falls back to 1000 for partial numeric values', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '500abc');
    expect(getGraphqlMax()).toBe(1000);
  });
});

describe('checkGraphqlRateLimit', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('returns allowed=true under the configured cap', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '5');
    for (let i = 0; i < 5; i++) {
      expect(checkGraphqlRateLimit('key-1').allowed).toBe(true);
    }
  });

  it('returns allowed=false with positive retryAfterMs when the cap is exceeded', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '5');
    for (let i = 0; i < 5; i++) {
      checkGraphqlRateLimit('key-1');
    }
    const result = checkGraphqlRateLimit('key-1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('keeps independent buckets per apiKeyId', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '3');
    for (let i = 0; i < 3; i++) {
      checkGraphqlRateLimit('key-a');
    }
    expect(checkGraphqlRateLimit('key-a').allowed).toBe(false);
    expect(checkGraphqlRateLimit('key-b').allowed).toBe(true);
  });

  it('lets traffic resume after the 1-second window expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-28T12:00:00.000Z'));
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '2');

    checkGraphqlRateLimit('key-1');
    checkGraphqlRateLimit('key-1');
    expect(checkGraphqlRateLimit('key-1').allowed).toBe(false);

    vi.advanceTimersByTime(1_100);
    expect(checkGraphqlRateLimit('key-1').allowed).toBe(true);
  });

  it('falls back to 1000 cap when env var is unset', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '');
    for (let i = 0; i < 1000; i++) {
      checkGraphqlRateLimit('key-default');
    }
    expect(checkGraphqlRateLimit('key-default').allowed).toBe(false);
  });
});

describe('RATE_LIMIT_SUGGESTIONS', () => {
  it('exposes a non-empty string for every kind', () => {
    for (const kind of [
      'graphql',
      'mutation',
      'login',
      'password',
      'transform',
    ] as const) {
      expect(RATE_LIMIT_SUGGESTIONS[kind]).toEqual(expect.any(String));
      expect(RATE_LIMIT_SUGGESTIONS[kind].length).toBeGreaterThan(0);
    }
  });
});

describe('buildRateLimitedBody', () => {
  it('returns the RATE_LIMITED body with seconds-rounded retryAfter', () => {
    expect(buildRateLimitedBody('login', 6_500)).toEqual({
      error: 'RATE_LIMITED',
      message: 'Too many requests',
      retryAfter: 7,
      suggestion: RATE_LIMIT_SUGGESTIONS.login,
    });
  });

  it('rounds 0ms up to 0 seconds', () => {
    expect(buildRateLimitedBody('mutation', 0).retryAfter).toBe(0);
  });

  it('rounds 1ms up to 1 second', () => {
    expect(buildRateLimitedBody('mutation', 1).retryAfter).toBe(1);
  });

  it('picks the right suggestion per kind', () => {
    expect(buildRateLimitedBody('graphql', 1000).suggestion).toBe(
      RATE_LIMIT_SUGGESTIONS.graphql
    );
    expect(buildRateLimitedBody('transform', 1000).suggestion).toBe(
      RATE_LIMIT_SUGGESTIONS.transform
    );
  });
});

describe('buildRateLimitedExtensions', () => {
  it('returns the GraphQL extensions shape', () => {
    expect(buildRateLimitedExtensions('graphql', 2_400)).toEqual({
      code: 'RATE_LIMITED',
      retryAfter: 3,
      suggestion: RATE_LIMIT_SUGGESTIONS.graphql,
    });
  });
});

describe('throwRateLimited', () => {
  it('sets Retry-After header and throws a 429 with the structured body', () => {
    const { event, headers } = makeMockEvent();

    let thrown: unknown;
    try {
      throwRateLimited(event, 'mutation', 4_200);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toMatchObject({
      statusCode: 429,
      statusMessage: 'Too many requests',
      data: {
        error: 'RATE_LIMITED',
        message: 'Too many requests',
        retryAfter: 5,
        suggestion: RATE_LIMIT_SUGGESTIONS.mutation,
      },
    });
    expect(headers.get('retry-after')).toBe('5');
  });

  it('matches the kind passed in', () => {
    const { event } = makeMockEvent();
    let thrown: unknown;
    try {
      throwRateLimited(event, 'login', 1_000);
    } catch (err) {
      thrown = err;
    }
    expect((thrown as { data: { suggestion: string } }).data.suggestion).toBe(
      RATE_LIMIT_SUGGESTIONS.login
    );
  });
});

describe('checkGraphqlRateLimit (snapshot fields)', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes limit/remaining/resetSeconds alongside allowed/retryAfterMs', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '4');
    const r = checkGraphqlRateLimit('key-snap');
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(4);
    expect(r.remaining).toBe(3);
    expect(r.resetSeconds).toBeGreaterThan(0);
    expect(r.retryAfterMs).toBe(0);
  });
});

describe('setRateLimitHeaders', () => {
  it('writes IETF and legacy headers for every snapshot field', () => {
    const { event, headers } = makeMockEvent();
    const snapshot: RateLimitSnapshot = {
      allowed: true,
      limit: 1000,
      remaining: 873,
      resetSeconds: 1,
      retryAfterMs: 0,
    };
    setRateLimitHeaders(event, snapshot);
    expect(headers.get('ratelimit-limit')).toBe('1000');
    expect(headers.get('ratelimit-remaining')).toBe('873');
    expect(headers.get('ratelimit-reset')).toBe('1');
    expect(headers.get('x-ratelimit-limit')).toBe('1000');
    expect(headers.get('x-ratelimit-remaining')).toBe('873');
    expect(headers.get('x-ratelimit-reset')).toBe('1');
  });
});
