import { describe, it, expect, beforeAll } from 'vitest';
import { setup, $fetch, fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { FIELD_TYPES } from '../../../utils/fieldTypes';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

type QueryField = {
  identifier: string;
  name: string;
  type: string;
  choices?: { label: string; value: string }[];
  targetContentTypeIds?: string[];
};

type QueryContentType = {
  id: string;
  identifier: string;
  name: string;
  fields: QueryField[];
};

type WithFieldsResponse = { items: QueryContentType[] };

type ContentTypeResponse = {
  id: string;
  name: string;
  identifier: string;
};

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

let articleType: ContentTypeResponse;

describe('GET /api/content-types/with-fields', async () => {
  await setup({ dev: true });

  beforeAll(async () => {
    const cookie = await getSessionCookie();
    articleType = await $fetch<ContentTypeResponse>('/api/content-types', {
      method: 'POST',
      headers: { cookie },
      body: {
        name: `With Fields Article ${Date.now()}`,
        fields: [
          {
            identifier: 'title',
            name: 'Title',
            type: FIELD_TYPES.ENTRY_TITLE,
            required: true,
          },
          {
            identifier: 'state',
            name: 'State',
            type: FIELD_TYPES.SELECT,
            options: { choices: ['Draft', 'Active'] },
          },
        ],
      },
    });
  });

  it('returns content types with mapped fields for a session user', async () => {
    const cookie = await getSessionCookie();
    const res = await $fetch<WithFieldsResponse>(
      '/api/content-types/with-fields',
      { headers: { cookie } }
    );

    expect(Array.isArray(res.items)).toBe(true);
    for (const ct of res.items) {
      expect(ct).toHaveProperty('id');
      expect(ct).toHaveProperty('identifier');
      expect(ct).toHaveProperty('name');
      expect(Array.isArray(ct.fields)).toBe(true);
    }

    const found = res.items.find((ct) => ct.id === articleType.id);
    expect(found).toBeDefined();
    expect(found!.identifier).toBe(articleType.identifier);

    const selectField = found!.fields.find((f) => f.identifier === 'state');
    expect(selectField).toBeDefined();
    expect(selectField!.type).toBe(FIELD_TYPES.SELECT);
    expect(selectField!.choices).toEqual([
      { label: 'Draft', value: 'Draft' },
      { label: 'Active', value: 'Active' },
    ]);
  });

  it('rejects an API-key caller with 403', async () => {
    await expect(
      $fetch('/api/content-types/with-fields', {
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
