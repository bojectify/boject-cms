import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorage } from 'unstorage';
import memoryDriver from 'unstorage/drivers/memory';
import {
  buildImageFieldsFromContentTypes,
  collectImageStorageKeys,
  DEFAULT_ASSET_CAPS,
  assertAssetsComplete,
  assertWithinCaps,
  exportAssets,
  importAssets,
  listAssetKeys,
} from './assets';
import { makeAssetsBundle } from './assets.fixtures';

describe('buildImageFieldsFromContentTypes', () => {
  it('maps content-type identifier to its IMAGE field identifiers', () => {
    const map = buildImageFieldsFromContentTypes(
      makeAssetsBundle().contentTypes!
    );
    expect(map.get('Article')).toEqual(new Set(['hero']));
  });
});

describe('collectImageStorageKeys', () => {
  it('collects deduped storage keys across all versions', () => {
    const b = makeAssetsBundle();
    const map = buildImageFieldsFromContentTypes(b.contentTypes!);
    const keys = collectImageStorageKeys(b, map);
    expect(keys.sort()).toEqual(['k1.png', 'k2.png']);
  });

  it('returns [] when the bundle has no entries', () => {
    const b = makeAssetsBundle();
    delete b.entries;
    const map = buildImageFieldsFromContentTypes(b.contentTypes!);
    expect(collectImageStorageKeys(b, map)).toEqual([]);
  });

  it('skips null/absent image values and non-image fields', () => {
    const b = makeAssetsBundle();
    b.entries![0]!.versions[0]!.data = { title: 'A', hero: null };
    const map = buildImageFieldsFromContentTypes(b.contentTypes!);
    const keys = collectImageStorageKeys(b, map);
    expect(keys).not.toContain(undefined);
    expect(keys).toContain('k2.png'); // draft version still has k2
  });
});

describe('assertAssetsComplete', () => {
  it('passes when every referenced key is present', () => {
    expect(() =>
      assertAssetsComplete(
        ['k1.png', 'k2.png'],
        new Set(['k1.png', 'k2.png', 'extra.png'])
      )
    ).not.toThrow();
  });

  it('throws naming the first missing key', () => {
    expect(() =>
      assertAssetsComplete(['k1.png', 'k2.png'], new Set(['k1.png']))
    ).toThrow(/k2\.png/);
  });
});

describe('assertWithinCaps', () => {
  it('uses sensible defaults', () => {
    expect(DEFAULT_ASSET_CAPS.perAsset).toBe(25 * 1024 * 1024);
    expect(DEFAULT_ASSET_CAPS.perBundle).toBe(1024 * 1024 * 1024);
  });

  it('throws when a single asset exceeds the per-asset cap', () => {
    expect(() =>
      assertWithinCaps('big.png', 30 * 1024 * 1024, 0, DEFAULT_ASSET_CAPS)
    ).toThrow(/big\.png/);
  });

  it('throws when the running total exceeds the per-bundle cap', () => {
    const caps = { perAsset: 1024, perBundle: 1500 };
    expect(() => assertWithinCaps('a.png', 800, 800, caps)).toThrow(
      /bundle size cap/i
    );
  });

  it('passes within caps', () => {
    expect(() =>
      assertWithinCaps('ok.png', 100, 100, DEFAULT_ASSET_CAPS)
    ).not.toThrow();
  });

  it('passes when sizes land exactly on the caps', () => {
    const caps = { perAsset: 1000, perBundle: 1000 };
    expect(() => assertWithinCaps('edge.png', 1000, 0, caps)).not.toThrow();
    expect(() => assertWithinCaps('edge.png', 400, 600, caps)).not.toThrow();
  });
});

