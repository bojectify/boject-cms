import {
  FIELD_TYPES,
  FIELD_TYPE_NAMES,
  isFieldTypeName,
} from '../../utils/fieldTypes';
import {
  CONTENT_STATUSES,
  CONTENT_STATUS_NAMES,
  isContentStatusName,
} from '../../utils/contentStatus';
import { isObject } from '../../utils/isObject';
import type {
  Bundle,
  BundleContentType,
  BundleEntry,
  BundleEntryVersion,
  BundleField,
  ValidationError,
  ValidationResult,
} from './types';
import { BUNDLE_VERSION } from './types';

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
      message: `expected version ${BUNDLE_VERSION}, got ${b.version}; run \`boject bundle migrate <path>\` to upgrade`,
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

      // Dedupe entryKey within each contentTypeIdentifier (#205).
      const seenKeys = new Map<string, Set<string>>();
      for (let i = 0; i < b.entries.length; i++) {
        const entry = b.entries[i];
        if (!isObject(entry)) continue;
        const e = entry as Partial<BundleEntry>;
        if (typeof e.entryKey !== 'string' || e.entryKey.length === 0) continue;
        if (typeof e.contentTypeIdentifier !== 'string') continue;
        let set = seenKeys.get(e.contentTypeIdentifier);
        if (!set) {
          set = new Set();
          seenKeys.set(e.contentTypeIdentifier, set);
        }
        if (set.has(e.entryKey)) {
          errors.push({
            path: `entries[${i}].entryKey`,
            message: `duplicate entryKey "${e.entryKey}" within contentTypeIdentifier "${e.contentTypeIdentifier}"`,
          });
        }
        set.add(e.entryKey);
      }
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
    (f) => isObject(f) && (f as BundleField).type === FIELD_TYPES.ENTRY_TITLE
  ).length;
  if (titleCount !== 1) {
    errors.push({
      path: `${path}.fields`,
      message: `expected exactly one ENTRY_TITLE field, got ${titleCount}`,
    });
  }

  const slugCount = c.fields.filter(
    (f) => isObject(f) && (f as BundleField).type === FIELD_TYPES.SLUG
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
  if (!isFieldTypeName(f.type)) {
    errors.push({
      path: `${path}.type`,
      message: `must be one of ${FIELD_TYPE_NAMES.join(', ')}`,
    });
    return;
  }

  if (
    'unique' in f &&
    f.unique !== undefined &&
    typeof f.unique !== 'boolean'
  ) {
    errors.push({
      path: `${path}.unique`,
      message: 'must be a boolean if present',
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
  if (typeof e.entryKey !== 'string' || e.entryKey.length === 0) {
    errors.push({
      path: `${path}.entryKey`,
      message: 'required (non-empty string)',
    });
  }

  if (!Array.isArray(e.versions)) {
    errors.push({
      path,
      message: 'entry must have a non-empty versions array',
    });
  } else if (e.versions.length === 0) {
    errors.push({
      path: `${path}.versions`,
      message: 'must contain at least one version',
    });
  } else {
    e.versions.forEach((v, i) =>
      validateEntryVersion(v, `${path}.versions[${i}]`, errors)
    );

    // Two-slot invariant: at most one PUBLISHED version and at most one
    // draft-slot version (DRAFT or CHANGED) per entry. ARCHIVED is
    // unbounded. Mirrors the partial unique index on ContentEntryVersion.
    const publishedCount = e.versions.filter(
      (v) =>
        isObject(v) &&
        (v as { status?: unknown }).status === CONTENT_STATUSES.PUBLISHED
    ).length;
    if (publishedCount > 1) {
      errors.push({
        path: `${path}.versions`,
        message: 'at most one PUBLISHED version per entry',
      });
    }
    const draftCount = e.versions.filter(
      (v) =>
        isObject(v) &&
        ((v as { status?: unknown }).status === CONTENT_STATUSES.DRAFT ||
          (v as { status?: unknown }).status === CONTENT_STATUSES.CHANGED)
    ).length;
    if (draftCount > 1) {
      errors.push({
        path: `${path}.versions`,
        message: 'at most one draft version (DRAFT or CHANGED) per entry',
      });
    }
  }

  if (portable && e.id !== null) {
    errors.push({
      path: `${path}.id`,
      message: 'portable bundle entries must have id=null',
    });
  }
}

function validateEntryVersion(
  version: unknown,
  path: string,
  errors: ValidationError[]
): void {
  if (!isObject(version)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }
  const v = version as Partial<BundleEntryVersion>;

  if (!isContentStatusName(v.status)) {
    errors.push({
      path: `${path}.status`,
      message: `must be one of ${CONTENT_STATUS_NAMES.join(', ')}`,
    });
  }
  if (!isObject(v.data)) {
    errors.push({ path: `${path}.data`, message: 'must be an object' });
  }
  if (
    v.publishedAt !== null &&
    v.publishedAt !== undefined &&
    typeof v.publishedAt !== 'string'
  ) {
    errors.push({
      path: `${path}.publishedAt`,
      message: 'must be a string or null',
    });
  }
}
