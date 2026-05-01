// apps/cms/scripts/content-bundle/snapshotCurrentSchema.ts
//
// The only impure file in the planner spec. Reads current schema +
// per-field usage from a PrismaClient (or transaction client) and
// returns a CurrentSchemaSnapshot the pure planner consumes.

import type { PrismaClient } from '#prisma';
import type { CurrentSchemaSnapshot, FieldUsage } from './schemaPlan.types';

export async function snapshotCurrentSchema(
  prisma: PrismaClient
): Promise<CurrentSchemaSnapshot> {
  const types = await prisma.contentType.findMany({
    include: { fields: { orderBy: { order: 'asc' } } },
    orderBy: { identifier: 'asc' },
  });

  const typeIdToIdentifier = new Map(types.map((t) => [t.id, t.identifier]));

  // Counts per type. Single grouped query.
  const entryCountRows = await prisma.contentEntry.groupBy({
    by: ['contentTypeId'],
    _count: { _all: true },
  });
  const entryCountByTypeId = new Map(
    entryCountRows.map((r) => [r.contentTypeId, r._count._all])
  );

  // Pull every entry with its versions in one pass for fieldUsage.
  // For "live editor view" use the most recent non-archived version
  // per entry (CHANGED > DRAFT > PUBLISHED).
  const entries = await prisma.contentEntry.findMany({
    include: { versions: true },
  });

  const fieldUsage = new Map<string, FieldUsage>();

  for (const ct of types) {
    for (const field of ct.fields) {
      const key = `${ct.identifier}:${field.identifier}`;
      const usage: FieldUsage = { entriesWithValue: 0 };
      const fieldType = field.type;
      const trackChoices = fieldType === 'SELECT';
      const trackRelationTargets =
        fieldType === 'RELATION' || fieldType === 'MULTIRELATION';
      const trackDuplicates = fieldType === 'TEXT' || fieldType === 'NUMBER';

      if (trackChoices) usage.selectChoiceCounts = new Map();
      if (trackRelationTargets) usage.relationTargetCounts = new Map();
      const valuesByEntry: Map<string, unknown> = new Map(); // for duplicates

      for (const entry of entries) {
        if (entry.contentTypeId !== ct.id) continue;
        const liveVersion = pickLiveVersion(entry.versions);
        if (!liveVersion) continue;
        const data = liveVersion.data as Record<string, unknown>;
        const value = data?.[field.identifier];
        if (value === undefined || value === null || value === '') continue;
        usage.entriesWithValue += 1;

        if (trackChoices && typeof value === 'string') {
          usage.selectChoiceCounts!.set(
            value,
            (usage.selectChoiceCounts!.get(value) ?? 0) + 1
          );
        }
        if (trackRelationTargets) {
          const refs = Array.isArray(value) ? value : [value];
          for (const ref of refs) {
            if (!ref || typeof ref !== 'object') continue;
            const targetTypeId = (ref as { contentTypeId?: string })
              .contentTypeId;
            if (!targetTypeId) continue;
            const targetIdentifier = typeIdToIdentifier.get(targetTypeId);
            if (!targetIdentifier) continue;
            usage.relationTargetCounts!.set(
              targetIdentifier,
              (usage.relationTargetCounts!.get(targetIdentifier) ?? 0) + 1
            );
          }
        }
        if (trackDuplicates) {
          valuesByEntry.set(entry.id, value);
        }
      }

      if (trackDuplicates) {
        const groups = new Map<string, string[]>();
        for (const [entryId, val] of valuesByEntry) {
          const k = JSON.stringify(val);
          let group = groups.get(k);
          if (!group) {
            group = [];
            groups.set(k, group);
          }
          group.push(entryId);
        }
        const dups: NonNullable<FieldUsage['duplicateValues']> = [];
        for (const [k, ids] of groups) {
          if (ids.length > 1) {
            dups.push({ value: JSON.parse(k), entryIds: ids });
          }
        }
        if (dups.length > 0) usage.duplicateValues = dups;
      }

      fieldUsage.set(key, usage);
    }
  }

  return {
    contentTypes: types.map((ct) => ({
      id: ct.id,
      identifier: ct.identifier,
      name: ct.name,
      description: ct.description,
      fields: ct.fields.map((f) => ({
        id: f.id,
        identifier: f.identifier,
        name: f.name,
        type: f.type,
        required: f.required,
        unique: f.unique,
        order: f.order,
        options: f.options as Record<string, unknown> | null,
      })),
      entryCount: entryCountByTypeId.get(ct.id) ?? 0,
    })),
    fieldUsage,
  };
}

type Version = {
  status: 'DRAFT' | 'PUBLISHED' | 'CHANGED' | 'ARCHIVED';
  data: unknown;
};

function pickLiveVersion(versions: Version[]): Version | null {
  return (
    versions.find((v) => v.status === 'CHANGED') ??
    versions.find((v) => v.status === 'DRAFT') ??
    versions.find((v) => v.status === 'PUBLISHED') ??
    null
  );
}
