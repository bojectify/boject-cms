import type { ContentStatus, FieldType } from '#prisma';

// V2 was redefined in #205: entries are now REQUIRED to carry an `entryKey`
// string. The version number was deliberately not bumped (clean cutover —
// no real-world v1/v2 entry-bearing bundles exist outside this repo).
// Validation enforces the new requirement at validate.ts.
export const BUNDLE_VERSION = 2;

export type BundleFieldOptions = {
  choices?: string[];
  targetContentTypeIds?: string[] | null[];
  targetContentTypeIdentifiers?: string[];
  [key: string]: unknown;
};

export interface BundleField {
  id: string | null;
  identifier: string;
  name: string;
  type: FieldType;
  required: boolean;
  unique?: boolean;
  order: number;
  options: BundleFieldOptions | null;
}

export interface BundleContentType {
  id: string | null;
  identifier: string;
  name: string;
  description: string | null;
  fields: BundleField[];
}

export interface BundleEntryVersion {
  status: ContentStatus;
  data: Record<string, unknown>;
  publishedAt: string | null;
}

export interface BundleEntry {
  id: string | null;
  contentTypeId: string | null;
  contentTypeIdentifier: string;
  entryTitle: string;
  entryKey: string;
  slug: string | null;
  // V1 flat fields (kept for backward compat on import)
  status?: ContentStatus;
  publishedAt?: string | null;
  data?: Record<string, unknown>;
  // V2 versioned
  versions?: BundleEntryVersion[];
}

export interface Bundle {
  version: number;
  exportedAt: string;
  portable: boolean;
  contentTypes?: BundleContentType[];
  entries?: BundleEntry[];
}

export type BundleMode = 'schema' | 'entries' | 'all';

export interface ValidationError {
  path: string;
  message: string;
}

export type ConflictErrorKind =
  | 'contentType.identifier'
  | 'contentType.id'
  | 'field.id'
  | 'entry.id'
  | 'entry.slug'
  | 'entry.entryTitle';

export interface ConflictError {
  kind: ConflictErrorKind;
  identifier: string;
  existingId?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

export interface ImportResult {
  contentTypesCreated: number;
  entriesCreated: number;
}
