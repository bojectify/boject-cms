// scripts/build-starters/validate.ts
import {
  FIELD_TYPES,
  FIELD_TYPE_NAMES,
  isFieldTypeName,
} from '../../utils/fieldTypes';
import { isObject } from '../../utils/isObject';
import type {
  Overlay,
  OverlayContentType,
  OverlayField,
  OverlayValidationError,
  OverlayValidationResult,
} from './types';
import { OVERLAY_VERSION } from './types';

const MODES = new Set(['create', 'patch']);

export function validateOverlay(input: unknown): OverlayValidationResult {
  const errors: OverlayValidationError[] = [];

  if (!isObject(input)) {
    return {
      ok: false,
      errors: [{ path: '', message: 'overlay must be an object' }],
    };
  }

  const o = input as Partial<Overlay>;

  if (o.version !== OVERLAY_VERSION) {
    errors.push({
      path: 'version',
      message: `expected version ${OVERLAY_VERSION}, got ${o.version}`,
    });
  }

  if (typeof o.name !== 'string' || o.name.length === 0) {
    errors.push({ path: 'name', message: 'must be a non-empty string' });
  }

  if (o.extends !== null && typeof o.extends !== 'string') {
    errors.push({
      path: 'extends',
      message: 'must be a string (parent bundle name) or null',
    });
  }

  if (o.contentTypes !== undefined) {
    if (!Array.isArray(o.contentTypes)) {
      errors.push({ path: 'contentTypes', message: 'must be an array' });
    } else {
      o.contentTypes.forEach((ct, i) =>
        validateContentType(ct, `contentTypes[${i}]`, errors)
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateContentType(
  ct: unknown,
  path: string,
  errors: OverlayValidationError[]
): void {
  if (!isObject(ct)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }
  const c = ct as Partial<OverlayContentType>;
  const mode = c.mode ?? 'create';

  if (!MODES.has(mode)) {
    errors.push({
      path: `${path}.mode`,
      message: `must be one of ${Array.from(MODES).join(', ')}`,
    });
  }
  if (typeof c.identifier !== 'string' || c.identifier.length === 0) {
    errors.push({
      path: `${path}.identifier`,
      message: 'must be a non-empty string',
    });
  }
  if (mode === 'create') {
    if (typeof c.name !== 'string' || c.name.length === 0) {
      errors.push({
        path: `${path}.name`,
        message: 'create mode requires a non-empty name',
      });
    }
  }
  if (!Array.isArray(c.fields)) {
    errors.push({ path: `${path}.fields`, message: 'must be an array' });
    return;
  }

  if (mode === 'create') {
    const titleCount = c.fields.filter(
      (f) => isObject(f) && (f as OverlayField).type === FIELD_TYPES.ENTRY_TITLE
    ).length;
    if (titleCount !== 1) {
      errors.push({
        path: `${path}.fields`,
        message: `create mode requires exactly one ENTRY_TITLE field, got ${titleCount}`,
      });
    }
  }

  c.fields.forEach((f, i) =>
    validateField(f, `${path}.fields[${i}]`, mode, errors)
  );
}

function validateField(
  field: unknown,
  path: string,
  mode: string,
  errors: OverlayValidationError[]
): void {
  if (!isObject(field)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }
  const f = field as Partial<OverlayField>;

  if (typeof f.identifier !== 'string' || f.identifier.length === 0) {
    errors.push({
      path: `${path}.identifier`,
      message: 'must be a non-empty string',
    });
  }
  if (!isFieldTypeName(f.type)) {
    errors.push({
      path: `${path}.type`,
      message: `must be one of ${FIELD_TYPE_NAMES.join(', ')}`,
    });
    return;
  }
  if (
    mode === 'patch' &&
    (f.type === FIELD_TYPES.ENTRY_TITLE || f.type === FIELD_TYPES.SLUG)
  ) {
    errors.push({
      path: `${path}.type`,
      message: `patch mode cannot introduce ${f.type} fields`,
    });
  }
  if (f.type === FIELD_TYPES.SELECT) {
    const choices = (f.options as { choices?: string[] } | null)?.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      errors.push({
        path: `${path}.options`,
        message: 'SELECT field requires a non-empty choices array',
      });
    }
  }
  if (f.type === FIELD_TYPES.RELATION || f.type === FIELD_TYPES.MULTIRELATION) {
    const opts = f.options ?? {};
    const idents = (opts as { targetContentTypeIdentifiers?: unknown })
      .targetContentTypeIdentifiers;
    if (!Array.isArray(idents) || idents.length === 0) {
      errors.push({
        path: `${path}.options`,
        message: `${f.type} field requires targetContentTypeIdentifiers`,
      });
    }
  }
}
