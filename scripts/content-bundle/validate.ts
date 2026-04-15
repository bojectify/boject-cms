import type {
  Bundle,
  BundleContentType,
  BundleEntry,
  BundleField,
  ValidationError,
  ValidationResult,
} from './types';
import { BUNDLE_VERSION } from './types';

const FIELD_TYPES = new Set([
  'ENTRY_TITLE',
  'SLUG',
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'BOOLEAN',
  'DATETIME',
  'SELECT',
  'RICHTEXT',
  'RELATION',
  'MULTIRELATION',
  'IMAGE',
]);

const STATUSES = new Set(['DRAFT', 'PUBLISHED', 'CHANGED', 'ARCHIVED']);

export function validateBundle(bundle: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isObject(bundle)) {
    return {
      ok: false,
      errors: [{ path: '', message: 'bundle must be an object' }],
    };
  }

  const b = bundle as Partial<Bundle>;

  if (b.version !== BUNDLE_VERSION) {
    errors.push({
      path: 'version',
      message: `expected version ${BUNDLE_VERSION}, got ${b.version}`,
    });
  }

  if (typeof b.portable !== 'boolean') {
    errors.push({ path: 'portable', message: 'must be a boolean' });
  }

  if (b.contentTypes !== undefined) {
    if (!Array.isArray(b.contentTypes)) {
      errors.push({ path: 'contentTypes', message: 'must be an array' });
    } else {
      b.contentTypes.forEach((ct, i) =>
        validateContentType(ct, `contentTypes[${i}]`, errors)
      );
    }
  }

  if (b.entries !== undefined) {
    if (!Array.isArray(b.entries)) {
      errors.push({ path: 'entries', message: 'must be an array' });
    } else {
      b.entries.forEach((e, i) =>
        validateEntry(e, `entries[${i}]`, b.portable === true, errors)
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateContentType(
  ct: unknown,
  path: string,
  errors: ValidationError[]
): void {
  if (!isObject(ct)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }
  const c = ct as Partial<BundleContentType>;

  if (typeof c.identifier !== 'string' || !c.identifier) {
    errors.push({
      path: `${path}.identifier`,
      message: 'must be a non-empty string',
    });
  }
  if (typeof c.name !== 'string' || !c.name) {
    errors.push({
      path: `${path}.name`,
      message: 'must be a non-empty string',
    });
  }
  if (!Array.isArray(c.fields)) {
    errors.push({ path: `${path}.fields`, message: 'must be an array' });
    return;
  }

  const titleCount = c.fields.filter(
    (f) => isObject(f) && (f as BundleField).type === 'ENTRY_TITLE'
  ).length;
  if (titleCount !== 1) {
    errors.push({
      path: `${path}.fields`,
      message: `expected exactly one ENTRY_TITLE field, got ${titleCount}`,
    });
  }

  const slugCount = c.fields.filter(
    (f) => isObject(f) && (f as BundleField).type === 'SLUG'
  ).length;
  if (slugCount > 1) {
    errors.push({
      path: `${path}.fields`,
      message: `expected at most one SLUG field, got ${slugCount}`,
    });
  }

  c.fields.forEach((f, i) => validateField(f, `${path}.fields[${i}]`, errors));
}

function validateField(
  field: unknown,
  path: string,
  errors: ValidationError[]
): void {
  if (!isObject(field)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }
  const f = field as Partial<BundleField>;

  if (typeof f.identifier !== 'string' || !f.identifier) {
    errors.push({
      path: `${path}.identifier`,
      message: 'must be a non-empty string',
    });
  }
  if (typeof f.type !== 'string' || !FIELD_TYPES.has(f.type)) {
    errors.push({
      path: `${path}.type`,
      message: `must be one of ${Array.from(FIELD_TYPES).join(', ')}`,
    });
    return;
  }

  if (f.type === 'SELECT') {
    const choices = (f.options as { choices?: string[] } | null)?.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      errors.push({
        path: `${path}.options`,
        message: 'SELECT field requires a non-empty choices array',
      });
    }
  }

  if (f.type === 'RELATION' || f.type === 'MULTIRELATION') {
    const opts = f.options ?? {};
    const ids = (opts as { targetContentTypeIds?: unknown })
      .targetContentTypeIds;
    const idents = (opts as { targetContentTypeIdentifiers?: unknown })
      .targetContentTypeIdentifiers;
    const hasIds = Array.isArray(ids) && ids.length > 0;
    const hasIdents = Array.isArray(idents) && idents.length > 0;
    if (!hasIds && !hasIdents) {
      errors.push({
        path: `${path}.options`,
        message: `${f.type} field requires targetContentTypeIds or targetContentTypeIdentifiers`,
      });
    }
  }
}

function validateEntry(
  entry: unknown,
  path: string,
  portable: boolean,
  errors: ValidationError[]
): void {
  if (!isObject(entry)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }
  const e = entry as Partial<BundleEntry>;

  if (typeof e.contentTypeIdentifier !== 'string' || !e.contentTypeIdentifier) {
    errors.push({
      path: `${path}.contentTypeIdentifier`,
      message: 'must be a non-empty string',
    });
  }
  if (typeof e.entryTitle !== 'string' || !e.entryTitle) {
    errors.push({
      path: `${path}.entryTitle`,
      message: 'must be a non-empty string',
    });
  }
  if (typeof e.status !== 'string' || !STATUSES.has(e.status)) {
    errors.push({
      path: `${path}.status`,
      message: `must be one of ${Array.from(STATUSES).join(', ')}`,
    });
  }
  if (!isObject(e.data)) {
    errors.push({ path: `${path}.data`, message: 'must be an object' });
  }

  if (portable && e.id !== null) {
    errors.push({
      path: `${path}.id`,
      message: 'portable bundle entries must have id=null',
    });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
