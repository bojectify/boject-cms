import { describe, it, expect, beforeAll } from 'vitest';
import { setup, fetch, url } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../test/credentials';
import { resetRateLimitStore } from '../utils/rateLimit';

let _sessionCookie: string | null = null;

async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: TEST_USERNAME,
      password: TEST_PASSWORD,
    }),
    headers: { 'Content-Type': 'application/json' },
  });
  const cookies = response.headers.getSetCookie();
  _sessionCookie = cookies.join('; ');
  return _sessionCookie;
}

describe('CSRF Origin check', async () => {
  await setup({ dev: true });

  let typeId: string;

  beforeAll(async () => {
    resetRateLimitStore();

    // Create a throwaway content type for the PUT probes below. We use a
    // nonce-suffixed name so parallel test files don't collide. POST must go
    // through the session cookie — API keys are read-only.
    const nonce = Math.random().toString(36).slice(2, 10);
    const createRes = await fetch('/api/content-types', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({
        name: `Csrf Probe ${nonce}`,
        identifier: `CsrfProbe${nonce}`,
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
        ],
      }),
    });
    if (createRes.status !== 201) {
      throw new Error(
        `CSRF test setup: POST failed (${createRes.status}): ${await createRes.text()}`
      );
    }
    const created = (await createRes.json()) as { id: string };
    typeId = created.id;
  });

  it('rejects a mutating request with a foreign Origin header', async () => {
    const response = await fetch(`/api/content-types/${typeId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example.com',
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({ description: 'foreign-origin probe' }),
    });
    expect(response.status).toBe(403);
  });

  it('allows a mutating request from the same Origin', async () => {
    // Use the test-utils `url()` helper to get the actual test server URL
    // (it runs on 127.0.0.1:<random-port>). Origin must match exactly the
    // Host header the server sees.
    const fullUrl = new URL(url('/'));
    const baseUrl = `${fullUrl.protocol}//${fullUrl.host}`;
    const response = await fetch(`/api/content-types/${typeId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({ description: 'same-origin probe' }),
    });
    expect(response.status).toBe(200);
  });

  it('allows requests without an Origin header (server-to-server, e.g. API key)', async () => {
    const response = await fetch('/api/content-types', {
      method: 'GET',
      headers: {
        Authorization: `Bearer boject_test_key_for_integration_tests_only`,
      },
    });
    expect(response.status).toBe(200);
  });

  describe('Bearer auth bypass for /api/content-entries (#172)', () => {
    it('skips Origin/Referer check on POST /api/content-entries with Bearer auth', async () => {
      // CSRF middleware bypasses Origin/Referer check when the request carries
      // a Bearer API key. Confirm this still applies after #172 added the path
      // to API_KEY_WRITABLE_PATHS.
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer boject_test_key_for_integration_tests_only',
          'Content-Type': 'application/json',
          // Deliberately mismatched Origin to confirm the Bearer bypass.
          Origin: 'https://attacker.example.com',
        },
        body: JSON.stringify({}),
      });
      // CSRF would have returned 403 with a clear "Origin mismatch" message.
      // Anything else (including 400 for missing body fields, or 422) confirms
      // the Bearer bypass kicks in.
      expect(res.status).not.toBe(403);
    });
  });
});
