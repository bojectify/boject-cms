import type { PrismaClient, FieldType, Prisma, ContentStatus } from '#prisma';
import type {
  Bundle,
  BundleEntry,
  BundleField,
  BundleMode,
  ImportResult,
  OnConflict,
} from './types';
import { validateBundle } from './validate';
import { decodeDataRefs } from './portable';
import { FIELD_TYPES } from '../../utils/fieldTypes';
import { planEntryImport } from './planEntryImport';

export interface ImportOptions {
  mode: BundleMode;
  author?: string;
  onConflict?: OnConflict;
  dryRun?: boolean;
}

// Mirrors apps/cms/server/utils/validateFieldUnique.ts::resolveUniqueFlag
// without depending on h3 (this module runs from `tsx` standalone too).
// ENTRY_TITLE and SLUG are always unique; everything else honours the
// bundle's flag (defaulting to false for legacy bundles that don't carry it).
function resolveBundleFieldUnique(f: BundleField): boolean {
  if (f.type === FIELD_TYPES.ENTRY_TITLE || f.type === FIELD_TYPES.SLUG)
    return true;
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

  const { mode, author, onConflict = 'fail', dryRun = false } = options;
  const wantsSchema = mode === 'schema' || mode === 'all';
  const wantsEntries = mode === 'entries' || mode === 'all';

  // Dry-run mechanism: the transaction still opens and the planner +
  // executor populate counters as normal, but at the end we throw a
  // sentinel exception so Prisma rolls back. The summary was captured
  // into `captured` before the throw.
  class DryRunRollback extends Error {}
  let captured: ImportResult = {
    contentTypesCreated: 0,
    entriesCreated: 0,
    entriesUpdated: 0,
    entriesSkipped: 0,
  };

  try {
    await prisma.$transaction(async (tx) => {
      let contentTypesCreated = 0;
      let entriesCreated = 0;
      let entriesUpdated = 0;
      let entriesSkipped = 0;

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
        const { plans } = planEntryImport(
          typeIdentifierToKeyToEntry,
          bundle,
          identifierToTypeId,
          onConflict
        );

        const pendingEntries: Array<{
          entryId: string;
          versionIds: string[];
          bundleEntry: BundleEntry;
          rawDataArrays: Record<string, unknown>[];
        }> = [];

        const buildVersionCreates = (
          bundleEntry: BundleEntry,
          versionSpecs: Array<{
            data: Record<string, unknown>;
            status: ContentStatus;
            publishedAt: string | null;
          }>,
          pass1Datas: Record<string, unknown>[]
        ) =>
          versionSpecs.map((v, i) => ({
            data: pass1Datas[i] as Prisma.InputJsonValue,
            entryTitle: bundleEntry.entryTitle,
            status: v.status,
            publishedAt: v.publishedAt ? new Date(v.publishedAt) : null,
            createdBy: author ?? null,
            updatedBy: author ?? null,
          }));

        for (const plan of plans) {
          const e = plan.bundleEntry;
          const typeId = identifierToTypeId.get(e.contentTypeIdentifier)!;
          const fieldTypes = fieldTypesByTypeId.get(typeId) ?? {};

          if (plan.action === 'skip') {
            // Seed the relation-resolution map with the existing id so
            // portable bundles can still resolve references to skipped entries.
            let map = typeIdentifierToKeyToEntry.get(e.contentTypeIdentifier);
            if (!map) {
              map = new Map();
              typeIdentifierToKeyToEntry.set(e.contentTypeIdentifier, map);
            }
            map.set(e.entryKey, plan.existingId);
            entriesSkipped++;
            continue;
          }

          const versionSpecs = e.versions.map((v) => ({
            data: v.data,
            status: v.status,
            publishedAt: v.publishedAt,
          }));
          const pass1Datas = versionSpecs.map((v) =>
            bundle.portable
              ? stripRelationFields(v.data, fieldTypes)
              : (v.data as Record<string, unknown>)
          );

          let entryId: string;
          let versionIds: string[];

          if (plan.action === 'create') {
            const created = await tx.contentEntry.create({
              data: {
                id: bundle.portable ? undefined : (e.id ?? undefined),
                contentTypeId: typeId,
                entryTitle: e.entryTitle,
                entryKey: e.entryKey,
                slug: e.slug,
                versions: {
                  create: buildVersionCreates(e, versionSpecs, pass1Datas),
                },
              },
              include: { versions: true },
            });
            entryId = created.id;
            versionIds = created.versions.map((v) => v.id);
            entriesCreated++;
          } else {
            // update
            await tx.contentEntryVersion.deleteMany({
              where: { entryId: plan.existingId },
            });
            const updated = await tx.contentEntry.update({
              where: { id: plan.existingId },
              data: {
                entryTitle: e.entryTitle,
                slug: e.slug,
                versions: {
                  create: buildVersionCreates(e, versionSpecs, pass1Datas),
                },
              },
              include: { versions: true },
            });
            entryId = updated.id;
            versionIds = updated.versions.map((v) => v.id);
            entriesUpdated++;
          }

          let map = typeIdentifierToKeyToEntry.get(e.contentTypeIdentifier);
          if (!map) {
            map = new Map();
            typeIdentifierToKeyToEntry.set(e.contentTypeIdentifier, map);
          }
          map.set(e.entryKey, entryId);

          pendingEntries.push({
            entryId,
            versionIds,
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

      captured = {
        contentTypesCreated,
        entriesCreated,
        entriesUpdated,
        entriesSkipped,
      };
      if (dryRun) throw new DryRunRollback();
    });
    // Prisma $transaction rethrows the user-callback error verbatim after
    // issuing ROLLBACK, so the sentinel arrives at this catch with its
    // identity intact and instanceof matches.
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }

  return captured;
}

function stripRelationFields(
  data: Record<string, unknown>,
  fieldTypes: Record<string, FieldType>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const type = fieldTypes[key];
    if (type === FIELD_TYPES.RELATION || type === FIELD_TYPES.MULTIRELATION) {
      out[key] = null;
    } else {
      out[key] = value;
    }
  }
  return out;
}
