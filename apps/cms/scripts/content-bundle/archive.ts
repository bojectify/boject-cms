import { createTarGzip, parseTarGzip } from 'nanotar';

export const TARBALL_EXTENSIONS = ['.tar.gz', '.tgz'] as const;

/** True if the path names a bundle tarball by extension (case-insensitive). */
export function isTarballPath(path: string): boolean {
  const lower = path.toLowerCase();
  return TARBALL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** True if the buffer begins with the gzip magic bytes (0x1f 0x8b). */
export function looksGzipped(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

const BUNDLE_ENTRY = 'bundle.json';
const ASSET_PREFIX = 'assets/';
// Fixed mtime so the same input always yields the same archive bytes
// (uid/gid/user/group already default to constants in nanotar).
const FIXED_ATTRS = { mtime: 0 } as const;

export interface BundleAsset {
  key: string;
  bytes: Uint8Array;
}

export interface PackBundleTarballArgs {
  bundleJson: string;
  assets: BundleAsset[];
}

/** Build a gzipped tar carrying bundle.json + assets/<key>. */
export async function packBundleTarball(
  args: PackBundleTarballArgs
): Promise<Uint8Array> {
  const sorted = [...args.assets].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  );
  const files = [
    {
      name: BUNDLE_ENTRY,
      data: new TextEncoder().encode(args.bundleJson),
      attrs: FIXED_ATTRS,
    },
    ...sorted.map((a) => ({
      name: `${ASSET_PREFIX}${a.key}`,
      data: a.bytes,
      attrs: FIXED_ATTRS,
    })),
  ];
  return createTarGzip(files);
}

export interface UnpackBundleTarballResult {
  bundleJson: string;
  assetKeys: string[];
  assets: Map<string, Buffer>;
}

function assertSafeAssetKey(name: string, key: string): void {
  if (
    key.length === 0 ||
    key.includes('/') ||
    key.includes('\\') ||
    key.includes('..')
  ) {
    throw new Error(
      `Refusing to unpack archive entry "${name}": unsafe asset key "${key}".`
    );
  }
}

/**
 * Parse a gzipped bundle tarball into bundle.json text + asset buffers.
 * Validates every entry name is exactly `bundle.json` or `assets/<safe-key>`
 * (rejects traversal, absolute, and nested paths). `assetBodies: false` keeps
 * bundle.json + the asset key list but does not retain asset buffers.
 */
export async function unpackBundleTarball(
  data: Uint8Array,
  opts: { assetBodies?: boolean } = {}
): Promise<UnpackBundleTarballResult> {
  const keepBodies = opts.assetBodies !== false;
  const entries = await parseTarGzip(data);

  let bundleJson: string | null = null;
  const assetKeys: string[] = [];
  const assets = new Map<string, Buffer>();

  for (const entry of entries) {
    if (entry.type === 'directory') continue;
    const name = entry.name;
    if (name === BUNDLE_ENTRY) {
      bundleJson = Buffer.from(entry.data ?? new Uint8Array()).toString('utf8');
      continue;
    }
    if (name.startsWith(ASSET_PREFIX)) {
      const key = name.slice(ASSET_PREFIX.length);
      assertSafeAssetKey(name, key);
      assetKeys.push(key);
      if (keepBodies) {
        assets.set(key, Buffer.from(entry.data ?? new Uint8Array()));
      }
      continue;
    }
    throw new Error(
      `Refusing to unpack archive entry "${name}": unexpected path outside ` +
        `bundle.json / assets/.`
    );
  }

  if (bundleJson === null) {
    throw new Error(
      'Archive has no bundle.json entry — not a content bundle tarball.'
    );
  }
  return { bundleJson, assetKeys, assets };
}
