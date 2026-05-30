/* eslint-disable import/first -- vi.mock calls must precede the imports they intercept */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./import', () => ({
  importBundle: vi.fn().mockResolvedValue({
    contentTypesCreated: 0,
    entriesCreated: 0,
    entriesUpdated: 0,
    entriesSkipped: 0,
  }),
}));

vi.mock('./applySchema', () => ({
  applySchema: vi.fn().mockResolvedValue({
    changed: false,
    plan: {
      contentTypes: { create: [], update: [], remove: [] },
      fields: { create: [], update: [], remove: [] },
      warnings: [],
      blockers: [],
    },
    applied: {
      contentTypesCreated: 0,
      contentTypesUpdated: 0,
      contentTypesRemoved: 0,
      fieldsCreated: 0,
      fieldsUpdated: 0,
      fieldsRemoved: 0,
    },
  }),
}));

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue(
      JSON.stringify({
        version: 2,
        exportedAt: '2026-05-01T00:00:00.000Z',
        portable: true,
        contentTypes: [],
      })
    ),
  };
});

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: vi.fn(
    // eslint-disable-next-line no-restricted-syntax -- plain function → constructor signature
    function () {
      return {};
    } as unknown as new () => unknown
  ),
}));

vi.mock('../../generated/prisma/client', () => ({
  PrismaClient: vi.fn(
    // eslint-disable-next-line no-restricted-syntax -- plain function → constructor signature
    function () {
      return { $disconnect: async () => {} };
    } as unknown as new () => unknown
  ),
}));

import { importBundle } from './import';
import { applySchema } from './applySchema';
import { runCli } from './index';

describe('content-bundle CLI — --apply flag dispatch', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('--schema --apply routes to applySchema', async () => {
    await runCli(['import', '/fake.json', '--schema', '--apply']);
    expect(applySchema).toHaveBeenCalledTimes(1);
    expect(importBundle).not.toHaveBeenCalled();
  });

  it('--schema (no --apply) routes to importBundle', async () => {
    await runCli(['import', '/fake.json', '--schema']);
    expect(importBundle).toHaveBeenCalledTimes(1);
    expect(applySchema).not.toHaveBeenCalled();
  });

  it('--entries --apply errors out', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runCli(['import', '/fake.json', '--entries', '--apply']);
    expect(applySchema).not.toHaveBeenCalled();
    expect(importBundle).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('--all --apply errors out', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runCli(['import', '/fake.json', '--all', '--apply']);
    expect(applySchema).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('--schema --apply --allow-destructive passes allowDestructive=true', async () => {
    await runCli([
      'import',
      '/fake.json',
      '--schema',
      '--apply',
      '--allow-destructive',
    ]);
    expect(applySchema).toHaveBeenCalledTimes(1);
    expect(vi.mocked(applySchema).mock.calls[0]![2]).toEqual({
      allowDestructive: true,
    });
  });
});

describe('content-bundle CLI on-conflict + dry-run', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('rejects an unrecognised --on-conflict value with exit 2', async () => {
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await runCli([
      'import',
      '/fake.json',
      '--entries',
      '--on-conflict',
      'bogus',
    ]);
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringMatching(/--on-conflict.*fail.*skip.*replace/)
    );
    expect(importBundle).not.toHaveBeenCalled();
    stderr.mockRestore();
  });

  it('passes onConflict and dryRun through to importBundle', async () => {
    await runCli([
      'import',
      '/fake.json',
      '--entries',
      '--on-conflict',
      'replace',
      '--dry-run',
    ]);
    expect(importBundle).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ onConflict: 'replace', dryRun: true })
    );
  });

  it('defaults onConflict to "fail" and dryRun to false when flags omitted', async () => {
    await runCli(['import', '/fake.json', '--entries']);
    expect(importBundle).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ onConflict: 'fail', dryRun: false })
    );
  });

  it('rejects --on-conflict combined with --apply with exit 2', async () => {
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await runCli([
      'import',
      '/fake.json',
      '--schema',
      '--apply',
      '--on-conflict',
      'skip',
    ]);
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(applySchema).not.toHaveBeenCalled();
    expect(importBundle).not.toHaveBeenCalled();
    stderr.mockRestore();
  });

  it('rejects --dry-run combined with --apply with exit 2', async () => {
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await runCli(['import', '/fake.json', '--schema', '--apply', '--dry-run']);
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(applySchema).not.toHaveBeenCalled();
    expect(importBundle).not.toHaveBeenCalled();
    stderr.mockRestore();
  });
});
