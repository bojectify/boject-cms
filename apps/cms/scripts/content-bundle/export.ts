import type { PrismaClient } from '#prisma';
import type {
  Bundle,
  BundleContentType,
  BundleEntry,
  BundleField,
  BundleMode,
} from './types';
import { BUNDLE_VERSION } from './types';
import { encodeDataRefs, type EntryKeyMap } from './portable';

export interface ExportOptions {
  mode: BundleMode;
  portable: boolean;
}

export async function exportBundle(
  prisma: PrismaClient,
  options: ExportOptions
): Promise<Bundle> {
  const { mode, portable } = options;

  const wantsSchema = mode === 'schema' || mode === 'all';
  const wantsEntries = mode === 'entries' || mode === 'all';

  const contentTypes = await prisma.contentType.findMany({
    include: { fields: { orderBy: { order: 'asc' } } },
    orderBy: { name: 'asc' },
  });

  const typeIdToIdentifier = new Map(
    contentTypes.map((c) => [c.id, c.identifier])
  );
  const identifierByTypeId = (id: string) => typeIdToIdentifier.get(id) ?? id;

  const allEntries = await prisma.contentEntry.findMany({
    include: { versions: true },
    orderBy: [{ contentTypeId: 'asc' }, { entryTitle: 'asc' }],
  });

  const entryKeysByType = new Map<string, EntryKeyMap>();
  for (const entry of allEntries) {
    const identifier = typeIdToIdentifier.get(entry.contentTypeId);
    if (!identifier) continue;
    let map = entryKeysByType.get(identifier);
    if (!map) {
      map = new Map();
      entryKeysByType.set(identifier, map);
    }
    map.set(entry.id, entry.entryKey);
  }

  const bundle: Bundle = {
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    portable,
  };

  if (wantsSchema) {
    bundle.contentTypes = contentTypes.map((ct) => {
      const fields: BundleField[] = ct.fields.map((f) => {
        const opts = (f.options ?? null) as BundleField['options'];
        let outOpts = opts;
        if (portable && opts && Array.isArray(opts.targetContentTypeIds)) {
          const idents = opts.targetContentTypeIds.map((id) =>
            identifierByTypeId(id as string)
          );
          outOpts = {
            ...opts,
            targetContentTypeIds: opts.targetContentTypeIds.map(() => null),
            targetContentTypeIdentifiers: idents,
          };
        } else if (
          !portable &&
          opts &&
          Array.isArray(opts.targetContentTypeIds)
        ) {
          const idents = (opts.targetContentTypeIds as string[]).map(
            (id) => typeIdToIdentifier.get(id) ?? id
          );
          outOpts = { ...opts, targetContentTypeIdentifiers: idents };
        }

        return {
          id: portable ? null : f.id,
          identifier: f.identifier,
          name: f.name,
          type: f.type,
          required: f.required,
          unique: f.unique,
          order: f.order,
          options: outOpts,
        };
      });

      return {
        id: portable ? null : ct.id,
        identifier: ct.identifier,
        name: ct.name,
        description: ct.description ?? null,
        fields,
      } satisfies BundleContentType;
    });
  }

  if (wantsEntries) {
    const fieldTypesByContentTypeId = new Map<string, Record<string, string>>();
    for (const ct of contentTypes) {
      const map: Record<string, string> = {};
      for (const f of ct.fields) map[f.identifier] = f.type;
      fieldTypesByContentTypeId.set(ct.id, map);
    }

    bundle.entries = allEntries.map((entry) => {
      const identifier =
        typeIdToIdentifier.get(entry.contentTypeId) ?? entry.contentTypeId;
      const fieldTypes =
        fieldTypesByContentTypeId.get(entry.contentTypeId) ?? {};

      return {
        id: portable ? null : entry.id,
        contentTypeId: portable ? null : entry.contentTypeId,
        contentTypeIdentifier: identifier,
        entryTitle: entry.entryTitle,
        entryKey: entry.entryKey,
        slug: entry.slug,
        versions: entry.versions.map((v) => ({
          status: v.status,
          data: portable
            ? encodeDataRefs(
                v.data as Record<string, unknown>,
                fieldTypes as Record<string, import('#prisma').FieldType>,
                typeIdToIdentifier,
                entryKeysByType
              )
            : (v.data as Record<string, unknown>),
          publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
        })),
      } satisfies BundleEntry;
    });
  }

  return bundle;
}
