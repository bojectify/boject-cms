import type { ContentStatus, FieldType } from '#prisma';

export const BUNDLE_VERSION = 1;

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

export interface BundleEntry {
  id: string | null;
  contentTypeId: string | null;
  contentTypeIdentifier: string;
  entryTitle: string;
  slug: string | null;
  status: ContentStatus;
  publishedAt: string | null;
  data: Record<string, unknown>;
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
