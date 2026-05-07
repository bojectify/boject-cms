/**
 * Walks `data` and rewrites synthetic entryIds → real DB entryIds.
 * Targets:
 *   - RELATION: `{ contentTypeId, entryId, contentTypeIdentifier }` objects
 *   - MULTIRELATION: arrays of the above
 *   - RICHTEXT: cmsEmbed nodes (attrs.entryId) and cmsLink marks (attrs.entryId)
 * Unmapped IDs are left in place — caller must ensure all referenced IDs
 * are in the map by the time this is called for a given group.
 *
 * Returns a deep-cloned object — input is never mutated.
 */
export function rewriteSyntheticIds(
  data: unknown,
  map: Map<string, string>
): unknown {
  return walk(data);

  function walk(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(walk);

    const obj = value as Record<string, unknown>;

    // RELATION/MULTIRELATION ref shape: { contentTypeId, entryId, contentTypeIdentifier? }
    if (
      typeof obj.entryId === 'string' &&
      typeof obj.contentTypeId === 'string' &&
      Object.keys(obj).length <= 4
    ) {
      const real = map.get(obj.entryId);
      const next: Record<string, unknown> = { ...obj };
      if (real) next.entryId = real;
      return next;
    }

    // cmsEmbed / cmsLink: walk attrs
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (
        k === 'attrs' &&
        v &&
        typeof v === 'object' &&
        typeof (v as { entryId?: unknown }).entryId === 'string'
      ) {
        const attrs = v as Record<string, unknown>;
        const real = map.get(attrs.entryId as string);
        next[k] = real ? { ...attrs, entryId: real } : { ...attrs };
      } else {
        next[k] = walk(v);
      }
    }
    return next;
  }
}
