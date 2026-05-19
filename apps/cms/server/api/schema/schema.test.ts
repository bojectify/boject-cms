import { fileURLToPath } from 'node:url';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { prisma } from '../../utils/prisma';
import { generateApiKey } from '../../utils/apiKey';
import { FIELD_TYPES } from '../../../utils/fieldTypes';

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
              type: FIELD_TYPES.ENTRY_TITLE,
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

describe('POST /api/schema/apply', () => {
  beforeEach(async () => {
    await prisma.contentEntry.deleteMany();
    await prisma.contentTypeField.deleteMany();
    await prisma.contentType.deleteMany();
  });

  afterEach(async () => {
    await prisma.apiKey.deleteMany({
      where: { name: { startsWith: 'test-' } },
    });
  });

  const SAMPLE: { bundle: unknown } = {
    bundle: {
      version: 2,
      exportedAt: '2026-05-01T00:00:00.000Z',
      portable: true,
      contentTypes: [
        {
          id: null,
          identifier: 'ApiApplyArticle',
          name: 'ApiApplyArticle',
          description: null,
          fields: [
            {
              id: null,
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              order: 0,
              options: null,
            },
          ],
        },
      ],
    },
  };

  it('returns 401 without auth', async () => {
    const res = await fetch('/api/schema/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SAMPLE),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 INSUFFICIENT_SCOPE for a key without schema:write', async () => {
    const key = await makeKey(['schema:read']);
    const res = await fetch('/api/schema/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(SAMPLE),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data?: { error?: string } };
    expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
  });

  it('returns 200 with apply result on success (api key)', async () => {
    const key = await makeKey(['schema:write']);
    const res = await fetch('/api/schema/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(SAMPLE),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      changed: boolean;
      applied: { contentTypesCreated: number };
    };
    expect(body.changed).toBe(true);
    expect(body.applied.contentTypesCreated).toBe(1);
    const inDb = await prisma.contentType.findUnique({
      where: { identifier: 'ApiApplyArticle' },
    });
    expect(inDb).not.toBeNull();
  });

  it('returns 400 BUNDLE_INVALID for a malformed bundle', async () => {
    const key = await makeKey(['schema:write']);
    const res = await fetch('/api/schema/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        bundle: {
          version: 2,
          exportedAt: 'x',
          portable: true,
          contentTypes: [{ identifier: 'X' }],
        },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      data?: { error?: string; errors?: unknown };
    };
    expect(body.data?.error).toBe('BUNDLE_INVALID');
    expect(Array.isArray(body.data?.errors)).toBe(true);
  });

  it('returns 400 SCHEMA_APPLY_BLOCKED with blockers and plan', async () => {
    // Seed a type + entry, then send an empty bundle without
    // allowDestructive — the planner blocks the removal.
    await prisma.contentType.create({
      data: {
        identifier: 'BlockedType',
        name: 'BlockedType',
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: FIELD_TYPES.ENTRY_TITLE,
              required: true,
              order: 0,
            },
          ],
        },
      },
    });
    const ct = await prisma.contentType.findUniqueOrThrow({
      where: { identifier: 'BlockedType' },
    });
    await prisma.contentEntry.create({
      data: {
        contentTypeId: ct.id,
        entryTitle: 'X',
        entryKey: 'x',
        slug: 'x',
        versions: {
          create: {
            data: { title: 'X' },
            entryTitle: 'X',
            status: 'PUBLISHED',
          },
        },
      },
    });
    const key = await makeKey(['schema:write']);
    const res = await fetch('/api/schema/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        bundle: {
          version: 2,
          exportedAt: '2026-05-01T00:00:00.000Z',
          portable: true,
          contentTypes: [],
        },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      data?: {
        error?: string;
        blockers?: Array<{ code: string }>;
        plan?: unknown;
      };
    };
    expect(body.data?.error).toBe('SCHEMA_APPLY_BLOCKED');
    expect(Array.isArray(body.data?.blockers)).toBe(true);
    expect(body.data?.blockers?.[0]?.code).toBe(
      'CONTENT_TYPE_REMOVAL_WITH_ENTRIES'
    );
  });

  it('honours dryRun in the body — returns success without mutating', async () => {
    const key = await makeKey(['schema:write']);
    const res = await fetch('/api/schema/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ ...SAMPLE, dryRun: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      changed: boolean;
      applied: { contentTypesCreated: number };
    };
    expect(body.changed).toBe(true);
    expect(body.applied.contentTypesCreated).toBe(1);
    const inDb = await prisma.contentType.findUnique({
      where: { identifier: 'ApiApplyArticle' },
    });
    expect(inDb).toBeNull();
  });

  // The SCHEMA_READONLY test for /api/schema/apply lives in
  // `apply-readonly.test.ts` — `useRuntimeConfig` snapshots
  // `BOJECT_SCHEMA_READONLY` at Nitro boot, so the env var must be set
  // before `setup()` runs. Mirrors the pattern used by
  // `content-types-readonly.test.ts`.
});
