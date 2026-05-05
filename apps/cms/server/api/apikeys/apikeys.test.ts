import { fileURLToPath } from 'node:url';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { prisma } from '../../utils/prisma';
import { generateApiKey, hashApiKey } from '../../utils/apiKey';

await setup({
  rootDir: fileURLToPath(new URL('../../..', import.meta.url)),
  dev: true,
});

async function makeKey(scopes: string[]): Promise<string> {
  const { raw, hash, prefix } = generateApiKey();
  await prisma.apiKey.create({
    data: {
      name: `test-${Math.random().toString(36).slice(2, 8)}`,
      keyHash: hash,
      keyPrefix: prefix,
      scopes,
    },
  });
  return raw;
}

// Cache the admin session cookie across the entire test process. The login
// endpoint is rate-limited to 10/60s per IP and this file performs 11+ logins,
// so calling it fresh every time would trip the limiter. Safe because no test
// in this file rotates the admin password — i.e. nothing bumps
// `User.passwordVersion`. If a future test calls `POST /api/account/password`
// (or otherwise invalidates the admin session), this cache MUST be reset or
// subsequent `loginAsAdmin()` calls will return a stale cookie that 401s.
let cachedCookie: string | null = null;
async function loginAsAdmin(): Promise<string> {
  if (cachedCookie) return cachedCookie;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_USERNAME, password: TEST_PASSWORD }),
    headers: { 'Content-Type': 'application/json' },
  });
  cachedCookie = res.headers.getSetCookie().join('; ');
  return cachedCookie;
}

afterEach(async () => {
  await prisma.apiKey.deleteMany({
    where: { name: { startsWith: 'test-' } },
  });
});

