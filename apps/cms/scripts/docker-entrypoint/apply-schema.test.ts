import { describe, expect, it, vi } from 'vitest';
import { applySchemaIfConfigured } from './apply-schema';

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
});
