import type { FieldType } from '#prisma';

export interface UuidRelationRef {
  contentTypeId: string;
  entryId: string;
}

export interface PortableRelationRef {
  contentTypeIdentifier: string;
  entryKey: string;
}

export type EntryKeyMap = Map<
  string,
  { slug: string | null; entryTitle: string }
>;

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
  const keys = entryMap?.get(ref.entryId);
  if (!keys) {
    throw new Error(
      `Cannot encode relation ref: entry ${ref.entryId} not found for ${identifier}`
    );
  }
  const entryKey = keys.slug ?? keys.entryTitle;
  if (!entryKey) {
    throw new Error(
      `Cannot encode relation ref: entry ${ref.entryId} has no slug or entryTitle`
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
    throw new Error(
      `Cannot decode relation ref: unknown identifier ${ref.contentTypeIdentifier}`
    );
  }
  const keyMap = typeIdentifierToKeyToEntry.get(ref.contentTypeIdentifier);
  const entryId = keyMap?.get(ref.entryKey);
  if (!entryId) {
    throw new Error(
      `Cannot decode relation ref: entry ${ref.contentTypeIdentifier}:${ref.entryKey} not found`
    );
  }
  return { contentTypeId, entryId };
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
    if (type === 'RELATION') {
      out[key] = encodeRelationRef(
        value as UuidRelationRef,
        typeIdToIdentifier,
        typeIdentifierToEntryKeys
      );
    } else if (type === 'MULTIRELATION') {
      out[key] = (value as UuidRelationRef[]).map((ref) =>
        encodeRelationRef(ref, typeIdToIdentifier, typeIdentifierToEntryKeys)
      );
    } else if (type === 'RICHTEXT') {
      out[key] = rewriteCmsEmbeds(value, (attrs) => {
        const { embedType, embedId } = attrs;
        if (!embedType || !embedId) return attrs;
        const ident = typeIdToIdentifier.get(embedType);
        if (!ident) return attrs;
        const entryMap = typeIdentifierToEntryKeys.get(ident);
        const keys = entryMap?.get(embedId);
        if (!keys) return attrs;
        const entryKey = keys.slug ?? keys.entryTitle;
        return { embedType: ident, embedKey: entryKey };
      });
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
    if (type === 'RELATION') {
      out[key] = decodeRelationRef(
        value as PortableRelationRef,
        identifierToTypeId,
        typeIdentifierToKeyToEntry
      );
    } else if (type === 'MULTIRELATION') {
      out[key] = (value as PortableRelationRef[]).map((ref) =>
        decodeRelationRef(ref, identifierToTypeId, typeIdentifierToKeyToEntry)
      );
    } else if (type === 'RICHTEXT') {
      out[key] = rewriteCmsEmbeds(value, (attrs) => {
        const { embedType, embedKey } = attrs;
        if (!embedType || !embedKey) return attrs;
        const contentTypeId = identifierToTypeId.get(embedType);
        if (!contentTypeId) return attrs;
        const keyMap = typeIdentifierToKeyToEntry.get(embedType);
        const entryId = keyMap?.get(embedKey);
        if (!entryId) return attrs;
        return { embedType: contentTypeId, embedId: entryId };
      });
    } else {
      out[key] = value;
    }
  }
  return out;
}

function rewriteCmsEmbeds(
  doc: unknown,
  rewrite: (attrs: Record<string, string>) => Record<string, unknown>
): unknown {
  if (!doc || typeof doc !== 'object') return doc;
  if (Array.isArray(doc)) return doc.map((n) => rewriteCmsEmbeds(n, rewrite));
  const node = doc as Record<string, unknown>;
  if (node.type === 'cmsEmbed' && typeof node.attrs === 'object') {
    return { ...node, attrs: rewrite(node.attrs as Record<string, string>) };
  }
  const out: Record<string, unknown> = { ...node };
  if (Array.isArray(node.content)) {
    out.content = (node.content as unknown[]).map((n) =>
      rewriteCmsEmbeds(n, rewrite)
    );
  }
  return out;
}
