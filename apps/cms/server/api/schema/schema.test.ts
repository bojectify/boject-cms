import { fileURLToPath } from 'node:url';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('GET /api/schema/export', () => {
  beforeEach(async () => {
    // Reset content types so each test sees a clean schema.
    await prisma.contentEntry.deleteMany();
    await prisma.contentTypeField.deleteMany();
    await prisma.contentType.deleteMany();
  });

  afterEach(async () => {
    await prisma.apiKey.deleteMany({
      where: { name: { startsWith: 'test-' } },
    });
  });

  it('returns 401 without auth', async () => {
    const res = await fetch('/api/schema/export');
    expect(res.status).toBe(401);
  });

  it('returns 403 INSUFFICIENT_SCOPE for an api key without schema:read', async () => {
    const key = await makeKey(['content:read']);
    const res = await fetch('/api/schema/export', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data?: { error?: string } };
    expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
  });

  it('returns 200 with a portable bundle for an api key with schema:read', async () => {
    await prisma.contentType.create({
      data: {
        identifier: 'TestThing',
        name: 'TestThing',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              order: 0,
            },
          ],
        },
      },
    });
    const key = await makeKey(['schema:read']);
    const res = await fetch('/api/schema/export', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      version: number;
      portable: boolean;
      contentTypes: Array<{ identifier: string }>;
      entries?: unknown;
    };
    expect(body.version).toBe(2);
    expect(body.portable).toBe(true);
    expect(body.contentTypes).toHaveLength(1);
    expect(body.contentTypes[0]?.identifier).toBe('TestThing');
    expect(body.entries).toBeUndefined();
  });

  it('returns 200 with a portable bundle for a session user', async () => {
    const loginRes = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: TEST_USERNAME,
        password: TEST_PASSWORD,
      }),
    });
    const cookies = loginRes.headers.getSetCookie();
    if (!cookies.length) throw new Error('login did not return cookie');
    const cookie = cookies.join('; ');
    const res = await fetch('/api/schema/export', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
  });
});
