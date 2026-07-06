import { describe, it, expect, afterEach } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { prisma } from '../../utils/prisma';
import type { RateLimitedBody } from '../../utils/rateLimitEndpoint';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

describe('Authentication', async () => {
  // BOJECT_TRUSTED_PROXY_HOPS trusts the X-Forwarded-For header so the
  // per-test spoofed IP below (rate-limit bucket isolation) keeps working —
  // getClientIp ignores XFF by default (#341).
  await setup({ dev: true, env: { BOJECT_TRUSTED_PROXY_HOPS: '1' } });

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

    it('rate-limits after 10 attempts in 60s and returns RATE_LIMITED body', async () => {
      // Use a unique simulated IP so this test's budget is isolated from
      // other tests in the suite (the in-process rate limiter is per-IP).
      const ip = `192.0.2.${Math.floor(Math.random() * 254) + 1}`;
      const headers = {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
      };
      let limited: Response | undefined;
      for (let i = 0; i < 11; i++) {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: TEST_USERNAME,
            password: 'wrong',
          }),
          headers,
        });
        if (res.status === 429) {
          limited = res;
          break;
        }
      }
      expect(limited).toBeDefined();
      expect(limited!.status).toBe(429);
      const body = (await limited!.json()) as { data?: RateLimitedBody };
      expect(body.data?.error).toBe('RATE_LIMITED');
      expect(body.data?.message).toBe('Too many requests');
      expect(body.data?.retryAfter).toBeGreaterThanOrEqual(1);
      expect(body.data?.suggestion).toContain('login');
      expect(limited!.headers.get('retry-after')).toBeDefined();
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

    it('allows REST API requests with a valid session', async () => {
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: TEST_USERNAME, password: TEST_PASSWORD }),
        headers: { 'Content-Type': 'application/json' },
      });
      const cookie = loginRes.headers.getSetCookie().join('; ');
      const response = await $fetch<{ items: unknown[]; total: number }>(
        '/api/content-types',
        { headers: { cookie } }
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

    it('rejects a session whose user has been deleted', async () => {
      // Create a transient user, log in as them, delete the user, expect 401.
      const transientEmail = `deleted-${Date.now()}@example.com`;
      const transientPassword = 'transient-strong-password-1!';
      await prisma.user.create({
        data: {
          email: transientEmail,
          // Re-hash with the same scrypt scheme used in seed.ts so verifyPassword accepts it.
          password: await (async () => {
            const { randomBytes, scrypt: scryptCb } =
              await import('node:crypto');
            const salt = randomBytes(16);
            const derived: Buffer = await new Promise((resolve, reject) => {
              scryptCb(
                transientPassword,
                salt,
                64,
                {
                  cost: 16384,
                  blockSize: 8,
                  parallelization: 1,
                  maxmem: 32 * 1024 * 1024,
                },
                (err, dk) => (err ? reject(err) : resolve(dk))
              );
            });
            const saltB64 = salt.toString('base64').replace(/=+$/, '');
            const hashB64 = derived.toString('base64').replace(/=+$/, '');
            return `$scrypt$n=16384,r=8,p=1$${saltB64}$${hashB64}`;
          })(),
          firstName: 'Deleted',
          lastName: 'User',
        },
      });

      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: transientEmail,
          password: transientPassword,
        }),
        headers: { 'content-type': 'application/json' },
      });
      expect(loginRes.status).toBeLessThan(400);
      const cookie = loginRes.headers.getSetCookie().join('; ');

      // Delete the user out from under the session cookie
      await prisma.user.delete({ where: { email: transientEmail } });

      // The cookie should now 401 on any session-authed route
      const res = await fetch('/api/content-types', { headers: { cookie } });
      expect(res.status).toBe(401);
    });
  });

  // ── API-key path partition (#257): tokens valid only on public + management;
  //    admin content is session-only (token → 401) ─────────────────────────
  describe('API-key path partition (#257)', () => {
    const bearer = { Authorization: `Bearer ${TEST_API_KEY}` };

    async function sessionCookie(): Promise<string> {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_USERNAME, password: TEST_PASSWORD }),
      });
      return res.headers.getSetCookie().join('; ');
    }

    it.each([
      '/api/entries?contentType=Anything',
      '/api/all-content',
      '/api/content-types',
    ])('token GET %s → 401 (admin content is session-only)', async (p) => {
      const res = await fetch(p, { headers: bearer });
      expect(res.status).toBe(401);
    });

    it('token write to /api/entries → 401', async () => {
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: { ...bearer, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: '00000000-0000-0000-0000-000000000000',
          data: {},
        }),
      });
      expect(res.status).toBe(401);
    });

    it('SESSION GET /api/content-types → 200 (session still works)', async () => {
      const res = await fetch('/api/content-types', {
        headers: { cookie: await sessionCookie() },
      });
      expect(res.status).toBe(200);
    });

    it('token GET /api/public/entries → not 401 (content:read; reaches handler)', async () => {
      const res = await fetch('/api/public/entries?contentType=Anything', {
        headers: bearer,
      });
      expect(res.status).not.toBe(401);
    });

    it.each([
      '/api/search?q=x',
      '/api/schema/export',
      '/api/content-bundle/export',
      '/api/apikeys',
    ])(
      'token on token-permitted path %s is NOT barred by the partition',
      async (p) => {
        // The test key has content:read + content:write only, so management
        // endpoints return 403 INSUFFICIENT_SCOPE and search returns 200 (or 503
        // if Meili is down). Any of those proves the partition let the token
        // THROUGH to the handler — the one outcome that must never happen is 401.
        const res = await fetch(p, { headers: bearer });
        expect(res.status).not.toBe(401);
      }
    );
  });
});
