import { describe, it, expect, beforeAll } from 'vitest';
import { setup, fetch } from '@nuxt/test-utils/e2e';
import { resetRateLimitStore } from '../../utils/rateLimit';
import { prisma } from '../../utils/prisma';

let _sessionCookie: string | null = null;
async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password' }),
  });
  _sessionCookie = response.headers.getSetCookie().join('; ');
  return _sessionCookie;
}

async function deliveriesFor(webhookId: string) {
  return prisma.webhookDelivery.findMany({
    where: { webhookId, event: 'CONTENT_TYPE_SCHEMA_CHANGED' },
    orderBy: { createdAt: 'asc' },
  });
}

describe('CONTENT_TYPE_SCHEMA_CHANGED fires from field endpoints', async () => {
  await setup({ dev: true });
  beforeAll(() => resetRateLimitStore());

  it('fires on add / update / reorder / delete with entryId null', async () => {
    const cookie = await getSessionCookie();
    const json = { 'Content-Type': 'application/json', Cookie: cookie };

    const whRes = await fetch('/api/webhooks', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        name: 'schema-sub',
        url: 'https://example.com/schema',
        events: ['CONTENT_TYPE_SCHEMA_CHANGED'],
        contentTypeIds: [],
      }),
    });
    expect(whRes.status).toBe(201);
    const webhook = (await whRes.json()) as { id: string };

    const ctRes = await fetch('/api/content-types', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        name: 'Schema Probe',
        fields: [{ name: 'Title', identifier: 'title', type: 'ENTRY_TITLE' }],
      }),
    });
    expect(ctRes.status).toBe(201);
    const ct = (await ctRes.json()) as { id: string; identifier: string };

    const addRes = await fetch(`/api/content-types/${ct.id}/fields`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ name: 'Body', identifier: 'body', type: 'TEXT' }),
    });
    expect(addRes.status).toBe(201);
    const addedField = (await addRes.json()) as { id: string };

    const putRes = await fetch(
      `/api/content-types/${ct.id}/fields/${addedField.id}`,
      {
        method: 'PUT',
        headers: json,
        body: JSON.stringify({ name: 'Body Text' }),
      }
    );
    expect(putRes.status).toBe(200);

    const reorderRes = await fetch(
      `/api/content-types/${ct.id}/fields/reorder`,
      {
        method: 'PUT',
        headers: json,
        body: JSON.stringify({ fields: [{ id: addedField.id, order: 0 }] }),
      }
    );
    expect(reorderRes.status).toBe(200);

    const delRes = await fetch(
      `/api/content-types/${ct.id}/fields/${addedField.id}`,
      { method: 'DELETE', headers: json }
    );
    expect(delRes.status).toBe(200);

    const deliveries = await deliveriesFor(webhook.id);
    expect(deliveries).toHaveLength(4);
    for (const d of deliveries) {
      expect(d.event).toBe('CONTENT_TYPE_SCHEMA_CHANGED');
      expect(d.entryId).toBeNull();
      expect(d.contentTypeId).toBe(ct.id);
      const payload = d.payload as Record<string, unknown>;
      expect(payload.event).toBe('CONTENT_TYPE_SCHEMA_CHANGED');
      expect(payload.contentTypeId).toBe(ct.id);
      expect(payload.contentTypeIdentifier).toBe(ct.identifier);
      expect(typeof payload.occurredAt).toBe('string');
      expect(typeof payload.deliveryId).toBe('string');
    }
  });

  it('does not fire for a webhook not subscribed to the event', async () => {
    const cookie = await getSessionCookie();
    const json = { 'Content-Type': 'application/json', Cookie: cookie };

    const whRes = await fetch('/api/webhooks', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        name: 'entry-only',
        url: 'https://example.com/entry',
        events: ['ENTRY_PUBLISHED'],
        contentTypeIds: [],
      }),
    });
    const webhook = (await whRes.json()) as { id: string };

    const ctRes = await fetch('/api/content-types', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        name: 'Schema Probe 2',
        fields: [{ name: 'Title', identifier: 'title', type: 'ENTRY_TITLE' }],
      }),
    });
    const ct = (await ctRes.json()) as { id: string };

    await fetch(`/api/content-types/${ct.id}/fields`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ name: 'Body', identifier: 'body', type: 'TEXT' }),
    });

    expect(await deliveriesFor(webhook.id)).toHaveLength(0);
  });
});
