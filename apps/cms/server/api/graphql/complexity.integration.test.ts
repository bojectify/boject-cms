import { describe, it, expect, beforeAll } from 'vitest';
import { setup, fetch, $fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { toCamelCase } from '../../../utils/casing';
import { FIELD_TYPES } from '../../../utils/fieldTypes';

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
          type: FIELD_TYPES.ENTRY_TITLE,
          required: true,
        },
        { identifier: 'body', name: 'Body', type: FIELD_TYPES.RICHTEXT },
      ],
    },
  });
  return ct.identifier;
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
  return `query { ${toCamelCase(identifier)}List(first: 5) { edges { node { body { references { id status entryKey createdAt updatedAt } } } } } }`;
}

function underCapQuery(identifier: string): string {
  return `query { ${toCamelCase(identifier)}List(first: 5) { edges { node { id } } } }`;
}

describe('GraphQL complexity scoring (#122) — default cap', async () => {
  // Pin the cap to the documented default (1000) on the booted server so this
  // suite is independent of any BOJECT_GRAPHQL_COMPLEXITY_MAX_COST a developer
  // sets in their local .env (a raised cap would stop the over-cap query below
  // from tripping and silently break this test). setup({ env }) injects into
  // the dev server's process.env, which wins over the .env-loaded value.
  await setup({
    dev: true,
    env: { BOJECT_GRAPHQL_COMPLEXITY_MAX_COST: '1000' },
  });

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
