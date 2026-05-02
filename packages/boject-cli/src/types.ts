// Minimal duplication of apps/cms/scripts/content-bundle/types.ts —
// the CLI is published standalone and cannot depend on Nuxt-side
// modules. Keep this file in sync with the canonical types when
// they change.

export interface BundleField {
  id: string | null;
  identifier: string;
  name: string;
  type: string; // FieldType — keep loose at the CLI layer
  required: boolean;
  unique?: boolean;
  order: number;
  options: Record<string, unknown> | null;
}

export interface BundleContentType {
  id: string | null;
  identifier: string;
  name: string;
  description: string | null;
  fields: BundleField[];
}

export interface Bundle {
  version: number;
  exportedAt: string;
  portable: boolean;
  contentTypes?: BundleContentType[];
  entries?: unknown[];
}

export interface ApplySchemaResultLike {
  changed: boolean;
  applied: {
    contentTypesCreated: number;
    contentTypesUpdated: number;
    contentTypesRemoved: number;
    fieldsCreated: number;
    fieldsUpdated: number;
    fieldsRemoved: number;
  };
  plan?: unknown;
}

export interface BlockerLike {
  code: string;
  message: string;
  path: string;
}
