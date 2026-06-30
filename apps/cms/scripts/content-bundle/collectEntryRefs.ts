import type { FieldType } from '#prisma';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { collectRichtextReferences } from '../../utils/collectRichtextReferences';

export interface CollectedEntryRef {
  contentTypeId: string;
  entryId: string;
  /** The field the reference came from — used for error messages. */
  fieldIdentifier: string;
}

/**
 * Collect every cross-entry reference a NON-PORTABLE entry's `data` makes:
 * RELATION / MULTIRELATION `{ contentTypeId, entryId }` values and RICHTEXT
 * cmsEmbed/cmsLink targets. Richtext refs come from `collectRichtextReferences`
 * — the same "referenced entry" notion the GraphQL `RichText.references`
 * resolver uses — so the import guard and the read API agree on what a
 * reference is.
 *
 * Malformed / missing / empty-string ids are skipped: the caller validates
 * existence, not shape. IMAGE `storageKey` is deliberately NOT collected — it
 * is a storage pointer, not an entry reference (references-only by design).
 */
export function collectEntryRefs(
  data: Record<string, unknown>,
  fieldTypes: Record<string, FieldType>
): CollectedEntryRef[] {
  const refs: CollectedEntryRef[] = [];
  for (const [key, value] of Object.entries(data)) {
    const type = fieldTypes[key];
    if (value === null || value === undefined) continue;
    if (type === FIELD_TYPES.RELATION) {
      pushRef(refs, value, key);
    } else if (type === FIELD_TYPES.MULTIRELATION) {
      if (Array.isArray(value)) {
        for (const ref of value) pushRef(refs, ref, key);
      }
    } else if (type === FIELD_TYPES.RICHTEXT) {
      for (const r of collectRichtextReferences(value)) {
        refs.push({
          contentTypeId: r.contentTypeId,
          entryId: r.entryId,
          fieldIdentifier: key,
        });
      }
    }
  }
  return refs;
}

function pushRef(
  out: CollectedEntryRef[],
  value: unknown,
  fieldIdentifier: string
): void {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (typeof v.contentTypeId !== 'string' || typeof v.entryId !== 'string') {
    return;
  }
  if (v.contentTypeId === '' || v.entryId === '') return;
  out.push({
    contentTypeId: v.contentTypeId,
    entryId: v.entryId,
    fieldIdentifier,
  });
}
