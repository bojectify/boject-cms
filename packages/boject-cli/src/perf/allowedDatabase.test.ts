import { describe, expect, it } from 'vitest';
import {
  assertAllowedDatabase,
  extractDatabaseName,
  DisallowedDatabaseError,
  UnparseableDatabaseUrlError,
} from './allowedDatabase.js';

describe('extractDatabaseName', () => {
  it('extracts the db name from a postgres URL', () => {
    expect(extractDatabaseName('postgres://u:p@h:5432/myapp_perf')).toBe(
      'myapp_perf'
    );
  });

  it('strips a query string', () => {
    expect(
      extractDatabaseName('postgresql://u:p@h:5432/myapp_perf?sslmode=require')
    ).toBe('myapp_perf');
  });

  it('throws on a URL with no path', () => {
    expect(() => extractDatabaseName('postgres://u:p@h:5432')).toThrow(
      UnparseableDatabaseUrlError
    );
  });

  it('throws on a malformed URL', () => {
    expect(() => extractDatabaseName('not a url')).toThrow(
      UnparseableDatabaseUrlError
    );
  });
});

describe('assertAllowedDatabase', () => {
  it('accepts a _perf-suffixed name with no allow-list', () => {
    expect(() =>
      assertAllowedDatabase('postgres://u:p@h/myapp_perf', [])
    ).not.toThrow();
  });

  it('accepts a _staging-suffixed name with no allow-list', () => {
    expect(() =>
      assertAllowedDatabase('postgres://u:p@h/foo_staging', [])
    ).not.toThrow();
  });

  it('rejects a plain prod-style name with no allow-list', () => {
    expect(() => assertAllowedDatabase('postgres://u:p@h/prod', [])).toThrow(
      DisallowedDatabaseError
    );
  });

  it('error message names the offending DB and the override flag', () => {
    try {
      assertAllowedDatabase('postgres://u:p@h/prod', []);
      expect.fail('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('"prod"');
      expect(msg).toContain('--allow-database prod');
      expect(msg).toContain('_perf');
      expect(msg).toContain('_staging');
    }
  });

  it('redacts userinfo in error messages', () => {
    try {
      assertAllowedDatabase('postgres://user:secret@h/prod', []);
      expect.fail('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain('secret');
      expect(msg).toContain('<redacted>');
    }
  });

  it('accepts an exact-match name in the allow-list', () => {
    expect(() =>
      assertAllowedDatabase('postgres://u:p@h/prod', ['prod'])
    ).not.toThrow();
  });

  it('accepts when the name is one of multiple allow-list entries', () => {
    expect(() =>
      assertAllowedDatabase('postgres://u:p@h/hotfix', [
        'staging',
        'prod',
        'hotfix',
      ])
    ).not.toThrow();
  });

  it('is case-sensitive on the suffix check', () => {
    expect(() =>
      assertAllowedDatabase('postgres://u:p@h/MyApp_PERF', [])
    ).toThrow(DisallowedDatabaseError);
  });

  it('is case-sensitive on the allow-list check', () => {
    expect(() =>
      assertAllowedDatabase('postgres://u:p@h/Prod', ['prod'])
    ).toThrow(DisallowedDatabaseError);
  });
});
