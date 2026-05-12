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
 *
 * This file also exports `findUnresolvedRefs` (entryId cascade-skip detection)
 * and `rewriteContentTypeIds` (identifier→UUID translation for contentTypeId
 * fields). All three walks share shape detection — they MUST stay in sync.
 * If a new reference shape is added in one walker, add it to the other two.
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

/**
 * Walks `data` and collects synthetic entryIds that are NOT in `map`.
 * Mirrors `rewriteSyntheticIds`'s walk — same shapes recognised:
 *   - RELATION/MULTIRELATION: `{ contentTypeId, entryId, ... }` objects
 *   - RICHTEXT: cmsEmbed nodes (attrs.entryId) and cmsLink marks (attrs.entryId)
 *
 * Use this BEFORE calling `rewriteSyntheticIds` to detect cascade-skip
 * candidates: if the returned set intersects the run's `skippedIds`, the
 * containing entry should be cascade-skipped too.
 */
export function findUnresolvedRefs(
  data: unknown,
  map: Map<string, string>
): Set<string> {
  const unresolved = new Set<string>();
  walk(data);
  return unresolved;

  function walk(value: unknown): void {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const v of value) walk(v);
      return;
    }
    const obj = value as Record<string, unknown>;

    // RELATION/MULTIRELATION ref shape: { contentTypeId, entryId, contentTypeIdentifier? }
    if (
      typeof obj.entryId === 'string' &&
      typeof obj.contentTypeId === 'string' &&
      Object.keys(obj).length <= 4
    ) {
      if (!map.has(obj.entryId)) unresolved.add(obj.entryId);
      return;
    }

    // cmsEmbed / cmsLink: check attrs.entryId
    for (const [k, v] of Object.entries(obj)) {
      if (
        k === 'attrs' &&
        v &&
        typeof v === 'object' &&
        typeof (v as { entryId?: unknown }).entryId === 'string'
      ) {
        const attrs = v as { entryId: string };
        if (!map.has(attrs.entryId)) unresolved.add(attrs.entryId);
      } else {
        walk(v);
      }
    }
  }
}

/**
 * Walks `data` and rewrites identifier-form contentTypeId fields → real DB UUIDs.
 * Targets:
 *   - RELATION: `{ contentTypeId, entryId, contentTypeIdentifier? }` objects
 *   - MULTIRELATION: arrays of the above
 *   - RICHTEXT: cmsEmbed nodes (attrs.contentTypeId) and cmsLink marks (attrs.contentTypeId)
 *
 * For each ref, if `contentTypeId` is a string AND a key in `typeIdByIdentifier`,
 * swap to the mapped UUID. Otherwise leave it unchanged (covers both
 * already-UUID values from non-portable bundles and unknown identifiers).
 *
 * Returns a deep-cloned object — input is never mutated.
 *
 * Sibling to `rewriteSyntheticIds` (entryId rewrite) and `findUnresolvedRefs`
 * (cascade-skip detection). All three walks share shape detection; they MUST
 * stay in sync — if a new reference shape is added here, add it to the
 * other walks too.
 */
export function rewriteContentTypeIds(
  data: unknown,
  typeIdByIdentifier: Map<string, string>
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
      const realCt = typeIdByIdentifier.get(obj.contentTypeId);
      const next: Record<string, unknown> = { ...obj };
      if (realCt) next.contentTypeId = realCt;
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
        const ct =
          typeof attrs.contentTypeId === 'string'
            ? typeIdByIdentifier.get(attrs.contentTypeId)
            : undefined;
        next[k] = ct ? { ...attrs, contentTypeId: ct } : { ...attrs };
      } else {
        next[k] = walk(v);
      }
    }
    return next;
  }
}
