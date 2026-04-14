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

  beforeAll(() => {
    resetRateLimitStore();
  });

  it('rejects a mutating request with a foreign Origin header', async () => {
    const navsRes = await fetch('/api/navigations', {
      headers: {
        Authorization: `Bearer boject_test_key_for_integration_tests_only`,
      },
    });
    const navs = (await navsRes.json()) as { items: { id: string }[] };
    const navId = navs.items[0]!.id;

    const response = await fetch(`/api/navigations/${navId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example.com',
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({ name: 'anything' }),
    });
    expect(response.status).toBe(403);
  });

  it('allows a mutating request from the same Origin', async () => {
    const navsRes = await fetch('/api/navigations', {
      headers: {
        Authorization: `Bearer boject_test_key_for_integration_tests_only`,
      },
    });
    const navs = (await navsRes.json()) as {
      items: { id: string; name: string }[];
    };
    const nav = navs.items[0]!;

    // Use the test-utils `url()` helper to get the actual test server URL
    // (it runs on 127.0.0.1:<random-port>). Origin must match exactly the
    // Host header the server sees.
    const fullUrl = new URL(url('/'));
    const baseUrl = `${fullUrl.protocol}//${fullUrl.host}`;
    const response = await fetch(`/api/navigations/${nav.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
        Cookie: await getSessionCookie(),
      },
      body: JSON.stringify({ name: nav.name }),
    });
    expect(response.status).toBe(200);
  });

  it('allows requests without an Origin header (server-to-server, e.g. API key)', async () => {
    const response = await fetch('/api/navigations', {
      method: 'GET',
      headers: {
        Authorization: `Bearer boject_test_key_for_integration_tests_only`,
      },
    });
    expect(response.status).toBe(200);
  });
});
