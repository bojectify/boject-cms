import { describe, it, expect, beforeAll } from 'vitest';
import { setup, fetch, $fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';

const TEST_API_KEY = 'boject_test_key_for_integration_tests_only';

async function getCookieFresh(): Promise<string> {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: TEST_USERNAME, password: TEST_PASSWORD }),
    headers: { 'Content-Type': 'application/json' },
  });
  return r.headers.getSetCookie().join('; ');
}

interface CtResponse {
  id: string;
  identifier: string;
  fields: Array<{ id: string; identifier: string; type: string }>;
}

// Content type with ENTRY_TITLE + RICHTEXT so we can build a
// richtext.references query that exceeds the 1000 default cap.
async function createComplexityTestCt(cookie: string): Promise<string> {
  const ts = Date.now();
  const ct = await $fetch<CtResponse>('/api/content-types', {
    method: 'POST',
    headers: { cookie },
    body: {
      name: `Complexity Test ${ts}`,
      fields: [
        {
          identifier: 'title',
          name: 'Title',
          type: 'ENTRY_TITLE',
          required: true,
        },
        { identifier: 'body', name: 'Body', type: 'RICHTEXT' },
      ],
    },
  });
  return ct.identifier;
}

function camel(s: string): string {
  return s[0]!.toLowerCase() + s.slice(1);
}

function gqlPost(query: string) {
  return fetch('/api/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TEST_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
}

// Cost math under default weights (defaultListMultiplier=20):
// references{5 scalars} = 5*20+10 = 110;
// body{references{...}} = 110+1 = 111;
// node{body{...}} = 111+1 = 112;
// edges{node{...}} = 112*20+1 = 2241. Comfortably > 1000.
function overCapQuery(identifier: string): string {
  return `query { ${camel(identifier)}List(first: 5) { edges { node { body { references { id status entryKey createdAt updatedAt } } } } } }`;
}

function underCapQuery(identifier: string): string {
  return `query { ${camel(identifier)}List(first: 5) { edges { node { id } } } }`;
}

describe('GraphQL complexity scoring (#122) — default cap', async () => {
  await setup({ dev: true });

  let identifier: string;
  beforeAll(async () => {
    identifier = await createComplexityTestCt(await getCookieFresh());
  });

  it('allows an under-cap query', async () => {
    const res = await gqlPost(underCapQuery(identifier));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors).toBeUndefined();
  });

  it('rejects an over-cap query with QUERY_TOO_COMPLEX', async () => {
    const res = await gqlPost(overCapQuery(identifier));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors).toBeDefined();
    expect(body.errors[0].extensions?.code).toBe('QUERY_TOO_COMPLEX');
  });
});
