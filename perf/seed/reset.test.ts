import { describe, expect, it, vi } from 'vitest';
import { resetPerfDb } from './reset';

describe('resetPerfDb', () => {
  it('runs TRUNCATE statements in dependency order', async () => {
    const queries: string[] = [];
    const runQuery = vi.fn(async (sql: string) => {
      queries.push(sql);
    });
    await resetPerfDb({
      databaseUrl: 'postgresql://u:p@h/boject_perf',
      runQuery,
    });
    const combined = queries.join('\n');
    expect(combined).toContain(
      'TRUNCATE TABLE "ContentEntryVersion" RESTART IDENTITY CASCADE'
    );
    expect(combined).toContain(
      'TRUNCATE TABLE "ContentEntry" RESTART IDENTITY CASCADE'
    );
    expect(combined).toContain(
      'TRUNCATE TABLE "ContentTypeField" RESTART IDENTITY CASCADE'
    );
    expect(combined).toContain(
      'TRUNCATE TABLE "ContentType" RESTART IDENTITY CASCADE'
    );
    expect(runQuery).toHaveBeenCalled();
  });

  it('refuses to run against non-perf database URLs', async () => {
    await expect(
      resetPerfDb({
        databaseUrl: 'postgresql://u:p@h/boject',
        runQuery: vi.fn(),
      })
    ).rejects.toThrow(/refusing/i);
  });
});