describe('POST /api/apikeys', () => {
  it('returns 401 without auth', async () => {
    const res = await fetch('/api/apikeys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', scopes: ['content:read'] }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 INSUFFICIENT_SCOPE for an api key without apikey:write', async () => {
    const key = await makeKey(['content:read']);
    const res = await fetch('/api/apikeys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ name: 'x', scopes: ['content:read'] }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data?: { error?: string } };
    expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
  });

  describe('body validation', () => {
    it('returns 400 BAD_REQUEST when name is missing', async () => {
      const cookie = await loginAsAdmin();
      const res = await fetch('/api/apikeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ scopes: ['content:read'] }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { data?: { error?: string } };
      expect(body.data?.error).toBe('BAD_REQUEST');
    });

    it('returns 400 when name is whitespace-only', async () => {
      const cookie = await loginAsAdmin();
      const res = await fetch('/api/apikeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: '   ', scopes: ['content:read'] }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when name is longer than 80 chars', async () => {
      const cookie = await loginAsAdmin();
      const res = await fetch('/api/apikeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          name: 'x'.repeat(81),
          scopes: ['content:read'],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when scopes is missing', async () => {
      const cookie = await loginAsAdmin();
      const res = await fetch('/api/apikeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: 'ok' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when scopes is empty', async () => {
      const cookie = await loginAsAdmin();
      const res = await fetch('/api/apikeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: 'ok', scopes: [] }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 UNKNOWN_SCOPE when a scope is unrecognised', async () => {
      const cookie = await loginAsAdmin();
      const res = await fetch('/api/apikeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: 'ok', scopes: ['admin'] }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        data?: { error?: string; recognised?: string[] };
      };
      expect(body.data?.error).toBe('UNKNOWN_SCOPE');
      expect(body.data?.recognised).toEqual([
        'content:read',
        'schema:read',
        'schema:write',
        'apikey:read',
        'apikey:write',
      ]);
    });

    it('returns 400 UNKNOWN_SCOPE when one of mixed scopes is invalid', async () => {
      const cookie = await loginAsAdmin();
      const res = await fetch('/api/apikeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          name: 'ok',
          scopes: ['content:read', 'banana'],
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { data?: { error?: string } };
      expect(body.data?.error).toBe('UNKNOWN_SCOPE');
    });
  });

  describe('happy path', () => {
    it('mints a content:read key under session auth', async () => {
      const cookie = await loginAsAdmin();
      const res = await fetch('/api/apikeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          name: 'test-session-content',
          scopes: ['content:read'],
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        id: string;
        name: string;
        prefix: string;
        scopes: string[];
        rawKey: string;
        createdAt: string;
      };
      expect(body.name).toBe('test-session-content');
      expect(body.scopes).toEqual(['content:read']);
      expect(body.rawKey).toMatch(/^boject_[a-f0-9]+$/);
      expect(body.prefix).toBe(body.rawKey.slice(0, 11));

      const dbRow = await prisma.apiKey.findUnique({ where: { id: body.id } });
      expect(dbRow).not.toBeNull();
      expect(dbRow!.keyPrefix).toBe(body.prefix);
      expect(dbRow!.scopes).toEqual(['content:read']);
      // keyHash should be sha256 hex of rawKey.
      const { createHash } = await import('node:crypto');
      const expectedHash = createHash('sha256')
        .update(body.rawKey)
        .digest('hex');
      expect(dbRow!.keyHash).toBe(expectedHash);
    });

    it('mints a content:read key for an api-key caller with apikey:write', async () => {
      const adminKey = await makeKey(['apikey:write']);
      const res = await fetch('/api/apikeys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminKey}`,
        },
        body: JSON.stringify({
          name: 'test-apikey-mints-content',
          scopes: ['content:read'],
        }),
      });
      expect(res.status).toBe(201);
    });
  });

  describe('(i) rule: api-key callers cannot mint apikey:write keys', () => {
    it('rejects api-key auth minting an apikey:write key', async () => {
      const adminKey = await makeKey(['apikey:write']);
      const res = await fetch('/api/apikeys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminKey}`,
        },
        body: JSON.stringify({
          name: 'test-i-rule-single',
          scopes: ['apikey:write'],
        }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { data?: { error?: string } };
      expect(body.data?.error).toBe('APIKEY_WRITE_REQUIRES_SESSION');
    });

    it('rejects api-key auth minting a key with mixed scopes including apikey:write', async () => {
      const adminKey = await makeKey(['apikey:write']);
      const res = await fetch('/api/apikeys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminKey}`,
        },
        body: JSON.stringify({
          name: 'test-i-rule-mixed',
          scopes: ['content:read', 'apikey:write'],
        }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { data?: { error?: string } };
      expect(body.data?.error).toBe('APIKEY_WRITE_REQUIRES_SESSION');
    });

    it('allows session auth to mint an apikey:write key', async () => {
      const cookie = await loginAsAdmin();
      const res = await fetch('/api/apikeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({
          name: 'test-session-mints-apikey-write',
          scopes: ['apikey:write'],
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { scopes: string[] };
      expect(body.scopes).toEqual(['apikey:write']);
    });
  });

  describe('rate limit', () => {
    it('returns 429 after 50 mutations from the same IP within 60s', async () => {
      const cookie = await loginAsAdmin();
      // 50 successful calls, then 51st should be rate-limited.
      let lastStatus = 0;
      for (let i = 0; i < 51; i++) {
        const res = await fetch('/api/apikeys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie },
          body: JSON.stringify({
            name: `test-rl-${i}`,
            scopes: ['content:read'],
          }),
        });
        lastStatus = res.status;
        if (res.status === 429) break;
      }
      expect(lastStatus).toBe(429);
    });
  });
});

describe('GET /api/apikeys', () => {
  it('returns 401 without auth', async () => {
    const res = await fetch('/api/apikeys');
    expect(res.status).toBe(401);
  });

  it('returns 403 INSUFFICIENT_SCOPE for an api key without apikey:read', async () => {
    const key = await makeKey(['content:read']);
    const res = await fetch('/api/apikeys', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data?: { error?: string } };
    expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
  });

  it('returns the list with apikey:read', async () => {
    await makeKey(['content:read']);
    await makeKey(['schema:read']);
    const reader = await makeKey(['apikey:read']);
    const res = await fetch('/api/apikeys', {
      headers: { Authorization: `Bearer ${reader}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<Record<string, unknown>>;
    };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(3);
    for (const item of body.items) {
      expect(item).not.toHaveProperty('keyHash');
      expect(item).not.toHaveProperty('rawKey');
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('prefix');
      expect(item).toHaveProperty('scopes');
      expect(item).toHaveProperty('createdAt');
    }
  });

  it('returns the list under session auth', async () => {
    const cookie = await loginAsAdmin();
    const res = await fetch('/api/apikeys', { headers: { cookie } });
    expect(res.status).toBe(200);
  });

  it('includes revoked keys with revokedAt populated', async () => {
    const target = await makeKey(['content:read']);
    const targetHash = hashApiKey(target);
    const targetRow = await prisma.apiKey.findUnique({
      where: { keyHash: targetHash },
      select: { id: true, keyPrefix: true },
    });
    expect(targetRow).not.toBeNull();
    await prisma.apiKey.update({
      where: { id: targetRow!.id },
      data: { revokedAt: new Date() },
    });
    const reader = await makeKey(['apikey:read']);
    const res = await fetch('/api/apikeys', {
      headers: { Authorization: `Bearer ${reader}` },
    });
    const body = (await res.json()) as {
      items: Array<{ id: string; revokedAt: string | null }>;
    };
    const revoked = body.items.find((i) => i.id === targetRow!.id);
    expect(revoked).toBeDefined();
    expect(revoked!.revokedAt).not.toBeNull();
  });

  it('sorts by createdAt desc', async () => {
    const reader = await makeKey(['apikey:read']);
    const res = await fetch('/api/apikeys', {
      headers: { Authorization: `Bearer ${reader}` },
    });
    const body = (await res.json()) as {
      items: Array<{ createdAt: string }>;
    };
    for (let i = 1; i < body.items.length; i++) {
      expect(body.items[i - 1]!.createdAt >= body.items[i]!.createdAt).toBe(
        true
      );
    }
  });
});
