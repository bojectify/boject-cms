import type { ContentTypeField } from '#prisma';

export interface EnrichDeps {
  loadIdentifiers: (contentTypeIds: string[]) => Promise<Map<string, string>>;
}

/**
 * Collect the unique set of contentTypeIds referenced by `cmsEmbed` nodes
 * anywhere in a ProseMirror JSON document tree.
 */
export function collectEmbedContentTypeIds(
  body: unknown,
  out: Set<string> = new Set()
): Set<string> {
  if (!body || typeof body !== 'object') return out;
  const n = body as {
    type?: unknown;
    attrs?: unknown;
    marks?: unknown;
    content?: unknown;
  };
  if (n.type === 'cmsEmbed') {
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    if (typeof attrs.contentTypeId === 'string') {
      out.add(attrs.contentTypeId);
    }
  }
  if (Array.isArray(n.marks)) {
    for (const mark of n.marks) {
      if (!mark || typeof mark !== 'object') continue;
      const m = mark as { type?: unknown; attrs?: unknown };
      if (m.type === 'cmsLink') {
        const a = (m.attrs ?? {}) as Record<string, unknown>;
        if (typeof a.contentTypeId === 'string') out.add(a.contentTypeId);
      }
    }
  }
  if (Array.isArray(n.content)) {
    for (const child of n.content) {
      collectEmbedContentTypeIds(child, out);
    }
  }
  return out;
}

/**
 * Walk a ProseMirror JSON document and return a new document where every
 * `cmsEmbed` node's `attrs` includes `contentTypeIdentifier` sourced from
 * `identifierMap`. Nodes whose `contentTypeId` is absent from the map are
 * left untouched (defensive — the validator already enforced allow-list
 * membership). Any stale `contentTypeIdentifier` already stored on the node
 * is overwritten with the current canonical value.
 *
 * The function is purely functional — the input tree is never mutated.
 */
export function enrichBodyWithContentTypeIdentifiers(
  body: unknown,
  identifierMap: Map<string, string>
): unknown {
  if (!body || typeof body !== 'object') return body;

  const n = body as {
    type?: unknown;
    attrs?: unknown;
    marks?: unknown;
    content?: unknown;
    [key: string]: unknown;
  };

  let result: Record<string, unknown> = { ...(n as object) } as Record<
    string,
    unknown
  >;

  if (n.type === 'cmsEmbed') {
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    const identifier =
      typeof attrs.contentTypeId === 'string'
        ? identifierMap.get(attrs.contentTypeId)
        : undefined;
    if (identifier !== undefined) {
      result = {
        ...result,
        attrs: { ...attrs, contentTypeIdentifier: identifier },
      };
    }
    return result;
  }

  if (Array.isArray(n.marks)) {
    const newMarks = n.marks.map((mark) => {
      if (!mark || typeof mark !== 'object') return mark;
      const m = mark as { type?: unknown; attrs?: unknown };
      if (m.type !== 'cmsLink') return mark;
      const attrs = (m.attrs ?? {}) as Record<string, unknown>;
      const identifier =
        typeof attrs.contentTypeId === 'string'
          ? identifierMap.get(attrs.contentTypeId)
          : undefined;
      if (identifier === undefined) return mark;
      return { ...m, attrs: { ...attrs, contentTypeIdentifier: identifier } };
    });
    result = { ...result, marks: newMarks };
  }

  if (Array.isArray(n.content)) {
    const newContent = n.content.map((child) =>
      enrichBodyWithContentTypeIdentifiers(child, identifierMap)
    );
    result = { ...result, content: newContent };
  }

  return result;
}

/**
 * Given an entry's `data` object and its field definitions, enrich every
 * RICHTEXT field's body by stamping `contentTypeIdentifier` onto each
 * `cmsEmbed` node. Returns a new `data` object; the input is not mutated.
 *
 * If there are no RICHTEXT fields or no embeds in the data, the original
 * `data` reference is returned unchanged.
 */
export async function enrichEntryDataWithEmbedIdentifiers(
  data: Record<string, unknown>,
  fields: Pick<ContentTypeField, 'identifier' | 'type'>[],
  deps: EnrichDeps
): Promise<Record<string, unknown>> {
  const richtextFields = fields.filter((f) => f.type === 'RICHTEXT');
  if (richtextFields.length === 0) return data;

  // Collect all unique contentTypeIds across all RICHTEXT fields
  const allIds = new Set<string>();
  for (const field of richtextFields) {
    const body = data[field.identifier];
    if (body != null) {
      collectEmbedContentTypeIds(body, allIds);
    }
  }

  if (allIds.size === 0) return data;

  const identifierMap = await deps.loadIdentifiers([...allIds]);

  // Build a new data object with enriched RICHTEXT bodies
  const enriched: Record<string, unknown> = { ...data };
  for (const field of richtextFields) {
    const body = data[field.identifier];
    if (body != null) {
      enriched[field.identifier] = enrichBodyWithContentTypeIdentifiers(
        body,
        identifierMap
      );
    }
  }

  return enriched;
}
