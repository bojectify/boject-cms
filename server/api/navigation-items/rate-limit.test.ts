import { describe, it, expect, beforeAll } from 'vitest';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { resetRateLimitStore } from '../../utils/rateLimit';

let _sessionCookie: string | null = null;

async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@boject.com',
      password: 'password',
    }),
    headers: { 'Content-Type': 'application/json' },
  });
  const cookies = response.headers.getSetCookie();
  _sessionCookie = cookies.join('; ');
  return _sessionCookie;
}

describe('Mutating nav endpoints rate limit', async () => {
  await setup({ dev: true });

  beforeAll(() => {
    resetRateLimitStore();
  });

  it('returns 429 after exceeding the per-endpoint mutation limit', async () => {
    // Grab the seeded navigation's id for a harmless PUT payload
    const navsRes = await fetch('/api/navigations', {
      headers: {
        Authorization: `Bearer boject_test_key_for_integration_tests_only`,
      },
    });
    const navs = (await navsRes.json()) as {
      items: { id: string; name: string }[];
    };
    const navId = navs.items[0]!.id;
    const currentName = navs.items[0]!.name;

    // Fire 31 requests to a mutating endpoint; the configured limit is 30/60s
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await fetch(`/api/navigations/${navId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await getSessionCookie(),
        },
        body: JSON.stringify({ name: currentName }),
      });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
