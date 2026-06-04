import type { FieldType } from '#prisma';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { EntryImportReferenceError } from './importErrors';

export interface UuidRelationRef {
  contentTypeId: string;
  entryId: string;
}

export interface PortableRelationRef {
  contentTypeIdentifier: string;
  entryKey: string;
}

export type EntryKeyMap = Map<string, string>;

export function encodeRelationRef(
  ref: UuidRelationRef,
  typeIdToIdentifier: Map<string, string>,
  typeIdentifierToEntryKeys: Map<string, EntryKeyMap>
): PortableRelationRef {
  const identifier = typeIdToIdentifier.get(ref.contentTypeId);
  if (!identifier) {
    throw new Error(
      `Cannot encode relation ref: unknown contentTypeId ${ref.contentTypeId}`
    );
  }
  const entryMap = typeIdentifierToEntryKeys.get(identifier);
  const entryKey = entryMap?.get(ref.entryId);
  if (!entryKey) {
    throw new Error(
      `Cannot encode relation ref: entry ${ref.entryId} has no entryKey under content type ${identifier}`
    );
  }
  return { contentTypeIdentifier: identifier, entryKey };
}

export function decodeRelationRef(
  ref: PortableRelationRef,
  identifierToTypeId: Map<string, string>,
  typeIdentifierToKeyToEntry: Map<string, Map<string, string>>
): UuidRelationRef {
  const contentTypeId = identifierToTypeId.get(ref.contentTypeIdentifier);
  if (!contentTypeId) {
    // Typed (→ HTTP 400 ENTRY_IMPORT_REFERENCE_INVALID) so a dangling ref in a
    // portable bundle surfaces the same clean status + shape as the
    // non-portable guard (assertNonPortableRefsResolve) rather than an h3 500.
    throw new EntryImportReferenceError(
      `Cannot decode relation ref: unknown identifier ${ref.contentTypeIdentifier}`
    );
  }
  const keyMap = typeIdentifierToKeyToEntry.get(ref.contentTypeIdentifier);
  const entryId = keyMap?.get(ref.entryKey);
  if (!entryId) {
    throw new EntryImportReferenceError(
      `Cannot decode relation ref: entry ${ref.contentTypeIdentifier}:${ref.entryKey} not found`
    );
  }
  return { contentTypeId, entryId };
}

function mapCmsEmbedAttrs(
  node: unknown,
  transform: (attrs: Record<string, unknown>) => Record<string, unknown>
): unknown {
  if (!node || typeof node !== 'object') return node;
  const n = node as { type?: unknown; attrs?: unknown; content?: unknown };
  const next: Record<string, unknown> = { ...(n as object) } as Record<
    string,
    unknown
  >;
  if (n.type === 'cmsEmbed') {
    next.attrs = { ...transform((n.attrs ?? {}) as Record<string, unknown>) };
  }
  if (Array.isArray(n.content)) {
    next.content = n.content.map((c) => mapCmsEmbedAttrs(c, transform));
  }
  return next;
}

export function encodeRichtextRefs(
  value: unknown,
  typeIdToIdentifier: Map<string, string>,
  typeIdentifierToEntryKeys: Map<string, EntryKeyMap>
): unknown {
  return mapCmsEmbedAttrs(value, (attrs) => {
    // Legacy / unknown-shape attrs (e.g. `embedType`/`embedId` from the old
    // cmsEmbed implementation) pass through untouched so existing bundles
    // remain importable.
    if (
      typeof attrs.contentTypeId !== 'string' ||
      typeof attrs.entryId !== 'string'
    ) {
      return attrs;
    }
    const ref = encodeRelationRef(
      {
        contentTypeId: attrs.contentTypeId,
        entryId: attrs.entryId,
      },
      typeIdToIdentifier,
      typeIdentifierToEntryKeys
    );
    return {
      contentTypeIdentifier: ref.contentTypeIdentifier,
      entryKey: ref.entryKey,
    };
  });
}

export function decodeRichtextRefs(
  value: unknown,
  identifierToTypeId: Map<string, string>,
  typeIdentifierToKeyToEntry: Map<string, Map<string, string>>
): unknown {
  return mapCmsEmbedAttrs(value, (attrs) => {
    // Legacy / unknown-shape attrs (e.g. `embedType`/`embedId` from the old
    // cmsEmbed implementation) pass through untouched so existing bundles
    // remain importable.
    if (
      typeof attrs.contentTypeIdentifier !== 'string' ||
      typeof attrs.entryKey !== 'string'
    ) {
      return attrs;
    }
    const uuid = decodeRelationRef(
      {
        contentTypeIdentifier: attrs.contentTypeIdentifier,
        entryKey: attrs.entryKey,
      },
      identifierToTypeId,
      typeIdentifierToKeyToEntry
    );
    return { contentTypeId: uuid.contentTypeId, entryId: uuid.entryId };
  });
}

type FieldTypeMap = Record<string, FieldType>;

export function encodeDataRefs(
  data: Record<string, unknown>,
  fieldTypes: FieldTypeMap,
  typeIdToIdentifier: Map<string, string>,
  typeIdentifierToEntryKeys: Map<string, EntryKeyMap>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const type = fieldTypes[key];
    if (value === null || value === undefined) {
      out[key] = value;
      continue;
    }
    if (type === FIELD_TYPES.RELATION) {
      out[key] = encodeRelationRef(
        value as UuidRelationRef,
        typeIdToIdentifier,
        typeIdentifierToEntryKeys
      );
    } else if (type === FIELD_TYPES.MULTIRELATION) {
      out[key] = (value as UuidRelationRef[]).map((ref) =>
        encodeRelationRef(ref, typeIdToIdentifier, typeIdentifierToEntryKeys)
      );
    } else if (type === FIELD_TYPES.RICHTEXT) {
      out[key] = encodeRichtextRefs(
        value,
        typeIdToIdentifier,
        typeIdentifierToEntryKeys
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function decodeDataRefs(
  data: Record<string, unknown>,
  fieldTypes: FieldTypeMap,
  identifierToTypeId: Map<string, string>,
  typeIdentifierToKeyToEntry: Map<string, Map<string, string>>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const type = fieldTypes[key];
    if (value === null || value === undefined) {
      out[key] = value;
      continue;
    }
    if (type === FIELD_TYPES.RELATION) {
      out[key] = decodeRelationRef(
        value as PortableRelationRef,
        identifierToTypeId,
        typeIdentifierToKeyToEntry
      );
    } else if (type === FIELD_TYPES.MULTIRELATION) {
      out[key] = (value as PortableRelationRef[]).map((ref) =>
        decodeRelationRef(ref, identifierToTypeId, typeIdentifierToKeyToEntry)
      );
    } else if (type === FIELD_TYPES.RICHTEXT) {
      out[key] = decodeRichtextRefs(
        value,
        identifierToTypeId,
        typeIdentifierToKeyToEntry
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}
