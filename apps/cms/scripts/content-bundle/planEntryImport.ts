import type {
  Bundle,
  EntryImportPlan,
  EntryImportPlanResult,
  OnConflict,
} from './types';
import {
  EntryImportConflictError,
  EntryImportReferenceError,
} from './importErrors';

/**
 * Pure planner: classifies each bundle entry as create / update / skip
 * against a pre-loaded existing-entry snapshot keyed by
 * (contentTypeIdentifier, entryKey).
 *
 * Throws on unknown content types and (in `fail` mode) on the first
 * collision. The thrown messages mirror the existing importBundle error
 * surface so downstream tests don't regress.
 */
export function planEntryImport(
  existingByTypeAndKey: Map<string, Map<string, string>>,
  bundle: Bundle,
  identifierToTypeId: Map<string, string>,
  onConflict: OnConflict
): EntryImportPlanResult {
  const plans: EntryImportPlan[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const bundleEntry of bundle.entries ?? []) {
    if (!identifierToTypeId.has(bundleEntry.contentTypeIdentifier)) {
      throw new EntryImportReferenceError(
        `Entry "${bundleEntry.entryTitle}" references unknown content type "${bundleEntry.contentTypeIdentifier}"`
      );
    }

    const existingId = existingByTypeAndKey
      .get(bundleEntry.contentTypeIdentifier)
      ?.get(bundleEntry.entryKey);

    if (existingId === undefined) {
      plans.push({ action: 'create', bundleEntry });
      created++;
      continue;
    }

    if (onConflict === 'fail') {
      throw new EntryImportConflictError(
        `Entry "${bundleEntry.contentTypeIdentifier}:${bundleEntry.entryKey}" already exists on target`,
        bundleEntry.contentTypeIdentifier,
        bundleEntry.entryKey
      );
    }
    if (onConflict === 'skip') {
      plans.push({ action: 'skip', bundleEntry, existingId });
      skipped++;
      continue;
    }
    // replace
    plans.push({ action: 'update', bundleEntry, existingId });
    updated++;
  }

  return { plans, summary: { created, updated, skipped } };
}
