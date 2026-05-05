import { fileURLToPath } from 'node:url';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { prisma } from '../../utils/prisma';
import { generateApiKey } from '../../utils/apiKey';

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

async function _loginAsAdmin(): Promise<string> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_USERNAME, password: TEST_PASSWORD }),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.headers.getSetCookie().join('; ');
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
});
