import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStorage, type Storage } from 'unstorage';
import fsDriver from 'unstorage/drivers/fs';
import s3Driver from 'unstorage/drivers/s3';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { buildStorageConfig } from '../../server/utils/storageConfig';
import type { Bundle, BundleContentType } from './types';

/**
 * Map of content-type identifier -> set of IMAGE field identifiers.
 * Built from a bundle's own contentTypes, or from the DB (see callers).
 */
export type ImageFieldsByType = Map<string, Set<string>>;

export function buildImageFieldsFromContentTypes(
  contentTypes: BundleContentType[]
): ImageFieldsByType {
  const map: ImageFieldsByType = new Map();
  for (const ct of contentTypes) {
    const set = new Set<string>();
    for (const f of ct.fields) {
      if (f.type === FIELD_TYPES.IMAGE) set.add(f.identifier);
    }
    map.set(ct.identifier, set);
  }
  return map;
}

/**
 * Walk every version's data, pick IMAGE field values, and return the
 * deduplicated list of storage keys. Pure — works in portable and
 * non-portable mode (IMAGE values are not ref-rewritten by portable encoding).
 */
export function collectImageStorageKeys(
  bundle: Bundle,
  imageFieldsByType: ImageFieldsByType
): string[] {
  const keys = new Set<string>();
  for (const entry of bundle.entries ?? []) {
    const imageFields = imageFieldsByType.get(entry.contentTypeIdentifier);
    if (!imageFields || imageFields.size === 0) continue;
    for (const version of entry.versions) {
      for (const fieldId of imageFields) {
        const value = version.data[fieldId];
        const storageKey = (value as { storageKey?: unknown } | null)
          ?.storageKey;
        if (typeof storageKey === 'string' && storageKey.length > 0) {
          keys.add(storageKey);
        }
      }
    }
  }
  return [...keys];
}

export interface AssetCaps {
  /** Max bytes for a single asset. */
  perAsset: number;
  /** Max cumulative bytes across all assets in one bundle. */
  perBundle: number;
}

export const DEFAULT_ASSET_CAPS: AssetCaps = {
  perAsset: 25 * 1024 * 1024, // 25 MB
  perBundle: 1024 * 1024 * 1024, // 1 GB
};

/**
 * Throw if any referenced storage key is missing from the present set.
 * Used at import time when an `assets/` directory exists (corrupt/partial
 * bundle detection).
 */
export function assertAssetsComplete(
  referencedKeys: string[],
  presentKeys: Set<string>
): void {
  for (const key of referencedKeys) {
    if (!presentKeys.has(key)) {
      throw new Error(
        `Bundle is missing asset bytes for storage key "${key}". ` +
          `The assets/ directory is present but incomplete.`
      );
    }
  }
}

/**
 * Throw if adding `size` bytes for `storageKey` would breach either cap.
 * `priorTotal` is the cumulative size of assets accumulated BEFORE this one
 * (the check is priorTotal + size > perBundle).
 */
export function assertWithinCaps(
  storageKey: string,
  size: number,
  priorTotal: number,
  caps: AssetCaps
): void {
  if (size > caps.perAsset) {
    throw new Error(
      `Asset "${storageKey}" is ${size} bytes, over the per-asset cap of ` +
        `${caps.perAsset} bytes. Raise it with --max-asset-size <MB>.`
    );
  }
  const cumulative = priorTotal + size;
  if (cumulative > caps.perBundle) {
    throw new Error(
      `Cumulative asset size ${cumulative} bytes exceeds the per-bundle ` +
        `size cap of ${caps.perBundle} bytes. Raise it with ` +
        `--max-bundle-size <MB>.`
    );
  }
}

/**
 * Re-hydrate the Nuxt `images:originals` storage spec into a standalone
 * unstorage instance. The spec object IS the unstorage driver options plus a
 * `driver` discriminator, so building a live handle is a direct mapping.
 * Runs outside Nitro (the bundle CLI is a tsx script).
 */
export function createBundleStorage(): Storage {
  const { driver, ...opts } = buildStorageConfig()['images:originals']!;
  if (driver === 'fs') {
    return createStorage({ driver: fsDriver({ base: opts.base as string }) });
  }
  if (driver === 's3') {
    return createStorage({
      // s3Driver option keys match the spec exactly (bucket/region/
      // accessKeyId/secretAccessKey/endpoint/pathPrefix), but the spec is
      // typed as a loose `Record<string, unknown>` so it has no structural
      // overlap with S3DriverOptions — the double cast is the honest bridge.
      // eslint-disable-next-line no-restricted-syntax -- spec is Record<string, unknown>; no structural overlap with S3DriverOptions
      driver: s3Driver(opts as unknown as Parameters<typeof s3Driver>[0]),
    });
  }
  throw new Error(`Unsupported storage driver for bundle assets: "${driver}".`);
}

export interface ExportAssetsArgs {
  storage: Storage;
  storageKeys: string[];
  assetsDir: string;
  caps: AssetCaps;
}

export interface ExportAssetsResult {
  count: number;
  totalBytes: number;
}

/**
 * Read each referenced byte from `storage` and write it to `assetsDir` on
 * disk. Fail-fast on a missing byte or a cap breach. The assets dir is only
 * created once the first byte is about to be written, so a fail-fast on the
 * very first key leaves no empty dir behind.
 *
 * On a mid-stream failure (missing byte or cap breach), assets already written
 * for earlier keys are left on disk — the caller owns cleanup of the output
 * directory.
 */
export async function exportAssets(
  args: ExportAssetsArgs
): Promise<ExportAssetsResult> {
  const { storage, storageKeys, assetsDir, caps } = args;
  let totalBytes = 0;
  let count = 0;
  let dirReady = false;

  for (const key of storageKeys) {
    const raw = await storage.getItemRaw<Buffer | Uint8Array | ArrayBuffer>(
      key
    );
    if (raw == null) {
      throw new Error(
        `Cannot export bundle: storage has no bytes for image storage key ` +
          `"${key}". Repair the drift or remove the reference, then retry.`
      );
    }
    // s3 returns ArrayBuffer; fs/memory return Buffer. Wrap ArrayBuffer in a
    // typed-array view so Buffer.from picks the ArrayLike<number> overload.
    const buffer = Buffer.isBuffer(raw)
      ? raw
      : Buffer.from(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw);
    // assertWithinCaps takes the PRE-asset running total and checks
    // priorTotal + size internally, so assert BEFORE incrementing.
    assertWithinCaps(key, buffer.length, totalBytes, caps);
    totalBytes += buffer.length;

    if (!dirReady) {
      mkdirSync(assetsDir, { recursive: true });
      dirReady = true;
    }
    writeFileSync(join(assetsDir, key), buffer);
    count++;
  }

  return { count, totalBytes };
}
