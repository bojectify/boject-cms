import type { ContentTypeField } from '#prisma';

export interface EnrichDeps {
  loadIdentifiers: (contentTypeIds: string[]) => Promise<Map<string, string>>;
}

/**
 * Collect the unique set of `contentTypeId`s referenced anywhere in a
 * ProseMirror JSON document tree by `cmsEmbed` and `cmsLink` inline atom
 * nodes (attrs.contentTypeId).
 *
 * Empty-string and non-string ids are skipped so they don't pollute the
 * downstream identifier-load query.
 */
export function collectEmbedContentTypeIds(
  body: unknown,
  out: Set<string> = new Set()
): Set<string> {
  if (!body || typeof body !== 'object') return out;
  const n = body as {
    type?: unknown;
    attrs?: unknown;
    content?: unknown;
  };
  if (n.type === 'cmsEmbed' || n.type === 'cmsLink') {
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    if (typeof attrs.contentTypeId === 'string' && attrs.contentTypeId !== '') {
      out.add(attrs.contentTypeId);
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
 * Walk a ProseMirror JSON document and return a new document where:
 *   - every `cmsEmbed` and `cmsLink` node's `attrs` has `contentTypeIdentifier`
 *     stamped from `identifierMap` (if a mapping exists);
 *   - every `cmsLink` and `externalLink` node with `target='_blank'` has
 *     `noopener noreferrer` injected into its `rel`, preserving any existing
 *     tokens such as `nofollow`.
 *
 * Nodes whose `contentTypeId` is absent from the map are left untouched
 * (defensive — the validator already enforced allow-list membership).
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
    content?: unknown;
    [key: string]: unknown;
  };

  let result: Record<string, unknown> = { ...(n as object) } as Record<
    string,
    unknown
  >;

  if (n.type === 'cmsEmbed' || n.type === 'cmsLink') {
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    let nextAttrs: Record<string, unknown> = { ...attrs };

    const identifier =
      typeof attrs.contentTypeId === 'string'
        ? identifierMap.get(attrs.contentTypeId)
        : undefined;
    if (identifier !== undefined) {
      nextAttrs.contentTypeIdentifier = identifier;
    }

    nextAttrs = applyRelInjection(nextAttrs);
    return { ...result, attrs: nextAttrs };
  }

  if (n.type === 'externalLink') {
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    return { ...result, attrs: applyRelInjection({ ...attrs }) };
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
 * Stamp `noopener noreferrer` onto link nodes with `target='_blank'`.
 * Defence-in-depth: external consumers reading `body.json` see the safe
 * rel value regardless of what the editor emitted.
 */
function applyRelInjection(
  attrs: Record<string, unknown>
): Record<string, unknown> {
  if (attrs.target !== '_blank') return attrs;
  const existing = typeof attrs.rel === 'string' ? attrs.rel.trim() : '';
  const safety = ['noopener', 'noreferrer'];
  const tokens = existing ? existing.split(/\s+/) : [];
  for (const t of safety) {
    if (!tokens.includes(t)) tokens.push(t);
  }
  return { ...attrs, rel: tokens.join(' ') };
}

/**
 * Given an entry's `data` object and its field definitions, enrich every
 * RICHTEXT field's body by stamping `contentTypeIdentifier` onto each
 * `cmsEmbed` node and each `cmsLink` node. Returns a new `data` object;
 * the input is not mutated.
 *
 * If there are no RICHTEXT fields or no references in the data, the
 * original `data` reference is returned unchanged.
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
