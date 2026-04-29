export interface RichtextReference {
  contentTypeId: string;
  entryId: string;
}

/**
 * Walk a ProseMirror JSON document and return the deduplicated set of
 * (contentTypeId, entryId) pairs referenced by `cmsEmbed` and `cmsLink`
 * inline atom nodes. `externalLink` nodes are ignored (they reference URLs,
 * not entries).
 *
 * Order is document-traversal order. The pair `(ct, e)` appears at most once
 * even if it occurs multiple times across cmsEmbed and cmsLink nodes. Pairs
 * with missing, non-string, or empty-string ids are silently skipped.
 *
 * Recursion is capped at depth 1000; references deeper than that are silently
 * dropped.
 */
export function collectRichtextReferences(body: unknown): RichtextReference[] {
  const out: RichtextReference[] = [];
  const seen = new Set<string>();

  function pushIfValid(attrs: unknown): void {
    if (!attrs || typeof attrs !== 'object') return;
    const a = attrs as Record<string, unknown>;
    if (typeof a.contentTypeId !== 'string') return;
    if (typeof a.entryId !== 'string') return;
    if (a.contentTypeId === '') return;
    if (a.entryId === '') return;
    const key = `${a.contentTypeId}:${a.entryId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ contentTypeId: a.contentTypeId, entryId: a.entryId });
  }

  const MAX_DEPTH = 1000;

  function walk(node: unknown, depth: number): void {
    if (depth > MAX_DEPTH) return;
    if (!node || typeof node !== 'object') return;
    const n = node as {
      type?: unknown;
      attrs?: unknown;
      content?: unknown;
    };

    if (n.type === 'cmsEmbed' || n.type === 'cmsLink') {
      pushIfValid(n.attrs);
    }

    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child, depth + 1);
    }
  }

  walk(body, 0);
  return out;
}