describe('exportAssets', () => {
  it('writes referenced bytes into the assets dir and reports total size', async () => {
    const storage = createStorage({ driver: memoryDriver() });
    await storage.setItemRaw('k1.png', Buffer.from('hello'));
    await storage.setItemRaw('k2.png', Buffer.from('world!!'));

    const dir = mkdtempSync(join(tmpdir(), 'assets-export-'));
    try {
      const result = await exportAssets({
        storage,
        storageKeys: ['k1.png', 'k2.png'],
        assetsDir: join(dir, 'assets'),
        caps: DEFAULT_ASSET_CAPS,
      });
      expect(result.count).toBe(2);
      expect(result.totalBytes).toBe(12); // 5 + 7
      expect(readFileSync(join(dir, 'assets', 'k1.png'), 'utf8')).toBe('hello');
      expect(readFileSync(join(dir, 'assets', 'k2.png'), 'utf8')).toBe(
        'world!!'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails fast when a referenced byte is missing from storage', async () => {
    const storage = createStorage({ driver: memoryDriver() });
    const dir = mkdtempSync(join(tmpdir(), 'assets-export-'));
    try {
      await expect(
        exportAssets({
          storage,
          storageKeys: ['gone.png'],
          assetsDir: join(dir, 'assets'),
          caps: DEFAULT_ASSET_CAPS,
        })
      ).rejects.toThrow(/gone\.png/);
      expect(existsSync(join(dir, 'assets'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails fast when an asset exceeds the per-asset cap', async () => {
    const storage = createStorage({ driver: memoryDriver() });
    await storage.setItemRaw('big.png', Buffer.alloc(2048));
    const dir = mkdtempSync(join(tmpdir(), 'assets-export-'));
    try {
      await expect(
        exportAssets({
          storage,
          storageKeys: ['big.png'],
          assetsDir: join(dir, 'assets'),
          caps: { perAsset: 1024, perBundle: 1024 * 1024 },
        })
      ).rejects.toThrow(/big\.png/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an unsafe storage key with a path separator', async () => {
    const storage = createStorage({ driver: memoryDriver() });
    await storage.setItemRaw('ok.png', Buffer.from('x'));
    const dir = mkdtempSync(join(tmpdir(), 'assets-export-'));
    try {
      await expect(
        exportAssets({
          storage,
          storageKeys: ['../escape.png'],
          assetsDir: join(dir, 'assets'),
          caps: DEFAULT_ASSET_CAPS,
        })
      ).rejects.toThrow(/unsafe storage key/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('normalizes non-Buffer getItemRaw results (e.g. s3 ArrayBuffer)', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    // Stub storage whose getItemRaw returns an ArrayBuffer, like the s3 driver.
    // eslint-disable-next-line no-restricted-syntax -- minimal stub; no structural overlap with the full Storage surface
    const storage = {
      getItemRaw: async () => bytes.buffer,
    } as unknown as import('unstorage').Storage;

    const dir = mkdtempSync(join(tmpdir(), 'assets-export-'));
    try {
      const result = await exportAssets({
        storage,
        storageKeys: ['ab.bin'],
        assetsDir: join(dir, 'assets'),
        caps: DEFAULT_ASSET_CAPS,
      });
      expect(result.count).toBe(1);
      expect(result.totalBytes).toBe(4);
      const written = readFileSync(join(dir, 'assets', 'ab.bin'));
      expect([...written]).toEqual([1, 2, 3, 4]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('importAssets', () => {
  it('writes every asset file into storage, skipping ones already present', async () => {
    const storage = createStorage({ driver: memoryDriver() });
    await storage.setItemRaw('existing.png', Buffer.from('OLD'));

    const dir = mkdtempSync(join(tmpdir(), 'assets-import-'));
    const assetsDir = join(dir, 'assets');
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, 'new.png'), Buffer.from('NEW'));
    writeFileSync(
      join(assetsDir, 'existing.png'),
      Buffer.from('SHOULD-NOT-OVERWRITE')
    );

    try {
      const result = await importAssets({ storage, assetsDir });
      expect(result.written).toBe(1);
      expect(result.skipped).toBe(1);
      expect((await storage.getItemRaw<Buffer>('new.png'))!.toString()).toBe(
        'NEW'
      );
      // existing key untouched
      expect(
        (await storage.getItemRaw<Buffer>('existing.png'))!.toString()
      ).toBe('OLD');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('listAssetKeys returns [] when the dir does not exist', () => {
    expect(listAssetKeys(join(tmpdir(), 'definitely-not-here-31'))).toEqual([]);
  });
});
