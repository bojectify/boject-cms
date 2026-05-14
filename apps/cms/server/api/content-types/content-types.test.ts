import { describe, it, expect, beforeEach } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { resetRateLimitStore } from '../../utils/rateLimit';
import { parseFieldOptions } from '../../../utils/fieldOptions';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

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

type ContentTypeResponse = {
  id: string;
  name: string;
  identifier: string;
  description: string | null;
  fields: Array<{
    id: string;
    identifier: string;
    name: string;
    type: string;
    required: boolean;
    unique: boolean;
    order: number;
    options: unknown;
  }>;
};

type FieldResponse = {
  id: string;
  identifier: string;
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
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
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'body', name: 'Body', type: 'TEXTAREA' },
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
          fields: [{ identifier: 'body', name: 'Body', type: 'TEXT' }],
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
              identifier: 'title',
              name: 'Title',
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
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        }),
      });
      expect(res.status).toBe(409);
    });

    it('rejects duplicate field identifiers', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Dup Fields ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'title', name: 'Title 2', type: 'TEXT' },
          ],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid field identifier format', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Bad Name ${Date.now()}`,
          fields: [
            {
              identifier: 'Title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('auto-sets unique=true on ENTRY_TITLE and SLUG during content type creation', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Unique Auto ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'slug', name: 'Slug', type: 'SLUG' },
            { identifier: 'summary', name: 'Summary', type: 'TEXT' },
          ],
        },
      });
      const titleField = created.fields.find((f) => f.type === 'ENTRY_TITLE');
      const slugField = created.fields.find((f) => f.type === 'SLUG');
      const textField = created.fields.find((f) => f.identifier === 'summary');
      expect(titleField!.unique).toBe(true);
      expect(slugField!.unique).toBe(true);
      expect(textField!.unique).toBe(false);
    });

    it('accepts unique=true on TEXT and NUMBER fields in content type creation', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Unique TN ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: 'sku',
              name: 'SKU',
              type: 'TEXT',
              unique: true,
            },
            {
              identifier: 'serial',
              name: 'Serial',
              type: 'NUMBER',
              unique: true,
            },
          ],
        },
      });
      const textField = created.fields.find((f) => f.identifier === 'sku');
      const numberField = created.fields.find((f) => f.identifier === 'serial');
      expect(textField!.unique).toBe(true);
      expect(numberField!.unique).toBe(true);
    });

    it('rejects unique=true on a BOOLEAN field during content type creation', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Unique Bool ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: 'flag',
              name: 'Flag',
              type: 'BOOLEAN',
              unique: true,
            },
          ],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects RELATION field with non-array targetContentTypeIds (Site 1a)', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Relation Non-Array ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: 'link',
              name: 'Link',
              type: 'RELATION',
              options: { targetContentTypeIds: 'not-an-array' },
            },
          ],
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      const message = body.statusMessage ?? body.message ?? '';
      expect(message).toContain('must be an array');
    });

    it('rejects RICHTEXT field with non-array targetContentTypeIds (Site 1b)', async () => {
      const cookie = await getSessionCookie();
      const res = await fetch('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Richtext Non-Array ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: 'body',
              name: 'Body',
              type: 'RICHTEXT',
              options: { targetContentTypeIds: 'not-an-array' },
            },
          ],
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      const message = body.statusMessage ?? body.message ?? '';
      expect(message).toContain('must be an array');
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
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'slug', name: 'Slug', type: 'SLUG' },
            { identifier: 'slug2', name: 'Slug 2', type: 'SLUG' },
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
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'summary', name: 'Summary', type: 'TEXT' },
            { identifier: 'count', name: 'Count', type: 'NUMBER' },
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
              identifier: 'title',
              name: 'Title',
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

    it('rejects changing the identifier with 400', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Immutable Type ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });

      await expect(
        $fetch<ContentTypeResponse>(`/api/content-types/${created.id}`, {
          method: 'PUT',
          headers: { cookie },
          body: { identifier: 'RenamedType' },
        })
      ).rejects.toMatchObject({ statusCode: 400 });

      const reloaded = await $fetch<ContentTypeResponse>(
        `/api/content-types/${created.id}`,
        { headers: { cookie } }
      );
      expect(reloaded.identifier).toBe(created.identifier);
    });

    it('accepts the existing identifier as a no-op', async () => {
      const cookie = await getSessionCookie();
      const created = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Roundtrip Type ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
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
          body: {
            name: `Roundtrip Updated ${Date.now()}`,
            identifier: created.identifier,
          },
        }
      );
      expect(updated.identifier).toBe(created.identifier);
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
              identifier: 'title',
              name: 'Title',
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
              identifier: 'title',
              name: 'Title',
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
          body: { identifier: 'summary', name: 'Summary', type: 'TEXT' },
        }
      );
      expect(field.id).toBeDefined();
      expect(field.identifier).toBe('summary');
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
              identifier: 'title',
              name: 'Title',
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
          identifier: 'title2',
          name: 'Title 2',
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
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'slug', name: 'Slug', type: 'SLUG' },
          ],
        },
      });

      const res = await fetch(`/api/content-types/${ct.id}/fields`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'slug2',
          name: 'Slug 2',
          type: 'SLUG',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid field identifier format', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Bad Name ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
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
          identifier: 'BadName',
          name: 'Bad',
          type: 'TEXT',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects duplicate field identifier', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Dup Name ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
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
          identifier: 'title',
          name: 'Title Dup',
          type: 'TEXT',
        }),
      });
      expect(res.status).toBe(409);
    });

    it('adds a RICHTEXT field', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Richtext Test ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
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
          body: { identifier: 'body', name: 'Body', type: 'RICHTEXT' },
        }
      );

      expect(field.type).toBe('RICHTEXT');
      expect(field.identifier).toBe('body');
    });

    it('creates a RELATION field with targetContentTypeIds', async () => {
      const cookie = await getSessionCookie();
      const target = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Relation Target ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });

      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Has Relation ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: 'relatedItem',
              name: 'Related Item',
              type: 'RELATION',
              options: { targetContentTypeIds: [target.id] },
            },
          ],
        },
      });

      const relField = ct.fields.find((f) => f.type === 'RELATION');
      expect(relField).toBeDefined();
      const relOpts = parseFieldOptions(relField!);
      expect(
        relOpts.type === 'RELATION' ? relOpts.targetContentTypeIds : []
      ).toContain(target.id);
    });

    it('rejects RELATION field without targetContentTypeIds', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `No Targets ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
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
          identifier: 'link',
          name: 'Link',
          type: 'RELATION',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('auto-sets unique=true when adding an ENTRY_TITLE or SLUG via POST /fields', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Auto Unique Slug ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
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
          body: { identifier: 'slug', name: 'Slug', type: 'SLUG' },
        }
      );
      expect(field.unique).toBe(true);
    });

    it('accepts unique=true when adding a TEXT field via POST /fields', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Accept Unique Text ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
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
          body: {
            identifier: 'sku',
            name: 'SKU',
            type: 'TEXT',
            unique: true,
          },
        }
      );
      expect(field.unique).toBe(true);
    });

    it('rejects unique=true on a RICHTEXT field via POST /fields', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Reject Unique Richtext ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
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
          identifier: 'body',
          name: 'Body',
          type: 'RICHTEXT',
          unique: true,
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects RELATION field with non-existent targetContentTypeId', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Bad Target ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
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
          identifier: 'link',
          name: 'Link',
          type: 'RELATION',
          options: {
            targetContentTypeIds: ['00000000-0000-0000-0000-000000000000'],
          },
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/content-types/[id]/fields/[fieldId]', () => {
    it('updates name and required', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Update ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'body', name: 'Body', type: 'TEXTAREA' },
          ],
        },
      });
      const fieldId = ct.fields[1]!.id;

      const updated = await $fetch<FieldResponse>(
        `/api/content-types/${ct.id}/fields/${fieldId}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: { name: 'Content Body', required: true },
        }
      );
      expect(updated.name).toBe('Content Body');
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
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'count', name: 'Count', type: 'NUMBER' },
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
              identifier: 'title',
              name: 'Title',
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
          body: JSON.stringify({ name: 'Nope' }),
        }
      );
      expect(res.status).toBe(404);
    });

    it('allows toggling unique=true on an empty TEXT field', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Unique Toggle On ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'sku', name: 'SKU', type: 'TEXT' },
          ],
        },
      });
      const fieldId = ct.fields[1]!.id;

      const updated = await $fetch<FieldResponse>(
        `/api/content-types/${ct.id}/fields/${fieldId}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: { unique: true },
        }
      );
      expect(updated.unique).toBe(true);
    });

    it('allows toggling unique=false on a user-configurable field', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Unique Toggle Off ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: 'sku',
              name: 'SKU',
              type: 'TEXT',
              unique: true,
            },
          ],
        },
      });
      const fieldId = ct.fields[1]!.id;

      const updated = await $fetch<FieldResponse>(
        `/api/content-types/${ct.id}/fields/${fieldId}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: { unique: false },
        }
      );
      expect(updated.unique).toBe(false);
    });

    it('rejects setting unique=false on ENTRY_TITLE', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Unique Title Reject ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });
      const fieldId = ct.fields[0]!.id;

      const res = await fetch(`/api/content-types/${ct.id}/fields/${fieldId}`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unique: false }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects setting unique=false on SLUG', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Unique Slug Reject ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'slug', name: 'Slug', type: 'SLUG' },
          ],
        },
      });
      const slugField = ct.fields.find((f) => f.type === 'SLUG')!;

      const res = await fetch(
        `/api/content-types/${ct.id}/fields/${slugField.id}`,
        {
          method: 'PUT',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ unique: false }),
        }
      );
      expect(res.status).toBe(400);
    });

    it('rejects setting unique=true on a BOOLEAN field', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Unique Boolean Reject ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'active', name: 'Active', type: 'BOOLEAN' },
          ],
        },
      });
      const fieldId = ct.fields[1]!.id;

      const res = await fetch(`/api/content-types/${ct.id}/fields/${fieldId}`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unique: true }),
      });
      expect(res.status).toBe(400);
    });

    it('blocks enabling unique on a TEXT field with existing duplicates', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Unique Dup Block ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'code', name: 'Code', type: 'TEXT' },
          ],
        },
      });
      const fieldId = ct.fields.find((f) => f.identifier === 'code')!.id;

      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Entry A ${Date.now()}`, code: 'DUP' },
        },
      });
      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Entry B ${Date.now()}`, code: 'DUP' },
        },
      });

      const res = await fetch(`/api/content-types/${ct.id}/fields/${fieldId}`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unique: true }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.data.error).toBe('UNIQUE_CONFLICT');
      expect(Array.isArray(body.data.conflicts)).toBe(true);
      const group = body.data.conflicts.find(
        (c: { value: unknown; entryIds: string[] }) => c.value === 'DUP'
      );
      expect(group).toBeDefined();
      expect(group.entryIds.length).toBeGreaterThanOrEqual(2);
    });

    it('blocks enabling unique on a NUMBER field with existing duplicates', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Unique Num Dup Block ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'issue', name: 'Issue', type: 'NUMBER' },
          ],
        },
      });
      const fieldId = ct.fields.find((f) => f.identifier === 'issue')!.id;

      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Entry A ${Date.now()}`, issue: 7 },
        },
      });
      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Entry B ${Date.now()}`, issue: 7 },
        },
      });

      const res = await fetch(`/api/content-types/${ct.id}/fields/${fieldId}`, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unique: true }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.data.error).toBe('UNIQUE_CONFLICT');
      expect(Array.isArray(body.data.conflicts)).toBe(true);
      const group = body.data.conflicts.find(
        (c: { value: unknown; entryIds: string[] }) =>
          c.value === 7 && typeof c.value === 'number'
      );
      expect(group).toBeDefined();
      expect(group.entryIds.length).toBeGreaterThanOrEqual(2);
    });

    it('allows enabling unique on a TEXT field when all values are distinct', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Unique Distinct ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'code', name: 'Code', type: 'TEXT' },
          ],
        },
      });
      const fieldId = ct.fields.find((f) => f.identifier === 'code')!.id;

      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Entry A ${Date.now()}`, code: 'ONE' },
        },
      });
      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Entry B ${Date.now()}`, code: 'TWO' },
        },
      });

      const updated = await $fetch<FieldResponse>(
        `/api/content-types/${ct.id}/fields/${fieldId}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: { unique: true },
        }
      );
      expect(updated.unique).toBe(true);
    });

    it('ignores null/empty values when detecting duplicates on toggle', async () => {
      const cookie = await getSessionCookie();
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: `Field Unique Null Empty ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'code', name: 'Code', type: 'TEXT' },
          ],
        },
      });
      const fieldId = ct.fields.find((f) => f.identifier === 'code')!.id;

      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Entry Empty ${Date.now()}`, code: '' },
        },
      });
      await $fetch('/api/content-entries', {
        method: 'POST',
        headers: { cookie },
        body: {
          contentTypeId: ct.id,
          data: { title: `Entry Null ${Date.now()}`, code: null },
        },
      });

      const updated = await $fetch<FieldResponse>(
        `/api/content-types/${ct.id}/fields/${fieldId}`,
        {
          method: 'PUT',
          headers: { cookie },
          body: { unique: true },
        }
      );
      expect(updated.unique).toBe(true);
    });

    // Tests below run from a distinct X-Forwarded-For so they bucket separately
    // from the rest of the suite under the in-memory mutation rate limiter.
    // The dev server's bucket can't be reset from the test process, so without
    // this header the new tests would push neighbouring tests over 50/60s.
    it('rejects RELATION options PUT with non-array targetContentTypeIds (#214)', async () => {
      const cookie = await getSessionCookie();
      const target = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.214' },
        body: {
          name: `PUT Rel Target ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.214' },
        body: {
          name: `PUT Rel Source A ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: 'link',
              name: 'Link',
              type: 'RELATION',
              options: { targetContentTypeIds: [target.id] },
            },
          ],
        },
      });
      const fieldId = ct.fields.find((f) => f.type === 'RELATION')!.id;

      const res = await fetch(`/api/content-types/${ct.id}/fields/${fieldId}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.214',
        },
        body: JSON.stringify({
          options: { targetContentTypeIds: 'not-an-array' },
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      const message = body.statusMessage ?? body.message ?? '';
      expect(message).toContain('must be an array');
    });

    it('rejects RELATION options PUT with non-UUID targetContentTypeIds (#214)', async () => {
      const cookie = await getSessionCookie();
      const target = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.214' },
        body: {
          name: `PUT Rel Target ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.214' },
        body: {
          name: `PUT Rel Source B ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: 'link',
              name: 'Link',
              type: 'RELATION',
              options: { targetContentTypeIds: [target.id] },
            },
          ],
        },
      });
      const fieldId = ct.fields.find((f) => f.type === 'RELATION')!.id;

      const res = await fetch(`/api/content-types/${ct.id}/fields/${fieldId}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.214',
        },
        body: JSON.stringify({
          options: { targetContentTypeIds: ['not-a-uuid'] },
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      const message = body.statusMessage ?? body.message ?? '';
      expect(message).toContain('Invalid UUID');
    });

    it('rejects RELATION options PUT with empty targetContentTypeIds (#214)', async () => {
      const cookie = await getSessionCookie();
      const target = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.214' },
        body: {
          name: `PUT Rel Target ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.214' },
        body: {
          name: `PUT Rel Source C ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: 'link',
              name: 'Link',
              type: 'RELATION',
              options: { targetContentTypeIds: [target.id] },
            },
          ],
        },
      });
      const fieldId = ct.fields.find((f) => f.type === 'RELATION')!.id;

      const res = await fetch(`/api/content-types/${ct.id}/fields/${fieldId}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.214',
        },
        body: JSON.stringify({
          options: { targetContentTypeIds: [] },
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      const message = body.statusMessage ?? body.message ?? '';
      expect(message).toContain('non-empty array');
    });

    it('rejects RELATION options PUT referencing a non-existent content type (#214)', async () => {
      const cookie = await getSessionCookie();
      const target = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.214' },
        body: {
          name: `PUT Rel Target ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.214' },
        body: {
          name: `PUT Rel Source D ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: 'link',
              name: 'Link',
              type: 'RELATION',
              options: { targetContentTypeIds: [target.id] },
            },
          ],
        },
      });
      const fieldId = ct.fields.find((f) => f.type === 'RELATION')!.id;

      const res = await fetch(`/api/content-types/${ct.id}/fields/${fieldId}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.214',
        },
        body: JSON.stringify({
          options: {
            targetContentTypeIds: ['00000000-0000-0000-0000-000000000000'],
          },
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      const message = body.statusMessage ?? body.message ?? '';
      expect(message).toContain('do not reference existing');
    });

    it('rejects MULTIRELATION options PUT with non-array targetContentTypeIds (#214)', async () => {
      const cookie = await getSessionCookie();
      const target = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.214' },
        body: {
          name: `PUT MRel Target ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.214' },
        body: {
          name: `PUT MRel Source ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: 'links',
              name: 'Links',
              type: 'MULTIRELATION',
              options: { targetContentTypeIds: [target.id] },
            },
          ],
        },
      });
      const fieldId = ct.fields.find((f) => f.type === 'MULTIRELATION')!.id;

      const res = await fetch(`/api/content-types/${ct.id}/fields/${fieldId}`, {
        method: 'PUT',
        headers: {
          cookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.214',
        },
        body: JSON.stringify({
          options: { targetContentTypeIds: 'not-an-array' },
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      const message = body.statusMessage ?? body.message ?? '';
      expect(message).toContain('must be an array');
    });

    it('accepts RELATION options PUT with valid existing targetContentTypeIds (#214)', async () => {
      const cookie = await getSessionCookie();
      const targetA = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.214' },
        body: {
          name: `PUT Rel TargetA ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });
      const targetB = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.214' },
        body: {
          name: `PUT Rel TargetB ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
          ],
        },
      });
      const ct = await $fetch<ContentTypeResponse>('/api/content-types', {
        method: 'POST',
        headers: { cookie, 'X-Forwarded-For': '203.0.113.214' },
        body: {
          name: `PUT Rel Source E ${Date.now()}`,
          fields: [
            {
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            {
              identifier: 'link',
              name: 'Link',
              type: 'RELATION',
              options: { targetContentTypeIds: [targetA.id] },
            },
          ],
        },
      });
      const fieldId = ct.fields.find((f) => f.type === 'RELATION')!.id;

      const updated = await $fetch<FieldResponse>(
        `/api/content-types/${ct.id}/fields/${fieldId}`,
        {
          method: 'PUT',
          headers: { cookie, 'X-Forwarded-For': '203.0.113.214' },
          body: {
            options: { targetContentTypeIds: [targetA.id, targetB.id] },
          },
        }
      );
      const opts = parseFieldOptions({
        type: 'RELATION',
        options: updated.options,
      });
      expect(opts.type === 'RELATION' ? opts.targetContentTypeIds : []).toEqual(
        [targetA.id, targetB.id]
      );
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
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'extra', name: 'Extra', type: 'TEXT' },
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
              identifier: 'title',
              name: 'Title',
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
              identifier: 'title',
              name: 'Title',
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

  describe('GET /api/content-types/options', () => {
    it('returns content types as label/value pairs', async () => {
      const cookie = await getSessionCookie();
      const options = await $fetch<{ label: string; value: string }[]>(
        '/api/content-types/options',
        { headers: { cookie } }
      );
      expect(Array.isArray(options)).toBe(true);
      expect(options.length).toBeGreaterThan(0);
      expect(options[0]).toHaveProperty('label');
      expect(options[0]).toHaveProperty('value');
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
              identifier: 'title',
              name: 'Title',
              type: 'ENTRY_TITLE',
              required: true,
            },
            { identifier: 'summary', name: 'Summary', type: 'TEXT' },
            { identifier: 'count', name: 'Count', type: 'NUMBER' },
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
      expect(fetched.fields[0]!.identifier).toBe('count');
      expect(fetched.fields[0]!.order).toBe(0);
      expect(fetched.fields[1]!.identifier).toBe('summary');
      expect(fetched.fields[1]!.order).toBe(1);
      expect(fetched.fields[2]!.identifier).toBe('title');
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
              identifier: 'title',
              name: 'Title',
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
