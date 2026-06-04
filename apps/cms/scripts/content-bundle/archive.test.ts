import { describe, it, expect } from 'vitest';
import { createTar } from 'nanotar';
import {
  isTarballPath,
  looksGzipped,
  packBundleTarball,
  unpackBundleTarball,
} from './archive';

describe('isTarballPath', () => {
  it('matches .tar.gz and .tgz, case-insensitive', () => {
    expect(isTarballPath('x.tar.gz')).toBe(true);
    expect(isTarballPath('/a/b/Bundle.TGZ')).toBe(true);
  });

  it('rejects non-tarball paths', () => {
    expect(isTarballPath('bundle.json')).toBe(false);
    expect(isTarballPath('./my-bundle/')).toBe(false);
    expect(isTarballPath('x.gz')).toBe(false); // .gz alone is not our format
  });
});

describe('looksGzipped', () => {
  it('detects the gzip magic bytes', () => {
    expect(looksGzipped(new Uint8Array([0x1f, 0x8b, 0x08, 0]))).toBe(true);
  });

  it('returns false for JSON / short buffers', () => {
    expect(looksGzipped(new Uint8Array([0x7b, 0x22]))).toBe(false); // {"
    expect(looksGzipped(new Uint8Array([0x1f]))).toBe(false);
  });
});

describe('packBundleTarball / unpackBundleTarball round-trip', () => {
  it('round-trips bundle.json text and asset bytes', async () => {
    const tar = await packBundleTarball({
      bundleJson: '{"hello":"world"}',
      assets: [
        { key: 'b.png', bytes: new Uint8Array([2, 2]) },
        { key: 'a.png', bytes: new Uint8Array([1]) },
      ],
    });
    const out = await unpackBundleTarball(tar);
    expect(out.bundleJson).toBe('{"hello":"world"}');
    // assets sorted by key on pack
    expect(out.assetKeys).toEqual(['a.png', 'b.png']);
    expect([...out.assets.get('a.png')!]).toEqual([1]);
    expect([...out.assets.get('b.png')!]).toEqual([2, 2]);
  });

  it('omits asset buffers but keeps keys + bundle.json when assetBodies:false', async () => {
    const tar = await packBundleTarball({
      bundleJson: '{}',
      assets: [{ key: 'a.png', bytes: new Uint8Array([9]) }],
    });
    const out = await unpackBundleTarball(tar, { assetBodies: false });
    expect(out.bundleJson).toBe('{}');
    expect(out.assetKeys).toEqual(['a.png']);
    expect(out.assets.size).toBe(0);
  });

  it('throws when there is no bundle.json entry', async () => {
    const tar = createTar([
      { name: 'assets/a.png', data: new Uint8Array([1]) },
    ]);
    void tar; // sanity: plain (non-gzipped) tar build works
    // gzip path: a gzipped tar with no bundle.json must be rejected
    const { createTarGzip } = await import('nanotar');
    const badGz = await createTarGzip([
      { name: 'assets/a.png', data: new Uint8Array([1]) },
    ]);
    await expect(unpackBundleTarball(badGz)).rejects.toThrow(/no bundle\.json/);
  });

  it('rejects traversal / unexpected entry names', async () => {
    const { createTarGzip } = await import('nanotar');
    const cases = ['../evil', '/abs', 'assets/../x', 'assets/sub/x'];
    for (const name of cases) {
      const gz = await createTarGzip([
        { name: 'bundle.json', data: new TextEncoder().encode('{}') },
        { name, data: new Uint8Array([1]) },
      ]);
      await expect(unpackBundleTarball(gz)).rejects.toThrow();
    }
  });
});
