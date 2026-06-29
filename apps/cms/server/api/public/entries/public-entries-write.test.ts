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
});
