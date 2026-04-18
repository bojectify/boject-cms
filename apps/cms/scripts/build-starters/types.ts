// scripts/build-starters/types.ts
import type { Bundle, BundleField } from '../content-bundle/types';

export const OVERLAY_VERSION = 1;

export type ContentTypeMode = 'create' | 'patch';

export interface OverlayField extends BundleField {}

export interface OverlayContentType {
  identifier: string;
  mode?: ContentTypeMode;
  name?: string;
  description?: string | null;
  fields: OverlayField[];
}

export interface Overlay {
  version: number;
  name: string;
  extends: string | null;
  contentTypes?: OverlayContentType[];
  entries?: Bundle['entries'];
}

export interface OverlayValidationError {
  path: string;
  message: string;
}

export interface OverlayValidationResult {
  ok: boolean;
  errors: OverlayValidationError[];
}
