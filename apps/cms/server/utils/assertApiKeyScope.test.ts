import { describe, expect, it } from 'vitest';
import { assertApiKeyScope } from './assertApiKeyScope';

function fakeEvent(opts: {
  authMethod?: 'session' | 'apikey';
  scopes?: string[];
}) {
  // eslint-disable-next-line no-restricted-syntax -- H3Event requires node/__is_event__/etc. the mock omits
  return {
    context: {
      authMethod: opts.authMethod ?? 'apikey',
      apiKeyScopes: opts.scopes,
    },
  } as unknown as Parameters<typeof assertApiKeyScope>[0];
}

describe('assertApiKeyScope', () => {
  it('passes session-authed events through unchanged', () => {
    expect(() =>
      assertApiKeyScope(fakeEvent({ authMethod: 'session' }), 'schema:read')
    ).not.toThrow();
  });

  it('passes when the API key has the required scope', () => {
    expect(() =>
      assertApiKeyScope(fakeEvent({ scopes: ['schema:read'] }), 'schema:read')
    ).not.toThrow();
  });

  it('throws 403 INSUFFICIENT_SCOPE when the scope is missing', () => {
    let thrown: { statusCode?: number; data?: unknown } | undefined;
    try {
      assertApiKeyScope(fakeEvent({ scopes: ['content:read'] }), 'schema:read');
    } catch (err) {
      thrown = err as typeof thrown;
    }
    expect(thrown?.statusCode).toBe(403);
    expect((thrown?.data as { error: string }).error).toBe(
      'INSUFFICIENT_SCOPE'
    );
    expect((thrown?.data as { required: string }).required).toBe('schema:read');
  });

  it('throws when scopes are missing entirely', () => {
    expect(() =>
      assertApiKeyScope(fakeEvent({ scopes: undefined }), 'schema:read')
    ).toThrow();
  });
});
