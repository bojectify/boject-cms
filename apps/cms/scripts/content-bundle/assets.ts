import { FIELD_TYPES } from '../../utils/fieldTypes';
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
