import { describe, it, expect } from 'vitest';
import { isTarballPath, looksGzipped } from './archive';

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
