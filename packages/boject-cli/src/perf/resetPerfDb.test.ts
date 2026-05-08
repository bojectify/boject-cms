import { describe, expect, it, vi } from 'vitest';
import { resetPerfDb } from './resetPerfDb.js';
import { DisallowedDatabaseError } from './allowedDatabase.js';

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

  it('refuses non-suffix-matching URLs without an allow-list', async () => {
    await expect(
      resetPerfDb({
        databaseUrl: 'postgresql://u:p@h/prod',
        runQuery: vi.fn(),
      })
    ).rejects.toBeInstanceOf(DisallowedDatabaseError);
  });

  it('accepts _staging-suffix names without an allow-list', async () => {
    const runQuery = vi.fn(async () => {});
    await resetPerfDb({
      databaseUrl: 'postgresql://u:p@h/myapp_staging',
      runQuery,
    });
    expect(runQuery).toHaveBeenCalled();
  });

  it('allows non-suffix names when listed in allowDatabase', async () => {
    const runQuery = vi.fn(async () => {});
    await resetPerfDb({
      databaseUrl: 'postgresql://u:p@h/prod',
      runQuery,
      allowDatabase: ['prod'],
    });
    expect(runQuery).toHaveBeenCalled();
  });
});
