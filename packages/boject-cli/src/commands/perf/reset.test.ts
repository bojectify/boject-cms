import { describe, expect, it, vi } from 'vitest';
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

  it('refuses a non-suffix URL without --allow-database', async () => {
    const fc = fakeClient();
    await expect(
      runPerfReset({
        databaseUrl: 'postgresql://u:p@h/staging',
        yes: true,
        _testClient: fc.client,
      })
    ).rejects.toThrow(/--allow-database|_perf|_staging/i);
  });

  it('rejects non-suffix URL without --allow-database before opening a DB connection', async () => {
    const connect = vi.fn(async () => {
      throw new Error('client.connect should not be called');
    });
    const client = {
      connect,
      query: vi.fn(async () => ({ rows: [] })),
      end: vi.fn(async () => {}),
    };
    await expect(
      runPerfReset({
        databaseUrl: 'postgresql://u:p@h/prod',
        yes: true,
        _testClient: client,
      })
    ).rejects.toThrow(/--allow-database|_perf|_staging/i);
    expect(connect).not.toHaveBeenCalled();
  });

  it('calls resetPerfDb with allowDatabase=[<name>] when flag set', async () => {
    const fc = fakeClient();
    await runPerfReset({
      databaseUrl: 'postgresql://u:p@h/staging',
      yes: true,
      allowDatabase: ['staging'],
      _testClient: fc.client,
    });
    expect(fc.calls.some((c) => c.sql.includes('TRUNCATE'))).toBe(true);
  });
});
