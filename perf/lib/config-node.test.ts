import { describe, expect, it } from 'vitest';
import { loadNodeConfig } from './config-node';

describe('loadNodeConfig', () => {
  it('returns defaults when env vars are unset', () => {
    const cfg = loadNodeConfig({});
    expect(cfg.baseUrl).toBe('http://localhost:4000');
    expect(cfg.perfDatabaseUrl).toBe(
      'postgresql://boject:boject@localhost:5432/boject_perf'
    );
    expect(cfg.apiKey).toBeUndefined();
  });

  it('reads overrides from env', () => {
    const cfg = loadNodeConfig({
      PERF_BASE_URL: 'https://staging.example.com',
      PERF_API_KEY: 'boject_test_abc',
      PERF_DATABASE_URL: 'postgresql://u:p@h:5432/db',
    });
    expect(cfg.baseUrl).toBe('https://staging.example.com');
    expect(cfg.apiKey).toBe('boject_test_abc');
    expect(cfg.perfDatabaseUrl).toBe('postgresql://u:p@h:5432/db');
  });

  it('trims trailing slash from baseUrl', () => {
    const cfg = loadNodeConfig({ PERF_BASE_URL: 'http://example.com/' });
    expect(cfg.baseUrl).toBe('http://example.com');
  });
});
