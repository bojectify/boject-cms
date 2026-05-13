import type { PrismaClient, FieldType, Prisma } from '#prisma';
import type {
  Bundle,
  BundleEntry,
  BundleField,
  BundleMode,
  ImportResult,
} from './types';
import { validateBundle } from './validate';
import { decodeDataRefs } from './portable';

export interface ImportOptions {
  mode: BundleMode;
  author?: string;
}

// Mirrors apps/cms/server/utils/validateFieldUnique.ts::resolveUniqueFlag
// without depending on h3 (this module runs from `tsx` standalone too).
// ENTRY_TITLE and SLUG are always unique; everything else honours the
// bundle's flag (defaulting to false for legacy bundles that don't carry it).
function resolveBundleFieldUnique(f: BundleField): boolean {
  if (f.type === 'ENTRY_TITLE' || f.type === 'SLUG') return true;
  return f.unique === true;
}

export async function importBundle(
  prisma: PrismaClient,
  bundle: Bundle,
  options: ImportOptions
): Promise<ImportResult> {
  const validation = validateBundle(bundle);
  if (!validation.ok) {
    throw new Error(
      `Bundle failed validation:\n${validation.errors
        .map((e) => `  ${e.path}: ${e.message}`)
        .join('\n')}`
    );
  }

  const { mode, author } = options;
  const wantsSchema = mode === 'schema' || mode === 'all';
  const wantsEntries = mode === 'entries' || mode === 'all';

  return prisma.$transaction(async (tx) => {
    let contentTypesCreated = 0;
    let entriesCreated = 0;

    const identifierToTypeId = new Map<string, string>();
    const typeIdentifierToKeyToEntry = new Map<string, Map<string, string>>();
    const fieldTypesByTypeId = new Map<string, Record<string, FieldType>>();

    const existingTypes = await tx.contentType.findMany({
      include: { fields: true },
    });
    for (const ct of existingTypes) {
      identifierToTypeId.set(ct.identifier, ct.id);
      const fieldTypes: Record<string, FieldType> = {};
      for (const f of ct.fields) fieldTypes[f.identifier] = f.type;
      fieldTypesByTypeId.set(ct.id, fieldTypes);
    }
    const existingEntries = await tx.contentEntry.findMany();
    for (const entry of existingEntries) {
      const ident = existingTypes.find(
        (t) => t.id === entry.contentTypeId
      )?.identifier;
      if (!ident) continue;
      let map = typeIdentifierToKeyToEntry.get(ident);
      if (!map) {
        map = new Map();
        typeIdentifierToKeyToEntry.set(ident, map);
      }
      map.set(entry.entryKey, entry.id);
    }

    // Pending field-target resolutions — in portable mode, RELATION/
    // MULTIRELATION targetContentTypeIdentifiers may point to content types
    // declared later in the bundle. Pass 1 creates fields with an empty
    // targetContentTypeIds array; pass 2 resolves and updates them below.
    const pendingFieldTargets: Array<{
      fieldId: string;
      fieldIdentifier: string;
      identifiers: string[];
      otherOptions: Record<string, unknown>;
    }> = [];

    if (wantsSchema && bundle.contentTypes) {
      for (const ct of bundle.contentTypes) {
        if (identifierToTypeId.has(ct.identifier)) {
          throw new Error(
            `ContentType identifier "${ct.identifier}" already exists on target`
          );
        }
      }

      for (const ct of bundle.contentTypes) {
        const created = await tx.contentType.create({
          data: {
            id: bundle.portable ? undefined : (ct.id ?? undefined),
            identifier: ct.identifier,
            name: ct.name,
            description: ct.description ?? undefined,
            fields: {
              create: ct.fields.map((f) => {
                let opts = f.options ?? null;
                if (
                  bundle.portable &&
                  opts &&
                  Array.isArray(opts.targetContentTypeIdentifiers)
                ) {
                  // Defer target resolution to pass 2 — other content types
                  // in this bundle may not yet be created.
                  const {
                    targetContentTypeIdentifiers: _omitIdents,
                    targetContentTypeIds: _omitIds,
                    ...rest
                  } = opts;
                  opts = { ...rest, targetContentTypeIds: [] };
                }
                return {
                  id: bundle.portable ? undefined : (f.id ?? undefined),
                  identifier: f.identifier,
                  name: f.name,
                  type: f.type,
                  required: f.required,
                  unique: resolveBundleFieldUnique(f),
                  order: f.order,
                  options: (opts ?? undefined) as Prisma.InputJsonValue,
                };
              }),
            },
          },
          include: { fields: true },
        });
        contentTypesCreated++;
        identifierToTypeId.set(created.identifier, created.id);
        const fieldTypes: Record<string, FieldType> = {};
        for (const f of created.fields) fieldTypes[f.identifier] = f.type;
        fieldTypesByTypeId.set(created.id, fieldTypes);

        if (bundle.portable) {
          for (const bundleField of ct.fields) {
            const opts = bundleField.options;
            if (!opts || !Array.isArray(opts.targetContentTypeIdentifiers)) {
              continue;
            }
            const createdField = created.fields.find(
              (cf) => cf.identifier === bundleField.identifier
            );
            if (!createdField) continue;
            const {
              targetContentTypeIdentifiers: _omitIdents,
              targetContentTypeIds: _omitIds,
              ...otherOptions
            } = opts;
            pendingFieldTargets.push({
              fieldId: createdField.id,
              fieldIdentifier: bundleField.identifier,
              identifiers: opts.targetContentTypeIdentifiers,
              otherOptions,
            });
          }
        }
      }

      // Pass 2: resolve deferred RELATION/MULTIRELATION field targets now
      // that every content type declared in this bundle exists.
      for (const pending of pendingFieldTargets) {
        const resolved = pending.identifiers.map((ident) => {
          const id = identifierToTypeId.get(ident);
          if (!id) {
            throw new Error(
              `RELATION field "${pending.fieldIdentifier}" targets unknown content type "${ident}"`
            );
          }
          return id;
        });
        await tx.contentTypeField.update({
          where: { id: pending.fieldId },
          data: {
            options: {
              ...pending.otherOptions,
              targetContentTypeIds: resolved,
            } as Prisma.InputJsonValue,
          },
        });
      }
    }

    if (wantsEntries && bundle.entries) {
      for (const e of bundle.entries) {
        const typeId = identifierToTypeId.get(e.contentTypeIdentifier);
        if (!typeId) {
          throw new Error(
            `Entry "${e.entryTitle}" references unknown content type "${e.contentTypeIdentifier}"`
          );
        }
        const existing = await tx.contentEntry.findFirst({
          where: { contentTypeId: typeId, entryKey: e.entryKey },
        });
        if (existing) {
          throw new Error(
            `Entry "${e.contentTypeIdentifier}:${e.entryKey}" already exists on target`
          );
        }
      }

      const pendingEntries: Array<{
        entryId: string;
        versionIds: string[];
        bundleEntry: BundleEntry;
        /** The raw data arrays (one per version) before portable resolution */
        rawDataArrays: Record<string, unknown>[];
      }> = [];

      for (const e of bundle.entries) {
        const typeId = identifierToTypeId.get(e.contentTypeIdentifier)!;
        const fieldTypes = fieldTypesByTypeId.get(typeId) ?? {};
        const isV2 = Array.isArray(e.versions);

        // Normalise versions: V1 entries have flat status/data, V2 entries
        // have a versions array.
        const versionSpecs = isV2
          ? e.versions!.map((v) => ({
              data: v.data,
              status: v.status,
              publishedAt: v.publishedAt,
            }))
          : [
              {
                data: e.data!,
                status: e.status!,
                publishedAt: e.publishedAt ?? null,
              },
            ];

        const pass1Datas = versionSpecs.map((v) =>
          bundle.portable
            ? stripRelationFields(v.data, fieldTypes)
            : (v.data as Record<string, unknown>)
        );

        const created = await tx.contentEntry.create({
          data: {
            id: bundle.portable ? undefined : (e.id ?? undefined),
            contentTypeId: typeId,
            entryTitle: e.entryTitle,
            entryKey: e.entryKey,
            slug: e.slug,
            versions: {
              create: versionSpecs.map((v, i) => ({
                data: pass1Datas[i] as Prisma.InputJsonValue,
                entryTitle: e.entryTitle,
                status: v.status,
                publishedAt: v.publishedAt ? new Date(v.publishedAt) : null,
                createdBy: author ?? null,
                updatedBy: author ?? null,
              })),
            },
          },
          include: { versions: true },
        });

        entriesCreated++;
        let map = typeIdentifierToKeyToEntry.get(e.contentTypeIdentifier);
        if (!map) {
          map = new Map();
          typeIdentifierToKeyToEntry.set(e.contentTypeIdentifier, map);
        }
        map.set(e.entryKey, created.id);

        pendingEntries.push({
          entryId: created.id,
          versionIds: created.versions.map((v) => v.id),
          bundleEntry: e,
          rawDataArrays: versionSpecs.map((v) => v.data),
        });
      }

      if (bundle.portable) {
        for (const {
          versionIds,
          bundleEntry,
          rawDataArrays,
        } of pendingEntries) {
          const typeId = identifierToTypeId.get(
            bundleEntry.contentTypeIdentifier
          )!;
          const fieldTypes = fieldTypesByTypeId.get(typeId) ?? {};
          for (let i = 0; i < versionIds.length; i++) {
            const resolvedData = decodeDataRefs(
              rawDataArrays[i]!,
              fieldTypes,
              identifierToTypeId,
              typeIdentifierToKeyToEntry
            );
            await tx.contentEntryVersion.update({
              where: { id: versionIds[i] },
              data: {
                data: resolvedData as Prisma.InputJsonValue,
              },
            });
          }
        }
      }
    }

    return { contentTypesCreated, entriesCreated };
  });
}

function stripRelationFields(
  data: Record<string, unknown>,
  fieldTypes: Record<string, FieldType>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const type = fieldTypes[key];
    if (type === 'RELATION' || type === 'MULTIRELATION') {
      out[key] = null;
    } else {
      out[key] = value;
    }
  }
  return out;
}
