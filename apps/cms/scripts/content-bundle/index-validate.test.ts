/* eslint-disable import/first -- vi.mock calls must precede the imports they intercept */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// validate never queries the DB, but runCli constructs a Prisma client and
// $disconnect()s in `finally`, so mock the adapter + client to keep this a
// pure unit test. NOTE: node:fs is deliberately NOT mocked here — we need the
// real fs to read on-disk temp-dir bundles.
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

import { runCli } from './index';
import { packBundleTarball } from './archive';

/** A valid v2 bundle with an Article content type carrying an IMAGE field. */
function bundleWithImage(storageKey: string) {
  return {
    version: 2,
    exportedAt: '2026-05-01T00:00:00.000Z',
    portable: true,
    contentTypes: [
      {
        id: null,
        identifier: 'Article',
        name: 'Article',
        description: null,
        fields: [
          {
            id: null,
            identifier: 'title',
            name: 'Title',
            type: 'ENTRY_TITLE',
            required: true,
            order: 0,
            options: null,
          },
          {
            id: null,
            identifier: 'hero',
            name: 'Hero',
            type: 'IMAGE',
            required: false,
            order: 1,
            options: null,
          },
        ],
      },
    ],
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
            data: {
              title: 'Welcome',
              hero: {
                storageKey,
                mimeType: 'image/png',
                width: 100,
                height: 100,
                fileSize: 1234,
              },
            },
          },
        ],
      },
    ],
  };
}

/** A valid v2 entries-only bundle (no contentTypes). */
function entriesOnlyBundle() {
  return {
    version: 2,
    exportedAt: '2026-05-01T00:00:00.000Z',
    portable: true,
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

describe('content-bundle CLI — validate offline asset completeness', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const tmpDirs: string[] = [];

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

  /**
   * Create a temp directory with a bundle.json, and (optionally) an assets/
   * dir populated with the named files.
   */
  function writeBundleDir(
    bundle: unknown,
    assets?: Record<string, string>
  ): string {
    const dir = mkdtempSync(join(tmpdir(), 'boject-validate-'));
    tmpDirs.push(dir);
    writeFileSync(join(dir, 'bundle.json'), JSON.stringify(bundle));
    if (assets) {
      const assetsDir = join(dir, 'assets');
      mkdirSync(assetsDir, { recursive: true });
      for (const [name, contents] of Object.entries(assets)) {
        writeFileSync(join(assetsDir, name), contents);
      }
    }
    return dir;
  }

  async function writeBundleTarball(
    bundle: unknown,
    assets: Record<string, string> = {}
  ): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'boject-validate-tar-'));
    tmpDirs.push(dir);
    const tar = await packBundleTarball({
      bundleJson: JSON.stringify(bundle),
      assets: Object.entries(assets).map(([key, contents]) => ({
        key,
        bytes: new TextEncoder().encode(contents),
      })),
    });
    const file = join(dir, 'bundle.tar.gz');
    writeFileSync(file, tar);
    return file;
  }

  it('reports valid when all referenced assets are present', async () => {
    const dir = writeBundleDir(bundleWithImage('k1.png'), {
      'k1.png': 'fake-bytes',
    });

    await runCli(['validate', dir]);

    expect(exitSpy).toHaveBeenCalledWith(0);
    const present = logSpy.mock.calls.find((c: unknown[]) =>
      /asset\(s\) present/.test(String(c[0]))
    );
    expect(present).toBeDefined();
    expect(String(present![0])).toContain('1');
  });

  it('errors and exits 1 when a referenced asset is missing', async () => {
    // assets/ dir exists (so assetsDir is non-null) but lacks k1.png.
    const dir = writeBundleDir(bundleWithImage('k1.png'), {
      'other.png': 'fake-bytes',
    });

    await runCli(['validate', dir]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    const missing = errorSpy.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('k1.png')
    );
    expect(missing).toBeDefined();
  });

  it('skips asset check for an entries-only directory bundle', async () => {
    const dir = writeBundleDir(entriesOnlyBundle(), {
      'unrelated.png': 'fake-bytes',
    });

    await runCli(['validate', dir]);

    expect(exitSpy).toHaveBeenCalledWith(0);
    const skipped = logSpy.mock.calls.find((c: unknown[]) =>
      /entries-only/.test(String(c[0]))
    );
    expect(skipped).toBeDefined();
  });

  it('reports valid for a tarball when all referenced assets are present', async () => {
    const file = await writeBundleTarball(bundleWithImage('k1.png'), {
      'k1.png': 'fake-bytes',
    });

    await runCli(['validate', file]);

    expect(exitSpy).toHaveBeenCalledWith(0);
    const present = logSpy.mock.calls.find((c: unknown[]) =>
      /asset\(s\) present/.test(String(c[0]))
    );
    expect(present).toBeDefined();
  });

  it('errors and exits 1 for a tarball missing a referenced asset', async () => {
    const file = await writeBundleTarball(bundleWithImage('k1.png'), {
      'other.png': 'fake-bytes',
    });

    await runCli(['validate', file]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    const missing = errorSpy.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('k1.png')
    );
    expect(missing).toBeDefined();
  });

  it('skips the asset check for an entries-only tarball', async () => {
    const file = await writeBundleTarball(entriesOnlyBundle());

    await runCli(['validate', file]);

    expect(exitSpy).toHaveBeenCalledWith(0);
    const skipped = logSpy.mock.calls.find((c: unknown[]) =>
      /entries-only/.test(String(c[0]))
    );
    expect(skipped).toBeDefined();
  });
});
