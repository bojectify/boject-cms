// apps/cms/server/api/schema/apply-readonly.test.ts
//
// Integration test for BOJECT_SCHEMA_READONLY on POST /api/schema/apply.
//
// IMPORTANT: This file boots a Nuxt dev server with the flag set.
// `useRuntimeConfig` snapshots the env at Nitro boot, so the env var
// must be set at module scope before `setup()` runs. Mirrors the
// pattern in `content-types-readonly.test.ts`.
/* eslint-disable import/first */
process.env.BOJECT_SCHEMA_READONLY = 'true';

import { fileURLToPath } from 'node:url';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../utils/prisma';
import { generateApiKey } from '../../utils/apiKey';
/* eslint-enable import/first */

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

const SAMPLE: { bundle: unknown } = {
  bundle: {
    version: 2,
    exportedAt: '2026-05-01T00:00:00.000Z',
    portable: true,
    contentTypes: [
      {
        id: null,
        identifier: 'ApiApplyArticleReadonly',
        name: 'ApiApplyArticleReadonly',
        description: null,
        fields: [
          {
            id: null,
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
            order: 0,
            options: null,
          },
        ],
      },
    ],
  },
};

describe('POST /api/schema/apply (BOJECT_SCHEMA_READONLY=true)', () => {
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

  it('returns 403 SCHEMA_READONLY when the readonly flag is on', async () => {
    const key = await makeKey(['schema:write']);
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
    expect(body.data?.error).toBe('SCHEMA_READONLY');
  });
});
