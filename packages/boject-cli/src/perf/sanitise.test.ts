import { describe, expect, it } from 'vitest';
import { sanitiseUrl, sanitiseLogLine } from './sanitise.js';

describe('sanitiseUrl', () => {
  it('strips userinfo from URLs', () => {
    expect(sanitiseUrl('https://user:pass@cms.example.com/api/health')).toBe(
      'https://cms.example.com/api/health'
    );
  });

  it('preserves URLs without userinfo', () => {
    expect(sanitiseUrl('https://cms.example.com/api/health')).toBe(
      'https://cms.example.com/api/health'
    );
  });

  it('preserves ports', () => {
    expect(sanitiseUrl('https://cms.example.com:8443/api/graphql')).toBe(
      'https://cms.example.com:8443/api/graphql'
    );
  });

  it('returns the input unchanged when not parseable as a URL', () => {
    expect(sanitiseUrl('not a url')).toBe('not a url');
  });
});

describe('sanitiseLogLine', () => {
  it('redacts a Bearer token in any text', () => {
    const apiKey = 'boject_aBcDeFgHiJkLmNoPqRsTuVwXyZ';
    const line = `Authorization: Bearer ${apiKey} on this line`;
    expect(sanitiseLogLine(line, apiKey)).toBe(
      'Authorization: Bearer [REDACTED] on this line'
    );
  });

  it('redacts an api key embedded in a URL query string', () => {
    const apiKey = 'boject_aBcDeFgHiJkLmNoPqRsTuVwXyZ';
    const line = `GET https://x.example.com/?api_key=${apiKey} 200`;
    expect(sanitiseLogLine(line, apiKey)).toContain('api_key=[REDACTED]');
  });

  it('returns the input unchanged when api key is empty', () => {
    expect(sanitiseLogLine('something', '')).toBe('something');
  });
});
