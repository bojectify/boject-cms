import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEFAULT_GRAPHQL_COMPLEXITY_MAX_COST,
  getGraphqlComplexityMaxCost,
  isGraphqlComplexityLogOnly,
} from './graphqlComplexity';

describe('getGraphqlComplexityMaxCost', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns the default when env var is unset', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_MAX_COST', '');
    expect(getGraphqlComplexityMaxCost()).toBe(
      DEFAULT_GRAPHQL_COMPLEXITY_MAX_COST
    );
  });

  it('returns the parsed value when env var is a positive number', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_MAX_COST', '500');
    expect(getGraphqlComplexityMaxCost()).toBe(500);
  });

  it('falls back to default on non-numeric env var', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_MAX_COST', 'abc');
    expect(getGraphqlComplexityMaxCost()).toBe(
      DEFAULT_GRAPHQL_COMPLEXITY_MAX_COST
    );
  });

  it('falls back to default on zero', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_MAX_COST', '0');
    expect(getGraphqlComplexityMaxCost()).toBe(
      DEFAULT_GRAPHQL_COMPLEXITY_MAX_COST
    );
  });

  it('falls back to default on negative number', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_MAX_COST', '-1');
    expect(getGraphqlComplexityMaxCost()).toBe(
      DEFAULT_GRAPHQL_COMPLEXITY_MAX_COST
    );
  });
});

describe('isGraphqlComplexityLogOnly', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns false when env var is unset', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_LOG_ONLY', '');
    expect(isGraphqlComplexityLogOnly()).toBe(false);
  });

  it('returns true on "true"', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_LOG_ONLY', 'true');
    expect(isGraphqlComplexityLogOnly()).toBe(true);
  });

  it('returns true on "1"', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_LOG_ONLY', '1');
    expect(isGraphqlComplexityLogOnly()).toBe(true);
  });

  it('returns false on any other value', () => {
    vi.stubEnv('BOJECT_GRAPHQL_COMPLEXITY_LOG_ONLY', 'no');
    expect(isGraphqlComplexityLogOnly()).toBe(false);
  });
});
