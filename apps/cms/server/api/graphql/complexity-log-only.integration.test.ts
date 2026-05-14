import { describe, it, expect, beforeAll } from 'vitest';
import { setup, fetch, $fetch } from '@nuxt/test-utils/e2e';
import { TEST_USERNAME, TEST_PASSWORD } from '../../test/credentials';
import { toCamelCase } from '../../../utils/casing';

// Separate file because @nuxt/test-utils v4 stores its test context in a
// module-level singleton — multiple setup() calls in one file have their
// ctx clobbered. Splitting per env-var configuration is the canonical
// workaround.

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

async function createComplexityTestCt(cookie: string): Promise<string> {
  const ts = Date.now();
  const ct = await $fetch<CtResponse>('/api/content-types', {
    method: 'POST',
    headers: { cookie },
    body: {
      name: `Complexity Test LogOnly ${ts}`,
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

describe('GraphQL complexity scoring (#122) — log-only', async () => {
  await setup({
    dev: true,
    env: { BOJECT_GRAPHQL_COMPLEXITY_LOG_ONLY: 'true' },
  });

  let identifier: string;
  beforeAll(async () => {
    identifier = await createComplexityTestCt(await getCookieFresh());
  });

  it('permits the same over-cap query when log-only is on', async () => {
    // Same shape as the default-cap test's over-cap query — would
    // normally reject at score ~2241 against the 1000 cap.
    const query = `query { ${toCamelCase(identifier)}List(first: 5) { edges { node { body { references { id status entryKey createdAt updatedAt } } } } } }`;
    const res = await fetch('/api/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const hasComplexityError = (body.errors ?? []).some(
      (e: { extensions?: { code?: string } }) =>
        e.extensions?.code === 'QUERY_TOO_COMPLEX'
    );
    expect(hasComplexityError).toBe(false);
  });
});
