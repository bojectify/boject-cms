import type { ContentStatus, FieldType } from '#prisma';

// Coupling rule: bumping BUNDLE_VERSION is a breaking change to the bundle
// format and MUST coincide with a CLI semver-major release. The reverse
// does not hold — a CLI major may ship without a bundle version bump.
// See docs/superpowers/specs/2026-05-28-bundle-format-versioning-and-migrations-design.md
// (internal repo) for the full versioning policy.
//
// History: V2 was redefined in #205 to require `entryKey` on every entry.
// The version number was not bumped at that time (clean cutover — no real
// v1/v2 entry-bearing bundles existed outside this repo). The defensive
// v1 entry-shape fallback was removed in #32.
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
