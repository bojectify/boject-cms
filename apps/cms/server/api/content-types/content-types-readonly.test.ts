// apps/cms/server/api/content-types/content-types-readonly.test.ts
//
// Integration tests for the BOJECT_SCHEMA_READONLY flag.
//
// IMPORTANT: This file boots a second Nuxt dev server with the flag
// set. Setting BOJECT_SCHEMA_READONLY at module scope (before
// `setup()` is called) ensures Nitro picks it up when reading
// runtimeConfig at server boot. Do not move this assignment inside
// `describe` or `beforeAll` — it must run before `setup`.
/* eslint-disable import/first */
process.env.BOJECT_SCHEMA_READONLY = 'true';

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { resetRateLimitStore } from '../../utils/rateLimit';
import { getTestDatabaseUrl } from '../../../test/dbUrl';
/* eslint-enable import/first */

const prismaUrl = getTestDatabaseUrl();
const prismaAdapter = new PrismaPg({ connectionString: prismaUrl });
const prisma = new PrismaClient({ adapter: prismaAdapter });

let _sessionCookie: string | null = null;

async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: TEST_USERNAME,
      password: TEST_PASSWORD,
    }),
    headers: { 'Content-Type': 'application/json' },
  });
  const cookies = response.headers.getSetCookie();
  _sessionCookie = cookies.join('; ');
  return _sessionCookie;
}

interface SeededContentType {
  id: string;
  fieldId: string;
}

// Tasks 5-10 will consume this via HTTP endpoints (PUT/DELETE/fields etc.).
let seeded: SeededContentType;

describe('Schema read-only flag (BOJECT_SCHEMA_READONLY=true)', async () => {
  await setup({ dev: true });

  beforeAll(async () => {
    // Seed via direct Prisma so we have real IDs to poke. Direct DB
    // writes bypass the readonly guard (it lives in the HTTP handlers,
    // not at the model layer) — that's correct: the entrypoint's
    // boot-time apply path also goes via Prisma directly and must
    // continue to work even on a readonly instance.
    const ct = await prisma.contentType.create({
      data: {
        name: `Readonly Seed ${Date.now()}`,
        identifier: `ReadonlySeed${Date.now()}`,
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              unique: true,
              order: 0,
            },
          ],
        },
      },
      include: { fields: true },
    });
    seeded = { id: ct.id, fieldId: ct.fields[0]!.id };
  });

  beforeEach(() => {
    resetRateLimitStore();
  });

  // Per-endpoint tests land in Tasks 4-10.
  // Negative tests (reads, content-entries, CSRF order) land in Task 11.

  it('returns 403 SCHEMA_READONLY on POST /api/content-types', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch('/api/content-types', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Should Not Create ${Date.now()}`,
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
          },
        ],
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data?: { error?: string } };
    expect(body.data?.error).toBe('SCHEMA_READONLY');
  });

  it('returns 403 SCHEMA_READONLY on PUT /api/content-types/[id]', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch(`/api/content-types/${seeded.id}`, {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data?: { error?: string } };
    expect(body.data?.error).toBe('SCHEMA_READONLY');
  });

  it('returns 403 SCHEMA_READONLY on DELETE /api/content-types/[id]', async () => {
    const cookie = await getSessionCookie();
    // Create a fresh content type via direct Prisma so we have a
    // disposable target — the seeded type is reused by negative tests.
    const target = await prisma.contentType.create({
      data: {
        name: `Disposable ${Date.now()}`,
        identifier: `Disposable${Date.now()}`,
        fields: {
          create: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
              unique: true,
              order: 0,
            },
          ],
        },
      },
    });
    const res = await fetch(`/api/content-types/${target.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data?: { error?: string } };
    expect(body.data?.error).toBe('SCHEMA_READONLY');
  });

  it('returns 403 SCHEMA_READONLY on POST /api/content-types/[id]/fields', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch(`/api/content-types/${seeded.id}/fields`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'shouldNotCreate',
        name: 'Should Not Create',
        type: 'TEXT',
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data?: { error?: string } };
    expect(body.data?.error).toBe('SCHEMA_READONLY');
  });

  it('returns 403 SCHEMA_READONLY on PUT /api/content-types/[id]/fields/[fieldId]', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch(
      `/api/content-types/${seeded.id}/fields/${seeded.fieldId}`,
      {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed Title' }),
      }
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data?: { error?: string } };
    expect(body.data?.error).toBe('SCHEMA_READONLY');
  });

  it('returns 403 SCHEMA_READONLY on DELETE /api/content-types/[id]/fields/[fieldId]', async () => {
    const cookie = await getSessionCookie();
    // Add a disposable field to the seeded type via direct Prisma —
    // we need a non-ENTRY_TITLE field because deleting the only
    // ENTRY_TITLE is otherwise blocked at handler layer with 400.
    const field = await prisma.contentTypeField.create({
      data: {
        contentTypeId: seeded.id,
        identifier: `disposable${Date.now()}`,
        name: 'Disposable',
        type: 'TEXT',
        required: false,
        unique: false,
        order: 99,
      },
    });
    const res = await fetch(
      `/api/content-types/${seeded.id}/fields/${field.id}`,
      { method: 'DELETE', headers: { cookie } }
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data?: { error?: string } };
    expect(body.data?.error).toBe('SCHEMA_READONLY');
  });

  it('returns 403 SCHEMA_READONLY on PUT /api/content-types/[id]/fields/reorder', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch(`/api/content-types/${seeded.id}/fields/reorder`, {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: [{ id: seeded.fieldId, order: 0 }],
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data?: { error?: string } };
    expect(body.data?.error).toBe('SCHEMA_READONLY');
  });

  describe('boundary — non-schema endpoints unaffected', () => {
    it('GET /api/content-types still returns 200', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-types', {
        headers: { cookie },
      });
      expect(res.status).toBe(200);
    });

    it('POST /api/content-entries succeeds against the seeded type', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentTypeId: seeded.id,
          data: { title: `Entry ${Date.now()}` },
        }),
      });
      // Content-entry mutations are deliberately not gated by the
      // readonly flag — the flag draws a line at schema editing only.
      expect(res.status).toBe(201);
    });
  });

  describe('guard order', () => {
    it('CSRF middleware runs before the readonly guard', async () => {
      const cookie = await getSessionCookie();
      // CSRF middleware rejects same-origin-mismatch with 403 before
      // the handler runs. Without a valid Origin/Referer, this fails
      // CSRF; if the readonly guard fired first, the data.error would
      // be SCHEMA_READONLY. We expect a CSRF-shaped 403 instead.
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          // Mismatched origin to trigger CSRF rejection
          Origin: 'https://evil.example.com',
        },
        body: JSON.stringify({
          name: `Should Not Reach Handler ${Date.now()}`,
          fields: [],
        }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { data?: { error?: string } };
      // CSRF rejection has no data.error === 'SCHEMA_READONLY' marker.
      // If this assertion fails (data.error IS 'SCHEMA_READONLY'), the
      // readonly guard ran before CSRF, which would be a regression.
      expect(body.data?.error).not.toBe('SCHEMA_READONLY');
    });
  });
});
