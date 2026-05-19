// VENDORED from apps/cms/scripts/content-bundle/schemaPlan.types.ts.
// The CLI is published standalone and cannot import from apps/cms/.
// Keep this file in sync when the canonical version changes.
//
// Type contract for the schema-as-code planner. The applier (Spec 3)
// and CLI (Spec 5) both consume SchemaPlan as their interface.

import type {
  Bundle,
  BundleContentType,
  BundleField,
} from './contentBundleTypes.js';
import { FIELD_TYPES, type FieldTypeName } from './fieldTypes.js';

/** Snapshot of current schema state, fetched once before planning. */
export interface CurrentSchemaSnapshot {
  contentTypes: Array<{
    id: string;
    identifier: string;
    name: string;
    description: string | null;
    fields: Array<{
      id: string;
      identifier: string;
      name: string;
      type: FieldTypeName;
      required: boolean;
      unique: boolean;
      order: number;
      options: Record<string, unknown> | null;
    }>;
    /** Total entries (any status) for this type. Used for removal safety. */
    entryCount: number;
  }>;
  /** Per-field stats for safety checks. Keyed by `${typeIdentifier}:${fieldIdentifier}`. */
  fieldUsage: Map<string, FieldUsage>;
}

export interface FieldUsage {
  /** Entries with a non-null/non-undefined value for this field. */
  entriesWithValue: number;
  /** For SELECT fields: count of entries by choice value. */
  selectChoiceCounts?: Map<string, number>;
  /** For RELATION/MULTIRELATION: count of entries pointing at each target identifier. */
  relationTargetCounts?: Map<string, number>;
  /** For NUMBER/TEXT: ordered list of duplicate values + the entry IDs holding them. */
  duplicateValues?: Array<{ value: string | number; entryIds: string[] }>;
}

export interface SchemaPlan {
  contentTypes: {
    create: BundleContentType[];
    update: TypeUpdate[];
    remove: TypeRemoval[];
  };
  fields: {
    create: FieldCreate[];
    update: FieldUpdate[];
    remove: FieldRemoval[];
  };
  warnings: Warning[];
  blockers: Blocker[];
}

export interface TypeUpdate {
  id: string;
  identifier: string;
  changes: Partial<Pick<BundleContentType, 'name' | 'description'>>;
}

export interface TypeRemoval {
  id: string;
  identifier: string;
  entryCount: number;
}

export interface FieldCreate {
  contentTypeId: string;
  contentTypeIdentifier: string;
  field: BundleField;
}

export interface FieldUpdate {
  id: string;
  contentTypeIdentifier: string;
  fieldIdentifier: string;
  changes: Partial<{
    name: string;
    required: boolean;
    unique: boolean;
    order: number;
    options: Record<string, unknown>;
  }>;
}

export interface FieldRemoval {
  id: string;
  contentTypeIdentifier: string;
  fieldIdentifier: string;
  entriesWithValue: number;
}

export type WarningCode =
  | 'FIELD_REMOVAL_DATA_LOSS'
  | 'NEW_REQUIRED_FIELD_WITH_ENTRIES'
  | 'OPTIONAL_TO_REQUIRED_NO_NULLS'
  | 'UNRECOGNISED_FIELD_OPTION';

export interface Warning {
  code: WarningCode;
  message: string;
  path: string;
}

export type BlockerCode =
  | 'CONTENT_TYPE_REMOVAL_WITH_ENTRIES'
  | 'CONTENT_TYPE_IDENTIFIER_CHANGE'
  | 'FIELD_IDENTIFIER_CHANGE'
  | 'FIELD_TYPE_CHANGE'
  | 'OPTIONAL_TO_REQUIRED_HAS_NULLS'
  | 'UNIQUE_CONFLICT'
  | 'SELECT_CHOICE_REMOVED_IN_USE'
  | 'RELATION_TARGET_REMOVED_IN_USE'
  | 'CONTENT_TYPE_REMOVAL_NEEDS_FLAG'
  | 'FIELD_REMOVAL_NEEDS_FLAG'
  | 'RELATION_TARGET_NOT_FOUND';

export interface Blocker {
  code: BlockerCode;
  message: string;
  path: string;
  /** Affected entry IDs, for blockers that name specific entries. */
  affectedEntryIds?: string[];
}

export interface PlanOptions {
  allowDestructive?: boolean;
}

/**
 * The fallback for `unique` when a bundle field doesn't carry it
 * explicitly. Mirrors the rule in
 * `apps/cms/server/utils/validateFieldUnique.ts::resolveUniqueFlag`:
 * ENTRY_TITLE and SLUG are implicitly unique, everything else
 * defaults to false.
 *
 * Duplicated here (rather than imported from server/utils) so the
 * planner stays free of Nuxt/h3 imports.
 */
export function effectiveBundleUnique(field: BundleField): boolean {
  if (field.type === FIELD_TYPES.ENTRY_TITLE || field.type === FIELD_TYPES.SLUG)
    return true;
  return field.unique === true;
}

export type { Bundle };
