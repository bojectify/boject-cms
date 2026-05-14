import { describe, it } from 'vitest';
import { setup } from '@nuxt/test-utils/e2e';

describe('GraphQL complexity scoring (#122)', async () => {
  await setup({ dev: true });

  it.skip('rejects an over-cap query with QUERY_TOO_COMPLEX', () => {
    // Unskipped in Task 5 once enforcement is wired up.
  });
});
