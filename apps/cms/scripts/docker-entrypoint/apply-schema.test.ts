import { describe, expect, it, vi } from 'vitest';
import { applySchemaIfConfigured } from './apply-schema';
import { SchemaApplyBlockedError } from '../content-bundle/applySchemaErrors';

const NOOP_LOGGER = { info: vi.fn(), error: vi.fn() };

describe('applySchemaIfConfigured', () => {
  it('skips when dirPath is undefined', async () => {
    const applySchemaFn = vi.fn();
    const readDir = vi.fn();
    const readFile = vi.fn();

    const result = await applySchemaIfConfigured(
      {} as Parameters<typeof applySchemaIfConfigured>[0],
      {
        dirPath: undefined,
        allowDestructive: false,
        applySchemaFn,
        readDir,
        readFile,
        logger: NOOP_LOGGER,
      }
    );

    expect(result).toEqual({
      applied: false,
      reason: 'no-dir',
      files: 0,
      totalChanges: 0,
    });
    expect(applySchemaFn).not.toHaveBeenCalled();
    expect(readDir).not.toHaveBeenCalled();
  });

  it('skips when the directory contains no .boject.json files', async () => {
    const applySchemaFn = vi.fn();
    const readDir = vi.fn().mockResolvedValue(['README.md', 'notes.txt']);
    const readFile = vi.fn();

    const result = await applySchemaIfConfigured(
      {} as Parameters<typeof applySchemaIfConfigured>[0],
      {
        dirPath: '/app/content-types',
        allowDestructive: false,
        applySchemaFn,
        readDir,
        readFile,
        logger: NOOP_LOGGER,
      }
    );

    expect(result).toEqual({
      applied: false,
      reason: 'no-bundles',
      files: 0,
      totalChanges: 0,
    });
    expect(applySchemaFn).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('skips when the directory is empty (special case of no-bundles)', async () => {
    const applySchemaFn = vi.fn();
    const readDir = vi.fn().mockResolvedValue([]);
    const readFile = vi.fn();

    const result = await applySchemaIfConfigured(
      {} as Parameters<typeof applySchemaIfConfigured>[0],
      {
        dirPath: '/app/content-types',
        allowDestructive: false,
        applySchemaFn,
        readDir,
        readFile,
        logger: NOOP_LOGGER,
      }
    );

    expect(result).toEqual({
      applied: false,
      reason: 'no-bundles',
      files: 0,
      totalChanges: 0,
    });
  });

  const ZERO_APPLIED = {
    contentTypesCreated: 0,
    contentTypesUpdated: 0,
    contentTypesRemoved: 0,
    fieldsCreated: 0,
    fieldsUpdated: 0,
    fieldsRemoved: 0,
  };

  const EMPTY_PLAN = {
    contentTypes: { create: [], update: [], remove: [] },
    fields: { create: [], update: [], remove: [] },
    warnings: [],
    blockers: [],
  };

  const SAMPLE_BUNDLE_JSON = JSON.stringify({
    version: 2,
    exportedAt: '2026-05-01T00:00:00.000Z',
    portable: true,
    contentTypes: [],
  });

  it('reads files in alphabetical order and calls applySchema once per file', async () => {
    const callOrder: string[] = [];
    const applySchemaFn = vi.fn().mockImplementation(async () => {
      return { changed: false, plan: EMPTY_PLAN, applied: { ...ZERO_APPLIED } };
    });
    const readDir = vi
      .fn()
      .mockResolvedValue([
        'b.boject.json',
        'a.boject.json',
        'README.md',
        'c.boject.json',
      ]);
    const readFile = vi.fn().mockImplementation(async (p: string) => {
      callOrder.push(p);
      return SAMPLE_BUNDLE_JSON;
    });

    const result = await applySchemaIfConfigured(
      {} as Parameters<typeof applySchemaIfConfigured>[0],
      {
        dirPath: '/app/content-types',
        allowDestructive: false,
        applySchemaFn,
        readDir,
        readFile,
        logger: NOOP_LOGGER,
      }
    );

    expect(callOrder).toEqual([
      '/app/content-types/a.boject.json',
      '/app/content-types/b.boject.json',
      '/app/content-types/c.boject.json',
    ]);
    expect(applySchemaFn).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      applied: true,
      reason: 'applied',
      files: 3,
      totalChanges: 0,
    });
  });

  it('aggregates totalChanges across all files', async () => {
    const applySchemaFn = vi
      .fn()
      .mockResolvedValueOnce({
        changed: true,
        plan: EMPTY_PLAN,
        applied: {
          ...ZERO_APPLIED,
          contentTypesCreated: 1,
          fieldsCreated: 2,
        },
      })
      .mockResolvedValueOnce({
        changed: true,
        plan: EMPTY_PLAN,
        applied: {
          ...ZERO_APPLIED,
          fieldsUpdated: 3,
        },
      });
    const readDir = vi
      .fn()
      .mockResolvedValue(['a.boject.json', 'b.boject.json']);
    const readFile = vi.fn().mockResolvedValue(SAMPLE_BUNDLE_JSON);

    const result = await applySchemaIfConfigured(
      {} as Parameters<typeof applySchemaIfConfigured>[0],
      {
        dirPath: '/app/content-types',
        allowDestructive: false,
        applySchemaFn,
        readDir,
        readFile,
        logger: NOOP_LOGGER,
      }
    );

    expect(result.totalChanges).toBe(6); // 1 + 2 + 3
    expect(result.files).toBe(2);
  });

  it('forwards allowDestructive into every per-file applySchema call', async () => {
    const applySchemaFn = vi.fn().mockResolvedValue({
      changed: false,
      plan: EMPTY_PLAN,
      applied: { ...ZERO_APPLIED },
    });
    const readDir = vi
      .fn()
      .mockResolvedValue(['a.boject.json', 'b.boject.json']);
    const readFile = vi.fn().mockResolvedValue(SAMPLE_BUNDLE_JSON);

    await applySchemaIfConfigured(
      {} as Parameters<typeof applySchemaIfConfigured>[0],
      {
        dirPath: '/app/content-types',
        allowDestructive: true,
        applySchemaFn,
        readDir,
        readFile,
        logger: NOOP_LOGGER,
      }
    );

    expect(applySchemaFn).toHaveBeenCalledTimes(2);
    expect(applySchemaFn.mock.calls[0]![2]).toEqual({ allowDestructive: true });
    expect(applySchemaFn.mock.calls[1]![2]).toEqual({ allowDestructive: true });
  });

  it('logs entry banner, per-file summaries, and grand total', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const applySchemaFn = vi
      .fn()
      .mockResolvedValueOnce({
        changed: true,
        plan: EMPTY_PLAN,
        applied: {
          ...ZERO_APPLIED,
          contentTypesCreated: 1,
          contentTypesUpdated: 2,
        },
      })
      .mockResolvedValueOnce({
        changed: false,
        plan: EMPTY_PLAN,
        applied: { ...ZERO_APPLIED },
      });
    const readDir = vi
      .fn()
      .mockResolvedValue(['a.boject.json', 'b.boject.json']);
    const readFile = vi.fn().mockResolvedValue(SAMPLE_BUNDLE_JSON);

    await applySchemaIfConfigured(
      {} as Parameters<typeof applySchemaIfConfigured>[0],
      {
        dirPath: '/app/content-types',
        allowDestructive: false,
        applySchemaFn,
        readDir,
        readFile,
        logger,
      }
    );

    const lines = logger.info.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain(
      '[apply-schema] BOJECT_SCHEMA_DIR=/app/content-types'
    );
    expect(lines).toContain(
      '[apply-schema] reading 2 files: a.boject.json, b.boject.json'
    );
    expect(lines).toContain(
      '[apply-schema] a.boject.json: 1 created, 2 updated, 0 removed'
    );
    expect(lines).toContain('[apply-schema] b.boject.json: (no-op)');
    expect(lines).toContain(
      '[apply-schema] done — 2 files applied, 3 total changes'
    );
  });

  it('logs the singular form for one file', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const applySchemaFn = vi.fn().mockResolvedValue({
      changed: false,
      plan: EMPTY_PLAN,
      applied: { ...ZERO_APPLIED },
    });
    const readDir = vi.fn().mockResolvedValue(['schema.boject.json']);
    const readFile = vi.fn().mockResolvedValue(SAMPLE_BUNDLE_JSON);

    await applySchemaIfConfigured(
      {} as Parameters<typeof applySchemaIfConfigured>[0],
      {
        dirPath: '/app/content-types',
        allowDestructive: false,
        applySchemaFn,
        readDir,
        readFile,
        logger,
      }
    );

    const lines = logger.info.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain(
      '[apply-schema] reading 1 file: schema.boject.json'
    );
    expect(lines).toContain(
      '[apply-schema] done — 1 file applied, 0 total changes'
    );
  });

  it('logs a skip line when no dir is configured', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    await applySchemaIfConfigured(
      {} as Parameters<typeof applySchemaIfConfigured>[0],
      {
        dirPath: undefined,
        allowDestructive: false,
        applySchemaFn: vi.fn(),
        readDir: vi.fn(),
        readFile: vi.fn(),
        logger,
      }
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[apply-schema] BOJECT_SCHEMA_DIR not set — skipping'
    );
  });

  it('logs a skip line when the dir has no bundles', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    await applySchemaIfConfigured(
      {} as Parameters<typeof applySchemaIfConfigured>[0],
      {
        dirPath: '/app/content-types',
        allowDestructive: false,
        applySchemaFn: vi.fn(),
        readDir: vi.fn().mockResolvedValue(['README.md']),
        readFile: vi.fn(),
        logger,
      }
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[apply-schema] no .boject.json files in /app/content-types — skipping'
    );
  });

  it('throws on the first failing file and does not continue', async () => {
    const applySchemaFn = vi
      .fn()
      .mockResolvedValueOnce({
        changed: true,
        plan: EMPTY_PLAN,
        applied: {
          ...ZERO_APPLIED,
          contentTypesCreated: 1,
        },
      })
      .mockRejectedValueOnce(new Error('boom'));
    const readDir = vi
      .fn()
      .mockResolvedValue(['a.boject.json', 'b.boject.json', 'c.boject.json']);
    const readFile = vi.fn().mockResolvedValue(SAMPLE_BUNDLE_JSON);

    await expect(
      applySchemaIfConfigured(
        {} as Parameters<typeof applySchemaIfConfigured>[0],
        {
          dirPath: '/app/content-types',
          allowDestructive: false,
          applySchemaFn,
          readDir,
          readFile,
          logger: NOOP_LOGGER,
        }
      )
    ).rejects.toThrow('boom');

    // a applied, b failed, c never attempted.
    expect(applySchemaFn).toHaveBeenCalledTimes(2);
  });

  it('logs each blocker on a SchemaApplyBlockedError before rethrowing', async () => {
    const blockers = [
      {
        code: 'CONTENT_TYPE_REMOVAL_WITH_ENTRIES' as const,
        message: 'Tag has 4 entries',
        path: 'contentTypes.Tag',
      },
      {
        code: 'FIELD_TYPE_CHANGE' as const,
        message: 'cannot change DATETIME to TEXT',
        path: 'contentTypes.Article.fields.publishDate',
      },
    ];
    const blockedPlan = { ...EMPTY_PLAN, blockers };
    const applySchemaFn = vi
      .fn()
      .mockRejectedValueOnce(
        new SchemaApplyBlockedError(blockers, blockedPlan)
      );
    const readDir = vi.fn().mockResolvedValue(['schema.boject.json']);
    const readFile = vi.fn().mockResolvedValue(SAMPLE_BUNDLE_JSON);
    const logger = { info: vi.fn(), error: vi.fn() };

    await expect(
      applySchemaIfConfigured(
        {} as Parameters<typeof applySchemaIfConfigured>[0],
        {
          dirPath: '/app/content-types',
          allowDestructive: false,
          applySchemaFn,
          readDir,
          readFile,
          logger,
        }
      )
    ).rejects.toBeInstanceOf(SchemaApplyBlockedError);

    const errLines = logger.error.mock.calls.map((c) => c[0] as string);
    expect(errLines).toContain('[apply-schema] schema.boject.json: BLOCKED');
    expect(errLines).toContain(
      '  - CONTENT_TYPE_REMOVAL_WITH_ENTRIES at contentTypes.Tag: Tag has 4 entries'
    );
    expect(errLines).toContain(
      '  - FIELD_TYPE_CHANGE at contentTypes.Article.fields.publishDate: cannot change DATETIME to TEXT'
    );
  });
});
