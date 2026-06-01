import type { FieldType } from '#prisma';
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
      if ((f.type as FieldType) === FIELD_TYPES.IMAGE) set.add(f.identifier);
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
        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          typeof (value as { storageKey?: unknown }).storageKey === 'string' &&
          (value as { storageKey: string }).storageKey.length > 0
        ) {
          keys.add((value as { storageKey: string }).storageKey);
        }
      }
    }
  }
  return [...keys];
}
