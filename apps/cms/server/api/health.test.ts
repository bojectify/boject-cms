import { describe, it, expect } from 'vitest';
import { setup, $fetch } from '@nuxt/test-utils/e2e';

type HealthResponse = {
  status: string;
  database: string;
  search: string;
};

describe('GET /api/health', async () => {
  await setup({ dev: true });

  it('reports ok, database connected, and a search reachability status', async () => {
    // /api/health is public — the auth middleware skips it (liveness probe).
    const res = await $fetch<HealthResponse>('/api/health');
    expect(res.status).toBe('ok');
    expect(res.database).toBe('connected');
    expect(['available', 'unavailable']).toContain(res.search);
  });
});
