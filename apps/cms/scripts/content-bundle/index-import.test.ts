/* eslint-disable import/first -- vi.mock calls must precede the imports they intercept */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      return {
        contentType: { findMany: async () => [] },
        $disconnect: async () => {},
      };
    } as unknown as new () => unknown
  ),
}));

const { importBundleMock, setItemRaw } = vi.hoisted(() => ({
  importBundleMock: vi.fn().mockResolvedValue({
    contentTypesCreated: 0,
    entriesCreated: 1,
    entriesUpdated: 0,
    entriesSkipped: 0,
  }),
  setItemRaw: vi.fn(async () => {}),
}));
vi.mock('./import', () => ({ importBundle: importBundleMock }));

vi.mock('./assets', async (importActual) => {
  const actual = await importActual<typeof import('./assets')>();
  return {
    ...actual,
    createBundleStorage: vi.fn(() => ({
      getItemRaw: async () => null,
      setItemRaw,
      hasItem: async () => false,
    })),
  };
});

import { runCli } from './index';
import { packBundleTarball } from './archive';

/** A minimal v2 entries-only bundle (no IMAGE fields → no asset completeness). */
function entriesBundle() {
  return {
    version: 2,
    exportedAt: 'x',
    portable: false,
    entries: [
      {
        id: null,
        contentTypeId: null,
        contentTypeIdentifier: 'Article',
        entryTitle: 'Welcome',
        entryKey: 'welcome',
        slug: 'welcome',
        versions: [
          {
            status: 'PUBLISHED',
            publishedAt: null,
            data: { title: 'Welcome' },
          },
        ],
      },
    ],
  };
}

describe('content-bundle CLI — tarball import', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const tmpDirs: string[] = [];

  function tmp(): string {
    const dir = mkdtempSync(join(tmpdir(), 'boject-import-'));
    tmpDirs.push(dir);
    return dir;
  }

  async function writeTarball(name: string): Promise<string> {
    const tar = await packBundleTarball({
      bundleJson: JSON.stringify(entriesBundle()),
      assets: [],
    });
    const file = join(tmp(), name);
    writeFileSync(file, tar);
    return file;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('imports a .tar.gz target (detected by extension)', async () => {
    const file = await writeTarball('bundle.tar.gz');
    await runCli(['import', file, '--entries']);
    expect(importBundleMock).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('auto-detects a tarball by gzip magic when the extension is wrong', async () => {
    const file = await writeTarball('bundle.bin');
    await runCli(['import', file, '--entries']);
    expect(importBundleMock).toHaveBeenCalledOnce();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('dry-run writes no asset bytes', async () => {
    const file = await writeTarball('bundle.tar.gz');
    await runCli(['import', file, '--entries', '--dry-run']);
    expect(setItemRaw).not.toHaveBeenCalled();
    expect(importBundleMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ dryRun: true })
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('errors on a corrupt archive', async () => {
    const file = join(tmp(), 'broken.tar.gz');
    writeFileSync(file, Buffer.from([0x1f, 0x8b, 0x08, 0, 1, 2, 3, 4]));
    await runCli(['import', file]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
