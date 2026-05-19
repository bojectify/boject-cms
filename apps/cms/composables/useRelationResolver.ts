import { FIELD_TYPES } from '~/utils/fieldTypes';
interface RelationRef {
  contentTypeId: string;
  entryId: string;
}

interface ResolvedRelation {
  contentTypeId: string;
  entryId: string;
  entryTitle: string;
  contentTypeName: string;
}

export function useRelationResolver() {
  // useRequestFetch returns a $fetch instance that forwards the incoming
  // request's cookies/headers when running during SSR. No-op on client.
  const request$fetch = useRequestFetch();

  const cache = reactive<
    Record<string, { entryTitle: string; contentTypeName: string }>
  >({});

  const contentTypeNames = reactive<Record<string, string>>({});

  async function resolveContentTypeName(
    contentTypeId: string
  ): Promise<string> {
    if (contentTypeNames[contentTypeId]) return contentTypeNames[contentTypeId];
    const ct = await request$fetch<{ name: string }>(
      `/api/content-types/${contentTypeId}`
    );
    contentTypeNames[contentTypeId] = ct.name;
    return ct.name;
  }

  async function resolveRef(ref: RelationRef): Promise<ResolvedRelation> {
    const cacheKey = `${ref.contentTypeId}:${ref.entryId}`;
    if (cache[cacheKey]) {
      return {
        ...ref,
        entryTitle: cache[cacheKey].entryTitle,
        contentTypeName: cache[cacheKey].contentTypeName,
      };
    }

    const [entry, contentTypeName] = await Promise.all([
      request$fetch<{
        data: Record<string, unknown>;
        contentType?: {
          name: string;
          fields: Array<{ identifier: string; type: string }>;
        };
      }>(`/api/content-entries/${ref.entryId}`),
      resolveContentTypeName(ref.contentTypeId),
    ]);

    const titleField = entry.contentType?.fields.find(
      (f) => f.type === FIELD_TYPES.ENTRY_TITLE
    );
    const titleKey = titleField?.identifier ?? 'title';
    const entryTitle = (entry.data[titleKey] as string) ?? 'Untitled';

    cache[cacheKey] = { entryTitle, contentTypeName };

    return { ...ref, entryTitle, contentTypeName };
  }

  async function resolveRefs(refs: RelationRef[]): Promise<ResolvedRelation[]> {
    return Promise.all(refs.map((r) => resolveRef(r)));
  }

  function updateCache(
    contentTypeId: string,
    entryId: string,
    entryTitle: string
  ) {
    const cacheKey = `${contentTypeId}:${entryId}`;
    const existing = cache[cacheKey];
    if (existing) {
      cache[cacheKey] = { ...existing, entryTitle };
    }
  }

  return { resolveRef, resolveRefs, updateCache };
}
