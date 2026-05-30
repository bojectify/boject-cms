import { fileURLToPath } from 'node:url';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../utils/prisma';
import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from '../../test/credentials';
import type { RateLimitedBody } from '../../utils/rateLimitEndpoint';
import { resetRateLimitStore } from '../../utils/rateLimit';

await setup({
  rootDir: fileURLToPath(new URL('../../..', import.meta.url)),
  dev: true,
});

async function login(email = TEST_USER_EMAIL, password = TEST_USER_PASSWORD) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    headers: { 'content-type': 'application/json' },
  });
  return res.headers.getSetCookie().join('; ');
}

// Re-hashes TEST_USER_PASSWORD using the same scrypt scheme as
// `prisma/seed.ts::hashPasswordForSeed` so login continues to work.
// Resets passwordVersion to 0 so middleware reads a clean slate.
async function resetTestUser() {
  const { randomBytes, scrypt: scryptCb } = await import('node:crypto');
  const salt = randomBytes(16);
  const derived: Buffer = await new Promise((resolve, reject) => {
    scryptCb(
      TEST_USER_PASSWORD,
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
  const password = `$scrypt$n=16384,r=8,p=1$${saltB64}$${hashB64}`;
  await prisma.user.update({
    where: { email: TEST_USER_EMAIL },
    data: { password, passwordVersion: 0 },
  });
}

describe('POST /api/account/password', () => {
  beforeAll(async () => {
    // The test DB is reset and seeded by vitest.globalSetup.ts.
  });

  afterEach(async () => {
    await resetTestUser();
    // Clear the in-process rate limiter between tests so the two cases
    // that pick random IPs from 192.0.2.0/24 can't collide (~0.4% per
    // run otherwise). Matches the convention in csrf / content-entries /
    // content-types / webhooks / rate-limit unit tests.
    resetRateLimitStore();
  });

  it('changes the password (204), bumps passwordVersion, current cookie still works', async () => {
    const cookie = await login();

    const res = await fetch('/api/account/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: TEST_USER_PASSWORD,
        newPassword: 'R8#fT2!qwLpZ-new',
      }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(204);

    const dbUser = await prisma.user.findUnique({
      where: { email: TEST_USER_EMAIL },
    });
    expect(dbUser?.passwordVersion).toBe(1);

    // Current device's cookie was re-issued; should still hit a session-only route
    const newCookie = res.headers.getSetCookie().join('; ');
    const meRes = await fetch('/api/_auth/session', {
      headers: { cookie: newCookie },
    });
    const me = await meRes.json();
    expect(me.user.passwordVersion).toBe(1);
  });

  it('returns 401 when currentPassword is wrong', async () => {
    const cookie = await login();
    const res = await fetch('/api/account/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: 'definitely-not-the-password',
        newPassword: 'R8#fT2!qwLpZ-new',
      }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(401);

    const dbUser = await prisma.user.findUnique({
      where: { email: TEST_USER_EMAIL },
    });
    expect(dbUser?.passwordVersion).toBe(0);
  });

  it('returns 400 WEAK_PASSWORD with failures=[blocklist] for a blocklisted password', async () => {
    const cookie = await login();
    const res = await fetch('/api/account/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: TEST_USER_PASSWORD,
        newPassword: 'password123',
      }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data?.error ?? body.error).toBe('WEAK_PASSWORD');
    const failures = body.data?.failures ?? body.failures;
    expect(failures).toContain('blocklist');
  });

  it('returns 400 WEAK_PASSWORD with failures=[length] for a too-short password', async () => {
    const cookie = await login();
    const res = await fetch('/api/account/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: TEST_USER_PASSWORD,
        newPassword: 'short!',
      }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    const failures = body.data?.failures ?? body.failures;
    expect(failures).toContain('length');
  });

  it('returns 400 when fields are missing', async () => {
    const cookie = await login();
    const res = await fetch('/api/account/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: TEST_USER_PASSWORD }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    const res = await fetch('/api/account/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: TEST_USER_PASSWORD,
        newPassword: 'R8#fT2!qwLpZ-new',
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 with an API-key Bearer token (read-only enforcement)', async () => {
    const res = await fetch('/api/account/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: TEST_USER_PASSWORD,
        newPassword: 'R8#fT2!qwLpZ-new',
      }),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer boject_test_key_for_integration_tests_only',
      },
    });
    expect(res.status).toBe(403);
  });

  it('rate-limits after 5 attempts in 60s', async () => {
    const cookie = await login();
    // Use a unique simulated IP so this test's budget is isolated from
    // other tests in the suite (the in-process rate limiter is per-IP).
    const ip = `192.0.2.${Math.floor(Math.random() * 254) + 1}`; // TEST-NET-1
    const headers = {
      'content-type': 'application/json',
      cookie,
      'x-forwarded-for': ip,
    };

    // 5 wrong-password attempts use up the budget for this IP
    for (let i = 0; i < 5; i++) {
      await fetch('/api/account/password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: 'wrong',
          newPassword: 'R8#fT2!qwLpZ-new',
        }),
        headers,
      });
    }
    const res = await fetch('/api/account/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: TEST_USER_PASSWORD,
        newPassword: 'R8#fT2!qwLpZ-new',
      }),
      headers,
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { data?: RateLimitedBody };
    expect(body.data?.error).toBe('RATE_LIMITED');
    expect(body.data?.message).toBe('Too many requests');
    expect(body.data?.retryAfter).toBeGreaterThanOrEqual(1);
    expect(body.data?.suggestion).toContain('password');
    expect(res.headers.get('retry-after')).toBeDefined();
  });

  it('invalidates other devices on next request', async () => {
    const cookieA = await login();
    const cookieB = await login(); // simulate a second device

    // Use a unique IP so this test's password-change call isn't blocked by
    // rate-limit budget consumed by earlier tests sharing the default IP.
    const ip = `192.0.2.${Math.floor(Math.random() * 254) + 1}`;

    const changeRes = await fetch('/api/account/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: TEST_USER_PASSWORD,
        newPassword: 'R8#fT2!qwLpZ-new',
      }),
      headers: {
        'content-type': 'application/json',
        cookie: cookieA,
        'x-forwarded-for': ip,
      },
    });
    expect(changeRes.status).toBe(204);

    // Device B's cookie still claims passwordVersion=0; middleware rejects
    const res = await fetch('/api/content-types', {
      headers: { cookie: cookieB },
    });
    expect(res.status).toBe(401);
  });
});
