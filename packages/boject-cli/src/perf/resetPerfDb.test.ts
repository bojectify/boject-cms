import { describe, expect, it, vi } from 'vitest';
import { resetPerfDb, NonPerfDatabaseError } from './resetPerfDb.js';

describe('resetPerfDb', () => {
  it('truncates only the entry tables (preserves schema)', async () => {
    const queries: string[] = [];
    const runQuery = vi.fn(async (sql: string) => {
      queries.push(sql);
    });
    await resetPerfDb({
      databaseUrl: 'postgresql://u:p@h/boject_perf',
      runQuery,
    });
    const combined = queries.join('\n');
    expect(combined).toContain('TRUNCATE TABLE "ContentEntryVersion"');
    expect(combined).toContain('TRUNCATE TABLE "ContentEntry"');
    expect(combined).not.toContain('TRUNCATE TABLE "ContentType"');
    expect(combined).not.toContain('TRUNCATE TABLE "ContentTypeField"');
  });

  it('refuses non-perf URLs by default', async () => {
    await expect(
      resetPerfDb({
        databaseUrl: 'postgresql://u:p@h/boject',
        runQuery: vi.fn(),
      })
    ).rejects.toBeInstanceOf(NonPerfDatabaseError);
  });

  it('allows non-perf URLs when allowNonPerfDb=true', async () => {
    const runQuery = vi.fn(async () => {});
    await resetPerfDb({
      databaseUrl: 'postgresql://u:p@h/staging',
      runQuery,
      allowNonPerfDb: true,
    });
    expect(runQuery).toHaveBeenCalled();
  });
});
