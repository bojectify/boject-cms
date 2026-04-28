import { describe, it, expect, afterEach, vi } from 'vitest';
import { getGraphqlMax } from './rateLimitEndpoint';

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
});
