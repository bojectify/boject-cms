import { describe, it, expect } from 'vitest';
import { setup, $fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

describe('Authentication', async () => {
  await setup({ dev: true });

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
  });
});
