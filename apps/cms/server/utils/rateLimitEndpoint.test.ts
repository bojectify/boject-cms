import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { H3Event } from 'h3';
import {
  enforceGraphqlRateLimit,
  getGraphqlMax,
  RATE_LIMIT_SUGGESTIONS,
  buildRateLimitedBody,
  buildRateLimitedExtensions,
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

describe('enforceGraphqlRateLimit', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('honours the configured cap and throws 429 with Retry-After when exceeded', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '5');
    const { event, headers } = makeMockEvent();

    for (let i = 0; i < 5; i++) {
      expect(() => enforceGraphqlRateLimit(event, 'key-1')).not.toThrow();
    }

    let thrown: unknown;
    try {
      enforceGraphqlRateLimit(event, 'key-1');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ statusCode: 429 });
    expect(headers.get('retry-after')).toBeDefined();
  });

  it('keeps independent buckets per apiKeyId', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '3');
    const { event } = makeMockEvent();

    for (let i = 0; i < 3; i++) {
      enforceGraphqlRateLimit(event, 'key-a');
    }
    expect(() => enforceGraphqlRateLimit(event, 'key-a')).toThrow();
    expect(() => enforceGraphqlRateLimit(event, 'key-b')).not.toThrow();
  });

  it('lets traffic resume after the 1-second window expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-28T12:00:00.000Z'));
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '2');
    const { event } = makeMockEvent();

    enforceGraphqlRateLimit(event, 'key-1');
    enforceGraphqlRateLimit(event, 'key-1');
    expect(() => enforceGraphqlRateLimit(event, 'key-1')).toThrow();

    // Advance past the 1s window
    vi.advanceTimersByTime(1_100);
    expect(() => enforceGraphqlRateLimit(event, 'key-1')).not.toThrow();
  });

  it('falls back to 1000 cap when env var is unset', () => {
    vi.stubEnv('GRAPHQL_RATE_LIMIT_RPS', '');
    const { event } = makeMockEvent();
    for (let i = 0; i < 1000; i++) {
      enforceGraphqlRateLimit(event, 'key-default');
    }
    expect(() => enforceGraphqlRateLimit(event, 'key-default')).toThrow();
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
