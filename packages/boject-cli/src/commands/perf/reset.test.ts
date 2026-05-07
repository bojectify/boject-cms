import { describe, expect, it } from 'vitest';
import { runPerfReset } from './reset.js';

interface QueryCall {
  sql: string;
  params: unknown[] | undefined;
}

function fakeClient(): {
  client: {
    connect: () => Promise<void>;
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    end: () => Promise<void>;
  };
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  return {
    client: {
      connect: async () => {},
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        return { rows: [] };
      },
      end: async () => {},
    },
    calls,
  };
}

describe('runPerfReset', () => {
  it('refuses without --database-url', async () => {
    await expect(runPerfReset({ yes: true } as never)).rejects.toThrow(
      /database-url/i
    );
  });

  it('truncates the perf tables when given a perf URL', async () => {
    const fc = fakeClient();
    await runPerfReset({
      databaseUrl: 'postgresql://u:p@h/boject_perf',
      yes: true,
      _testClient: fc.client,
    });
    expect(fc.calls.length).toBeGreaterThan(0);
    expect(fc.calls.some((c) => c.sql.includes('TRUNCATE'))).toBe(true);
  });

  it('refuses a non-perf URL without --allow-non-perf-db', async () => {
    const fc = fakeClient();
    await expect(
      runPerfReset({
        databaseUrl: 'postgresql://u:p@h/staging',
        yes: true,
        _testClient: fc.client,
      })
    ).rejects.toThrow(/non.?perf|allow-non-perf-db/i);
  });

  it('calls resetPerfDb with allowNonPerfDb=true when flag set', async () => {
    const fc = fakeClient();
    await runPerfReset({
      databaseUrl: 'postgresql://u:p@h/staging',
      yes: true,
      allowNonPerfDb: true,
      _testClient: fc.client,
    });
    expect(fc.calls.some((c) => c.sql.includes('TRUNCATE'))).toBe(true);
  });
});
