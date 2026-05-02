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
});
