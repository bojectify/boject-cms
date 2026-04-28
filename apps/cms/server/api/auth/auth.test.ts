import { describe, it, expect, afterEach } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { prisma } from '../../utils/prisma';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

describe('Authentication', async () => {
  await setup({ dev: true });

  // Reset passwordVersion after each test in case a test bumps it.
  afterEach(async () => {
    await prisma.user.updateMany({
      where: { email: TEST_USERNAME, passwordVersion: { not: 0 } },
      data: { passwordVersion: 0 },
    });
  });

  // ── Login endpoint ──────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    it('returns 401 for invalid password', async () => {
      const response = await $fetch('/api/auth/login', {
        method: 'POST',
        body: { email: TEST_USERNAME, password: 'wrong' },
        ignoreResponseError: true,
      });
      expect(response).toMatchObject({
        statusCode: 401,
        message: 'Invalid credentials',
      });
    });

    it('returns 401 for non-existent email', async () => {
      const response = await $fetch('/api/auth/login', {
        method: 'POST',
        body: { email: 'nobody@example.com', password: TEST_PASSWORD },
        ignoreResponseError: true,
      });
      expect(response).toMatchObject({
        statusCode: 401,
        message: 'Invalid credentials',
      });
    });

    it('returns 400 for missing credentials', async () => {
      const response = await $fetch('/api/auth/login', {
        method: 'POST',
        body: {},
        ignoreResponseError: true,
      });
      expect(response).toMatchObject({
        statusCode: 400,
        message: 'Missing credentials',
      });
    });

    it('succeeds with valid credentials', async () => {
      const response = await $fetch('/api/auth/login', {
        method: 'POST',
        body: { email: TEST_USERNAME, password: TEST_PASSWORD },
      });
      expect(response).toEqual({ ok: true });
    });

    it('login response carries passwordVersion in the session', async () => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const cookie = res.headers.getSetCookie().join('; ');
      const me = await $fetch<{ user: { passwordVersion: number } }>(
        '/api/_auth/session',
        { headers: { cookie } }
      );
      expect(me.user.passwordVersion).toBe(0);
    });
  });

  // ── Server middleware ───────────────────────────────────────

  describe('server middleware', () => {
    it('rejects unauthenticated REST API requests', async () => {
      const response = await $fetch('/api/content-types', {
        ignoreResponseError: true,
      });
      expect(response).toMatchObject({
        statusCode: 401,
        message: 'Unauthorized',
      });
    });

    it('allows REST API requests with a valid API key', async () => {
      const response = await $fetch<{ items: unknown[]; total: number }>(
        '/api/content-types',
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(response).toHaveProperty('items');
      expect(response).toHaveProperty('total');
    });

    it('allows login endpoint without auth', async () => {
      const response = await $fetch('/api/auth/login', {
        method: 'POST',
        body: { email: TEST_USERNAME, password: 'wrong' },
        ignoreResponseError: true,
      });
      // Should get 401 from the login handler, not from the middleware
      expect(response).toMatchObject({
        statusCode: 401,
        message: 'Invalid credentials',
      });
    });

    it('rejects a session whose passwordVersion no longer matches the DB', async () => {
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const cookie = loginRes.headers.getSetCookie().join('; ');

      // Bump passwordVersion in the DB out from under the session
      await prisma.user.update({
        where: { email: TEST_USERNAME },
        data: { passwordVersion: { increment: 1 } },
      });

      // Any authenticated request must now 401
      await expect(
        $fetch('/api/content-types', { headers: { cookie } })
      ).rejects.toMatchObject({ status: 401 });
    });
  });
});
