import { describe, expect, it } from 'vitest';
import {
  API_KEY_SCOPES,
  API_KEY_SCOPES_SET,
  API_KEY_SCOPE_DESCRIPTIONS,
  isApiKeyScope,
} from './apiKeyScopes';

describe('apiKeyScopes', () => {
  it('exposes the canonical list of scopes', () => {
    expect(API_KEY_SCOPES).toEqual([
      'content:read',
      'content:write',
      'schema:read',
      'schema:write',
      'apikey:read',
      'apikey:write',
    ]);
  });

  it('API_KEY_SCOPES_SET contains every scope', () => {
    for (const s of API_KEY_SCOPES) {
      expect(API_KEY_SCOPES_SET.has(s)).toBe(true);
    }
  });

  it('API_KEY_SCOPE_DESCRIPTIONS has an entry for every scope', () => {
    for (const s of API_KEY_SCOPES) {
      expect(API_KEY_SCOPE_DESCRIPTIONS[s]).toEqual(expect.any(String));
      expect(API_KEY_SCOPE_DESCRIPTIONS[s].length).toBeGreaterThan(0);
    }
    expect(Object.keys(API_KEY_SCOPE_DESCRIPTIONS).sort()).toEqual(
      [...API_KEY_SCOPES].sort()
    );
  });

  describe('isApiKeyScope', () => {
    it('returns true for every recognised scope', () => {
      for (const s of API_KEY_SCOPES) {
        expect(isApiKeyScope(s)).toBe(true);
      }
    });

    it.each([
      ['empty string', ''],
      ['unknown scope', 'admin'],
      ['similar but wrong', 'content:delete'],
      ['null', null],
      ['undefined', undefined],
      ['number', 42],
      ['object', {}],
      ['array', []],
    ])('returns false for %s', (_label, value) => {
      expect(isApiKeyScope(value)).toBe(false);
    });
  });
});
