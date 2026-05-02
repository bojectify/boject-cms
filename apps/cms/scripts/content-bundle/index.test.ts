/* eslint-disable import/first */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./import', () => ({
  importBundle: vi.fn().mockResolvedValue({
    contentTypesCreated: 0,
    entriesCreated: 0,
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
  PrismaPg: vi.fn(function () {
    return {};
  } as unknown as new () => unknown),
}));

vi.mock('../../generated/prisma/client', () => ({
  PrismaClient: vi.fn(function () {
    return { $disconnect: async () => {} };
  } as unknown as new () => unknown),
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
    expect(
      (applySchema as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![2]
    ).toEqual({
      allowDestructive: true,
    });
  });
});
