// scripts/build-starters/types.ts
import type { Bundle, BundleField } from '../content-bundle/types';

export const OVERLAY_VERSION = 1;

export type ContentTypeMode = 'create' | 'patch';

export type OverlayField = BundleField;

export interface OverlayContentType {
  identifier: string;
  mode?: ContentTypeMode;
  name?: string;
  description?: string | null;
  /** Field-partial names whose fields are appended to this content type. */
  extends?: string[];
  fields: OverlayField[];
}

export interface Overlay {
  version: number;
  name: string;
  extends: string | string[] | null;
  contentTypes?: OverlayContentType[];
  entries?: Bundle['entries'];
}

export interface FieldPartial {
  name: string;
  fields: OverlayField[];
}

/** Normalise an overlay/content-type `extends` value to a name array. */
export function normalizeExtends(
  ext: string | string[] | null | undefined
): string[] {
  if (ext == null) return [];
  return Array.isArray(ext) ? ext : [ext];
}

export interface OverlayValidationError {
  path: string;
  message: string;
}

export interface OverlayValidationResult {
  ok: boolean;
  errors: OverlayValidationError[];
}
