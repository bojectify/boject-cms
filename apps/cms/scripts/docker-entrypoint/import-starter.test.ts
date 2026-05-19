import { describe, expect, it, vi } from 'vitest';
import { importStarterIfEmpty } from './import-starter';

type MockPrisma = {
  contentType: { count: ReturnType<typeof vi.fn> };
};

function makePrisma(count: number): MockPrisma {
  return {
    contentType: { count: vi.fn().mockResolvedValue(count) },
  };
}

const SAMPLE_BUNDLE = {
  version: 2,
  exportedAt: '2026-01-01T00:00:00Z',
  contentTypes: [],
  entries: [],
};

describe('importStarterIfEmpty', () => {
  it('imports when ContentType table is empty', async () => {
    const prisma = makePrisma(0);
    const importBundle = vi.fn().mockResolvedValue({
      contentTypesCreated: 0,
      entriesCreated: 0,
    });
    const readBundle = vi.fn().mockResolvedValue(SAMPLE_BUNDLE);

    const result = await importStarterIfEmpty(
      // eslint-disable-next-line no-restricted-syntax -- PrismaClient surface is wide; mock only has contentType.count
      prisma as unknown as Parameters<typeof importStarterIfEmpty>[0],
      { bundlePath: '/starters/base.boject.json', importBundle, readBundle }
    );

    expect(result).toEqual({
      imported: true,
      reason: 'imported',
      stats: { contentTypesCreated: 0, entriesCreated: 0 },
    });
    expect(readBundle).toHaveBeenCalledWith('/starters/base.boject.json');
    expect(importBundle).toHaveBeenCalledOnce();
  });

  it('is a no-op when ContentType table already has rows', async () => {
    const prisma = makePrisma(3);
    const importBundle = vi.fn();
    const readBundle = vi.fn();

    const result = await importStarterIfEmpty(
      // eslint-disable-next-line no-restricted-syntax -- PrismaClient surface is wide; mock only has contentType.count
      prisma as unknown as Parameters<typeof importStarterIfEmpty>[0],
      { bundlePath: '/starters/base.boject.json', importBundle, readBundle }
    );

    expect(result).toEqual({
      imported: false,
      reason: 'content-types-already-exist',
    });
    expect(importBundle).not.toHaveBeenCalled();
    expect(readBundle).not.toHaveBeenCalled();
  });
});
