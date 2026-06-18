import { describe, it, expect, beforeEach } from 'vitest';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { resetRateLimitStore } from '../../utils/rateLimit';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

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

describe('/api/public/* namespace policy', async () => {
  await setup({ dev: true });

  beforeEach(() => {
    resetRateLimitStore();
  });

  // The route handler for /api/public/entries does not exist yet — the
  // policy is enforced by the global auth middleware, which runs before
  // route resolution, so these 401 assertions hold regardless. After the
  // route lands (Task 2) it stays API-key-only, so they remain valid.
  it('rejects a session-cookie caller with 401 (never session-authed)', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch('/api/public/entries?contentType=Anything', {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(401);
  });

  it('rejects an unauthenticated caller with 401', async () => {
    const res = await fetch('/api/public/entries?contentType=Anything');
    expect(res.status).toBe(401);
  });

  it('accepts a valid API key (does not 401)', async () => {
    const res = await fetch('/api/public/entries?contentType=Anything', {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    // The route handler is not implemented yet (Task 2), so a 404 is the
    // expected pass-through; the assertion here is only that the API key
    // is NOT rejected at the auth gate.
    expect(res.status).not.toBe(401);
  });
});
