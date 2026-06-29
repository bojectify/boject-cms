import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { randomUUID } from 'node:crypto';
import { TEST_USERNAME, TEST_PASSWORD } from '../../../test/credentials';
import { resetRateLimitStore } from '../../../utils/rateLimit';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';
const bearer = { Authorization: `Bearer ${TEST_API_KEY}`, 'Content-Type': 'application/json' };

async function getSessionCookie(): Promise<string> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_USERNAME, password: TEST_PASSWORD }),
  });
  return res.headers.getSetCookie().join('; ');
}

describe('/api/public/entries (write surface)', async () => {
  await setup({ dev: true });

  const sfx = randomUUID().slice(0, 8);
  let contentTypeId = '';

  beforeAll(async () => {
    const cookie = await getSessionCookie();
    const ct = await $fetch<{ id: string }>('/api/content-types', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: {
        name: `PubWrite ${sfx}`,
        fields: [
          { identifier: 'title', name: 'Title', type: 'ENTRY_TITLE', required: true },
          { identifier: 'summary', name: 'Summary', type: 'TEXT' },
        ],
      },
    });
    contentTypeId = ct.id;
  });

  beforeEach(() => resetRateLimitStore());

  it('creates a DRAFT entry and returns id + entryKey', async () => {
    const res = await fetch('/api/public/entries', {
      method: 'POST',
      headers: bearer,
      body: JSON.stringify({ contentTypeId, data: { title: `A ${sfx}-${randomUUID().slice(0, 6)}` } }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; entryKey: string; status: string };
    expect(body.id).toBeTruthy();
    expect(body.entryKey).toBeTruthy();
    expect(body.status).toBe('DRAFT');
  });

  it('creates a PUBLISHED entry with publish:true', async () => {
    const res = await fetch('/api/public/entries', {
      method: 'POST',
      headers: bearer,
      body: JSON.stringify({ contentTypeId, publish: true, data: { title: `Pub ${sfx}-${randomUUID().slice(0, 6)}` } }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('PUBLISHED');
  });

  it('rejects a session-cookie caller with 401 (token-only namespace)', async () => {
    const cookie = await getSessionCookie();
    const res = await fetch('/api/public/entries', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentTypeId, data: { title: 'x' } }),
    });
    expect(res.status).toBe(401);
  });

  it('403 when the key lacks content:write', async () => {
    const cookie = await getSessionCookie();
    const created = await $fetch<{ rawKey: string }>('/api/apikeys', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: { name: `pub-nowrite ${sfx}`, scopes: ['content:read'] },
    });
    const res = await fetch('/api/public/entries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${created.rawKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentTypeId, data: { title: 'x' } }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data?: { error?: string; required?: string } };
    expect(body.data?.error).toBe('INSUFFICIENT_SCOPE');
    expect(body.data?.required).toBe('content:write');
  });

  it('PUT replaces data as a CHANGED draft when published, returns it', async () => {
    // seed a published entry
    const created = await fetch('/api/public/entries', {
      method: 'POST', headers: bearer,
      body: JSON.stringify({ contentTypeId, publish: true, data: { title: `Put ${sfx}-${randomUUID().slice(0,6)}`, summary: 'orig' } }),
    });
    const { id } = (await created.json()) as { id: string };

    const res = await fetch(`/api/public/entries/${id}`, {
      method: 'PUT', headers: bearer,
      body: JSON.stringify({ data: { title: `Put2 ${sfx}-${randomUUID().slice(0,6)}`, summary: 'replaced' } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; data: Record<string, unknown> };
    expect(body.status).toBe('CHANGED');
    expect(body.data.summary).toBe('replaced');
  });

  it('PUT with publish:true publishes the full body', async () => {
    const created = await fetch('/api/public/entries', {
      method: 'POST', headers: bearer,
      body: JSON.stringify({ contentTypeId, data: { title: `PutPub ${sfx}-${randomUUID().slice(0,6)}` } }),
    });
    const { id } = (await created.json()) as { id: string };
    const res = await fetch(`/api/public/entries/${id}`, {
      method: 'PUT', headers: bearer,
      body: JSON.stringify({ publish: true, data: { title: `PutPub2 ${sfx}-${randomUUID().slice(0,6)}`, summary: 'live' } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('PUBLISHED');
  });

  it('PUT 404s an unknown id', async () => {
    const res = await fetch(`/api/public/entries/${randomUUID()}`, {
      method: 'PUT', headers: bearer, body: JSON.stringify({ data: { title: 'x' } }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH merges a partial body onto the working version', async () => {
    const created = await fetch('/api/public/entries', {
      method: 'POST', headers: bearer,
      body: JSON.stringify({ contentTypeId, publish: true, data: { title: `Pat ${sfx}-${randomUUID().slice(0,6)}`, summary: 'keep' } }),
    });
    const { id } = (await created.json()) as { id: string };
    // PATCH only summary; title must survive (PATCH onto PUBLISHED-only ⇒ CHANGED = PUBLISHED+patch)
    const res = await fetch(`/api/public/entries/${id}`, {
      method: 'PATCH', headers: bearer,
      body: JSON.stringify({ data: { summary: 'patched' } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; data: Record<string, unknown> };
    expect(body.status).toBe('CHANGED');
    expect(body.data.summary).toBe('patched');
    expect(body.data.title).toBeTruthy(); // untouched, preserved from PUBLISHED base
  });

  it('PATCH null clears an optional field', async () => {
    const created = await fetch('/api/public/entries', {
      method: 'POST', headers: bearer,
      body: JSON.stringify({ contentTypeId, data: { title: `Clr ${sfx}-${randomUUID().slice(0,6)}`, summary: 'had value' } }),
    });
    const { id } = (await created.json()) as { id: string };
    const res = await fetch(`/api/public/entries/${id}`, {
      method: 'PATCH', headers: bearer, body: JSON.stringify({ data: { summary: null } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.summary ?? null).toBeNull();
  });

  it('PATCH rejects an unknown field with 400 UNKNOWN_FIELD', async () => {
    const created = await fetch('/api/public/entries', {
      method: 'POST', headers: bearer,
      body: JSON.stringify({ contentTypeId, data: { title: `Unk ${sfx}-${randomUUID().slice(0,6)}` } }),
    });
    const { id } = (await created.json()) as { id: string };
    const res = await fetch(`/api/public/entries/${id}`, {
      method: 'PATCH', headers: bearer, body: JSON.stringify({ data: { nope: 1 } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { data?: { error?: string; field?: string } };
    expect(body.data?.error).toBe('UNKNOWN_FIELD');
    expect(body.data?.field).toBe('nope');
  });

  it('PATCH clearing a required field 400s (validated against the merged result)', async () => {
    const created = await fetch('/api/public/entries', {
      method: 'POST', headers: bearer,
      body: JSON.stringify({ contentTypeId, data: { title: `Req ${sfx}-${randomUUID().slice(0,6)}` } }),
    });
    const { id } = (await created.json()) as { id: string };
    const res = await fetch(`/api/public/entries/${id}`, {
      method: 'PATCH', headers: bearer, body: JSON.stringify({ data: { title: null } }),
    });
    expect(res.status).toBe(400);
  });
});
