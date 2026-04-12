import { describe, it, expect, beforeEach } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { resetRateLimitStore } from '../../utils/rateLimit';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

let _sessionCookie: string | null = null;

async function getSessionCookie(): Promise<string> {
  if (_sessionCookie) return _sessionCookie;
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@boject.com',
      password: 'password',
    }),
    headers: { 'Content-Type': 'application/json' },
  });
  const cookies = response.headers.getSetCookie();
  _sessionCookie = cookies.join('; ');
  return _sessionCookie;
}

type ContentTypeResponse = {
  id: string;
  name: string;
  description: string | null;
  fields: Array<{
    id: string;
    name: string;
    label: string;
    type: string;
    required: boolean;
    order: number;
    options: unknown;
  }>;
};

type FieldResponse = {
  id: string;
  name: string;
  label: string;
  type: string;
  required: boolean;
  order: number;
  options: unknown;
};

type ListResponse = {
  items: Array<{ id: string; name: string; [key: string]: unknown }>;
  total: number;
};

describe('Content Type endpoints', async () => {
  await setup({ dev: true });

  beforeEach(() => {
    resetRateLimitStore();
  });

  describe('POST /api/content-types', () => {
    it('creates a content type with fields', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Test Type ${Date.now()}`,
          description: 'A test content type',
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { name: 'body', label: 'Body', type: 'TEXTAREA' },
          ],
        },
      });
      expect(created.id).toBeDefined();
      expect(created.fields).toHaveLength(2);
      expect(created.fields[0]!.type).toBe('ENTRY_TITLE');
      expect(created.fields[0]!.order).toBe(0);
      expect(created.fields[1]!.order).toBe(1);
    });

    it('rejects missing ENTRY_TITLE field', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `No Title ${Date.now()}`,
          fields: [{ name: 'body', label: 'Body', type: 'TEXT' }],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects duplicate name', async () => {
      const cookie = await getSessionCookie();
      const name = `Dup Type ${Date.now()}`;
      await $fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        }),
      });
      expect(res.status).toBe(409);
    });

    it('rejects duplicate field names', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Dup Fields ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { name: 'title', label: 'Title 2', type: 'TEXT' },
          ],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid field name format', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Bad Name ${Date.now()}`,
          fields: [
            {
              name: 'Title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects more than one SLUG field', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Two Slugs ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { name: 'slug', label: 'Slug', type: 'SLUG' },
            { name: 'slug2', label: 'Slug 2', type: 'SLUG' },
          ],
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/content-types', () => {
    it('returns paginated content types', async () => {
      const { items, total } = await $fetch<ListResponse>(
        '/api/content-types',
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(total).toBeGreaterThanOrEqual(1);
      expect(items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/content-types/[id]', () => {
    it('returns content type with fields ordered by order', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Detail Type ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { name: 'summary', label: 'Summary', type: 'TEXT' },
            { name: 'count', label: 'Count', type: 'NUMBER' },
          ],
        },
      });
      const fetched = await $fetch<ContentTypeResponse>(
        `/api/content-types/${created.id}`,
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(fetched.fields).toHaveLength(3);
      expect(fetched.fields[0]!.order).toBe(0);
      expect(fetched.fields[1]!.order).toBe(1);
      expect(fetched.fields[2]!.order).toBe(2);
    });

    it('returns 404 for unknown id', async () => {
      const res = await fetch(
        '/api/content-types/00000000-0000-0000-0000-000000000000',
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/content-types/[id]', () => {
    it('updates name and description', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Update Type ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });
      const updated = await $fetch<ContentTypeResponse>(
        `/api/content-types/${created.id}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: { name: `Updated ${Date.now()}`, description: 'Updated desc' },
        }
      );
      expect(updated.description).toBe('Updated desc');
    });
  });

  describe('DELETE /api/content-types/[id]', () => {
    it('deletes a content type with no entries', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Delete Type ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });
      const res = await fetch(`/api/content-types/${created.id}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/content-types/[id]/fields', () => {
    it('adds a field with auto-incremented order', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Add ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });

      const field = await $fetch<FieldResponse>(
        `/api/content-types/${ct.id}/fields`,
        {
          method: 'POST',
          headers: { cookie },
          body: { name: 'summary', label: 'Summary', type: 'TEXT' },
        }
      );
      expect(field.id).toBeDefined();
      expect(field.name).toBe('summary');
      expect(field.order).toBe(1);
    });

    it('rejects adding a second ENTRY_TITLE field', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Dup ET ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });

      const res = await fetch(`/api/content-types/${ct.id}/fields`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'title2',
          label: 'Title 2',
          type: 'ENTRY_TITLE',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects adding a second SLUG field', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Dup Slug ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { name: 'slug', label: 'Slug', type: 'SLUG' },
          ],
        },
      });

      const res = await fetch(`/api/content-types/${ct.id}/fields`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'slug2',
          label: 'Slug 2',
          type: 'SLUG',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid field name format', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Bad Name ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });

      const res = await fetch(`/api/content-types/${ct.id}/fields`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'BadName',
          label: 'Bad',
          type: 'TEXT',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects duplicate field name', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Dup Name ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });

      const res = await fetch(`/api/content-types/${ct.id}/fields`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'title',
          label: 'Title Dup',
          type: 'TEXT',
        }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('PUT /api/content-types/[id]/fields/[fieldId]', () => {
    it('updates label and required', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Update ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { name: 'body', label: 'Body', type: 'TEXTAREA' },
          ],
        },
      });
      const fieldId = ct.fields[1]!.id;

      const updated = await $fetch<FieldResponse>(
        `/api/content-types/${ct.id}/fields/${fieldId}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: { label: 'Content Body', required: true },
        }
      );
      expect(updated.label).toBe('Content Body');
      expect(updated.required).toBe(true);
    });

    it('allows type change when no entries exist', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Type Change ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { name: 'count', label: 'Count', type: 'NUMBER' },
          ],
        },
      });
      const fieldId = ct.fields[1]!.id;

      const updated = await $fetch<FieldResponse>(
        `/api/content-types/${ct.id}/fields/${fieldId}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: { type: 'TEXT' },
        }
      );
      expect(updated.type).toBe('TEXT');
    });

    it('returns 404 for field not belonging to content type', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Wrong CT ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });

      const res = await fetch(
        `/api/content-types/${ct.id}/fields/10000000-0000-4000-a000-000000000000`,
        {
          method: 'PUT',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: 'Nope' }),
        }
      );
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/content-types/[id]/fields/[fieldId]', () => {
    it('deletes a non-essential field', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Delete ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { name: 'extra', label: 'Extra', type: 'TEXT' },
          ],
        },
      });
      const fieldId = ct.fields[1]!.id;

      const res = await fetch(`/api/content-types/${ct.id}/fields/${fieldId}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('blocks deleting the only ENTRY_TITLE field', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Del ET ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });
      const fieldId = ct.fields[0]!.id;

      const res = await fetch(`/api/content-types/${ct.id}/fields/${fieldId}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown field', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Del 404 ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });

      const res = await fetch(
        `/api/content-types/${ct.id}/fields/10000000-0000-4000-a000-000000000000`,
        {
          method: 'DELETE',
          headers: { cookie },
        }
      );
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/content-types/[id]/fields/reorder', () => {
    it('reorders fields and verifies new order', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Reorder ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { name: 'summary', label: 'Summary', type: 'TEXT' },
            { name: 'count', label: 'Count', type: 'NUMBER' },
          ],
        },
      });

      // Reverse the order
      await $fetch(`/api/content-types/${ct.id}/fields/reorder`, {
        method: 'PUT',
        headers: { cookie },
        body: {
          fields: [
            { id: ct.fields[0]!.id, order: 2 },
            { id: ct.fields[1]!.id, order: 1 },
            { id: ct.fields[2]!.id, order: 0 },
          ],
        },
      });

      // Fetch and verify new order
      const fetched = await $fetch<ContentTypeResponse>(
        `/api/content-types/${ct.id}`,
        {
          headers: { Authorization: `Bearer ${TEST_API_KEY}` },
        }
      );
      expect(fetched.fields[0]!.name).toBe('count');
      expect(fetched.fields[0]!.order).toBe(0);
      expect(fetched.fields[1]!.name).toBe('summary');
      expect(fetched.fields[1]!.order).toBe(1);
      expect(fetched.fields[2]!.name).toBe('title');
      expect(fetched.fields[2]!.order).toBe(2);
    });

    it('rejects fields not belonging to the content type', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Reorder Bad ${Date.now()}`,
          fields: [
            {
              name: 'title',
              label: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });

      const res = await fetch(`/api/content-types/${ct.id}/fields/reorder`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: [
            {
              id: '10000000-0000-4000-a000-000000000000',
              order: 0,
            },
          ],
        }),
      });
      expect(res.status).toBe(400);
    });
  });
});
