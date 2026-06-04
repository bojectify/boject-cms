/* eslint-disable import/first -- vi.mock calls must precede the imports they intercept */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The export branch constructs a Prisma client, calls exportBundle +
// imageFieldsFromDb (prisma.contentType.findMany) + createBundleStorage. Mock
// the adapter, the client, the export module, and createBundleStorage so this
// runs DB-free and storage-free while still exercising runCli's real export
// orchestration (dir-vs-file decision, bundle.json write, --no-assets opt-out).
// NOTE: node:fs is deliberately NOT mocked — we use the real fs + temp dirs.
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

vi.mock('./export', () => ({
  exportBundle: vi.fn().mockResolvedValue({
    version: 2,
    exportedAt: 'x',
    portable: false,
    contentTypes: [],
    entries: [],
  }),
}));

vi.mock('./assets', async (importActual) => {
  const actual = await importActual<typeof import('./assets')>();
  return {
    ...actual,
    createBundleStorage: vi.fn(() => ({
      getItemRaw: async () => null,
      setItemRaw: async () => {},
      hasItem: async () => false,
    })),
  };
});

import { runCli } from './index';
import { unpackBundleTarball } from './archive';

describe('content-bundle CLI — export directory orchestration', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const tmpDirs: string[] = [];

  function tmp(): string {
    const dir = mkdtempSync(join(tmpdir(), 'boject-export-'));
    tmpDirs.push(dir);
    return dir;
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

  it('writes bundle.json for a directory target (trailing slash)', async () => {
    const dir = tmp();
    await runCli(['export', '--all', '--out', join(dir, '/')]);

    expect(existsSync(join(dir, 'bundle.json'))).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(0);
    const logged = logSpy.mock.calls.find((c: unknown[]) =>
      /bundle\.json/.test(String(c[0]))
    );
    expect(logged).toBeDefined();
  });

  it('writes a single .json file (no bundle.json dir) for a file target', async () => {
    const dir = tmp();
    await runCli(['export', '--all', '--out', join(dir, 'out.json')]);

    expect(existsSync(join(dir, 'out.json'))).toBe(true);
    expect(existsSync(join(dir, 'bundle.json'))).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('--no-assets with a directory target still writes bundle.json and no assets/', async () => {
    const dir = tmp();
    await runCli(['export', '--all', '--out', join(dir, '/'), '--no-assets']);

    expect(existsSync(join(dir, 'bundle.json'))).toBe(true);
    expect(existsSync(join(dir, 'assets'))).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('writes a .tar.gz target containing bundle.json', async () => {
    const dir = tmp();
    const out = join(dir, 'bundle.tar.gz');
    await runCli(['export', '--all', '--out', out]);

    expect(existsSync(out)).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(0);

    const unpacked = await unpackBundleTarball(readFileSync(out));
    const bundle = JSON.parse(unpacked.bundleJson);
    expect(bundle.version).toBe(2);
    // mocked exportBundle returns no entries → no assets in the archive
    expect(unpacked.assetKeys).toEqual([]);

    const logged = logSpy.mock.calls.find((c: unknown[]) =>
      /tarball/i.test(String(c[0]))
    );
    expect(logged).toBeDefined();
  });
});
